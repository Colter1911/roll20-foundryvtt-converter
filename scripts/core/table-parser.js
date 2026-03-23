/**
 * table-parser.js — R20Table → RollTable конвертация.
 */

import { buildOwnership } from "./utils.js";

/**
 * @param {import("./r20-document.js").R20Table} r20table
 * @param {import("./id-mapper.js").IdMapper}    idMapper
 * @returns {Object} данные для RollTable.create()
 */
export function tableToRollTable(r20table, idMapper) {
  const results = r20table.items.map((item, i) => ({
    _id:    idMapper.getOrCreate("tableitem_" + (item.id || i)),
    type:   0,   // plain text
    text:   item.name,
    img:    item.img || "icons/svg/d20-black.svg",
    weight: item.weight,
    range:  [0, 0],  // будет пересчитано Foundry автоматически
  }));

  return {
    _id:     idMapper.getOrCreate(r20table.id),
    name:    r20table.name,
    formula: `1d${Math.max(1, r20table.items.length)}`,
    results: results,
    flags: { "r20-to-fvtt": { originalId: r20table.id } },
  };
}
