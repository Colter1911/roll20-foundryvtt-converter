/**
 * systems/dnd5e/index.js — Точка входа dnd5e адаптера.
 * Shaped Sheet парсер — заглушка с fallback на OGL5e.
 */

import { BaseSystemAdapter } from "../base-system.js";
import { SheetDetector }     from "./sheet-detector.js";
import { OGL5eAdapter }      from "./ogl5e-parser.js";

export { OGL5eAdapter };

/**
 * Shaped Sheet адаптер.
 * Пока использует OGL5e как основу — Shaped атрибуты во многом совместимы.
 * В будущем можно переопределить buildPCSystem/buildNPCSystem.
 */
export class ShapedAdapter extends OGL5eAdapter {
  get priority() { return 5; }

  canHandle(r20char) {
    return SheetDetector.detect(r20char) === "shaped";
  }
}

/**
 * Получить все зарегистрированные dnd5e-адаптеры.
 * @returns {BaseSystemAdapter[]} отсортированные по priority desc
 */
export function getDnd5eAdapters() {
  return [
    new OGL5eAdapter(),
    new ShapedAdapter(),
  ].sort((a, b) => b.priority - a.priority);
}
