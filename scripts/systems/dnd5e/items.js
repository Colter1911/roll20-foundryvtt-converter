/**
 * items.js — Конвертация repeating секций Roll20 → Foundry Items (dnd5e).
 * Заклинания, атаки, инвентарь, черты, NPC действия.
 */

import {
  mapActivationType, buildDamageParts, parseRange, parseDuration, parseTarget
} from "../../core/utils.js";
import {
  SPELL_SECTIONS, NPC_ACTION_SECTIONS
} from "./field-maps.js";

/* ═══════════════════════════════════════════════
   Заклинания (repeating_spell-N)
═══════════════════════════════════════════════ */

/**
 * Получить все заклинания персонажа как массив Item-данных.
 */
export function buildSpellItems(r20char, idMapper) {
  const items = [];

  for (const section of SPELL_SECTIONS) {
    const rows = r20char.repeating[section] ?? [];
    for (const row of rows) {
      try {
        items.push(spellRowToItem(row, idMapper));
      } catch (e) {
        console.warn(`R20Import | Spell parse error (${row._id}):`, e.message);
      }
    }
  }

  return items;
}

function spellRowToItem(row, idMapper) {
  const level = parseInt(row.spelllevel) || 0;

  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.spellname || "Unknown Spell",
    type: "spell",
    system: {
      level,
      school:      mapSpellSchool(row.spellschool),
      description: { value: row.spelldescription || "" },
      source:      { book: "Roll20 Import" },
      activation: {
        type: mapActivationType(row.spellcastingtime),
        cost: 1,
      },
      duration: parseDuration(row.spellduration),
      range:    parseRange(row.spellrange),
      target:   parseTarget(row.spelltarget),
      components: {
        vocal:    !!(row.spellcomp_v    && row.spellcomp_v    !== "0"),
        somatic:  !!(row.spellcomp_s    && row.spellcomp_s    !== "0"),
        material: !!(row.spellcomp_m    && row.spellcomp_m    !== "0"),
        materials: { value: row.spellcomp_materials || "" },
      },
      preparation: {
        mode:     level === 0 ? "always" : "prepared",
        prepared: level === 0 || row.spellprepared === "1",
      },
      damage: {
        base: buildDamageParts(row)[0] ?? {},
        versatile: "",
      },
      save: row.spellsave
        ? { ability: String(row.spellsave).toLowerCase().slice(0, 3), dc: parseInt(row.roll_output_dc) || null }
        : {},
    },
    flags: { "r20-to-fvtt": { originalId: row._id, section: "_spell" } },
  };
}

const SCHOOL_MAP = {
  abjuration: "abj",    abj: "abj",
  conjuration: "con",   con: "con",
  divination: "div",    div: "div",
  enchantment: "enc",   enc: "enc",
  evocation: "evo",     evo: "evo",
  illusion: "ill",      ill: "ill",
  necromancy: "nec",    nec: "nec",
  transmutation: "trs", trs: "trs",
};
function mapSpellSchool(raw) {
  return SCHOOL_MAP[String(raw ?? "").toLowerCase()] ?? "evo";
}

/* ═══════════════════════════════════════════════
   Атаки (repeating_attack) — только не-заклинательные
═══════════════════════════════════════════════ */

export function buildAttackItems(r20char, idMapper) {
  const items = [];
  const rows  = r20char.repeating["repeating_attack"] ?? [];

  for (const row of rows) {
    // Если атака привязана к заклинанию — пропустить (оно уже создано)
    if (row.spellid) continue;
    try {
      items.push(attackRowToItem(row, idMapper));
    } catch (e) {
      console.warn(`R20Import | Attack parse error (${row._id}):`, e.message);
    }
  }

  return items;
}

function attackRowToItem(row, idMapper) {
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.atkname || "Unknown Attack",
    type: "weapon",
    system: {
      description: { value: row.atk_desc || "" },
      source:      { book: "Roll20 Import" },
      quantity: 1,
      weight:   { value: 0, units: "lb" },
      price:    { value: 0, denomination: "gp" },
      equipped: true,
      identified: true,
      damage: {
        base: {
          formula: row.dmgbase || "1d4",
          types:   [String(row.dmgtype ?? "").toLowerCase()],
        },
      },
      range: parseRange(row.atkrange),
      activation: { type: "action", cost: 1 },
    },
    flags: { "r20-to-fvtt": { originalId: row._id, section: "attack" } },
  };
}

/* ═══════════════════════════════════════════════
   Инвентарь (repeating_inventory)
═══════════════════════════════════════════════ */

export function buildInventoryItems(r20char, idMapper) {
  const items = [];
  const rows  = r20char.repeating["repeating_inventory"] ?? [];

  for (const row of rows) {
    try {
      items.push(inventoryRowToItem(row, idMapper));
    } catch (e) {
      console.warn(`R20Import | Inventory parse error (${row._id}):`, e.message);
    }
  }

  return items;
}

function inventoryRowToItem(row, idMapper) {
  // Простая эвристика типа: если есть броня — equipment, иначе loot
  const itemType = row.itemarmor ? "equipment" : "loot";
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.itemname || "Item",
    type: itemType,
    system: {
      description: { value: row.itemcontent || "" },
      source:      { book: "Roll20 Import" },
      quantity:    parseInt(row.itemcount)  || 1,
      weight:      { value: parseFloat(row.itemweight) || 0, units: "lb" },
      price:       { value: parseFloat(row.itemcost)   || 0, denomination: "gp" },
      equipped:    row.equipped === "1",
      identified:  true,
    },
    flags: { "r20-to-fvtt": { originalId: row._id, section: "inventory" } },
  };
}

/* ═══════════════════════════════════════════════
   Черты / расовые способности (repeating_traits)
═══════════════════════════════════════════════ */

export function buildTraitItems(r20char, idMapper) {
  const items = [];
  const rows  = r20char.repeating["repeating_traits"] ?? [];

  for (const row of rows) {
    try {
      items.push({
        _id:  idMapper.getOrCreate(row._id),
        name: row.name || "Trait",
        type: "feat",
        system: {
          description: { value: row.description || "" },
          activation:  { type: "passive", cost: null },
        },
        flags: { "r20-to-fvtt": { originalId: row._id, section: "traits" } },
      });
    } catch (e) {
      console.warn(`R20Import | Trait parse error (${row._id}):`, e.message);
    }
  }

  return items;
}

/* ═══════════════════════════════════════════════
   NPC действия (action/bonus/reaction/trait/legendary)
═══════════════════════════════════════════════ */

export function buildNPCActionItems(r20char, idMapper) {
  const items = [];

  for (const [section, activationType] of Object.entries(NPC_ACTION_SECTIONS)) {
    const rows = r20char.repeating[section] ?? [];
    for (const row of rows) {
      // Пропустить пустые строки без имени и описания
      if (!row.name && !row.description) continue;
      try {
        items.push({
          _id:  idMapper.getOrCreate(row._id),
          name: row.name || "Action",
          type: "feat",
          system: {
            description: { value: row.description || "" },
            activation:  { type: activationType, cost: 1 },
            // Если у действия есть урон
            damage: row.npc_dmg1
              ? { base: { formula: row.npc_dmg1, types: [String(row.npc_dmg1_type ?? "").toLowerCase()] } }
              : undefined,
          },
          flags: { "r20-to-fvtt": { originalId: row._id, section } },
        });
      } catch (e) {
        console.warn(`R20Import | NPC action parse error (${row._id}):`, e.message);
      }
    }
  }

  return items;
}

/* ═══════════════════════════════════════════════
   NPC атаки (repeating_npcatk)
═══════════════════════════════════════════════ */

export function buildNPCAttackItems(r20char, idMapper) {
  const items = [];
  const sections = ["repeating_npcatk", "repeating_npcdmg"];

  for (const section of sections) {
    const rows = r20char.repeating[section] ?? [];
    for (const row of rows) {
      try {
        items.push({
          _id:  idMapper.getOrCreate(row._id + "_" + section),
          name: row.name || row.atkname || "NPC Attack",
          type: "weapon",
          system: {
            description: { value: row.description || "" },
            equipped:    true,
            identified:  true,
            activation:  { type: "action", cost: 1 },
            damage: {
              base: {
                formula: row.dmg1 || row.npc_dmg1 || "1d4",
                types:   [String(row.dmg1type || row.npc_dmg1_type || "").toLowerCase()],
              },
            },
          },
          flags: { "r20-to-fvtt": { originalId: row._id, section } },
        });
      } catch (e) {
        console.warn(`R20Import | NPC attack parse error (${row._id}):`, e.message);
      }
    }
  }

  return items;
}
