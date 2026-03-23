/**
 * actor-assembler.js — Оркестратор библиотечной сборки НПС.
 *
 * Путь A (actor template): найти актёра в Actor-паках → взять его items +
 *   патч R20 значений + добавить кастомные R20 items которых нет в компендиуме.
 *
 * Путь B (item-by-item): актёр не найден → каждый R20 item обогащается
 *   из Item-паков или строится с нуля.
 *
 * Системные данные (HP, AC, stats, saves...) ВСЕГДА берутся из Roll20.
 */

import { enrichItem, patchItemWithR20 } from "./item-enricher.js";
import { buildNPCItemFromRow, buildSpellItemFromRow } from "./item-factory.js";
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
    if (baseActorData.type !== "npc") return baseActorData;

    // ── Путь A: ищем актёра целиком в Actor-паках ──
    const actorMatch = this.#index.findActor(r20char.name);
    if (actorMatch) {
      const compActor = await this.#index.loadDocument(actorMatch.packId, actorMatch.docId);
      if (compActor) {
        console.debug(`R20Import | Actor "${r20char.name}" → template from ${actorMatch.packId} (score=${actorMatch.score.toFixed(2)})`);
        return this.#pathA(baseActorData, r20char, compActor, idMapper);
      }
    }

    // ── Путь B: item-by-item ────────────────────────
    console.debug(`R20Import | Actor "${r20char.name}" → item-by-item enrichment`);
    return this.#pathB(baseActorData, r20char, idMapper);
  }

  // ── Путь A ─────────────────────────────────────────

  async #pathA(baseActorData, r20char, compActor, idMapper) {
    const compItems = compActor.items ?? [];
    const r20Items  = this.#collectR20Items(r20char);

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
        const item = r20item.isSpell
          ? buildSpellItemFromRow(r20item.row, idMapper)
          : buildNPCItemFromRow(r20item.row, r20item.activationType, idMapper);
        if (item) enrichedItems.push(item);
      }
    }

    return { ...baseActorData, items: enrichedItems };
  }

  // ── Путь B ─────────────────────────────────────────

  async #pathB(baseActorData, r20char, idMapper) {
    const r20Items      = this.#collectR20Items(r20char);
    const enrichedItems = [];

    for (const r20item of r20Items) {
      try {
        const item = await enrichItem(
          r20item.row,
          r20item.activationType,
          r20item.isSpell,
          this.#index,
          idMapper
        );
        if (item) enrichedItems.push(item);
      } catch (e) {
        console.warn(`R20Import | enrichItem "${r20item.name}" failed:`, e.message);
      }
    }

    return { ...baseActorData, items: enrichedItems };
  }

  // ── Сбор R20 items ─────────────────────────────────

  /**
   * Собрать все items НПС из repeating-секций.
   * @returns {Array<{row, activationType, isSpell, name}>}
   */
  #collectR20Items(r20char) {
    const items = [];

    // NPC actions (action / bonus / reaction / legendary / trait)
    for (const [section, activationType] of Object.entries(NPC_ACTION_SECTIONS)) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.name || "").trim();
        items.push({ row, activationType, isSpell: false, name });
      }
    }

    // NPC атаки (repeating_npcatk, repeating_npcdmg)
    for (const section of ["repeating_npcatk", "repeating_npcdmg"]) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.name || row.atkname || "").trim();
        items.push({ row, activationType: "action", isSpell: false, name });
      }
    }

    // Заклинания
    for (const section of SPELL_SECTIONS) {
      for (const row of r20char.repeating[section] ?? []) {
        const name = String(row.spellname || "").trim();
        items.push({ row, activationType: "action", isSpell: true, name });
      }
    }

    return items;
  }
}
