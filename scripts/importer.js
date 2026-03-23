/**
 * importer.js — Оркестратор всего процесса импорта Roll20 → Foundry VTT.
 * Координирует все парсеры и адаптеры, обрабатывает ошибки, батчи документов.
 */

import { AssetManager }     from "./asset-manager.js";
import { IdMapper }         from "./core/id-mapper.js";
import { buildFolderTree }  from "./core/folder-builder.js";
import { handoutToJournalEntry } from "./core/journal-parser.js";
import { jukeboxToPlaylist }     from "./core/playlist-parser.js";
import { tableToRollTable }      from "./core/table-parser.js";
import { macroToMacro }          from "./core/macro-parser.js";
import {
  buildSceneBase, parseWallPath, parseDoorObject,
  graphicToToken, graphicToTile, textToDrawing
} from "./core/scene-parser.js";
import {
  R20Character, R20Page, R20Handout, R20JukeboxTrack, R20Table, R20Macro
} from "./core/r20-document.js";
import { getDnd5eAdapters } from "./systems/dnd5e/index.js";
import { GenericAdapter }   from "./systems/generic/index.js";
import { CompendiumIndex }  from "./library/compendium-index.js";
import { ActorAssembler }   from "./library/actor-assembler.js";

export class R20Importer {
  constructor(options) {
    this.options  = options;
    this.idMapper = new IdMapper();
    this.assets   = new AssetManager(game.world.id);
    this.errors   = [];
    this.warnings = [];
  }

  /**
   * Запустить полный импорт из ZIP-файла.
   * @param {File}     zipFile
   * @param {Function} [onProgress] — callback({ total, current, label })
   * @returns {Promise<{ errors: string[], warnings: string[] }>}
   */
  async run(zipFile, onProgress) {
    // Загрузить JSZip (ожидаем в lib/)
    const JSZip = await this.#loadJSZip();
    const zip       = await JSZip.loadAsync(zipFile);
    this.zipPaths   = Object.keys(zip.files || {});
    const campaign  = JSON.parse(await zip.file("campaign.json").async("string"));

    console.log(`R20Import | Campaign: "${campaign.campaign_title}" (${campaign.release ?? "legacy"})`);

    const totalSteps = this.#countSteps(campaign);
    let   step = 0;
    const progress = (label) => onProgress?.({ total: totalSteps, current: ++step, label });

    // ── Шаг 0: Игроки ────────────────────────────────
    const playerIdMap = this.#buildPlayerMap(campaign.players ?? []);

    // ── Шаг 1: Папки акторов ─────────────────────────
    progress("Создание папок...");
    const actorFolderMap   = await this.#safeRun("buildActorFolders",
      () => buildFolderTree(campaign.journalfolder ?? [], "Actor",        this.idMapper));
    const journalFolderMap = await this.#safeRun("buildJournalFolders",
      () => buildFolderTree(campaign.journalfolder ?? [], "JournalEntry", this.idMapper));

    // ── Шаг 1.5: Библиотечный индекс (если включён) ──
    this.assembler = null;
    if (this.options.useLibrary) {
      const moduleIds = this.options.moduleIds ?? [];
      if (moduleIds.length > 0) {
        progress("Индексирование компендиумов...");
        try {
          const index = new CompendiumIndex();
          await index.build(moduleIds, this.options.threshold ?? 0.8);
          this.assembler = new ActorAssembler(index, { threshold: this.options.threshold ?? 0.8 });
        } catch (e) {
          this.warnings.push(`Library index failed: ${e.message}`);
          console.warn("R20Import | Library index error:", e);
        }
      }
    }

    // ── Шаг 2: Персонажи (Акторы) ────────────────────
    if (this.options.importActors && campaign.characters?.length > 0) {
      progress(`Персонажи (${campaign.characters.length})...`);
      await this.#importActors(campaign, zip, actorFolderMap, playerIdMap);
    }

    // ── Шаг 3: Журнал (Handouts) ─────────────────────
    if (this.options.importJournal && campaign.handouts?.length > 0) {
      progress(`Журнал (${campaign.handouts.length})...`);
      await this.#importJournal(campaign, zip, journalFolderMap, playerIdMap);
    }

    // ── Шаг 4: Сцены (Pages) ─────────────────────────
    if (this.options.importScenes && campaign.pages?.length > 0) {
      progress(`Сцены (${campaign.pages.length})...`);
      await this.#importScenes(campaign, zip);
    }

    // ── Шаг 5: Таблицы бросков ───────────────────────
    if (this.options.importTables && campaign.tables?.length > 0) {
      progress(`Таблицы (${campaign.tables.length})...`);
      await this.#importTables(campaign);
    }

    // ── Шаг 6: Плейлисты (Jukebox) ───────────────────
    if (this.options.importPlaylists && campaign.jukebox?.length > 0) {
      progress(`Музыка (${campaign.jukebox.length})...`);
      await this.#importPlaylists(campaign);
    }

    // ── Шаг 7: Макросы ───────────────────────────────
    if (this.options.importMacros && campaign.macros?.length > 0) {
      progress(`Макросы (${campaign.macros.length})...`);
      await this.#importMacros(campaign);
    }

    progress("Готово!");

    if (this.errors.length)   console.error("R20Import | Errors:",   this.errors);
    if (this.warnings.length) console.warn( "R20Import | Warnings:", this.warnings);

    return { errors: this.errors, warnings: this.warnings };
  }

  /* ═══════════════════════════════════════════════
     АКТОРЫ
  ═══════════════════════════════════════════════ */

  async #importActors(campaign, zip, folderMap, playerIdMap) {
    const adapters = this.#getAdapters();
    const actorsData = [];

    for (let i = 0; i < campaign.characters.length; i++) {
      const raw    = campaign.characters[i];
      const r20ch  = new R20Character(raw, i);
      
      // Пропуск персонажей игроков (оставляем только NPC по просьбе пользователя)
      if (!r20ch.flag("npc")) continue;

      const adapter = adapters.find(a => a.canHandle(r20ch)) ?? adapters[adapters.length - 1];

      const charDir = this.#findEntityDir("characters", r20ch.name, i);
      
      let avatarZipPath = this.#findFileByUrl(charDir, r20ch.avatarUrl);
      if (!avatarZipPath) avatarZipPath = this.#findFileInDir(charDir, "avatar");
      if (!avatarZipPath) avatarZipPath = this.#findAnyImageInDir(charDir);

      let tokenZipPath  = this.#findFileByUrl(charDir, r20ch.defaultToken?.imgsrc || r20ch.defaultToken?.avatar);
      if (!tokenZipPath) tokenZipPath = this.#findFileInDir(charDir, "token");

      try {
        let data = await adapter.toActorData(r20ch, this.idMapper, this.assets, zip, playerIdMap, folderMap, avatarZipPath, tokenZipPath);
        if (data && this.assembler) {
          data = await this.assembler.assemble(data, r20ch, this.idMapper);
        }
        if (data) actorsData.push(data);
      } catch (err) {
        this.errors.push(`Actor "${r20ch.name}": ${err.message}`);
        console.error(`R20Import | Actor "${r20ch.name}":`, err);
      }
    }

    await this.#createBatch(Actor, actorsData);
  }

  /* ═══════════════════════════════════════════════
     ЖУРНАЛ
  ═══════════════════════════════════════════════ */

  async #importJournal(campaign, zip, folderMap, playerIdMap) {
    const entriesData = [];

    for (let i = 0; i < campaign.handouts.length; i++) {
      const raw = campaign.handouts[i];
      // Игнорируем технические файлы от API (TokenMod, CombatTracker и т.д.)
      const name = raw.name || "";
      if (
        name.endsWith(" Menu") || 
        name.startsWith("Main Menu ") || 
        name.startsWith("Help: TokenMod")
      ) {
        continue;
      }

      try {
        const r20h = new R20Handout(raw, i);
        // Загрузить аватар если он есть в папке
        let avatarPath = "";
        
        const handoutDir = this.#findEntityDir("handouts", r20h.name, i) || this.#findEntityDir("journal", r20h.name, i);
        
        // Kakaroto's Exporter скачивает картинки под их оригинальными именами из Roll20 (например: spider_cult_art.jpg)
        let avatarZipPath = this.#findFileByUrl(handoutDir, r20h.avatarUrl);
        if (!avatarZipPath) avatarZipPath = this.#findFileInDir(handoutDir, "avatar");
        if (!avatarZipPath) avatarZipPath = this.#findFileInDir(handoutDir, "image");
        // Примечание: НЕ ищем по "handout" — иначе найдём handout.json вместо картинки
        if (!avatarZipPath) avatarZipPath = this.#findAnyImageInDir(handoutDir);

        // Загружаем только если это действительно файл изображения
        if (avatarZipPath && this.#isImagePath(avatarZipPath)) {
          const ext = avatarZipPath.split('.').pop() || "png";
          avatarPath = await this.assets.upload(zip, avatarZipPath, `${r20h.id}.${ext}`, "journal").catch(() => "");
        }
        
        // Локализуем внешние картинки в HTML-контенте (Roll20 CDN → Foundry Data)
        const notesLocalized    = await this.assets.localizeHtmlImages(r20h.notes,   "journal");
        const gmNotesLocalized  = await this.assets.localizeHtmlImages(r20h.gmNotes, "journal");

        const data = handoutToJournalEntry(
          { ...r20h, notes: notesLocalized, gmNotes: gmNotesLocalized },
          folderMap, this.idMapper, playerIdMap, avatarPath
        );
        entriesData.push(data);
      } catch (err) {
        this.errors.push(`Handout "${raw.name}": ${err.message}`);
      }
    }

    await this.#createBatch(JournalEntry, entriesData);
  }

  /* ═══════════════════════════════════════════════
     СЦЕНЫ
  ═══════════════════════════════════════════════ */

  async #importScenes(campaign, zip) {
    for (let i = 0; i < campaign.pages.length; i++) {
      const raw    = campaign.pages[i];
      const r20p   = new R20Page(raw, i);

      if (r20p.isArchived) continue;

      try {
        await this.#importOnePage(r20p, i, zip);
      } catch (err) {
        this.errors.push(`Scene "${r20p.name}": ${err.message}`);
        console.error(`R20Import | Scene "${r20p.name}":`, err);
      }
    }
  }

  async #importOnePage(r20page, i, zip) {
    const pageDir = this.#findEntityDir("pages", r20page.name, i);

    // Фоновое изображение
    let bgZipPath = this.#findFileInDir(pageDir, "thumbnail");
    if (!bgZipPath) bgZipPath = this.#findFileInDir(pageDir, "background");
    if (!bgZipPath) bgZipPath = this.#findFileInDir(pageDir, "page");

    let bgPath = "";
    if (bgZipPath) {
      const bgExt = bgZipPath.split('.').pop() || "png";
      bgPath = await this.assets.upload(zip, bgZipPath, `background.${bgExt}`, `scenes/${r20page.id}`);
    }

    const { sceneData, gridMultiplier, marginX, marginY, gridSize } = buildSceneBase(r20page, bgPath);

    // ── Стены ───────────────────────────────────────
    const wallPaths = r20page.paths.filter(p => p.layer === "walls" || p.layer === "map");
    const walls = [];
    for (const path of wallPaths) {
      walls.push(...parseWallPath(path, gridMultiplier, marginX, marginY, this.options));
    }

    // ── Двери (legacy) ─────────────────────────────
    for (const door of r20page.doors) {
      walls.push(parseDoorObject(door, gridMultiplier, marginX, marginY));
    }
    for (const win of r20page.windows) {
      const d = parseDoorObject(win, gridMultiplier, marginX, marginY);
      d.ds = 0;
      walls.push(d);
    }

    // ── Токены и тайлы ─────────────────────────────
    const tokens = [];
    const tiles  = [];

    for (const graphic of r20page.graphics) {
      const isToken = !!graphic.represents;
      if (isToken) {
        const tokenData = graphicToToken(graphic, gridMultiplier, marginX, marginY, gridSize, this.idMapper);
        if (tokenData) tokens.push(tokenData);
      } else {
        // Тайл — загрузить изображение
        let imgZipPath = this.#findFileInDir(`${pageDir}/graphics`, graphic.id);
        
        let resolvedImg = graphic.imgsrc;
        if (!resolvedImg && imgZipPath) {
          const tileExt = imgZipPath.split('.').pop() || "png";
          resolvedImg = await this.assets.upload(zip, imgZipPath, `${graphic.id}.${tileExt}`, `scenes/${r20page.id}/tiles`);
        }
        
        if (resolvedImg) {
          tiles.push(graphicToTile(graphic, gridMultiplier, marginX, marginY, resolvedImg));
        }
      }
    }

    // ── Текст → Drawing ────────────────────────────
    const drawings = r20page.texts.map(t => textToDrawing(t, gridMultiplier, marginX, marginY)).filter(Boolean);

    // ── Создать сцену ──────────────────────────────
    await Scene.create({
      ...sceneData,
      walls,
      tokens,
      tiles,
      drawings,
    }, { keepId: true });

    console.log(`R20Import | Scene "${r20page.name}" created (${walls.length} walls, ${tokens.length} tokens, ${tiles.length} tiles)`);
  }

  /* ═══════════════════════════════════════════════
     ТАБЛИЦЫ
  ═══════════════════════════════════════════════ */

  async #importTables(campaign) {
    const tablesData = (campaign.tables ?? []).map(raw => {
      try {
        const r20t = new R20Table(raw);
        return tableToRollTable(r20t, this.idMapper);
      } catch (err) {
        this.errors.push(`Table "${raw.name}": ${err.message}`);
        return null;
      }
    }).filter(Boolean);

    await this.#createBatch(RollTable, tablesData);
  }

  /* ═══════════════════════════════════════════════
     ПЛЕЙЛИСТЫ
  ═══════════════════════════════════════════════ */

  async #importPlaylists(campaign) {
    try {
      const playlistData = jukeboxToPlaylist(campaign.jukebox ?? [], this.idMapper);
      if (playlistData) {
        await Playlist.create(playlistData, { keepId: true });
      }
    } catch (err) {
      this.errors.push(`Playlist: ${err.message}`);
    }
  }

  /* ═══════════════════════════════════════════════
     МАКРОСЫ
  ═══════════════════════════════════════════════ */

  async #importMacros(campaign) {
    const macrosData = (campaign.macros ?? []).map(raw => {
      try {
        const r20m = new R20Macro(raw);
        return macroToMacro(r20m, this.idMapper);
      } catch (err) {
        this.errors.push(`Macro "${raw.name}": ${err.message}`);
        return null;
      }
    }).filter(Boolean);

    await this.#createBatch(Macro, macrosData);
  }

  /* ═══════════════════════════════════════════════
     УТИЛИТЫ
  ═══════════════════════════════════════════════ */

  /**
   * Создать документы батчами по N штук.
   * При ошибке на батче — пробует по одному для диагностики.
   */
  async #createBatch(DocumentClass, dataArray, batchSize = 20) {
    for (let i = 0; i < dataArray.length; i += batchSize) {
      const batch = dataArray.slice(i, i + batchSize);
      try {
        await DocumentClass.createDocuments(batch, { keepId: true });
      } catch (e) {
        this.warnings.push(`${DocumentClass.documentName} batch ${i} failed, retrying individually`);
        for (const item of batch) {
          try {
            await DocumentClass.createDocuments([item], { keepId: true });
          } catch (e2) {
            this.errors.push(`  ${DocumentClass.documentName} "${item.name}": ${e2.message}`);
          }
        }
      }
    }
  }

  /** Безопасный вызов — возвращает результат или пустой Map при ошибке */
  async #safeRun(label, fn) {
    try { return await fn(); }
    catch (e) {
      this.errors.push(`${label}: ${e.message}`);
      return new Map();
    }
  }

  /** Построить карту Roll20 игрок → Foundry юзер */
  #buildPlayerMap(players) {
    const map = {};
    for (const p of players) {
      const name = (p.displayname || "").toLowerCase();
      const foundryUser = game.users.find(u => u.name.toLowerCase() === name);
      if (foundryUser) map[p.id] = foundryUser.id;
    }
    return map;
  }

  /** Получить системные адаптеры в порядке приоритета */
  #getAdapters() {
    const systemId = game.system.id;
    if (systemId === "dnd5e") {
      return [...getDnd5eAdapters(), new GenericAdapter()];
    }
    return [new GenericAdapter()];
  }

  /** Подсчитать количество шагов прогресса */
  #countSteps(campaign) {
    let steps = 2; // папки + завершение
    if (this.options.importActors    && campaign.characters?.length > 0) steps++;
    if (this.options.importJournal   && campaign.handouts?.length   > 0) steps++;
    if (this.options.importScenes    && campaign.pages?.length      > 0) steps++;
    if (this.options.importTables    && campaign.tables?.length     > 0) steps++;
    if (this.options.importPlaylists && campaign.jukebox?.length    > 0) steps++;
    if (this.options.importMacros    && campaign.macros?.length     > 0) steps++;
    return steps;
  }

  /** Найти директорию сущности в ZIP (независимо от нумерации и регистра) */
  #findEntityDir(section, name, rawIndex) {
    if (!this.zipPaths) return null;
    const sectionPrefix = `${section}/`.toLowerCase();
    const list = this.zipPaths.filter(p => p.toLowerCase().startsWith(sectionPrefix));
    const cleanName = String(name || "").replace(/[\\/:*?"<>|]/g, "-").toLowerCase();
    
    const dirs = new Set();
    for (const p of list) {
       const parts = p.split('/');
       if (parts.length >= 2) dirs.add(parts[1]); 
    }
    
    const idx1 = rawIndex + 1;
    const idx0 = rawIndex;
    const padded1 = String(idx1).padStart(3, "0");
    const padded0 = String(idx0).padStart(3, "0");
    
    let fallbackDir = null;

    // Очень неточный поиск имени (оставляем только буквы и цифры)
    const looseName = String(name || "").replace(/[^a-z0-9а-яё]/gi, "").toLowerCase();

    for (const d of dirs) {
      const lowerD = d.toLowerCase();
      
      const hasRightIndex = lowerD.startsWith(`${idx1} -`) || lowerD.startsWith(`${idx1}-`) ||
                            lowerD.startsWith(`${padded1} -`) || lowerD.startsWith(`${padded1}-`) ||
                            lowerD.startsWith(`${idx0} -`) || lowerD.startsWith(`${idx0}-`) ||
                            lowerD.startsWith(`${padded0} -`) || lowerD.startsWith(`${padded0}-`);
                            
      const dLoose = lowerD.replace(/[^a-z0-9а-яё]/gi, "");
      const hasRightName = looseName.length > 2 && dLoose.includes(looseName);
      
      // Идеальное совпадение: и индекс, и часть имени совпали
      if (hasRightIndex && hasRightName) return `${section}/${d}`;
      
      // Индекс в R20Exporter.js решает всё. Если индекс совпал — это 99% та самая папка,
      // даже если имя было полностью искажено при экспорте.
      if (hasRightIndex) return `${section}/${d}`;
      
      // Запасное совпадение только по имени (если индексы вообще не совпадают)
      if (hasRightName) fallbackDir = `${section}/${d}`;
    }
    return fallbackDir; 
  }

  /** Найти файл внутри папки по префиксу (имени без расширения) */
  #findFileInDir(dirPath, filePrefix) {
    if (!dirPath || !this.zipPaths) return null;
    const prefix = `${dirPath}/${filePrefix}`.toLowerCase();
    for (const p of this.zipPaths) {
      if (p.toLowerCase().startsWith(prefix)) return p;
    }
    return null;
  }

  /** Найти файл по его оригинальному имени из URL (Roll20 Exporter скачивает файлы под их настоящими именами) */
  #findFileByUrl(dirPath, url) {
    if (!url || !dirPath || !this.zipPaths) return null;
    try {
      const urlPath = url.split("?")[0];
      const filename = decodeURIComponent(urlPath.split('/').pop()).toLowerCase();
      if (!filename || filename.length < 2) return null;
      
      const prefix = `${dirPath}/`.toLowerCase();
      for (const p of this.zipPaths) {
         if (p.toLowerCase().startsWith(prefix) && p.toLowerCase().endsWith(filename)) {
             return p;
         }
      }
    } catch (e) { }
    return null;
  }

  /** Проверить что путь является файлом изображения (не JSON/HTML/etc.) */
  #isImagePath(zipPath) {
    const ext = String(zipPath ?? "").split(".").pop().toLowerCase();
    return ["png", "jpg", "jpeg", "webp", "gif", "svg", "webm"].includes(ext);
  }

  /** Найти ЛЮБОЕ изображение в указанной папке (fallback) */
  #findAnyImageInDir(dirPath) {
    if (!dirPath || !this.zipPaths) return null;
    const prefix = `${dirPath}/`.toLowerCase();
    for (const p of this.zipPaths) {
      const lowerD = p.toLowerCase();
      if (lowerD.startsWith(prefix)) {
        if (lowerD.endsWith(".png") || lowerD.endsWith(".jpg") || lowerD.endsWith(".jpeg") || lowerD.endsWith(".webp") || lowerD.endsWith(".gif")) {
           return p; 
        }
      }
    }
    return null;
  }

  /** Загрузить JSZip из различных источников */
  async #loadJSZip() {
    // 1. Уже в глобальном пространстве
    if (typeof JSZip !== "undefined") return JSZip;

    // 2. Попробовать загрузить из lib/ модуля
    try {
      const mod = await import("modules/r20-to-fvtt/lib/jszip.min.js");
      if (mod?.default?.loadAsync) return mod.default;
    } catch { /* не найден — идём дальше */ }

    // 3. Динамически загрузить с CDN (fallback)
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      script.onload = () => {
        if (typeof JSZip !== "undefined") resolve(JSZip);
        else reject(new Error("JSZip CDN загружен, но JSZip не определён"));
      };
      script.onerror = () => reject(new Error(
        "Не удалось загрузить JSZip. Скачайте jszip.min.js и поместите в папку lib/ модуля."
      ));
      document.head.appendChild(script);
    });
  }
}
