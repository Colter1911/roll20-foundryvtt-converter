/**
 * journal-parser.js — Handouts → JournalEntry конвертация.
 */

import { buildOwnership } from "./utils.js";

/**
 * Конвертировать R20Handout в данные для JournalEntry.create().
 * @param {import("./r20-document.js").R20Handout} r20handout
 * @param {Map<string,string|null>}  folderMap   — r20id → foundry folder id
 * @param {import("./id-mapper.js").IdMapper}     idMapper
 * @param {Object<string,string>}    playerIdMap — r20playerId → foundry userId
 * @param {string}                   [avatarPath] — путь к загруженному аватару
 * @returns {Object} данные для JournalEntry.create()
 */
export function handoutToJournalEntry(r20handout, folderMap, idMapper, playerIdMap, avatarPath = "") {
  const pages = [];

  // Основной контент — страница OBSERVER
  if (r20handout.notes?.trim()) {
    pages.push({
      _id:  foundry.utils.randomID(),
      name: "Заметки",
      type: "text",
      sort: 100000,
      text: { content: r20handout.notes, format: 1 },
      ownership: { default: 2 },
    });
  }

  // GM Notes — страница только для GM
  if (r20handout.gmNotes?.trim()) {
    pages.push({
      _id:  foundry.utils.randomID(),
      name: "GM Notes",
      type: "text",
      sort: 200000,
      text: { content: r20handout.gmNotes, format: 1 },
      ownership: { default: 0 },
    });
  }

  // Если нет никакого текста — попробовать создать страницу-картинку из аватара,
  // иначе — пустую текстовую страницу-заглушку
  if (pages.length === 0) {
    const imgSrc = avatarPath || r20handout.avatarUrl || "";
    if (imgSrc) {
      pages.push({
        _id:  foundry.utils.randomID(),
        name: r20handout.name,
        type: "image",
        sort: 100000,
        src:  imgSrc,
        image: { caption: "" },
        ownership: { default: 2 },
      });
    } else {
      pages.push({
        _id:  foundry.utils.randomID(),
        name: r20handout.name,
        type: "text",
        sort: 100000,
        text: { content: "", format: 1 },
      });
    }
  }

  return {
    _id:    idMapper.getOrCreate(r20handout.id),
    name:   r20handout.name,
    img:    avatarPath || r20handout.avatarUrl || null,
    folder: folderMap.get(r20handout.id) ?? null,
    pages:  pages,
    ownership: buildOwnership(r20handout, playerIdMap),
    flags: { "r20-to-fvtt": { originalId: r20handout.id } },
  };
}
