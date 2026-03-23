/**
 * base-system.js — Абстрактный базовый класс системного адаптера.
 * Каждый адаптер знает КАК превратить R20Character в данные конкретной Foundry-системы.
 */

export class BaseSystemAdapter {
  /**
   * Возвращает true, если этот адаптер умеет обработать данный персонаж.
   * @param {import("../../core/r20-document.js").R20Character} r20char
   * @returns {boolean}
   */
  canHandle(r20char) {
    return false;
  }

  /**
   * Конвертирует R20Character → объект для Actor.create()
   * @param {import("../../core/r20-document.js").R20Character} r20char
   * @param {import("../../core/id-mapper.js").IdMapper}        idMapper
   * @param {import("../../asset-manager.js").AssetManager}     assets
   * @param {JSZip}   zip
   * @param {Object}  playerIdMap
   * @param {Map}     folderMap
   * @param {string}  [avatarZipPath] — путь к аватару внутри ZIP (найден importer'ом)
   * @param {string}  [tokenZipPath]  — путь к токену внутри ZIP (найден importer'ом)
   * @returns {Promise<Object>} Foundry Actor data
   */
  async toActorData(r20char, idMapper, assets, zip, playerIdMap, folderMap, avatarZipPath = "", tokenZipPath = "") {
    throw new Error(`${this.constructor.name}.toActorData() must be implemented`);
  }

  /**
   * Приоритет адаптера (больше = проверяется первым).
   * @returns {number}
   */
  get priority() { return 0; }
}
