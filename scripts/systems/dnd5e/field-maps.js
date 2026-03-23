/**
 * field-maps.js — Таблицы маппинга полей Roll20 OGL 5e → Foundry dnd5e.
 */

/** 6 базовых характеристик: [foundryCode, roll20AttrName] */
export const ABILITIES = [
  ["str", "strength"],
  ["dex", "dexterity"],
  ["con", "constitution"],
  ["int", "intelligence"],
  ["wis", "wisdom"],
  ["cha", "charisma"],
];

/** Навыки: roll20Name → foundryCode */
export const SKILL_MAP = {
  "acrobatics":       "acr",
  "animal-handling":  "ani",
  "arcana":           "arc",
  "athletics":        "ath",
  "deception":        "dec",
  "history":          "his",
  "insight":          "ins",
  "intimidation":     "itm",
  "investigation":    "inv",
  "medicine":         "med",
  "nature":           "nat",
  "perception":       "per",
  "performance":      "prf",
  "persuasion":       "prs",
  "religion":         "rel",
  "sleight-of-hand":  "slt",
  "stealth":          "ste",
  "survival":         "sur",
};

/** Секции заклинаний (повторяющиеся) */
export const SPELL_SECTIONS = [
  "repeating_spell-cantrip",
  "repeating_spell-1",
  "repeating_spell-2",
  "repeating_spell-3",
  "repeating_spell-4",
  "repeating_spell-5",
  "repeating_spell-6",
  "repeating_spell-7",
  "repeating_spell-8",
  "repeating_spell-9",
];

/** Уровни заклинаний для слотов */
export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** NPC repeating секции → тип активации */
export const NPC_ACTION_SECTIONS = {
  "repeating_npcaction":      "action",
  "repeating_npcbonusaction": "bonus",
  "repeating_npcreaction":    "reaction",
  "repeating_npctrait":       "special",
  "repeating_npcaction-l":    "legendary",
};
