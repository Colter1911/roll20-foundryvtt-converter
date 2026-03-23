/**
 * macro-parser.js — R20Macro → Macro конвертация.
 * R20 макросы имеют несовместимый синтаксис (@{attr}), поэтому
 * импортируются как тип "chat" для ручной доработки.
 */

/**
 * @param {import("./r20-document.js").R20Macro} r20macro
 * @param {import("./id-mapper.js").IdMapper}    idMapper
 * @returns {Object} данные для Macro.create()
 */
export function macroToMacro(r20macro, idMapper) {
  return {
    _id:     idMapper.getOrCreate(r20macro.id),
    name:    r20macro.name,
    type:    "chat",   // "script" невозможен без портирования синтаксиса
    command: r20macro.action || "",
    img:     "icons/svg/d20-black.svg",
    flags: {
      "r20-to-fvtt": {
        originalId:    r20macro.id,
        originalSyntax: "roll20",
        note: "Макрос импортирован как chat — требует ручной адаптации синтаксиса"
      }
    },
  };
}
