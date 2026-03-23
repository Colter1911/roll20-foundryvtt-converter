/**
 * r20-document.js — Нормализованные структуры данных Roll20.
 * Изолирует различия Legacy/Jumpgate форматов от системных адаптеров.
 */

/* ═══════════════════════════════════════════════
   R20Character — нормализованный персонаж
═══════════════════════════════════════════════ */
export class R20Character {
  constructor(raw, zipIndex) {
    this.id           = raw.id || raw._id || String(zipIndex);
    this.name         = raw.name || "Unnamed";
    this.bio          = raw.bio  || "";
    this.gmNotes      = raw.gmnotes || "";
    this.avatarUrl    = raw.avatar  || "";
    this.isArchived   = raw.archived === "True" || raw.archived === true;
    this.sheetName    = raw.charactersheetname || "unknown";
    this.controlledBy = this.#parseIdList(raw.controlledby);
    this.inJournals   = this.#parseIdList(raw.inplayerjournals);

    // Плоский словарь: { name → { current, max } }
    const attrsList = raw.attribs || raw.attributes || [];
    this.attrs     = this.#buildAttrMap(attrsList);
    // Repeating-секции: { "repeating_spell-1" → [{ _id, field1, ... }] }
    this.repeating = this.#buildRepeatingMap(attrsList);

    // Токен по умолчанию (объект или пустой объект)
    this.defaultToken = this.#parseDefaultToken(raw.defaulttoken);

    // Служебные поля для ZIP-путей (в R20Exporter индексы файлов обычно начинаются с 1)
    this._zipIndex = zipIndex + 1;
  }

  /** Текущее значение атрибута (с фоллбеком на регистронезависимый поиск) */
  attr(name, fallback = "") {
    if (this.attrs[name] !== undefined) return this.attrs[name].current;
    
    const lower = name.toLowerCase();
    for (const k in this.attrs) {
      if (k.toLowerCase() === lower) return this.attrs[k].current;
    }
    return fallback;
  }

  /** Максимальное значение атрибута (с фоллбеком на регистронезависимый поиск) */
  attrMax(name, fallback = "") {
    if (this.attrs[name] !== undefined) return this.attrs[name].max;
    
    const lower = name.toLowerCase();
    for (const k in this.attrs) {
      if (k.toLowerCase() === lower) return this.attrs[k].max;
    }
    return fallback;
  }

  /** Числовое значение атрибута */
  num(name, fallback = 0) {
    return parseFloat(this.attr(name)) || fallback;
  }

  /** Булевое значение флага-атрибута */
  flag(name) {
    const v = this.attr(name);
    return v === "1" || v === true || v === 1;
  }

  // ── Приватные методы ─────────────────────────

  #buildAttrMap(attributes) {
    const map = {};
    for (const a of attributes) {
      if (!a.name?.startsWith("repeating_")) {
        map[a.name] = {
          current: a.current ?? "",
          max:     a.max     ?? "",
        };
      }
    }
    return map;
  }

  #buildRepeatingMap(attributes) {
    const sections = {};
    const rowData  = {};

    for (const a of attributes) {
      const m = a.name?.match(/^(repeating_[^_]+)_([^_]+(?:_[^_]+)?)_(.+)$/);
      if (!m) continue;
      const [, section, rowId, field] = m;

      if (!sections[section]) sections[section] = [];
      if (!rowData[rowId])    rowData[rowId]    = { _id: rowId, _section: section };
      rowData[rowId][field] = a.current ?? "";

      if (!sections[section].includes(rowId)) sections[section].push(rowId);
    }

    const result = {};
    for (const [section, ids] of Object.entries(sections)) {
      result[section] = ids.map(id => rowData[id]);
    }
    return result;
  }

  #parseIdList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    try { return JSON.parse(v).filter(Boolean); } catch { return []; }
  }

  #parseDefaultToken(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
}

/* ═══════════════════════════════════════════════
   R20Page — нормализованная сцена
═══════════════════════════════════════════════ */
export class R20Page {
  constructor(raw, index) {
    this.id             = raw.id || raw._id || String(index);
    this.name           = raw.name || "Untitled";
    this.index          = index;
    this.width          = parseFloat(raw.width)  || 25;
    this.height         = parseFloat(raw.height) || 25;
    this.gridType       = raw.grid_type || "square";
    this.showGrid       = raw.showgrid !== "False" && raw.showgrid !== false;
    this.gridSnap       = parseFloat(raw.snapping_increment) || 1;
    this.scaleNumber    = parseFloat(raw.scale_number) || 5;
    this.scaleUnits     = raw.scale_units || "ft";
    this.bgColor        = raw.background_color || "#000000";
    this.thumbnail      = raw.thumbnail || "";
    this.isArchived     = raw.archived === "True";
    this.dynLighting    = raw.dynamic_lighting_enabled === "True";
    this.fogExploration = raw.explorer_mode !== "off";

    this.graphics    = raw.graphics || [];
    this.paths       = raw.paths    || [];
    this.texts       = raw.texts    || [];
    this.doors       = raw.doors    || [];
    this.windows     = raw.windows  || [];
    this.zorder      = raw.zorder   || [];

    this._zipIndex   = index + 1;
  }
}

/* ═══════════════════════════════════════════════
   R20Handout — нормализованный хэндаут (журнал)
═══════════════════════════════════════════════ */
export class R20Handout {
  constructor(raw, index) {
    this.id           = raw.id || raw._id;
    this.name         = raw.name || "Untitled";
    this.notes        = raw.notes   || "";
    this.gmNotes      = raw.gmnotes || "";
    this.avatarUrl    = raw.avatar  || "";
    this.isArchived   = raw.archived === "True";
    this.controlledBy = this.#parseIdList(raw.controlledby);
    this.inJournals   = this.#parseIdList(raw.inplayerjournals);
    this._zipIndex    = index + 1;
  }

  #parseIdList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    try { return JSON.parse(v).filter(Boolean); } catch { return []; }
  }
}

/* ═══════════════════════════════════════════════
   R20JukeboxTrack — нормализованный трек
═══════════════════════════════════════════════ */
export class R20JukeboxTrack {
  constructor(raw) {
    this.id       = raw.id || raw._id;
    this.title    = raw.title || "Untitled Track";
    this.source   = raw.source || "";
    this.volume   = parseFloat(raw.volume) || 1;
    this.loop     = raw.loop === true || raw.loop === "true";
    this.softstop = raw.softstop !== false && raw.softstop !== "false";
  }
}

/* ═══════════════════════════════════════════════
   R20Table — нормализованная таблица бросков
═══════════════════════════════════════════════ */
export class R20Table {
  constructor(raw) {
    this.id      = raw.id || raw._id;
    this.name    = raw.name || "Table";
    this.items   = (raw.tableitems || []).map(item => ({
      id:     item.id,
      name:   item.name   || "",
      weight: parseInt(item.weight) || 1,
      img:    item.avatar || "",
    }));
  }
}

/* ═══════════════════════════════════════════════
   R20Macro — нормализованный макрос
═══════════════════════════════════════════════ */
export class R20Macro {
  constructor(raw) {
    this.id         = raw.id || raw._id;
    this.name       = raw.name || "Macro";
    this.action     = raw.action || "";
    this.visibleTo  = raw.visibleto || "";
    this.isTokenAction = raw.istokenaction === true || raw.istokenaction === "true";
  }
}
