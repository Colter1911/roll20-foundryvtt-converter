/**
 * name-matcher.js — Нормализация имён и нечёткий поиск.
 * Используется для матчинга Roll20 item/actor имён с компендиумом.
 */

/**
 * Нормализовать строку для сравнения:
 * lowercase, ё→е, убрать скобки и спецсимволы.
 * @param {string} name
 * @returns {string}
 */
export function normalize(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*\([^)]*\)/g, "")     // убрать (скобки с содержимым)
    .replace(/['"«»,.:;!?\/\\]/g, "") // убрать пунктуацию
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Схожесть строк по алгоритму Левенштейна (0..1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const la = a.length, lb = b.length;
  const maxLen = Math.max(la, lb);
  if (maxLen === 0) return 1;

  // Оптимизированный O(n*m) с одной строкой dp
  const dp = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const curr = Math.min(prev + cost, dp[j] + 1, dp[j - 1] + 1);
      dp[j - 1] = prev;
      prev = curr;
    }
    dp[lb] = prev;
  }
  return 1 - dp[lb] / maxLen;
}

/**
 * Найти лучшее совпадение по имени среди кандидатов.
 * Сначала проверяем точное нормализованное совпадение, затем fuzzy.
 *
 * @param {string}            query      — искомое имя
 * @param {Array<{name:string, [key:string]:any}>} candidates — массив объектов с полем name
 * @param {number}            threshold  — минимальная схожесть (0..1), default 0.8
 * @returns {{ item: object, score: number } | null}
 */
export function findBest(query, candidates, threshold = 0.8) {
  if (!query || !candidates?.length) return null;

  const nq = normalize(query);
  let bestItem = null;
  let bestScore = 0;

  for (const c of candidates) {
    const nc = normalize(c.name ?? "");

    // Точное нормализованное совпадение — сразу возвращаем
    if (nc === nq) return { item: c, score: 1.0 };

    const score = levenshteinSimilarity(nq, nc);
    if (score > bestScore) {
      bestScore = score;
      bestItem  = c;
    }
  }

  return bestScore >= threshold ? { item: bestItem, score: bestScore } : null;
}
