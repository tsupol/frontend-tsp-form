// Pure detection logic: no DOM, no React, no Tesseract.
// Inputs: a list of OCR-extracted lines (each with words and bboxes).
// Outputs: the selected English landmark-label matches.
//
// Ported from C:\Users\tonsu\WebstormProjects\ocr-js-client-testing\src\lib\anchorDetection.ts.

import { distance as levDistance } from 'fastest-levenshtein';

export type BBox = { x0: number; y0: number; x1: number; y1: number };
export type WordHit = { text: string; bbox: BBox };
export type LineHit = { text: string; bbox: BBox; words: WordHit[] };

export type LabelId =
  | 'TH_HEADER'
  | 'EN_HEADER'
  | 'TH_CID_LABEL'
  | 'EN_CID_LABEL'
  | 'TH_NAME_LABEL'
  | 'EN_NAME_LABEL'
  | 'EN_LASTNAME_LABEL'
  | 'TH_DOB_LABEL'
  | 'EN_DOB_LABEL'
  | 'TH_RELIGION_LABEL'
  | 'TH_ADDRESS_LABEL'
  | 'TH_ISSUE_LABEL'
  | 'EN_ISSUE_LABEL'
  | 'TH_EXPIRY_LABEL'
  | 'EN_EXPIRY_LABEL';

export type LabelSpec = {
  id: LabelId;
  text: string;
  trust: number;
  maxNormalizedDistance: number;
  family?: string;
  tail?: { text: string; maxNormalizedDistance: number };
};

export const LABELS: LabelSpec[] = [
  { id: 'EN_HEADER',         text: 'Thai National ID Card', trust: 1.0, maxNormalizedDistance: 0.45 },
  { id: 'EN_CID_LABEL',      text: 'Identification Number', trust: 1.0, maxNormalizedDistance: 0.45 },
  { id: 'EN_NAME_LABEL',     text: 'Name',                  trust: 0.4, maxNormalizedDistance: 0.25 },
  { id: 'EN_LASTNAME_LABEL', text: 'Last name',             trust: 0.7, maxNormalizedDistance: 0.35 },
  { id: 'EN_DOB_LABEL',      text: 'Date of Birth',         trust: 1.0, maxNormalizedDistance: 0.45,
    family: 'date-of', tail: { text: 'Birth',  maxNormalizedDistance: 0.34 } },
  { id: 'EN_ISSUE_LABEL',    text: 'Date of Issue',         trust: 1.0, maxNormalizedDistance: 0.45,
    family: 'date-of', tail: { text: 'Issue',  maxNormalizedDistance: 0.34 } },
  { id: 'EN_EXPIRY_LABEL',   text: 'Date of Expiry',        trust: 1.0, maxNormalizedDistance: 0.45,
    family: 'date-of', tail: { text: 'Expiry', maxNormalizedDistance: 0.40 } },
];

export type Relation = {
  from: LabelId;
  to: LabelId;
  dx: number;
  dy: number;
  tolX: number;
  tolY: number;
};

export const RELATIONS: Relation[] = [
  { from: 'TH_HEADER',         to: 'EN_HEADER',         dx:  1.0, dy:  0.0, tolX: 0.9, tolY: 1.0 },
  { from: 'EN_HEADER',         to: 'EN_CID_LABEL',      dx: -1.0, dy:  2.5, tolX: 1.5, tolY: 2.0 },
  { from: 'TH_HEADER',         to: 'TH_CID_LABEL',      dx:  0.0, dy:  1.3, tolX: 1.0, tolY: 1.5 },
  { from: 'TH_CID_LABEL',      to: 'EN_CID_LABEL',      dx:  0.0, dy:  1.2, tolX: 0.8, tolY: 1.2 },
  { from: 'EN_CID_LABEL',      to: 'TH_NAME_LABEL',     dx:  0.0, dy:  1.5, tolX: 1.5, tolY: 1.5 },
  { from: 'TH_NAME_LABEL',     to: 'EN_NAME_LABEL',     dx:  1.5, dy:  1.5, tolX: 2.0, tolY: 1.5 },
  { from: 'EN_NAME_LABEL',     to: 'EN_LASTNAME_LABEL', dx:  0.0, dy:  2.5, tolX: 1.5, tolY: 1.5 },
  { from: 'EN_LASTNAME_LABEL', to: 'EN_DOB_LABEL',      dx: -0.5, dy:  2.0, tolX: 2.0, tolY: 2.0 },
  { from: 'EN_DOB_LABEL',      to: 'TH_DOB_LABEL',      dx:  0.0, dy: -1.2, tolX: 1.5, tolY: 1.2 },
  { from: 'EN_DOB_LABEL',      to: 'TH_RELIGION_LABEL', dx:  0.2, dy:  2.0, tolX: 2.0, tolY: 1.5 },
  { from: 'TH_RELIGION_LABEL', to: 'TH_ADDRESS_LABEL',  dx: -3.5, dy:  2.0, tolX: 3.0, tolY: 2.0 },
  { from: 'EN_DOB_LABEL',      to: 'EN_ISSUE_LABEL',    dx: -1.0, dy:  7.0, tolX: 2.0, tolY: 3.0 },
  { from: 'EN_ISSUE_LABEL',    to: 'EN_EXPIRY_LABEL',   dx:  3.0, dy:  0.0, tolX: 2.0, tolY: 1.0 },
  { from: 'EN_ISSUE_LABEL',    to: 'TH_ISSUE_LABEL',    dx:  0.0, dy: -1.2, tolX: 1.0, tolY: 1.2 },
  { from: 'EN_EXPIRY_LABEL',   to: 'TH_EXPIRY_LABEL',   dx:  0.0, dy: -1.2, tolX: 1.0, tolY: 1.2 },
];

export function bboxCenter(b: BBox): { cx: number; cy: number } {
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

export function unionBbox(boxes: BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

export function normalizedEditDistance(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levDistance(a, b) / maxLen;
}

export type LineCandidate = {
  labelId: LabelId;
  lineIndex: number;
  line: LineHit;
  wordIndices: number[];
  matchedText: string;
  matchedBbox: BBox;
  matchScore: number;
  matchQuality: number;
  tailScore?: number;
  tailWordIndex?: number;
};

function findTail(
  line: LineHit,
  tail: NonNullable<LabelSpec['tail']>,
): { wordIndex: number; score: number } | null {
  let bestIdx = -1;
  let bestScore = Infinity;
  for (let wi = 0; wi < line.words.length; wi++) {
    const w = line.words[wi];
    const t = w.text.trim();
    if (!t) continue;
    const s = normalizedEditDistance(t, tail.text);
    if (s < bestScore) {
      bestScore = s;
      bestIdx = wi;
    }
  }
  if (bestIdx < 0 || bestScore > tail.maxNormalizedDistance) return null;
  return { wordIndex: bestIdx, score: bestScore };
}

export function collectLineCandidates(lines: LineHit[]): LineCandidate[] {
  const out: LineCandidate[] = [];
  for (const spec of LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const words = line.words.filter((w) => w.text.trim().length > 0);
      if (words.length === 0) continue;

      let bestSize = -1;
      let bestStart = -1;
      let bestScore = Infinity;
      let bestText = '';

      for (let size = 1; size <= words.length; size++) {
        for (let start = 0; start + size <= words.length; start++) {
          const slice = words.slice(start, start + size);
          const text = slice.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const score = normalizedEditDistance(text, spec.text);
          if (score < bestScore) {
            bestScore = score;
            bestSize = size;
            bestStart = start;
            bestText = text;
          }
        }
      }

      if (bestSize < 0) continue;
      if (bestScore > spec.maxNormalizedDistance) continue;

      let tailHit: ReturnType<typeof findTail> = null;
      let combinedScore = bestScore;
      const bestSlice = words.slice(bestStart, bestStart + bestSize);
      const boxesForMatch: BBox[] = bestSlice.map((w) => w.bbox);
      if (spec.tail) {
        tailHit = findTail(line, spec.tail);
        if (!tailHit) continue;
        boxesForMatch.push(line.words[tailHit.wordIndex].bbox);
        combinedScore = 0.4 * bestScore + 0.6 * tailHit.score;
      }

      const wordIndices: number[] = [];
      let cursor = 0;
      for (let wi = 0; wi < line.words.length; wi++) {
        if (line.words[wi].text.trim().length === 0) continue;
        if (cursor >= bestStart && cursor < bestStart + bestSize) wordIndices.push(wi);
        cursor++;
      }
      if (tailHit && !wordIndices.includes(tailHit.wordIndex)) {
        wordIndices.push(tailHit.wordIndex);
        wordIndices.sort((a, b) => a - b);
      }

      const matchedText = wordIndices.map((wi) => line.words[wi].text).join(' ').replace(/\s+/g, ' ').trim() || bestText;

      out.push({
        labelId: spec.id,
        lineIndex: i,
        line,
        wordIndices,
        matchedText,
        matchedBbox: unionBbox(boxesForMatch),
        matchScore: combinedScore,
        matchQuality: (1 - combinedScore) * spec.trust,
        tailScore: tailHit?.score,
        tailWordIndex: tailHit?.wordIndex,
      });
    }
  }
  return out;
}

function bestPerLine(cands: LineCandidate[]): Map<number, LineCandidate> {
  const m = new Map<number, LineCandidate>();
  for (const c of cands) {
    const cur = m.get(c.lineIndex);
    if (!cur || c.matchScore < cur.matchScore) m.set(c.lineIndex, c);
  }
  return m;
}

export function resolveFamilies(candidates: LineCandidate[]): LineCandidate[] {
  const familyOf = new Map<LabelId, string>();
  for (const spec of LABELS) if (spec.family) familyOf.set(spec.id, spec.family);

  const inFamily: LineCandidate[] = [];
  const passthrough: LineCandidate[] = [];
  for (const c of candidates) {
    if (familyOf.has(c.labelId)) inFamily.push(c);
    else passthrough.push(c);
  }
  if (inFamily.length === 0) return candidates;

  const byFamily = new Map<string, LineCandidate[]>();
  for (const c of inFamily) {
    const fam = familyOf.get(c.labelId)!;
    const arr = byFamily.get(fam) ?? [];
    arr.push(c);
    byFamily.set(fam, arr);
  }

  const keep: LineCandidate[] = [...passthrough];

  for (const [, famCands] of byFamily) {
    const labels = [...new Set(famCands.map((c) => c.labelId))];
    const byLabel = new Map<LabelId, Map<number, LineCandidate>>();
    for (const id of labels) {
      byLabel.set(id, bestPerLine(famCands.filter((c) => c.labelId === id)));
    }

    const lineSet = new Set<number>();
    for (const m of byLabel.values()) for (const li of m.keys()) lineSet.add(li);
    const lines = [...lineSet];

    const UNASSIGNED_PENALTY = 1.0;
    type Assignment = Map<LabelId, LineCandidate | null>;
    let bestCost = Infinity;
    let bestAssign: Assignment | null = null;

    const recurse = (i: number, used: Set<number>, cur: Assignment, costSoFar: number) => {
      if (costSoFar >= bestCost) return;
      if (i === labels.length) {
        if (costSoFar < bestCost) {
          bestCost = costSoFar;
          bestAssign = new Map(cur);
        }
        return;
      }
      const id = labels[i];
      const linesForId = byLabel.get(id)!;
      cur.set(id, null);
      recurse(i + 1, used, cur, costSoFar + UNASSIGNED_PENALTY);
      for (const li of lines) {
        if (used.has(li)) continue;
        const cand = linesForId.get(li);
        if (!cand) continue;
        used.add(li);
        cur.set(id, cand);
        recurse(i + 1, used, cur, costSoFar + cand.matchScore);
        used.delete(li);
      }
      cur.delete(id);
    };

    recurse(0, new Set<number>(), new Map(), 0);

    if (bestAssign) {
      for (const cand of (bestAssign as Assignment).values()) {
        if (cand) keep.push(cand);
      }
    }
  }

  return keep;
}

export type Selected = {
  labelId: LabelId;
  lineIndex: number;
  line: LineHit;
  matchedText: string;
  matchedBbox: BBox;
  wordIndices: number[];
  matchScore: number;
  confidence: number;
};

function relationAgreement(rel: Relation, a: BBox, b: BBox): number {
  const aw = a.x1 - a.x0;
  const ah = a.y1 - a.y0;
  if (aw <= 0 || ah <= 0) return 0;
  const bc = bboxCenter(b);
  const expectedCx = a.x0 + (rel.dx + 0.5) * aw;
  const expectedCy = a.y0 + (rel.dy + 0.5) * ah;
  const dxNorm = Math.abs(bc.cx - expectedCx) / aw;
  const dyNorm = Math.abs(bc.cy - expectedCy) / ah;
  if (dxNorm > rel.tolX || dyNorm > rel.tolY) return 0;
  return Math.max(0, 1 - (dxNorm / rel.tolX) * 0.5 - (dyNorm / rel.tolY) * 0.5);
}

function totalAgreement(assignments: Map<LabelId, BBox>, scale = 0.5): number {
  let sum = 0;
  for (const rel of RELATIONS) {
    const a = assignments.get(rel.from);
    const b = assignments.get(rel.to);
    if (!a || !b) continue;
    sum += relationAgreement(rel, a, b) * scale;
  }
  return sum;
}

function totalMatchQuality(picks: LineCandidate[]): number {
  return picks.reduce((s, p) => s + p.matchQuality, 0);
}

export function jointSelect(candidates: LineCandidate[]): Map<LabelId, Selected> {
  const byLabel = new Map<LabelId, LineCandidate[]>();
  for (const c of candidates) {
    const arr = byLabel.get(c.labelId) ?? [];
    arr.push(c);
    byLabel.set(c.labelId, arr);
  }
  for (const arr of byLabel.values()) arr.sort((a, b) => b.matchQuality - a.matchQuality);

  const picks = new Map<LabelId, LineCandidate>();
  for (const [labelId, arr] of byLabel) picks.set(labelId, arr[0]);

  const scoreSet = (m: Map<LabelId, LineCandidate>) => {
    const bboxMap = new Map<LabelId, BBox>();
    for (const [id, p] of m) bboxMap.set(id, p.matchedBbox);
    return totalMatchQuality([...m.values()]) + totalAgreement(bboxMap);
  };

  let changed = true;
  let bestScore = scoreSet(picks);
  while (changed) {
    changed = false;
    for (const [labelId, arr] of byLabel) {
      const current = picks.get(labelId);
      for (const alt of arr) {
        if (current && alt.lineIndex === current.lineIndex) continue;
        picks.set(labelId, alt);
        const s = scoreSet(picks);
        if (s > bestScore + 1e-9) {
          bestScore = s;
          changed = true;
          continue;
        }
        if (current) picks.set(labelId, current);
        else picks.delete(labelId);
      }
      if (current) {
        picks.delete(labelId);
        const s = scoreSet(picks);
        if (s > bestScore + 1e-9) {
          bestScore = s;
          changed = true;
        } else {
          picks.set(labelId, current);
        }
      }
    }
  }

  const bboxMap = new Map<LabelId, BBox>();
  for (const [id, p] of picks) bboxMap.set(id, p.matchedBbox);

  const result = new Map<LabelId, Selected>();
  for (const [id, p] of picks) {
    let agree = 0;
    let count = 0;
    for (const rel of RELATIONS) {
      if (rel.from !== id && rel.to !== id) continue;
      const a = bboxMap.get(rel.from);
      const b = bboxMap.get(rel.to);
      if (!a || !b) continue;
      agree += relationAgreement(rel, a, b);
      count++;
    }
    const agreementFactor = count === 0 ? 0.5 : Math.min(1, agree / count);
    const confidence = Math.min(1, p.matchQuality * (0.6 + 0.4 * agreementFactor));
    result.set(id, {
      labelId: id,
      lineIndex: p.lineIndex,
      line: p.line,
      matchedText: p.matchedText,
      matchedBbox: p.matchedBbox,
      wordIndices: p.wordIndices,
      matchScore: p.matchScore,
      confidence,
    });
  }
  return result;
}

export type DetectionResult = {
  candidates: LineCandidate[];
  resolvedCandidates: LineCandidate[];
  selected: Selected[];
};

export function detect(lines: LineHit[]): DetectionResult {
  const candidates = collectLineCandidates(lines);
  const resolvedCandidates = resolveFamilies(candidates);
  const selected = [...jointSelect(resolvedCandidates).values()];
  return { candidates, resolvedCandidates, selected };
}
