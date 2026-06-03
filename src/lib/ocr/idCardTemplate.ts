// Thai ID card template — landmark positions, OCR-ROI rectangles, and affine fit.
// Ported from C:\Users\tonsu\WebstormProjects\ocr-js-client-testing\src\lib\idCardTemplate.ts.

import type { LabelId, Selected, BBox } from './anchorDetection';

export type Point = { u: number; v: number };

export type LandmarkSpec = {
  id: LabelId;
  center: Point;
  size: { w: number; h: number };
  n: number;
};

// Hand-traced on 166880.h1200.webp via /ocr-test/template-build.
// Origin = top-left of EN_HEADER box; unit length = EN_HEADER box width.
// v is positive downward (photo y convention).
export const TEMPLATE_LANDMARKS: LandmarkSpec[] = [
  { id: 'EN_HEADER',         center: { u:  0.500, v: 0.055 }, size: { w: 1.000, h: 0.110 }, n: 1 },
  { id: 'EN_CID_LABEL',      center: { u: -0.609, v: 0.207 }, size: { w: 0.642, h: 0.075 }, n: 1 },
  { id: 'EN_NAME_LABEL',     center: { u: -0.498, v: 0.448 }, size: { w: 0.188, h: 0.069 }, n: 1 },
  { id: 'EN_LASTNAME_LABEL', center: { u: -0.431, v: 0.551 }, size: { w: 0.313, h: 0.079 }, n: 1 },
  { id: 'EN_DOB_LABEL',      center: { u: -0.326, v: 0.769 }, size: { w: 0.379, h: 0.071 }, n: 1 },
  { id: 'EN_ISSUE_LABEL',    center: { u: -0.891, v: 1.352 }, size: { w: 0.348, h: 0.062 }, n: 1 },
  { id: 'EN_EXPIRY_LABEL',   center: { u:  0.197, v: 1.345 }, size: { w: 0.383, h: 0.066 }, n: 1 },
];

export type OcrRoiId =
  | 'CID_NUMBER'
  | 'FULLNAME_TH'
  | 'DOB_EN'
  | 'ISSUE_EN'
  | 'EXPIRY_EN';

export type OcrRoiSpec = {
  id: OcrRoiId;
  label: string;
  rect: { u0: number; v0: number; u1: number; v1: number };
  anchoredOn: LabelId;
  padU?: number;
  padV?: number;
};

export const TEMPLATE_OCR_ROIS: OcrRoiSpec[] = [
  { id: 'CID_NUMBER', label: 'CID number',
    rect: { u0: -0.321, v0: 0.086, u1:  0.605, v1: 0.233 },
    anchoredOn: 'EN_CID_LABEL' },
  { id: 'FULLNAME_TH', label: 'Full name (TH)',
    rect: { u0: -0.653, v0: 0.212, u1:  0.834, v1: 0.410 },
    anchoredOn: 'EN_NAME_LABEL' },
  { id: 'DOB_EN', label: 'DOB (EN)',
    rect: { u0: -0.134, v0: 0.682, u1:  0.466, v1: 0.832 },
    anchoredOn: 'EN_DOB_LABEL' },
  { id: 'ISSUE_EN', label: 'Issue (EN)',
    rect: { u0: -1.096, v0: 1.229, u1: -0.685, v1: 1.342 },
    anchoredOn: 'EN_ISSUE_LABEL' },
  { id: 'EXPIRY_EN', label: 'Expiry (EN)',
    rect: { u0: -0.029, v0: 1.228, u1:  0.418, v1: 1.336 },
    anchoredOn: 'EN_EXPIRY_LABEL' },
];

// Affine transform: 6 DOF (translation + 2x2 matrix). Closed-form LS per-axis.
export type FitParams = {
  a: number; b: number; c: number; d: number; tx: number; ty: number;
  rms: number;
  n: number;
};

export function templateToPhoto(p: Point, fit: FitParams): { x: number; y: number } {
  return {
    x: fit.a * p.u + fit.b * p.v + fit.tx,
    y: fit.c * p.u + fit.d * p.v + fit.ty,
  };
}

export function fitSimilarity(
  pairs: { template: Point; photo: { x: number; y: number } }[],
): FitParams | null {
  const n = pairs.length;
  if (n < 3) return null;

  let cu = 0, cv = 0, cx = 0, cy = 0;
  for (const p of pairs) { cu += p.template.u; cv += p.template.v; cx += p.photo.x; cy += p.photo.y; }
  cu /= n; cv /= n; cx /= n; cy /= n;

  let Suu = 0, Svv = 0, Suv = 0;
  let Sux = 0, Svx = 0;
  let Suy = 0, Svy = 0;
  for (const p of pairs) {
    const u = p.template.u - cu;
    const v = p.template.v - cv;
    const x = p.photo.x - cx;
    const y = p.photo.y - cy;
    Suu += u * u;
    Svv += v * v;
    Suv += u * v;
    Sux += u * x;
    Svx += v * x;
    Suy += u * y;
    Svy += v * y;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-12) return null;

  const a = ( Svv * Sux - Suv * Svx) / det;
  const b = (-Suv * Sux + Suu * Svx) / det;
  const c = ( Svv * Suy - Suv * Svy) / det;
  const d = (-Suv * Suy + Suu * Svy) / det;

  const tx = cx - (a * cu + b * cv);
  const ty = cy - (c * cu + d * cv);

  let sse = 0;
  for (const p of pairs) {
    const px = a * p.template.u + b * p.template.v + tx;
    const py = c * p.template.u + d * p.template.v + ty;
    const ex = px - p.photo.x;
    const ey = py - p.photo.y;
    sse += ex * ex + ey * ey;
  }
  const rms = Math.sqrt(sse / n);

  return { a, b, c, d, tx, ty, rms, n };
}

export type LandmarkFit = {
  fit: FitParams;
  residuals: { id: LabelId; residual: number }[];
};

function landmarkCorrespondences(
  spec: LandmarkSpec,
  sel: Selected,
): { template: Point; photo: { x: number; y: number }; id: LabelId; side: 'L' | 'R' }[] {
  const tCx = spec.center.u;
  const tCy = spec.center.v;
  const tHalfInset = spec.size.w / 6;
  const tLeft  = { u: tCx - tHalfInset, v: tCy };
  const tRight = { u: tCx + tHalfInset, v: tCy };

  const b = sel.matchedBbox;
  const pCy = (b.y0 + b.y1) / 2;
  const pW = b.x1 - b.x0;
  const pCx = (b.x0 + b.x1) / 2;
  const pHalfInset = pW / 6;
  const pLeft  = { x: pCx - pHalfInset, y: pCy };
  const pRight = { x: pCx + pHalfInset, y: pCy };

  return [
    { template: tLeft,  photo: pLeft,  id: sel.labelId, side: 'L' },
    { template: tRight, photo: pRight, id: sel.labelId, side: 'R' },
  ];
}

export function fitTemplateFromDetections(detected: Selected[]): LandmarkFit | null {
  const wanted = new Map(TEMPLATE_LANDMARKS.map((l) => [l.id, l]));
  const pairs: { template: Point; photo: { x: number; y: number }; id: LabelId; side: 'L' | 'R' }[] = [];
  for (const sel of detected) {
    const spec = wanted.get(sel.labelId);
    if (!spec) continue;
    pairs.push(...landmarkCorrespondences(spec, sel));
  }
  const distinctLandmarks = new Set(pairs.map((p) => p.id)).size;
  if (distinctLandmarks < 3) return null;
  const uMin = Math.min(...pairs.map((p) => p.template.u));
  const uMax = Math.max(...pairs.map((p) => p.template.u));
  const vMin = Math.min(...pairs.map((p) => p.template.v));
  const vMax = Math.max(...pairs.map((p) => p.template.v));
  if (uMax - uMin < 0.2 || vMax - vMin < 0.15) return null;

  const fit = fitSimilarity(pairs);
  if (!fit) return null;
  const perLandmark = new Map<LabelId, number[]>();
  for (const p of pairs) {
    const proj = templateToPhoto(p.template, fit);
    const r = Math.hypot(proj.x - p.photo.x, proj.y - p.photo.y);
    const arr = perLandmark.get(p.id) ?? [];
    arr.push(r);
    perLandmark.set(p.id, arr);
  }
  const residuals = [...perLandmark.entries()].map(([id, rs]) => ({
    id,
    residual: rs.reduce((s, r) => s + r, 0) / rs.length,
  }));
  return { fit, residuals };
}

export type ProjectedRoi = {
  id: OcrRoiId;
  label: string;
  bbox: BBox;
  quad: { x: number; y: number }[];
};
