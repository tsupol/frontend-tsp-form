/** Damerau–Levenshtein-based similarity (0..1). 1 = identical, 0 = no overlap. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const al = a.length, bl = b.length;
  if (al === 0 || bl === 0) return 0;
  const matrix: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) matrix[i][0] = i;
  for (let j = 0; j <= bl; j++) matrix[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }
  const distance = matrix[al][bl];
  return 1 - distance / Math.max(al, bl);
}

/** Best similarity of query against candidate or any whitespace-split token. */
export function fuzzyScore(query: string, candidate: string): number {
  const cands = [candidate, ...candidate.split(/\s+/)].filter(Boolean);
  let best = 0;
  for (const c of cands) {
    const s = similarity(query, c.toLowerCase());
    if (s > best) best = s;
  }
  return best;
}

/** Adaptive similarity threshold: looser as the query grows. */
export function fuzzyThreshold(queryLen: number): number {
  if (queryLen < 2) return 1;
  if (queryLen < 3) return 0.8;
  return 0.6;
}

/**
 * Filter + rank items client-side for a picker. Every typed word must match
 * (token-AND); per word, word-prefix beats substring beats in-order subsequence
 * ("aple" → apple) beats a close typo (edit distance, `fuzzyThreshold`).
 * Lower total first; ties keep the original order. Empty query → items as-is.
 * Same tiers as the FinanceRatesPage brand/family picker, plus the typo tier.
 */
export function fuzzyRank<T>(items: T[], query: string, hay: (item: T) => string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;

  const tokenScore = (h: string, words: string[], tk: string): number | null => {
    if (words.some(w => w.startsWith(tk))) return 0;
    if (h.includes(tk)) return 1;
    let i = 0;
    for (const ch of h) { if (ch === tk[i]) i++; if (i === tk.length) return 2; }
    const sim = fuzzyScore(tk, h);
    if (sim >= fuzzyThreshold(tk.length)) return 3 + (1 - sim);   // closer typo first
    return null;
  };

  return items
    .map((item, index) => {
      const h = hay(item).toLowerCase();
      const words = h.split(/\s+/);
      let score = 0;
      for (const tk of tokens) {
        const s = tokenScore(h, words, tk);
        if (s == null) return null;
        score += s;
      }
      return { item, index, score };
    })
    .filter((e): e is { item: T; index: number; score: number } => e != null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(e => e.item);
}
