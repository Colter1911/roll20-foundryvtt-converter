/**
 * sheet-detector.js — определение типа листа персонажа Roll20.
 */

export class SheetDetector {
  /**
   * Определяет тип листа по полям персонажа.
   * @param {import("../../core/r20-document.js").R20Character} r20char
   * @returns {"ogl5e" | "shaped" | "unknown"}
   */
  static detect(r20char) {
    const sheet = String(r20char.sheetName ?? "").toLowerCase();

    // Явные совпадения по имени листа
    if (sheet === "ogl5e" || sheet === "5th edition ogl by roll20" || sheet === "5e_shaped")
      return sheet === "5e_shaped" ? "shaped" : "ogl5e";

    if (sheet.includes("shaped") || sheet.includes("5e_shaped"))
      return "shaped";

    // Определение по наличию ключевых атрибутов
    if (r20char.attrs["shaped_d20"]?.current !== undefined)
      return "shaped";

    // OGL 5e: есть атрибут strength
    if (r20char.attrs["strength"]?.current !== undefined)
      return "ogl5e";

    return "unknown";
  }
}
