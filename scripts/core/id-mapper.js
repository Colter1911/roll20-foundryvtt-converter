/**
 * id-mapper.js — детерминированное преобразование Roll20 ID → Foundry ID.
 * Один R20 ID всегда даёт один и тот же Foundry ID (хеш-функция, без случайности).
 */

export class IdMapper {
  #r20ToFvtt = new Map();
  #fvttToR20 = new Map();

  /**
   * Получить или создать Foundry ID для данного Roll20 ID.
   * Детерминированно: одинаковый r20id → одинаковый fvttId.
   * @param {string|number} r20id
   * @returns {string} 16-символьный Foundry ID
   */
  getOrCreate(r20id) {
    const key = String(r20id ?? "");
    if (this.#r20ToFvtt.has(key)) return this.#r20ToFvtt.get(key);
    const fvttId = this.#hashToFoundryId(key);
    this.#r20ToFvtt.set(key, fvttId);
    this.#fvttToR20.set(fvttId, key);
    return fvttId;
  }

  /**
   * Получить уже созданный Foundry ID или null.
   * @param {string|number} r20id
   * @returns {string|null}
   */
  get(r20id) {
    return this.#r20ToFvtt.get(String(r20id ?? "")) ?? null;
  }

  /**
   * Получить Roll20 ID по Foundry ID.
   * @param {string} fvttId
   * @returns {string|null}
   */
  getR20(fvttId) {
    return this.#fvttToR20.get(fvttId) ?? null;
  }

  /**
   * Стабильный 16-символьный хеш строки.
   * Использует двойной MurmurHash3-like алгоритм.
   * Символы из алфавита Foundry VTT: [a-zA-Z0-9] (62 символа).
   */
  #hashToFoundryId(str) {
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);

    let id  = "";
    let tmp = n;
    for (let i = 0; i < 16; i++) {
      id  += CHARS[tmp % CHARS.length];
      tmp  = Math.floor(tmp / CHARS.length);
      if (tmp === 0) {
        // Обязательно >>> 0, чтобы побитовый XOR не давал отрицательные числа,
        // иначе tmp % 62 будет отрицательным и CHARS[tmp] даст undefined.
        tmp = (n ^ Math.imul(i, 0x9e3779b9)) >>> 0;
        // На случай если tmp всё равно будет 0 (крайне маловероятно), задаём 1
        if (tmp === 0) tmp = 1;
      }
    }
    return id;
  }
}
