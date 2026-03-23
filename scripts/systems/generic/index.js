/**
 * systems/generic/index.js — Fallback адаптер для неизвестных систем.
 * Создаёт актора с именем, типом и картинкой — без системных данных.
 */

import { BaseSystemAdapter } from "../base-system.js";
import { buildOwnership }    from "../../core/utils.js";

export class GenericAdapter extends BaseSystemAdapter {
  get priority() { return -1; }

  canHandle(_r20char) {
    return true; // всегда true — это последний fallback
  }

  async toActorData(r20char, idMapper, assets, zip, playerIdMap, folderMap) {
    const avatarZipPath = `characters/${String(r20char._zipIndex).padStart(3, "0")} - ${r20char.name}/avatar.png`;
    const avatarPath = await assets.upload(zip, avatarZipPath, "avatar.png", "actors").catch(() => "");

    return {
      _id:    idMapper.getOrCreate(r20char.id),
      name:   r20char.name,
      type:   r20char.flag("npc") ? "npc" : "character",
      img:    avatarPath || null,
      folder: folderMap?.get(r20char.id) ?? null,
      ownership: buildOwnership(r20char, playerIdMap),
      flags: {
        "r20-to-fvtt": {
          originalId: r20char.id,
          sheet:      r20char.sheetName,
          note:       "Generic fallback import — no system data",
        }
      },
    };
  }
}
