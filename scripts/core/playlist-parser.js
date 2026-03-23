/**
 * playlist-parser.js — R20 Jukebox → Playlist конвертация.
 */

import { buildOwnership } from "./utils.js";

/**
 * Создать данные для одного Playlist из массива jukebox-треков.
 * Обычно Roll20 jukebox = один мастер-плейлист.
 *
 * @param {Array}    jukeboxTracks  — campaign.jukebox
 * @param {import("./id-mapper.js").IdMapper} idMapper
 * @returns {Object} данные для Playlist.create()
 */
export function jukeboxToPlaylist(jukeboxTracks, idMapper) {
  if (!Array.isArray(jukeboxTracks) || jukeboxTracks.length === 0) return null;

  const sounds = jukeboxTracks.map(track => ({
    _id:    idMapper.getOrCreate(track.id || track._id),
    name:   track.title || "Track",
    path:   track.source || "",
    volume: parseFloat(track.volume) || 0.5,
    repeat: track.loop === true || track.loop === "true",
    flags: { "r20-to-fvtt": { originalId: track.id } },
  }));

  return {
    _id:    idMapper.getOrCreate("jukebox_playlist"),
    name:   "Roll20 Jukebox",
    mode:   0,    // 0 = sequential
    sounds: sounds,
    flags: { "r20-to-fvtt": { source: "jukebox" } },
  };
}
