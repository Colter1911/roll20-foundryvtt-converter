/**
 * asset-manager.js — Загрузка медиафайлов из ZIP в Foundry Data.
 * Кеширует загруженные пути чтобы не дублировать файлы.
 */

import { sanitizeFilename } from "./core/utils.js";

export class AssetManager {
  #cache = new Map();         // zipPath → foundryPath
  #createdDirs = new Set();   // targetDir → boolean
  #uploadBasePath = "";

  /**
   * @param {string} worldId — game.world.id
   */
  constructor(worldId) {
    this.#uploadBasePath = `worlds/${worldId}/assets/r20`;
  }

  /**
   * Загрузить файл из ZIP в Foundry Data.
   * @param {JSZip}   zip
   * @param {string}  zipPath    — путь внутри ZIP
   * @param {string}  filename   — желаемое имя файла
   * @param {string}  [subdir]   — подкаталог (actors|scenes|journal|...)
   * @returns {Promise<string>}  — путь в Foundry Data или "" при ошибке
   */
  async upload(zip, zipPath, filename, subdir = "misc") {
    if (!zipPath) return "";
    const cacheKey = zipPath;
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey);

    const zipEntry = zip.file(zipPath);
    if (!zipEntry) {
      // Попробуем без ведущего слэша / с trailing slash
      const alt = zipEntry || zip.file(zipPath.replace(/^\//, "")) || zip.file("/" + zipPath);
      if (!alt) {
        console.warn(`R20Import | Asset not found in ZIP: ${zipPath}`);
        return "";
      }
    }

    const entry = zip.file(zipPath) || zip.file(zipPath.replace(/^\//, ""));
    if (!entry) return "";

    try {
      const blob          = await entry.async("blob");
      const safeFilename  = sanitizeFilename(filename);
      const mimeType      = this.#guessMime(safeFilename) || blob.type || "image/png";
      const file          = new File([blob], safeFilename, { type: mimeType });
      const targetDir     = `${this.#uploadBasePath}/${subdir}`;

      await this.#ensureDir(targetDir);

      const result = await FilePicker.upload("data", targetDir, file, {});
      const path   = result.path ?? result;
      this.#cache.set(cacheKey, path);
      return path;
    } catch (e) {
      console.error(`R20Import | Failed to upload ${zipPath}:`, e);
      return "";
    }
  }

  /**
   * Рекурсивное создание директорий в Foundry Data
   */
  async #ensureDir(targetPath) {
    if (this.#createdDirs.has(targetPath)) return;
    
    const parts = targetPath.split("/");
    let currentPath = "";
    
    for (const part of parts) {
      if (!part) continue;
      currentPath += (currentPath ? "/" : "") + part;
      
      if (!this.#createdDirs.has(currentPath)) {
        try {
          await FilePicker.createDirectory("data", currentPath);
        } catch (e) {
          // Игнорируем ошибку, если папка уже существует
        }
        this.#createdDirs.add(currentPath);
      }
    }
  }

  /**
   * Вернуть уже кешированный путь или оригинальный ключ.
   * @param {string} key
   * @returns {string}
   */
  resolve(key) {
    return this.#cache.get(key) ?? key ?? "";
  }

  /**
   * Скачать внешнее изображение по URL (например Roll20 CDN) и загрузить в Foundry.
   * При ошибке CORS/сети — возвращает оригинальный URL (изображение будет работать пока CDN доступен).
   * @param {string} url     — внешний URL изображения
   * @param {string} subdir  — подкаталог назначения
   * @returns {Promise<string>} — путь в Foundry Data или исходный URL
   */
  async fetchExternal(url, subdir = "misc") {
    if (!url) return "";
    if (this.#cache.has(url)) return this.#cache.get(url);

    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();

      // Проверяем что ответ — действительно изображение (не JSON/XML ошибка от S3)
      const isImage = blob.type.startsWith("image/") || blob.type === "application/octet-stream";
      if (!isImage) throw new Error(`Not an image (content-type: ${blob.type})`);

      // Имя файла из URL (без query string)
      const urlPath  = url.split("?")[0];
      const rawName  = decodeURIComponent(urlPath.split("/").pop()) || "image";
      const ext      = rawName.includes(".") ? rawName.split(".").pop().toLowerCase() : "png";
      const filename = sanitizeFilename(`${Date.now()}_${rawName}`);
      const mimeType = blob.type || this.#guessMime(filename) || "image/png";
      const file     = new File([blob], filename, { type: mimeType });
      const targetDir = `${this.#uploadBasePath}/${subdir}`;

      await this.#ensureDir(targetDir);
      const result = await FilePicker.upload("data", targetDir, file, {});
      const path   = result.path ?? result;
      this.#cache.set(url, path);
      return path;
    } catch (err) {
      // CORS или сеть недоступна — оставляем внешний URL как есть.
      // Картинки будут работать пока Roll20 CDN доступен.
      console.debug(`R20Import | Внешнее изображение не скачано (оставлен внешний URL): ${url}`, err?.message ?? err);
      this.#cache.set(url, url);
      return url;
    }
  }

  /**
   * Найти все внешние <img> в HTML и заменить их src на Foundry-пути.
   * @param {string} html    — исходный HTML
   * @param {string} subdir  — подкаталог для загрузки
   * @returns {Promise<string>} — HTML с заменёнными src
   */
  async localizeHtmlImages(html, subdir = "misc") {
    if (!html || !html.includes("<img")) return html;

    // Собираем все уникальные внешние src
    const srcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    const externalUrls = new Set();
    let m;
    while ((m = srcRegex.exec(html)) !== null) {
      const src = m[1];
      if (src.startsWith("http://") || src.startsWith("https://")) {
        externalUrls.add(src);
      }
    }

    if (externalUrls.size === 0) return html;

    // Скачиваем все параллельно (с ограничением concurrency=4)
    const urls = [...externalUrls];
    const resolvedMap = new Map();
    for (let i = 0; i < urls.length; i += 4) {
      const batch = urls.slice(i, i + 4);
      const results = await Promise.all(batch.map(u => this.fetchExternal(u, subdir)));
      batch.forEach((u, idx) => resolvedMap.set(u, results[idx]));
    }

    // Заменяем src в HTML
    return html.replace(/<img([^>]+)src=["']([^"']+)["']/gi, (match, before, src) => {
      const resolved = resolvedMap.get(src);
      if (resolved && resolved !== src) {
        return `<img${before}src="${resolved}"`;
      }
      return match;
    });
  }

  /**
   * Загрузить пачку ассетов параллельно (с ограничением concurrency).
   * @param {Array<{zip,zipPath,filename,subdir}>} tasks
   * @param {number} [concurrency=4]
   * @returns {Promise<string[]>}
   */
  async uploadBatch(tasks, concurrency = 4) {
    const results = [];
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(t => this.upload(t.zip, t.zipPath, t.filename, t.subdir))
      );
      results.push(...batchResults);
    }
    return results;
  }

  /** Определить MIME-тип по расширению файла */
  #guessMime(filename) {
    const ext = String(filename).split(".").pop()?.toLowerCase();
    const map = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", webm: "video/webm",
      mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
      svg: "image/svg+xml",
    };
    return map[ext] ?? "";
  }
}
