// เฝ้าเครื่อง — the device-watch scene's floor (UI_SUMMARY 165 · IMPLEMENT 2026-11-13
// device_watch_scene). Drawn in the same world as the dunning queue (QueueWorld: the
// simulation's camera, light, lot and people) so the two pictures read as one set.
//
// World frame: metres, y up. The shop counter runs along +x at z = 0 and everything comes
// toward the camera (+z):
//   left  = the plaza in front of the shop — devices stuck in Lost Mode, two groups
//           (system-locked · staff-locked), longest-locked first (the RPC's order);
//   right = the road leaving the shop — silent devices, one lane per `group_code`, floor bands
//           per `level_hours` from the RPC's `thresholds.levels_hours`. Within a band the least
//           silent stands nearest the shop, so the number over the heads grows with distance.
// Which band, lane and whether it is work all come from fn_silent_task_list; nothing here
// buckets by hours itself.

import { Mesh, MeshLambertMaterial } from 'three';
import { QueueWorld, UNIT_BOX, UNIT_CYL } from '../../call-center/queue/queueWorld';
import type { SilentGroup, SilentTaskRow } from '../silentWatch/silentWatchApi';
import type { LostModeStuckRow } from '../lostModeStuckApi';

/** Silent ids are offset so they never meet an asset id (the stuck people) in one picture. */
export const SILENT_ID = 1_000_000_000;
export const silentFigureId = (episodeId: number) => SILENT_ID + episodeId;

export const GROUPS: { code: SilentGroup; tone: string; cols: number }[] = [
  { code: 'PRE_FIRST_DUE', tone: '#7c3aed', cols: 4 },
  { code: 'PAYING', tone: '#0f766e', cols: 4 },
  // Overdue rows are the collectors' work, not this page's, and there are many: wider, so the road stays short.
  { code: 'OVERDUE', tone: '#b45309', cols: 8 },
];
export const STUCK_GROUPS: { key: 'SYSTEM' | 'STAFF'; tone: string; floor: string }[] = [
  { key: 'SYSTEM', tone: '#dc2626', floor: '#f7cfcf' },
  { key: 'STAFF', tone: '#9f1239', floor: '#f1dbe1' },
];
export const isStaffLock = (r: LostModeStuckRow) => r.reason_code === 'STAFF';
/** Band floors, lighter near the shop, darker the longer the silence. */
const BAND_FLOORS = ['#e6e9ec', '#dadfe4', '#cdd4db', '#c0c9d1', '#b3bdc7', '#a6b2bd'];
export const TASK_RING = '#ea580c';
export const STUCK_RING = '#dc2626';

const COL_W = 1.5; // wide enough that the tags over neighbouring heads don't overlap
const STEP = 1.15;
const Y0 = 1.25; // first person in front of the counter
const STUCK_PER = 6;
const GROUP_GAP = 1.4;
const ROAD_GAP = 2.6; // plaza → road
const LANE_GAP = 1.0;
export const SIGN_Y = 2.75;
const LOT_COLOR = '#cfcbc1';

export interface SilentSpot { p: SilentTaskRow; x: number; z: number }
export interface StuckSpot { p: LostModeStuckRow; x: number; z: number }
export interface Band { z0: number; z1: number; hours: number; last: boolean }
export interface WatchLaid {
  silent: SilentSpot[];
  stuck: StuckSpot[];
  bands: Band[];
  /** Left x of each stuck group's first column, and the group's width. */
  stuckX: number[]; stuckW: number[];
  plazaW: number; plazaDepth: number;
  /** null = no road (the viewer may not see silent devices). */
  road: { x0: number; x1: number; laneX: number[]; laneW: number[] } | null;
  w: number; depth: number;
}

export function layoutWatch(silent: SilentTaskRow[], stuck: LostModeStuckRow[], levels: number[] | null): WatchLaid {
  // ── Plaza ──
  const stuckSpots: StuckSpot[] = [];
  const stuckX: number[] = [];
  const stuckW: number[] = [];
  let cursor = 0.9;
  let plazaDepth = Y0 + STEP;
  for (const G of STUCK_GROUPS) {
    const ps = stuck.filter(r => isStaffLock(r) === (G.key === 'STAFF')); // RPC order: longest first
    const cols = Math.max(1, Math.ceil(ps.length / STUCK_PER));
    stuckX.push(cursor);
    ps.forEach((p, i) => {
      const z = Y0 + (i % STUCK_PER) * STEP;
      stuckSpots.push({ p, x: cursor + Math.floor(i / STUCK_PER) * COL_W, z });
      plazaDepth = Math.max(plazaDepth, z + 0.9);
    });
    const w = Math.max((cols - 1) * COL_W, 0);
    stuckW.push(w);
    cursor += w + GROUP_GAP + 1.2;
  }
  const plazaW = cursor - GROUP_GAP - 0.6;

  // ── Road ──
  const silentSpots: SilentSpot[] = [];
  const bands: Band[] = [];
  let road: WatchLaid['road'] = null;
  let depth = plazaDepth;
  if (levels) {
    const x0 = plazaW + ROAD_GAP;
    const laneX: number[] = [];
    const laneW: number[] = [];
    let lx = x0 + 0.7;
    for (const G of GROUPS) {
      laneX.push(lx);
      const w = (G.cols - 1) * COL_W;
      laneW.push(w);
      lx += w + 1.4 + LANE_GAP;
    }
    const x1 = lx - LANE_GAP - 0.7;
    let z = Y0;
    levels.forEach((h, li) => {
      let rows = 1;
      GROUPS.forEach((G, gi) => {
        const ps = silent
          .filter(s => s.group_code === G.code && s.level_hours === h)
          .sort((a, b) => a.silent_hours - b.silent_hours || a.episode_id - b.episode_id);
        rows = Math.max(rows, Math.ceil(ps.length / G.cols));
        ps.forEach((p, i) => silentSpots.push({ p, x: laneX[gi] + (i % G.cols) * COL_W, z: z + Math.floor(i / G.cols) * STEP }));
      });
      const z0 = z - STEP / 2;
      const z1 = z + (rows - 1) * STEP + STEP / 2;
      bands.push({ z0, z1, hours: h, last: li === levels.length - 1 });
      z = z1 + STEP / 2;
    });
    depth = Math.max(depth, bands[bands.length - 1]?.z1 ?? depth);
    road = { x0, x1, laneX, laneW };
  }
  return { silent: silentSpots, stuck: stuckSpots, bands, stuckX, stuckW, plazaW, plazaDepth, road, w: road ? road.x1 : plazaW, depth };
}

/** QueueWorld's people and camera on the watch floor. */
export class WatchWorld extends QueueWorld {
  setWatchLayout(L: WatchLaid) {
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
    const dashes = (ax: number, az: number, bx: number, bz: number, c: string, wide = 0.05) => {
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

    // The lot, as in the queue.
    box(-2.2, -0.12, -3, L.w + 6, 0.12, L.depth + 5, LOT_COLOR, false);
    // Plaza: one tint per stuck group, side by side (never stacked on each other).
    STUCK_GROUPS.forEach((G, i) => {
      const x = L.stuckX[i];
      box(x - 0.6, 0, 0.35, L.stuckW[i] + 1.2, 0.012, L.plazaDepth - 0.35, G.floor, false);
    });
    // Road: one slab per band, edge to edge, darker with distance.
    if (L.road) {
      const r = L.road;
      L.bands.forEach((b, i) => {
        box(r.x0, 0, b.z0, r.x1 - r.x0, 0.012, b.z1 - b.z0, BAND_FLOORS[Math.min(i, BAND_FLOORS.length - 1)], false);
        if (i > 0) dashes(r.x0 - 1.2, b.z0, r.x1 + 0.3, b.z0, '#7d8b94');
      });
      const zEnd = L.bands[L.bands.length - 1]?.z1 ?? Y0;
      for (let gi = 1; gi < r.laneX.length; gi++) {
        const xb = r.laneX[gi] - 0.7 - LANE_GAP / 2;
        dashes(xb, 0.4, xb, zEnd, '#ffffff', 0.09);
      }
    }
    // The shop counter across the whole front; the clerks sit behind the plaza part.
    box(-0.3, 0, -0.55, L.w + 0.6, 0.78, 0.55, '#ecdcb6');
    box(-0.36, 0.78, -0.6, L.w + 0.72, 0.05, 0.65, '#d8c69c');
    // Sign posts: one per stuck group, one per lane.
    STUCK_GROUPS.forEach((_, i) => post(L.stuckX[i] + L.stuckW[i] / 2, -0.25, SIGN_Y));
    L.road?.laneX.forEach((x, gi) => post(x + L.road!.laneW[gi] / 2, -0.25, SIGN_Y));
    this.renderer.shadowMap.needsUpdate = true;
    this.start();
  }
}
