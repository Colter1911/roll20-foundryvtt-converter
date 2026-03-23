/**
 * folder-builder.js — Рекурсивное построение дерева папок из R20 journalfolder/jukeboxfolder.
 */

import { IdMapper } from "./id-mapper.js";

/**
 * Рекурсивно создать Folder документы из Roll20 journalfolder/jukeboxfolder структуры.
 *
 * R20 format:
 *   [ "handout-id", { "n": "Folder Name", "id": "...", "i": [...] }, ... ]
 *
 * @param {Array}    folderData     — массив из campaign.journalfolder или jukeboxfolder
 * @param {string}   type           — "JournalEntry" | "Actor" | "Playlist" | "RollTable"
 * @param {IdMapper} idMapper
 * @returns {Promise<Map<string, string|null>>} — карта r20_entity_id → foundry_folder_id | null
 */
export async function buildFolderTree(folderData, type, idMapper) {
  /** @type {Map<string, string|null>} */
  const entityFolderMap = new Map();

  if (!Array.isArray(folderData) || folderData.length === 0) {
    return entityFolderMap;
  }

  /**
   * Рекурсивная обработка одного уровня.
   * @param {Array}       items
   * @param {string|null} parentFolderId
   */
  async function processLevel(items, parentFolderId) {
    for (const item of items) {
      if (!item) continue;

      // Строка — это ID сущности (handout, character и т.д.)
      if (typeof item === "string") {
        entityFolderMap.set(item, parentFolderId);
        continue;
      }

      // Объект с полем "n" — это папка
      if (typeof item === "object" && item.n) {
        const folderId = idMapper.getOrCreate("folder_" + (item.id || item.n));
        try {
          await Folder.create({
            _id:    folderId,
            name:   item.n,
            type:   type,
            folder: parentFolderId ?? null,
            sorting: "m",
          }, { keepId: true });
        } catch (e) {
          // Папка уже существует — не критично, продолжаем
          if (!e.message?.includes("already exists")) {
            console.warn(`R20Import | Failed to create folder "${item.n}":`, e.message);
          }
        }

        // Рекурсия по дочерним элементам
        if (Array.isArray(item.i)) {
          await processLevel(item.i, folderId);
        }
      }
    }
  }

  await processLevel(folderData, null);
  return entityFolderMap;
}
