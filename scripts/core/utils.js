/**
 * utils.js — Вспомогательные функции общего назначения.
 * Используются несколькими парсерами.
 */

/* ═══════════════════════════════════════════════
   Ownership
═══════════════════════════════════════════════ */

/**
 * Построить объект ownership из Roll20 полей controlledby/inplayerjournals.
 * @param {{ inJournals?: string[], controlledBy?: string[] }} r20entity
 * @param {Object<string,string>} playerIdMap — r20playerId → foundryUserId
 * @returns {Object}
 */
export function buildOwnership(r20entity, playerIdMap) {
  const ownership = { default: 0 }; // NONE

  // inplayerjournals → OBSERVER (2)
  const viewers = parseR20IdList(r20entity.inJournals ?? r20entity.inplayerjournals);
  for (const pid of viewers) {
    if (pid === "all") { ownership.default = Math.max(ownership.default, 2); break; }
    const fid = playerIdMap?.[pid];
    if (fid) ownership[fid] = Math.max(ownership[fid] ?? 0, 2);
  }

  // controlledby → OWNER (3)
  const owners = parseR20IdList(r20entity.controlledBy ?? r20entity.controlledby);
  for (const pid of owners) {
    if (pid === "all") { ownership.default = 3; break; }
    const fid = playerIdMap?.[pid];
    if (fid) ownership[fid] = 3;
  }

  return ownership;
}

export function parseR20IdList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string") {
    try { 
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch { 
      // Roll20 часто хранит права просто через запятую: "all, -someid, user2"
      return v.split(",").map(s => s.trim()).filter(Boolean);
    }
    return v.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/* ═══════════════════════════════════════════════
   AC / Speed / CR
═══════════════════════════════════════════════ */

/**
 * Парсить КД: "17+", "13 (натуральная броня)" → 13
 * @param {string|number} v
 * @returns {number}
 */
export function parseAC(v) {
  return parseInt(String(v).match(/(\d+)/)?.[1]) || 10;
}

/**
 * Парсить скорость: "30 футов", "30 ft.", "30 ft., fly 60 ft." → 30
 * @param {string|number} v
 * @returns {number}
 */
export function parseSpeed(v) {
  return parseInt(String(v).match(/^(\d+)/)?.[1]) || 30;
}

/**
 * Парсить CR: "1/4" → 0.25, "1/2" → 0.5, "11" → 11
 * @param {string|number} v
 * @returns {number}
 */
export function parseCR(v) {
  if (!v && v !== 0) return 0;
  const s = String(v).trim();
  if (s.includes("/")) {
    const [n, d] = s.split("/");
    return parseInt(n) / parseInt(d);
  }
  return parseFloat(s) || 0;
}

/* ═══════════════════════════════════════════════
   Spell helpers
═══════════════════════════════════════════════ */

/**
 * Парсить тип цели заклинания.
 * @param {string} raw
 * @returns {{ value: string, type: string }}
 */
export function parseTarget(raw) {
  if (!raw) return { value: null, units: "ft", type: "creature" };
  const lower = String(raw).toLowerCase();
  if (lower.includes("self")) return { value: 0, units: "self", type: "self" };
  const m = lower.match(/(\d+)/);
  return { value: m ? parseInt(m[1]) : null, units: "ft", type: "creature" };
}

/**
 * Парсить формулу дистанции.
 * @param {string} raw
 * @returns {{ value: number|null, units: string }}
 */
export function parseRange(raw) {
  if (!raw) return { value: null, units: "ft" };
  const lower = String(raw).toLowerCase().trim();
  if (lower === "self") return { value: 0, units: "self" };
  if (lower === "touch") return { value: null, units: "touch" };
  if (lower === "sight" || lower === "unlimited") return { value: null, units: "spec" };
  const m = lower.match(/^(\d+)\s*(ft|feet|foot|m|meter|км|фут|метр)?/i);
  return {
    value: m ? parseInt(m[1]) : null,
    units: (m?.[2] ?? "ft").toLowerCase().startsWith("m") ? "m" : "ft",
  };
}

/**
 * Парсить длительность заклинания.
 * @param {string} raw
 * @returns {{ value: string, units: string, concentration?: boolean }}
 */
export function parseDuration(raw) {
  if (!raw) return { value: "", units: "inst" };
  const lower = String(raw).toLowerCase();

  if (lower.includes("instantaneous") || lower.includes("мгновенн"))
    return { value: "", units: "inst" };

  if (lower.includes("concentration") || lower.includes("концентраци")) {
    const m = lower.match(/(\d+)/);
    return {
      value: m?.[1] ?? "1",
      units: lower.includes("hour") || lower.includes("час") ? "hour" : "minute",
      concentration: true,
    };
  }

  if (lower.includes("permanent") || lower.includes("until dispelled") || lower.includes("постоянн"))
    return { value: "", units: "perm" };

  const m = lower.match(/(\d+)/);
  if (m) {
    let units = "spec";
    if (lower.includes("round") || lower.includes("раунд")) units = "round";
    else if (lower.includes("minute") || lower.includes("минут")) units = "minute";
    else if (lower.includes("hour") || lower.includes("час")) units = "hour";
    else if (lower.includes("day") || lower.includes("дн") || lower.includes("день")) units = "day";
    else if (lower.includes("month") || lower.includes("месяц")) units = "month";
    else if (lower.includes("year") || lower.includes("год") || lower.includes("лет")) units = "year";
    
    return { value: m[1], units };
  }

  // Если нет чисел, нужно вернуть пустую строку в value, иначе DataModel D&D 5e упадёт
  return { value: "", units: "spec" };
}

/**
 * Таблица типов активации заклинаний Roll20 → Foundry.
 */
const ACTIVATION_MAP = {
  "1 action":        "action",
  "1 bonus action":  "bonus",
  "1 reaction":      "reaction",
  "1 minute":        "minute",
  "10 minutes":      "minute",
  "1 hour":          "hour",
  "8 hours":         "hour",
  "special":         "special",
  "no action":       "none",
  "none":            "none",
};

/**
 * Маппинг типа активации заклинания.
 * @param {string} raw
 * @returns {string}
 */
export function mapActivationType(raw) {
  return ACTIVATION_MAP[String(raw ?? "").toLowerCase()] ?? "action";
}

/**
 * Собрать массив частей урона из строки заклинания/атаки.
 * @param {Object} row — строка repeating_spell или repeating_attack
 * @returns {Array}
 */
export function buildDamageParts(row) {
  const parts = [];
  if (row.spelldamage)  parts.push({ formula: row.spelldamage,  types: [row.spelldamagetype  || ""] });
  if (row.spelldamage2) parts.push({ formula: row.spelldamage2, types: [row.spelldamagetype2 || ""] });
  if (row.dmgbase)      parts.push({ formula: row.dmgbase,      types: [String(row.dmgtype ?? "").toLowerCase()] });
  return parts;
}

/* ═══════════════════════════════════════════════
   NPC type parser
═══════════════════════════════════════════════ */

const NPC_TYPE_MAP = {
  humanoid: "humanoid", гуманоид: "humanoid",
  undead: "undead",     нежить:   "undead",
  beast: "beast",       зверь:    "beast",
  fiend: "fiend",       исчадие:  "fiend",
  dragon: "dragon",     дракон:   "dragon",
  construct: "construct", конструкт: "construct",
  celestial: "celestial", небожитель: "celestial",
  elemental: "elemental", элементаль: "elemental",
  fey: "fey",           фея:     "fey",
  plant: "plant",       растение: "plant",
  ooze: "ooze",         слизь:   "ooze",
  giant: "giant",       великан: "giant",
  monstrosity: "monstrosity", чудовище: "monstrosity",
  aberration: "aberration",  аберрация: "aberration",
  swarm: "swarm",
};

/**
 * Парсить тип NPC: "Средний Гуманоид (эльф)" → { value: "humanoid", subtype: "эльф" }
 * @param {string} v
 * @returns {{ value: string, subtype: string }}
 */
export function parseNPCType(v) {
  const lower = String(v ?? "").toLowerCase();
  let foundType = "humanoid";
  for (const [key, val] of Object.entries(NPC_TYPE_MAP)) {
    if (lower.includes(key)) { foundType = val; break; }
  }
  const subtypeMatch = String(v ?? "").match(/\(([^)]+)\)/);
  return { value: foundType, subtype: subtypeMatch?.[1] ?? "" };
}

/* ═══════════════════════════════════════════════
   Misc
═══════════════════════════════════════════════ */

/**
 * Санитизировать имя файла.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  return String(name ?? "file")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._\-]/g, "_")
    .slice(0, 120) || "file";
}

/**
 * Нормализовать Roll20 ID: убрать дефис в начале, заменить спецсимволы.
 * @param {string} id
 * @returns {string}
 */
export function normalizeR20Id(id) {
  return String(id ?? "").replace(/^-/, "").replace(/[^a-zA-Z0-9_]/g, "_");
}
