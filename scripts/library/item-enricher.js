/**
 * item-enricher.js — Слияние данных компендиума и Roll20 для одного item.
 *
 * Политика слияния (раздел 3a плана):
 *   Компендиум = структурный шаблон (activities, описание по умолчанию, иконка).
 *   Roll20     = конкретные значения (формулы урона, бонус атаки, save DC, описание если есть).
 *   R20 данные перезаписывают компендиум только если они непустые.
 */

import { buildNPCItemFromRow, buildSpellItemFromRow } from "./item-factory.js";

// ── Вспомогательные ─────────────────────────────

function f(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function dmgPart(formula, type) {
  return {
    formula,
    types:  type ? [type.toLowerCase()] : [],
    bonus:  "",
    custom: { enabled: false, label: "" },
    scaling: { mode: "whole", number: null, formula: "" },
  };
}

// ── Патч одного activity ──────────────────────────

function patchActivity(act, row) {
  // Attack bonus
  const bonus = f(row, "attack_tohit", "tohit", "npc_attack_bonus");
  if (bonus && act.attack) {
    act.attack.bonus = bonus;
  }

  // Primary damage (NPC + spell field names)
  const dmgF = f(row, "dmgbase", "npc_dmg1", "dmg1", "spelldamage");
  const dmgT = f(row, "dmgtype", "npc_dmg1_type", "dmg1type", "spelldamagetype");
  if (dmgF) {
    act.damage ??= { parts: [] };
    act.damage.parts ??= [];
    if (act.damage.parts.length > 0) {
      act.damage.parts[0].formula = dmgF;
      if (dmgT) act.damage.parts[0].types = [dmgT.toLowerCase()];
    } else {
      act.damage.parts.push(dmgPart(dmgF, dmgT));
    }
  }

  // Secondary damage
  const dmg2F = f(row, "dmg2base", "npc_dmg2", "dmg2", "spelldamage2");
  const dmg2T = f(row, "dmg2type", "npc_dmg2_type", "dmg2type", "spelldamagetype2");
  if (dmg2F) {
    act.damage ??= { parts: [] };
    act.damage.parts ??= [];
    const part2 = dmgPart(dmg2F, dmg2T);
    if (act.damage.parts.length > 1) act.damage.parts[1] = part2;
    else act.damage.parts.push(part2);
  }

  // Save DC (NPC + spell field names)
  const savedc = f(row, "savedc", "npc_save_dc", "roll_output_dc");
  if (savedc && act.save?.dc) {
    act.save.dc.formula     = savedc;
    act.save.dc.calculation = "flat";
  }

  // Save ability
  const saveAttr = f(row, "saveattr", "savetype", "npc_saveattr", "spellsave");
  if (saveAttr && act.save) {
    act.save.ability = [saveAttr.toLowerCase().slice(0, 3)];
  }
}

// ── Публичный API ───────────────────────────────

/**
 * Применить Roll20 данные поверх item из компендиума.
 * Возвращает новый объект (оригинал не мутируется).
 *
 * @param {object} compItem — item data из компендиума
 * @param {object} row      — R20 repeating row
 * @returns {object}
 */
export function patchItemWithR20(compItem, row) {
  const result = deepCopy(compItem);

  // Описание: R20 если непустое
  const r20desc = f(row, "description", "spelldescription");
  if (r20desc) {
    result.system       ??= {};
    result.system.description ??= {};
    result.system.description.value = r20desc;
  }

  // Патч activities
  const acts = result.system?.activities;
  if (acts && typeof acts === "object") {
    for (const actId of Object.keys(acts)) {
      patchActivity(acts[actId], row);
    }
  }

  return result;
}

/**
 * Найти item в компендиуме, применить R20 патч, или построить с нуля.
 *
 * @param {object}          row            — R20 repeating row
 * @param {string}          activationType — action|bonus|reaction|legendary|special
 * @param {boolean}         isSpell
 * @param {CompendiumIndex} index
 * @param {object}          idMapper
 * @param {string|null}     [nameOverride]         — имя для поиска (если поле имени нестандартное)
 * @param {Function|null}   [fallbackFn]           — fallback builder вместо buildNPCItemFromRow
 * @param {string|null}     [preferredTypeOverride] — переопределить тип поиска (напр. "feat")
 * @returns {Promise<object>} — Foundry Item data
 */
export async function enrichItem(row, activationType, isSpell, index, idMapper, nameOverride = null, fallbackFn = null, preferredTypeOverride = null) {
  const name = nameOverride ?? (isSpell
    ? f(row, "spellname")
    : f(row, "name", "atkname"));

  // Ищем в компендиуме если есть имя
  if (name) {
    const preferredType = preferredTypeOverride ?? (isSpell ? "spell" : null);
    const match = index.findItem(name, preferredType);

    if (match) {
      const compItem = await index.loadDocument(match.packId, match.docId);
      if (compItem) {
        const enriched   = patchItemWithR20(compItem, row);
        enriched._id     = idMapper.getOrCreate(row._id);
        enriched.flags ??= {};
        enriched.flags["r20-to-fvtt"] = {
          originalId:     row._id,
          fromCompendium: match.packId,
          matchScore:     match.score,
        };
        return enriched;
      }
    }
  }

  // Fallback: строим из R20 данных
  if (fallbackFn) return fallbackFn();
  return isSpell
    ? buildSpellItemFromRow(row, idMapper)
    : buildNPCItemFromRow(row, activationType, idMapper);
}
