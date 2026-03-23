/**
 * item-factory.js — Построить dnd5e 4.x Item из Roll20 строк (без компендиума).
 * Используется как fallback когда совпадение в компендиуме не найдено.
 *
 * Поддерживает разные варианты имён полей (Legacy/Jumpgate OGL5e).
 */

// ── Вспомогательные функции ─────────────────────

/**
 * Получить первое непустое значение из нескольких вариантов имён поля.
 */
function f(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

function randomId() {
  return foundry.utils.randomID();
}

/**
 * Построить damage part из формулы и типа.
 */
function dmgPart(formula, type) {
  return {
    formula,
    types:  type ? [type.toLowerCase()] : [],
    bonus:  "",
    custom: { enabled: false, label: "" },
    scaling: { mode: "whole", number: null, formula: "" },
  };
}

// ── Парсинг механики из описания ────────────────

/** Атрибут спасброска: [regex, 3-буквенный код dnd5e] */
const SAVE_ABILITY_MAP = [
  [/спасбросок\s+телосложения/i, "con"], [/спасброска\s+телосложения/i, "con"],
  [/спасбросок\s+силы/i,         "str"], [/спасброска\s+силы/i,         "str"],
  [/спасбросок\s+ловкости/i,     "dex"], [/спасброска\s+ловкости/i,     "dex"],
  [/спасбросок\s+интеллекта/i,   "int"], [/спасброска\s+интеллекта/i,   "int"],
  [/спасбросок\s+мудрости/i,     "wis"], [/спасброска\s+мудрости/i,     "wis"],
  [/спасбросок\s+харизмы/i,      "cha"], [/спасброска\s+харизмы/i,      "cha"],
  [/constitution\s+saving\s+throw/i, "con"],
  [/strength\s+saving\s+throw/i,     "str"],
  [/dexterity\s+saving\s+throw/i,    "dex"],
  [/intelligence\s+saving\s+throw/i, "int"],
  [/wisdom\s+saving\s+throw/i,       "wis"],
  [/charisma\s+saving\s+throw/i,     "cha"],
];

/**
 * Извлечь механику из текста описания:
 *   - спасбросок + DC (если указан)
 *   - первый Roll20 inline roll [[xdy+z]]
 *
 * @param {string} desc — HTML или plain text
 * @returns {{ roll: string|null, save: {ability:string, dc:string|null}|null }}
 */
function parseDescriptionMechanics(desc) {
  if (!desc) return { roll: null, save: null };
  // Убрать HTML-теги
  const text = String(desc).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Спасбросок
  let save = null;
  for (const [re, ability] of SAVE_ABILITY_MAP) {
    if (re.test(text)) {
      // DC: "Сл 13" / "DC 13" / "СЛ13"
      const dcMatch = text.match(/(?:сл|dc)\s*(\d+)/i);
      save = { ability, dc: dcMatch ? dcMatch[1] : null };
      break;
    }
  }

  // Roll20 inline roll: [[1d4]], [[2d6+3]], [[1d8-1]]
  const inlineMatch = text.match(/\[\[\s*(\d+d\d+(?:[+\-]\d+)?)\s*\]\]/i);
  const roll = inlineMatch ? inlineMatch[1] : null;

  return { roll, save };
}

// ── Builders для activities ─────────────────────

function buildAttackActivity(row, activationType) {
  const attackBonus = f(row, "attack_tohit", "tohit", "npc_attack_bonus");
  const dmgFormula  = f(row, "dmgbase", "npc_dmg1", "dmg1");
  const dmgType     = f(row, "dmgtype", "npc_dmg1_type", "dmg1type");
  const dmg2Formula = f(row, "dmg2base", "npc_dmg2", "dmg2");
  const dmg2Type    = f(row, "dmg2type", "npc_dmg2_type", "dmg2type");
  const atkType     = f(row, "attack_type", "npc_attack_type") || "melee";

  const parts = [];
  if (dmgFormula)  parts.push(dmgPart(dmgFormula, dmgType));
  if (dmg2Formula) parts.push(dmgPart(dmg2Formula, dmg2Type));

  const range = atkType === "ranged"
    ? { value: 60, units: "ft", special: "" }
    : { value: 5,  units: "ft", special: "" };

  return {
    _id:  randomId(),
    type: "attack",
    name: "",
    activation: { type: activationType, value: 1, condition: "" },
    attack: {
      ability:  "",
      bonus:    attackBonus,
      critical: { threshold: null, damage: "" },
      flat:     false,
      type:     { value: atkType, classification: "natural" },
    },
    damage: {
      critical: { allow: true, bonus: "" },
      onSave:   "half",
      parts,
    },
    range,
    target: {
      template: {},
      affects:  { count: "", type: "creature", choice: false, special: "" },
      prompt:   true,
    },
    uses:    { spent: 0, max: "", recovery: [] },
    effects: [],
  };
}

function buildSaveActivity(row, activationType) {
  const savedc     = f(row, "savedc", "npc_save_dc");
  const saveAttr   = f(row, "saveattr", "savetype", "npc_saveattr");
  const dmgFormula = f(row, "savedamage", "dmgbase", "npc_dmg1", "dmg1");
  const dmgType    = f(row, "dmgtype", "npc_dmg1_type", "dmg1type");

  const parts = [];
  if (dmgFormula) parts.push(dmgPart(dmgFormula, dmgType));

  return {
    _id:  randomId(),
    type: "save",
    name: "",
    activation: { type: activationType, value: 1, condition: "" },
    save: {
      ability:       saveAttr ? [saveAttr.toLowerCase().slice(0, 3)] : [],
      dc:            { formula: savedc || "10", calculation: "flat" },
      successOrFail: false,
    },
    damage: {
      onSave: "half",
      parts,
    },
    target: {
      template: {},
      affects:  { count: "", type: "creature", choice: false, special: "" },
      prompt:   true,
    },
    uses:    { spent: 0, max: "", recovery: [] },
    effects: [],
  };
}

function buildUtilityActivity(activationType) {
  return {
    _id:  randomId(),
    type: "utility",
    name: "",
    activation: { type: activationType, value: 1, condition: "" },
    uses:    { spent: 0, max: "", recovery: [] },
    effects: [],
  };
}

function buildSaveActivityFromDesc(save, rollFormula, activationType) {
  const parts = [];
  if (rollFormula) parts.push(dmgPart(rollFormula, ""));
  return {
    _id:  randomId(),
    type: "save",
    name: "",
    activation: { type: activationType, value: 1, condition: "" },
    save: {
      ability:       [save.ability],
      dc:            { formula: save.dc ?? "10", calculation: "flat" },
      successOrFail: false,
    },
    damage: {
      onSave: "half",
      parts,
    },
    target: {
      template: {},
      affects:  { count: "", type: "creature", choice: false, special: "" },
      prompt:   true,
    },
    uses:    { spent: 0, max: "", recovery: [] },
    effects: [],
  };
}

/**
 * Определить тип активности по данным строки и построить activity.
 * Приоритет: структурные поля (attack/save) → парсинг описания → utility.
 */
function buildActivity(row, activationType) {
  const hasAttack = f(row, "attack_tohit", "tohit", "npc_attack_bonus") !== "" ||
                    (f(row, "dmgbase", "npc_dmg1", "dmg1") !== "" &&
                     f(row, "savedc", "npc_save_dc") === "");
  const hasSave = f(row, "savedc", "npc_save_dc") !== "";

  if (hasAttack && !hasSave) return buildAttackActivity(row, activationType);
  if (hasSave)               return buildSaveActivity(row, activationType);

  // Fallback: ищем механику в тексте описания
  const desc = f(row, "description", "spelldescription");
  const { roll, save } = parseDescriptionMechanics(desc);
  if (save) return buildSaveActivityFromDesc(save, roll, activationType);

  const act = buildUtilityActivity(activationType);
  if (roll) act.roll = { formula: roll, prompt: false, visible: false };
  return act;
}

// ── Публичный API ───────────────────────────────

/**
 * Построить Foundry Item из строки repeating_npcaction / repeating_npcatk / etc.
 *
 * @param {object} row            — строка repeating-секции
 * @param {string} activationType — action|bonus|reaction|legendary|special
 * @param {object} idMapper
 * @returns {object} — Foundry Item data
 */
export function buildNPCItemFromRow(row, activationType, idMapper) {
  const name        = f(row, "name", "atkname");
  const description = f(row, "description");
  // Пропустить пустые items без имени и описания
  if (!name && !description) return null;
  const itemName = name || "Action";
  const activity    = buildActivity(row, activationType);
  const activities  = { [activity._id]: activity };

  // weapon если это атака, иначе feat
  const itemType = activity.type === "attack" ? "weapon" : "feat";

  const base = {
    _id:  idMapper.getOrCreate(row._id),
    name: itemName,
    type: itemType,
    system: {
      description: { value: description, chat: "" },
      source:      { book: "Roll20 Import", page: "" },
      activation:  { type: activationType, value: 1, condition: "" },
      activities,
    },
    flags: { "r20-to-fvtt": { originalId: row._id, builtFromScratch: true } },
  };

  if (itemType === "weapon") {
    base.system.equipped    = true;
    base.system.identified  = true;
    base.system.quantity    = 1;
    base.system.weight      = { value: 0, units: "lb" };
    base.system.price       = { value: 0, denomination: "gp" };
  }

  return base;
}

/**
 * Построить Foundry Item из строки repeating_spell-N.
 *
 * @param {object} row     — spell row
 * @param {object} idMapper
 * @returns {object} — Foundry Item data
 */
export function buildSpellItemFromRow(row, idMapper) {
  const name  = f(row, "spellname") || "Spell";
  const level = parseInt(f(row, "spelllevel")) || 0;
  const desc  = f(row, "spelldescription");

  // Переводим spell-специфичные поля в generic для buildActivity
  const mappedRow = {
    ...row,
    dmgbase:  f(row, "spelldamage"),
    dmgtype:  f(row, "spelldamagetype"),
    dmg2base: f(row, "spelldamage2"),
    dmg2type: f(row, "spelldamagetype2"),
    savedc:   f(row, "roll_output_dc"),
    saveattr: f(row, "spellsave"),
  };

  const activity   = buildActivity(mappedRow, "action");
  const activities = { [activity._id]: activity };

  return {
    _id:  idMapper.getOrCreate(row._id),
    name,
    type: "spell",
    system: {
      description: { value: desc, chat: "" },
      source:      { book: "Roll20 Import", page: "" },
      level,
      activation: { type: "action", value: 1, condition: "" },
      activities,
    },
    flags: { "r20-to-fvtt": { originalId: row._id, builtFromScratch: true } },
  };
}
