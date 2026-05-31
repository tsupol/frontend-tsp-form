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
