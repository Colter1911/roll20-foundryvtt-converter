/**
 * actor-assembler.js — Оркестратор библиотечной сборки актёров (НПС и ПК).
 *
 * Путь A (actor template): найти актёра в Actor-паках → взять его items +
 *   патч R20 значений + добавить кастомные R20 items которых нет в компендиуме.
 *
 * Путь B (item-by-item): актёр не найден → каждый R20 item обогащается
 *   из Item-паков или строится с нуля.
 *   Для ПК: class/race/background загружаются из компендиума отдельно.
 *
 * Системные данные (HP, AC, stats, saves...) ВСЕГДА берутся из Roll20.
 */

import { enrichItem, patchItemWithR20 } from "./item-enricher.js";
import {
  buildNPCItemFromRow, buildSpellItemFromRow,
  buildInventoryItemFromRow, buildFeatItemFromRow,
} from "./item-factory.js";
import { findBest } from "./name-matcher.js";
import { NPC_ACTION_SECTIONS, SPELL_SECTIONS } from "../systems/dnd5e/field-maps.js";

export class ActorAssembler {
  #index;
  #threshold;

  /**
   * @param {CompendiumIndex} index
   * @param {object} options
   * @param {number} [options.threshold=0.8]
   */
  constructor(index, options = {}) {
    this.#index     = index;
    this.#threshold = options.threshold ?? 0.8;
  }

  /**
   * Обогатить baseActorData items из компендиума.
   * Системные данные (system.*) остаются нетронутыми.
   *
   * @param {object}       baseActorData — результат toActorData()
   * @param {R20Character} r20char
   * @param {object}       idMapper
   * @returns {Promise<object>} — actor data с обогащёнными items
   */
  async assemble(baseActorData, r20char, idMapper) {
    const isPC = baseActorData.type === "character";
    if (baseActorData.type !== "npc" && !isPC) return baseActorData;

    // ── Путь A: ищем актёра целиком в Actor-паках ──
    const actorMatch = this.#index.findActor(r20char.name);
    if (actorMatch) {
      const compActor = await this.#index.loadDocument(actorMatch.packId, actorMatch.docId);
      if (compActor) {
        console.debug(`R20Import | Actor "${r20char.name}" → template from ${actorMatch.packId} (score=${actorMatch.score.toFixed(2)})`);
        return this.#pathA(baseActorData, r20char, compActor, idMapper, isPC);
      }
    }

    // ── Путь B: item-by-item ────────────────────────
    console.debug(`R20Import | Actor "${r20char.name}" → item-by-item enrichment`);
    return this.#pathB(baseActorData, r20char, idMapper, isPC);
  }

  // ── Путь A ─────────────────────────────────────────

  async #pathA(baseActorData, r20char, compActor, idMapper, isPC) {
    const compItems = compActor.items ?? [];
    const r20Items  = isPC ? this.#collectPCItems(r20char) : this.#collectNPCItems(r20char);

    // Для каждого item компендиума — ищем совпадение в R20 items → патч значений
    const usedR20Ids = new Set();

    const enrichedItems = compItems.map(compItem => {
      const match = findBest(compItem.name, r20Items, this.#threshold);
      if (match && !usedR20Ids.has(match.item.row._id)) {
        usedR20Ids.add(match.item.row._id);
        const patched = patchItemWithR20(compItem, match.item.row);
        patched._id   = idMapper.getOrCreate(match.item.row._id);
        return patched;
      }
      // Нет R20 совпадения — item из компендиума как есть, новый ID
      return { ...compItem, _id: foundry.utils.randomID() };
    });

    // R20 items без совпадения → buildFromScratch (кастомные добавления GM)
    for (const r20item of r20Items) {
      if (!usedR20Ids.has(r20item.row._id)) {
        const item = this.#buildFallbackItem(r20item, idMapper);
        if (item) enrichedItems.push(item);
      }
    }

    return { ...baseActorData, items: enrichedItems };
  }

  // ── Путь B ─────────────────────────────────────────

  async #pathB(baseActorData, r20char, idMapper, isPC) {
    const r20Items      = isPC ? this.#collectPCItems(r20char) : this.#collectNPCItems(r20char);
    const enrichedItems = [];

    // Для ПК: meta-items (class, race, background) из компендиума
    if (isPC) {
      for (const meta of await this.#enrichPCMetaItems(r20char, idMapper)) {
        enrichedItems.push(meta);
      }
    }

    for (const r20item of r20Items) {
      try {
        let item;
        if (r20item.category === "inventory") {
          // Инвентарь: ищем по itemname, fallback → buildInventoryItemFromRow
          item = await enrichItem(
            r20item.row, r20item.activationType, false,
            this.#index, idMapper,
            r20item.name || null,
            () => buildInventoryItemFromRow(r20item.row, idMapper)
          );
        } else if (r20item.category === "feat") {
          // Черты/расовые: ищем по name с preferredType feat, fallback → buildFeatItemFromRow
          item = await enrichItem(
            r20item.row, r20item.activationType, false,
            this.#index, idMapper,
            r20item.name || null,
            () => buildFeatItemFromRow(r20item.row, idMapper),
            "feat"
          );
        } else {
          // NPC actions, PC attacks, spells — стандартный путь
          item = await enrichItem(
            r20item.row, r20item.activationType, r20item.isSpell,
            this.#index, idMapper
          );
        }
        if (item) enrichedItems.push(item);
      } catch (e) {
        console.warn(`R20Import | enrichItem "${r20item.name}" failed:`, e.message);
      }
    }

    return { ...baseActorData, items: enrichedItems };
  }

  // ── Meta-items ПК ───────────────────────────────────

  /**
   * Загрузить class/race/background из компендиума по атрибутам персонажа.
   * @returns {Promise<object[]>}
   */
  async #enrichPCMetaItems(r20char, idMapper) {
    const metaDefs = [
      { attrKeys: ["class", "class_name"], type: "class",      key: "class"      },
      { attrKeys: ["race"],                type: "race",        key: "race"       },
      { attrKeys: ["background"],          type: "background",  key: "background" },
    ];

    const results = [];
    for (const { attrKeys, type, key } of metaDefs) {
      let name = "";
      for (const attrKey of attrKeys) {
        name = String(r20char.attr(attrKey) || "").trim();
        if (name) break;
      }
      if (!name) continue;

      const item = await this.#loadMetaItem(name, type, `${r20char.id}_${key}`, idMapper);
      if (item) results.push(item);
      else console.debug(`R20Import | Meta "${name}" (${type}) not found in compendium`);
    }
    return results;
  }

  async #loadMetaItem(name, type, syntheticKey, idMapper) {
    const match = this.#index.findItem(name, type);
    if (!match) return null;
    const compItem = await this.#index.loadDocument(match.packId, match.docId);
    if (!compItem) return null;
    const result  = { ...compItem, _id: idMapper.getOrCreate(syntheticKey) };
    result.flags ??= {};
    result.flags["r20-to-fvtt"] = { originalId: syntheticKey, fromCompendium: match.packId, matchScore: match.score };
    return result;
  }

  // ── Fallback builder ────────────────────────────────

  #buildFallbackItem(r20item, idMapper) {
    if (r20item.isSpell)                   return buildSpellItemFromRow(r20item.row, idMapper);
    if (r20item.category === "inventory")  return buildInventoryItemFromRow(r20item.row, idMapper);
    if (r20item.category === "feat")       return buildFeatItemFromRow(r20item.row, idMapper);
    return buildNPCItemFromRow(r20item.row, r20item.activationType, idMapper);
  }

  // ── Сбор R20 items ─────────────────────────────────

  /**
   * Собрать все items НПС из repeating-секций.
   * @returns {Array<{row, activationType, isSpell, name, category}>}
   */
  #collectNPCItems(r20char) {
    const items = [];

    // NPC actions (action / bonus / reaction / legendary / trait)
    for (const [section, activationType] of Object.entries(NPC_ACTION_SECTIONS)) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.name || "").trim();
        items.push({ row, activationType, isSpell: false, name, category: "action" });
      }
    }

    // NPC атаки (repeating_npcatk, repeating_npcdmg)
    for (const section of ["repeating_npcatk", "repeating_npcdmg"]) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.name || row.atkname || "").trim();
        items.push({ row, activationType: "action", isSpell: false, name, category: "action" });
      }
    }

    // Заклинания
    for (const section of SPELL_SECTIONS) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.spellname || "").trim();
        items.push({ row, activationType: "action", isSpell: true, name, category: "spell" });
      }
    }

    return items;
  }

  /**
   * Собрать все items ПК из repeating-секций.
   * @returns {Array<{row, activationType, isSpell, name, category}>}
   */
  #collectPCItems(r20char) {
    const items = [];

    // Атаки (repeating_attack) — пропускаем spell-linked
    for (const row of r20char.repeating["repeating_attack"] ?? []) {
      if (row.spellid) continue;
      const name = String(row.atkname || row.name || "").trim();
      items.push({ row, activationType: "action", isSpell: false, name, category: "action" });
    }

    // Инвентарь (repeating_inventory)
    for (const row of r20char.repeating["repeating_inventory"] ?? []) {
      const name = String(row.itemname || "").trim();
      items.push({ row, activationType: "action", isSpell: false, name, category: "inventory" });
    }

    // Черты / расовые способности (repeating_traits)
    for (const row of r20char.repeating["repeating_traits"] ?? []) {
      const name = String(row.name || "").trim();
      items.push({ row, activationType: "passive", isSpell: false, name, category: "feat" });
    }

    // Заклинания
    for (const section of SPELL_SECTIONS) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.spellname || "").trim();
        items.push({ row, activationType: "action", isSpell: true, name, category: "spell" });
      }
    }

    return items;
  }
}
