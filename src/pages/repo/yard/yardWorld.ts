// ลานงานยึด — the yard's floor, drawn in the dunning queue's world (QueueWorld: the
// simulation's camera, light, lot and people) so the repo team's picture reads as one set
// with the collectors' queue.
//
// World frame: metres, y up. The repo office counter runs along +x at z = 0 and the yard
// comes toward the camera (+z):
//   x (left → right) = lanes from fn_repo_yard_live `lanes[]` by `seq`: easy to find → hard;
//   z (near → far)   = bands from `bands[]` by `seq`: new · free · picked · worked.
// A lane is as wide as its biggest band needs; a band as deep as its fullest lane. Within a
// lane + band, jobs stand in `pos` order (the RPC's), front row first. Nothing here buckets.

import { Mesh, MeshLambertMaterial } from 'three';
import { QueueWorld, UNIT_BOX, UNIT_CYL } from '../../call-center/queue/queueWorld';
import type { YardBand, YardJob, YardLane } from './yardApi';

export const LANE_TONE: Record<YardLane, string> = {
  FIX_RECENT: '#15803d',
  FIX_OLD: '#4d7c0f',
  MDM_ALIVE: '#0369a1',
  MDM_SILENT: '#c2410c',
  NO_MDM: '#475569',
};
export const BAND_FLOOR: Record<YardBand, string> = {
  NEW: '#e9e0f7',
  FREE: '#f4dcdc',
  PICKED: '#dce6f2',
  WORKED: '#dfeadf',
};
export const BAND_TONE: Record<YardBand, string> = { NEW: '#7c3aed', FREE: '#b91c1c', PICKED: '#1d4ed8', WORKED: '#15803d' };

const COL_W = 2.1; // the shop name + tag over neighbouring heads don't overlap
const STEP = 1.6; // two lines over each head (shop, days) need the room
const Y0 = 1.3; // first row in front of the counter
const MAX_COLS = 8;
const LANE_MIN = 4.4; // lane signs (three lines, longer names) never overlap at the starting zoom
const LANE_GAP = 1.0;
export const SIGN_Y = 2.75;
/** Where the band slabs start and end along x — the labels and the band hover use the same edges. */
export const BAND_X0 = 0.1;
export const bandX1 = (L: { w: number }) => L.w + 0.2;

export interface YardSpot { j: YardJob; x: number; z: number }
export interface YardLaid {
  spots: YardSpot[];
  lanes: { code: YardLane; x: number; w: number }[];
  bands: { code: YardBand; z0: number; z1: number }[];
  w: number; depth: number;
}

export function layoutYard(jobs: YardJob[], laneOrder: YardLane[], bandOrder: YardBand[]): YardLaid {
  const at = (l: YardLane, b: YardBand) => jobs.filter(j => j.lane === l && j.band === b).sort((p, q) => p.pos - q.pos);
  // Columns per lane from its fullest band; rows per band from its fullest lane.
  const cols = laneOrder.map(l => {
    const most = Math.max(0, ...bandOrder.map(b => at(l, b).length));
    return Math.max(1, Math.min(MAX_COLS, Math.ceil(Math.sqrt(most * 1.6))));
  });
  const rows = bandOrder.map(b => Math.max(1, ...laneOrder.map((l, li) => Math.ceil(at(l, b).length / cols[li]))));

  const lanes: YardLaid['lanes'] = [];
  let x = 0.9;
  laneOrder.forEach((l, li) => {
    const w = (cols[li] - 1) * COL_W;
    lanes.push({ code: l, x, w });
    x += Math.max(w + LANE_GAP + 0.6, LANE_MIN);
  });
  const bands: YardLaid['bands'] = [];
  let z = Y0;
  bandOrder.forEach((b, bi) => {
    bands.push({ code: b, z0: z - STEP / 2, z1: z + (rows[bi] - 1) * STEP + STEP / 2 });
    z += rows[bi] * STEP + 0.4;
  });

  const spots: YardSpot[] = [];
  laneOrder.forEach((l, li) => bandOrder.forEach((b, bi) => {
    at(l, b).forEach((j, i) => spots.push({
      j,
      x: lanes[li].x + (i % cols[li]) * COL_W,
      z: bands[bi].z0 + STEP / 2 + Math.floor(i / cols[li]) * STEP,
    }));
  }));
  const w = x - LANE_GAP;
  return { spots, lanes, bands, w, depth: bands[bands.length - 1]?.z1 ?? Y0 };
}

/** QueueWorld's people and camera on the yard floor. */
export class YardWorld extends QueueWorld {
  setYardLayout(L: YardLaid) {
    this.staticRoot.clear();
    this.staticMats.forEach(m => m.dispose());
    this.staticMats = [];
    const mat = (c: string) => { const m = new MeshLambertMaterial({ color: c }); this.staticMats.push(m); return m; };
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, shadow = true) => {
      const m = new Mesh(UNIT_BOX, mat(c));
      m.scale.set(w, h, d);
      m.position.set(x + w / 2, y + h / 2, z + d / 2);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.staticRoot.add(m);
    };
    const post = (x: number, z: number, h: number) => {
      const m = new Mesh(UNIT_CYL, mat('#7d8b94'));
      m.scale.set(0.025, h, 0.025);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      this.staticRoot.add(m);
    };
    // Dashes lie on top of the band slabs (0.012 high), never in their plane (threejs-guide).
    const dashes = (ax: number, az: number, bx: number, bz: number, c: string, wide = 0.06) => {
      const dm = mat(c);
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(len / 0.5));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const d = new Mesh(UNIT_BOX, dm);
        d.scale.set(wide, 0.01, 0.26);
        d.position.set(ax + (bx - ax) * t, 0.019, az + (bz - az) * t);
        d.rotation.y = Math.atan2(bx - ax, bz - az);
        this.staticRoot.add(d);
      }
    };

    const x0 = BAND_X0;
    const x1 = bandX1(L);
    // The lot, as in the queue.
    box(-2.4, -0.12, -3, L.w + 6.4, 0.12, L.depth + 5, '#cfcbc1', false);
    // One slab per band, edge to edge, side by side in depth (never stacked).
    L.bands.forEach(b => box(x0, 0, b.z0, x1 - x0, 0.012, b.z1 - b.z0, BAND_FLOOR[b.code], false));
    // White dashed line between lanes, over the bands.
    for (let i = 1; i < L.lanes.length; i++) {
      const prev = L.lanes[i - 1];
      const xb = (prev.x + prev.w + L.lanes[i].x) / 2;
      dashes(xb, L.bands[0]?.z0 ?? 0.6, xb, L.depth, '#ffffff', 0.09);
    }
    // The repo office counter across the front; a sign post for each lane behind it.
    box(-0.3, 0, -0.55, L.w + 0.6, 0.78, 0.55, '#ecdcb6');
    box(-0.36, 0.78, -0.6, L.w + 0.72, 0.05, 0.65, '#d8c69c');
    L.lanes.forEach(l => post(l.x + l.w / 2, -0.25, SIGN_Y));
    this.renderer.shadowMap.needsUpdate = true;
    this.start();
  }
}
