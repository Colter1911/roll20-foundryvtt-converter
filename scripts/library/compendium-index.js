/**
 * compendium-index.js — Индексирование Foundry компендиумов.
 * Строит лёгкий индекс имён для быстрого поиска, документы загружаются лениво.
 */

import { findBest } from "./name-matcher.js";

export class CompendiumIndex {
  #actorEntries = [];   // [{name, packId, docId}]
  #itemEntries  = [];   // [{name, packId, docId, type}]
  #docCache     = new Map();  // "packId::docId" → raw document object
  #threshold    = 0.8;

  /**
   * Построить индексы из выбранных модулей/компендиумов.
   * Вызывается один раз перед импортом.
   *
   * @param {string[]} moduleIds — ID пакетов (module/system/world)
   * @param {number}   threshold — порог нечёткого совпадения (0..1)
   */
  async build(moduleIds = [], threshold = 0.8) {
    this.#threshold = threshold;

    // Разворачиваем moduleIds → отдельные pack IDs по типу
    const modules      = CompendiumIndex.getAvailableModules();
    const moduleMap    = new Map(modules.map(m => [m.id, m]));
    const actorPackIds = moduleIds.flatMap(mid => moduleMap.get(mid)?.actorPackIds ?? []);
    const itemPackIds  = moduleIds.flatMap(mid => moduleMap.get(mid)?.itemPackIds  ?? []);

    this.#actorEntries = await this.#indexPacks(actorPackIds);
    this.#itemEntries  = await this.#indexPacks(itemPackIds);
    console.log(
      `R20Import | Library index built: ${this.#actorEntries.length} actors, ` +
      `${this.#itemEntries.length} items (threshold=${threshold})`
    );
  }

  /**
   * Найти актёра по имени в Actor-паках.
   * @param {string} name
   * @returns {{ packId: string, docId: string, score: number } | null}
   */
  findActor(name) {
    const r = findBest(name, this.#actorEntries, this.#threshold);
    return r ? { packId: r.item.packId, docId: r.item.docId, score: r.score } : null;
  }

  /**
   * Найти item по имени в Item-паках.
   * @param {string}  name
   * @param {string|null} [preferredType] — "spell"|"weapon"|"feat" и т.д.
   *        Если задан — сначала ищем среди items этого типа.
   * @returns {{ packId: string, docId: string, score: number } | null}
   */
  findItem(name, preferredType = null) {
    // Сначала пробуем среди preferred type
    if (preferredType) {
      const typed = this.#itemEntries.filter(e => e.type === preferredType);
      const r = findBest(name, typed, this.#threshold);
      if (r) return { packId: r.item.packId, docId: r.item.docId, score: r.score };
    }
    // Затем по всем items
    const r = findBest(name, this.#itemEntries, this.#threshold);
    return r ? { packId: r.item.packId, docId: r.item.docId, score: r.score } : null;
  }

  /**
   * Загрузить полный документ по packId + docId (с кешированием).
   * @param {string} packId
   * @param {string} docId
   * @returns {Promise<object|null>} — raw plain object (toObject())
   */
  async loadDocument(packId, docId) {
    const key = `${packId}::${docId}`;
    if (this.#docCache.has(key)) return this.#docCache.get(key);

    const pack = game.packs.get(packId);
    if (!pack) {
      console.warn(`R20Import | Pack not found: ${packId}`);
      return null;
    }

    try {
      const doc  = await pack.getDocument(docId);
      const data = doc?.toObject?.() ?? doc;
      this.#docCache.set(key, data);
      return data;
    } catch (e) {
      console.warn(`R20Import | loadDocument(${packId}, ${docId}) failed:`, e.message);
      return null;
    }
  }

  /**
   * Получить список доступных модулей/пакетов, сгруппированных по packageName.
   * Каждый элемент = один модуль (один чекбокс в UI).
   *
   * @returns {Array<{id, label, actorPackIds, itemPackIds}>}
   */
  static getAvailableModules() {
    const map = new Map();

    for (const pack of game.packs) {
      const type = pack.metadata.type;
      if (type !== "Actor" && type !== "Item") continue;

      const packageName = pack.metadata.packageName
        ?? pack.metadata.module
        ?? pack.metadata.system
        ?? "world";
      const packId = pack.metadata.id ?? pack.collection;

      if (!map.has(packageName)) {
        // Получить человекочитаемое название модуля
        let label = packageName;
        const mod = game.modules?.get(packageName);
        if (mod) {
          label = mod.title ?? mod.name ?? packageName;
        } else if (packageName === game.system?.id) {
          label = game.system.title ?? packageName;
        } else if (packageName === "world") {
          label = game.world?.title ?? "World";
        }
        map.set(packageName, { id: packageName, label, actorPackIds: [], itemPackIds: [] });
      }

      const entry = map.get(packageName);
      if (type === "Actor") entry.actorPackIds.push(packId);
      else                  entry.itemPackIds.push(packId);
    }

    return [...map.values()]
      .filter(m => m.actorPackIds.length > 0 || m.itemPackIds.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Private ────────────────────────────────────

  async #indexPacks(packIds) {
    const entries = [];
    for (const packId of packIds) {
      const pack = game.packs.get(packId);
      if (!pack) {
        console.warn(`R20Import | Pack not found: ${packId}`);
        continue;
      }
      try {
        // getIndex — лёгкий запрос, только имена и _id
        const idx = await pack.getIndex({ fields: ["name", "type"] });
        for (const e of idx) {
          entries.push({
            name:   e.name,
            packId,
            docId:  e._id,
            type:   e.type ?? null,
          });
        }
        console.debug(`R20Import | Indexed pack "${pack.metadata.label}": ${idx.size} entries`);
      } catch (e) {
        console.warn(`R20Import | Failed to index pack ${packId}:`, e.message);
      }
    }
    return entries;
  }
}
