import {
  BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, PCFShadowMap,
  Quaternion, Raycaster, RingGeometry, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
  type BufferGeometry, type Material,
} from 'three';
import { LANES, type QueueLane, type QueuePerson } from './queueApi';
import { SHOUT_MS, WALK_MS as WALK_OUT_MS } from './queueGeom';

// The dunning queue drawn in the simulation's world (owner 11-12: "make it fit the
// simulation set"): the same orthographic camera angle, sky light + sun, shadows, lot floor
// and palette as src/pages/simulation/simulationWorld.ts. The people are new: a full figure
// with knees (Ton picked design 3, no skirt) — idle they shift their weight from leg to leg,
// and when the backend moves them they walk to the new place.
//
// World frame: metres, y up. The counter runs along +x at z = 0, the lines come toward the
// camera (+z). One InstancedMesh per body part, so ~250 people are ~25 draw calls; every
// part's matrix is rebuilt per frame from a few joint angles.
// Lane, place in line and every number come from fn_dunning_queue_live; this file only draws.

// ── Camera (same as the simulation) ─────────────────────────────────────────
export const PX = 30; // screen pixels per metre at zoom 1
const AZ = Math.PI / 4;
const EL = (36 * Math.PI) / 180;
const DIR = new Vector3(Math.cos(EL) * Math.sin(AZ), Math.sin(EL), Math.cos(EL) * Math.cos(AZ));
const RIGHT = new Vector3(Math.cos(AZ), 0, -Math.sin(AZ));
const UP = new Vector3(-Math.sin(EL) * Math.sin(AZ), Math.cos(EL), -Math.sin(EL) * Math.cos(AZ));

/** Where a world point lands on screen at zoom 1, before the pan (same as the simulation). */
export const project = (x: number, y: number, z: number): [number, number] => [
  (x * RIGHT.x + z * RIGHT.z) * PX,
  -(x * UP.x + y * UP.y + z * UP.z) * PX,
];
/** The inverse of `project` for a point on the floor (y = 0): screen at zoom 1 → world x, z. */
export const unprojectFloor = (px: number, py: number): [number, number] => {
  const a = px / PX;
  const b = -py / PX;
  const det = RIGHT.x * UP.z - RIGHT.z * UP.x;
  return [(a * UP.z - RIGHT.z * b) / det, (RIGHT.x * b - a * UP.x) / det];
};
/** Screen pixels per metre of height at zoom 1. */
export const HEIGHT_PX = UP.y * PX;

// ── Palette (the simulation's, plus the queue's own meanings) ───────────────
const C = {
  grass: '#65b779', lot: '#cfcbc1', desk: '#ecdcb6', deskSide: '#d8c69c',
  post: '#7d8b94', rope: '#c0392b',
  skin: ['#f1cdb0', '#e7b996', '#d9a67f'], hair: ['#3b2d24', '#5a4232', '#26211e', '#6b5a48'],
  trousers: ['#3c4a5c', '#2f3b47', '#4a5f7a', '#5b4a3c', '#3d4a3d'], shoe: '#2a2f35', eye: '#22282d',
  coat: '#f6f8f9', collar: '#2a9d8f', beanie: '#5c677d', pom: '#e6e9eb', cone: '#f37021',
};
/** Shirt = gender (owner 11-11 answer 4: blue man · pink woman · grey not given). */
export const SHIRT: Record<string, string> = { M: '#3f7fd3', F: '#e86aa6', '': '#9aa3ab' };
const SELECT_COLOR = '#2563eb';
const FOCUS_COLOR = '#f5b301';

// ── Layout (metres) ─────────────────────────────────────────────────────────
const X_PAD = 0.9;
export const LANE_MIN = 2.6; // lane signs ~100 px apart at the starting zoom, so they never overlap
const COL_W = 1.5; // wide enough that the tags over neighbouring heads don't overlap
export const PER_COL = 6;
const MAX_COLS = 8;
const Y0 = 1.15; // head of the line, in front of the counter
const STEP = 1.1; // between people in a column
export const DEPTH = Y0 + (PER_COL - 1) * STEP + 0.8;
export const SIGN_Y = 2.75; // lane signs, above the heads at the counter
export const FIGURE_H = 1.42; // feet to the top of the hair

export interface Spot { p: QueuePerson; x: number; z: number; head: boolean; tail: boolean }
export interface More { x: number; z: number; n: number; lane: QueueLane }
export interface Laid {
  spots: Spot[]; more: More[];
  ropes: { x: number; z1: number; z2: number }[];
  paths: { tone: string; pts: [number, number][] }[];
  laneX: number[]; laneCols: number[]; w: number;
}

export function layoutQueue(people: QueuePerson[]): Laid {
  const spots: Spot[] = [];
  const more: More[] = [];
  const ropes: Laid['ropes'] = [];
  const paths: Laid['paths'] = [];
  const laneX: number[] = [];
  const laneCols: number[] = [];
  let cursor = X_PAD;
  for (const L of LANES) {
    const ps = people.filter(p => p.lane === L.lane).sort((a, b) => a.pos - b.pos);
    const shown = ps.slice(0, PER_COL * MAX_COLS);
    const cols = Math.max(1, Math.ceil(shown.length / PER_COL));
    const x0 = cursor;
    // Long lines wind back and forth like an airport queue (even columns walk away from the counter).
    const at = (i: number): [number, number] => {
      const col = Math.floor(i / PER_COL);
      const r = i % PER_COL;
      const row = col % 2 === 0 ? r : PER_COL - 1 - r;
      return [x0 + col * COL_W, Y0 + row * STEP];
    };
    if (shown.length > 1) paths.push({ tone: L.tone, pts: shown.map((_, i) => at(i)) });
    shown.forEach((p, i) => {
      const [x, z] = at(i);
      spots.push({ p, x, z, head: i === 0, tail: i === shown.length - 1 && shown.length > 1 });
    });
    if (ps.length > shown.length) {
      const [x, z] = at(shown.length);
      more.push({ x, z, n: ps.length - shown.length, lane: L.lane });
    }
    // Ropes between columns, leaving the turn open at the far / near end.
    const zTop = Y0 - 0.45;
    const zBot = Y0 + (PER_COL - 1) * STEP + 0.45;
    for (let k = 0; k < cols - 1; k++) {
      const xb = x0 + (k + 0.5) * COL_W;
      ropes.push(k % 2 === 0 ? { x: xb, z1: zTop, z2: zBot - 1.2 } : { x: xb, z1: zTop + 1.2, z2: zBot });
    }
    laneX.push(x0);
    laneCols.push(cols);
    cursor += Math.max((cols - 1) * COL_W + 1.5, LANE_MIN);
  }
  return { spots, more, ropes, paths, laneX, laneCols, w: cursor - 0.4 };
}

// ── Geometry (shared) ───────────────────────────────────────────────────────
export const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_BALL = new SphereGeometry(1, 20, 14);
export const UNIT_CYL = new CylinderGeometry(1, 1, 1, 16);
const ARM = new CapsuleGeometry(0.05, 0.33, 6, 12);
const HAIR_BACK = new CapsuleGeometry(0.156, 0.171, 6, 12);
const HAIR_SIDE = new CapsuleGeometry(0.057, 0.171, 6, 12);
const CONE = new CylinderGeometry(0.03, 0.13, 0.32, 16, 1, true).rotateZ(Math.PI / 2); // narrow end at -x (the mouth)

type Part =
  | 'shoeL' | 'shoeR' | 'shinL' | 'shinR' | 'thighL' | 'thighR' | 'hips' | 'torso' | 'collar'
  | 'armL' | 'armR' | 'handL' | 'handR' | 'neck' | 'head' | 'eyeL' | 'eyeR' | 'hair' | 'hairBack'
  | 'hairSideL' | 'hairSideR' | 'pom';
const PARTS: { part: Part; geo: BufferGeometry }[] = [
  { part: 'shoeL', geo: UNIT_BOX }, { part: 'shoeR', geo: UNIT_BOX },
  { part: 'shinL', geo: UNIT_BOX }, { part: 'shinR', geo: UNIT_BOX },
  { part: 'thighL', geo: UNIT_BOX }, { part: 'thighR', geo: UNIT_BOX },
  { part: 'hips', geo: UNIT_BOX }, { part: 'torso', geo: UNIT_BOX }, { part: 'collar', geo: UNIT_CYL },
  { part: 'armL', geo: ARM }, { part: 'armR', geo: ARM },
  { part: 'handL', geo: UNIT_BALL }, { part: 'handR', geo: UNIT_BALL },
  { part: 'neck', geo: UNIT_CYL }, { part: 'head', geo: UNIT_BALL },
  { part: 'eyeL', geo: UNIT_BALL }, { part: 'eyeR', geo: UNIT_BALL },
  { part: 'hair', geo: UNIT_BALL }, { part: 'hairBack', geo: HAIR_BACK },
  { part: 'hairSideL', geo: HAIR_SIDE }, { part: 'hairSideR', geo: HAIR_SIDE }, { part: 'pom', geo: UNIT_BALL },
];
/** Parts a click can land on. */
const HITTABLE: Part[] = ['torso', 'head', 'hair', 'hips', 'thighL', 'thighR', 'armL', 'armR'];

// ── Small helpers ───────────────────────────────────────────────────────────
const pick = <T,>(list: T[], n: number) => list[Math.abs(Math.floor(n)) % list.length];
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpS = new Vector3();
/** m = parent · T(x,y,z) · R(rx,ry,rz) — joints only rotate. */
function joint(out: Matrix4, parent: Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'YXZ'));
  tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
  return out.multiplyMatrices(parent, tmpM);
}
/** m = parent · T(x,y,z) · S(sx,sy,sz) — a part hung on a joint. */
function partAt(out: Matrix4, parent: Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.set(sx, sy, sz));
  return out.multiplyMatrices(parent, tmpM);
}
const ZERO = new Matrix4().makeScale(0, 0, 0);

interface Figure {
  id: number; // contract id; staff use negative ids
  staff: boolean;
  gender: 'M' | 'F' | '';
  seed: number;
  ring: string | null; // situation colour under the feet
  focused: boolean;
  /** 0 = full colour · faded (contacted in 24 h) · dimmed by a filter. */
  wash: number;
  // motion
  x: number; z: number; tx: number; tz: number;
  fromX: number; fromZ: number; walkT0: number; walkDur: number;
  facing: number;
  born: number; leaving: number; // ms timestamps, 0 = not
  shoutUntil: number; // this customer is being shouted at
  task: null | { kind: 'shout'; target: number; t0: number; homeX: number; homeZ: number };
  phase: number;
}

const FACE_CAMERA = Math.PI / 4;
const WALK_SPEED = 1.5; // m/s
const STRIDE = 0.8;

export type QueueHit = { kind: 'person'; id: number } | null;

export class QueueWorld {
  protected renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 40, 420);
  private lambert = new MeshLambertMaterial({ color: '#ffffff' });
  private meshes = new Map<Part, InstancedMesh>();
  private ringMesh: InstancedMesh;
  private focusMesh: InstancedMesh;
  private selRing: Mesh;
  private hoverRing: Mesh;
  private hovered: number | null = null;
  private cone: Mesh;
  // Protected: the device-watch scene (nnf-extra/deviceWatch) builds its own floor on the same world.
  protected staticRoot = new Group();
  protected staticMats: Material[] = [];
  private figures: Figure[] = [];
  private byId = new Map<number, Figure>();
  private capacity = 0;
  private picked: number | null = null;
  private raf = 0;
  private view = { k: 1, x: 0, y: 0, w: 1, h: 1 };
  private sized = false;
  private ray = new Raycaster();
  private motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private canvas: HTMLCanvasElement;
  private owned: { dispose: () => void }[] = [];
  /** Called after every drawn frame, so the HTML labels can follow the people. */
  onFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(C.grass);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.camera.position.copy(DIR).multiplyScalar(220);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.staticRoot);

    // Rings on the floor: flat overlays, lifted, depth offset, no depth write (threejs-guide).
    const ringGeo = new RingGeometry(0.27, 0.34, 32).rotateX(-Math.PI / 2);
    const ringMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.ringMesh = new InstancedMesh(ringGeo, ringMat, 1);
    this.ringMesh.renderOrder = 1;
    const focusGeo = new RingGeometry(0.36, 0.46, 40).rotateX(-Math.PI / 2);
    const focusMat = new MeshBasicMaterial({ color: FOCUS_COLOR, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.focusMesh = new InstancedMesh(focusGeo, focusMat, 1);
    this.focusMesh.renderOrder = 1;
    const selGeo = new RingGeometry(0.4, 0.52, 40).rotateX(-Math.PI / 2);
    const selMat = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.selRing = new Mesh(selGeo, selMat);
    this.selRing.renderOrder = 2;
    // A faint copy drawn through the crowd, so the ring reads even behind people (as in the simulation).
    const ghostMat = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
    const ghost = new Mesh(selGeo, ghostMat);
    ghost.renderOrder = 3;
    this.selRing.add(ghost);
    this.selRing.visible = false;
    // The same ring, faint, under the person the mouse is on (setHovered) — "you can click this".
    const hoverMat = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.hoverRing = new Mesh(selGeo, hoverMat);
    this.hoverRing.renderOrder = 2;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    this.owned.push(hoverMat);
    this.cone = new Mesh(CONE, new MeshLambertMaterial({ color: C.cone, side: DoubleSide }));
    this.cone.visible = false;
    this.cone.castShadow = true;
    this.scene.add(this.ringMesh, this.focusMesh, this.selRing, this.cone);
    this.owned.push(ringGeo, ringMat, focusGeo, focusMat, selGeo, selMat, ghostMat);
    this.lights();
    this.ensureCapacity(64);
  }

  private lights() {
    this.scene.add(new HemisphereLight('#ffffff', '#cfd4d6', 1.75));
    const sun = new DirectionalLight('#fff6ea', 1.75);
    sun.position.set(34, 48, 22);
    sun.target.position.set(10, 0, 3);
    sun.castShadow = true;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096);
    const reach = 40;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 160 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  private ensureCapacity(n: number) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5), 64);
    for (const { part, geo } of PARTS) {
      const old = this.meshes.get(part);
      if (old) { this.scene.remove(old); old.dispose(); }
      const m = new InstancedMesh(geo, this.lambert, cap);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.meshes.set(part, m);
      this.scene.add(m);
    }
    for (const mesh of [this.ringMesh, this.focusMesh]) {
      const fresh = new InstancedMesh(mesh.geometry, mesh.material as Material, cap);
      fresh.renderOrder = mesh.renderOrder;
      fresh.count = 0;
      fresh.frustumCulled = false;
      this.scene.remove(mesh);
      this.scene.add(fresh);
      if (mesh === this.ringMesh) this.ringMesh = fresh; else this.focusMesh = fresh;
    }
    this.capacity = cap;
  }

  // ── Static: floor, lanes, counter, ropes ──
  setLayout(laid: Laid, waiting: boolean) {
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
      return m;
    };
    const post = (x: number, z: number, h: number, r: number, c: string) => {
      const m = new Mesh(UNIT_CYL, mat(c));
      m.scale.set(r, h, r);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      this.staticRoot.add(m);
    };
    const w = laid.w;
    // The lot, as the simulation's shop floor.
    box(-2.2, -0.12, -3, w + 7, 0.12, DEPTH + 5, C.lot, false);
    // Each lane's floor tint, a thin slab on the lot (its bottom face is hidden under it).
    LANES.forEach((L, li) => {
      const x = laid.laneX[li];
      const x2 = x + (laid.laneCols[li] - 1) * COL_W;
      const has = laid.spots.some(s => s.p.lane === L.lane);
      const end = has ? DEPTH : Y0 + 0.5;
      box(x - 0.48, 0, 0.35, x2 - x + 0.96, 0.012, end - 0.35, L.floor, false);
    });
    // Counter (a long desk), the clerks stand behind it.
    box(-0.3, 0, -0.55, w + 0.6, 0.78, 0.55, waiting ? '#e7c98d' : C.desk);
    box(-0.36, 0.78, -0.6, w + 0.72, 0.05, 0.65, C.deskSide);
    // Lane sign posts, rising from behind the counter.
    laid.laneX.forEach(x => post(x, -0.25, SIGN_Y, 0.025, C.post));
    // Airport ropes: two posts and a rope at waist height.
    for (const r of laid.ropes) {
      post(r.x, r.z1, 0.9, 0.03, '#59656f');
      post(r.x, r.z2, 0.9, 0.03, '#59656f');
      const rope = new Mesh(UNIT_BOX, mat(C.rope));
      rope.scale.set(0.025, 0.025, r.z2 - r.z1);
      rope.position.set(r.x, 0.86, (r.z1 + r.z2) / 2);
      this.staticRoot.add(rope);
    }
    // Dashed walking path through each line, head → end, in the lane's colour.
    for (const pa of laid.paths) {
      const dashMat = mat(pa.tone);
      for (let i = 1; i < pa.pts.length; i++) {
        const [ax, az] = pa.pts[i - 1];
        const [bx, bz] = pa.pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.floor(len / 0.28));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const d = new Mesh(UNIT_BOX, dashMat);
          d.scale.set(0.05, 0.01, 0.14);
          d.position.set(ax + (bx - ax) * t, 0.018, az + (bz - az) * t);
          d.rotation.y = Math.atan2(bx - ax, bz - az);
          this.staticRoot.add(d);
        }
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ── People ──
  /** Everyone who should be on the floor now. New ones appear, moved ones walk, gone ones shrink away. */
  setPeople(list: { id: number; x: number; z: number; gender: 'M' | 'F' | ''; ring: string | null; focused: boolean; wash: number; staff?: boolean }[]) {
    const now = performance.now();
    const seen = new Set<number>();
    for (const it of list) {
      seen.add(it.id);
      let f = this.byId.get(it.id);
      if (!f) {
        f = {
          id: it.id, staff: !!it.staff, gender: it.gender, seed: Math.abs(it.id), ring: it.ring, focused: it.focused, wash: it.wash,
          x: it.x, z: it.z, tx: it.x, tz: it.z, fromX: it.x, fromZ: it.z, walkT0: 0, walkDur: 0, facing: FACE_CAMERA,
          born: this.motion ? now : 0, leaving: 0, shoutUntil: 0, task: null, phase: (Math.abs(it.id) * 2.399) % (Math.PI * 2),
        };
        this.byId.set(it.id, f);
        this.figures.push(f);
      } else {
        f.leaving = 0;
        f.gender = it.gender; f.ring = it.ring; f.focused = it.focused; f.wash = it.wash;
        if (!f.task && (Math.abs(f.tx - it.x) > 0.01 || Math.abs(f.tz - it.z) > 0.01)) this.walkTo(f, it.x, it.z, now);
        else if (f.task) { f.task.homeX = it.x; f.task.homeZ = it.z; }
      }
    }
    for (const f of this.figures) if (!seen.has(f.id) && !f.leaving) f.leaving = this.motion ? now : now - 10_000;
    this.ensureCapacity(this.figures.length + 8);
    this.paint();
    this.start();
  }

  private walkTo(f: Figure, x: number, z: number, now: number) {
    f.fromX = f.x; f.fromZ = f.z; f.tx = x; f.tz = z;
    const d = Math.hypot(x - f.x, z - f.z);
    f.walkT0 = now;
    f.walkDur = this.motion ? Math.min(3200, (d / WALK_SPEED) * 1000) : 0;
  }

  /** Per-instance colours: shirt by gender, washed toward the floor when faded or filtered out. */
  private paint() {
    const lot = new Color(C.lot);
    const col = new Color();
    const set = (part: Part, i: number, hex: string, wash: number) => {
      col.set(hex).lerp(lot, wash);
      this.meshes.get(part)!.setColorAt(i, col);
    };
    this.figures.forEach((f, i) => {
      const shirt = f.staff ? C.coat : (SHIRT[f.gender] ?? SHIRT['']);
      const skin = pick(C.skin, f.seed);
      const hair = f.gender === '' && !f.staff ? C.beanie : pick(C.hair, f.seed * 3 + 1);
      const trousers = f.staff ? '#2f3b47' : pick(C.trousers, f.seed * 7 + 2);
      const w = f.wash;
      for (const p of ['shoeL', 'shoeR'] as Part[]) set(p, i, C.shoe, w);
      for (const p of ['shinL', 'shinR', 'thighL', 'thighR', 'hips'] as Part[]) set(p, i, trousers, w);
      for (const p of ['torso', 'armL', 'armR'] as Part[]) set(p, i, shirt, w);
      set('collar', i, C.collar, w);
      for (const p of ['handL', 'handR', 'neck', 'head'] as Part[]) set(p, i, skin, w);
      set('eyeL', i, C.eye, w); set('eyeR', i, C.eye, w);
      for (const p of ['hair', 'hairBack', 'hairSideL', 'hairSideR'] as Part[]) set(p, i, hair, w);
      set('pom', i, C.pom, w);
      this.ringMesh.setColorAt(i, col.set(f.ring ?? '#000000').lerp(lot, w * 0.6));
    });
    this.meshes.forEach(m => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  setPicked(id: number | null) { this.picked = id; this.start(); }
  setHovered(id: number | null) { if (id === this.hovered) return; this.hovered = id; this.start(); }

  /** Staff member nearest the customer walks out with a traffic cone and shouts in their ear. */
  shout(id: number) {
    const target = this.byId.get(id);
    if (!target || target.staff) return;
    const now = performance.now();
    const staff = this.figures.filter(f => f.staff && !f.task && !f.leaving);
    if (!staff.length) return;
    const s = staff.reduce((a, b) => (Math.abs(b.x - target.x) < Math.abs(a.x - target.x) ? b : a));
    s.task = { kind: 'shout', target: id, t0: now, homeX: s.tx, homeZ: s.tz };
    target.shoutUntil = now + SHOUT_MS;
    this.start();
  }

  /** Last known floor point of a person (also a little while after they left). */
  floorOf(id: number): [number, number] | null {
    const f = this.byId.get(id);
    return f ? [f.x, f.z] : null;
  }

  /** Screen point (canvas pixels) of a world point. */
  screen(x: number, y: number, z: number): [number, number] {
    const [px, py] = project(x, y, z);
    return [this.view.x + px * this.view.k, this.view.y + py * this.view.k];
  }

  setView(k: number, x: number, y: number, width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.view = { k, x, y, w: width, h: height };
    const s = k * PX;
    this.camera.left = -x / s;
    this.camera.right = (width - x) / s;
    this.camera.top = y / s;
    this.camera.bottom = (y - height) / s;
    this.camera.updateProjectionMatrix();
    this.sized = true;
    this.start();
  }

  hit(px: number, py: number): QueueHit {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.ray.setFromCamera(new Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    let best: { d: number; hit: QueueHit } | null = null;
    for (const part of HITTABLE) {
      const m = this.meshes.get(part);
      if (!m) continue;
      for (const found of this.ray.intersectObject(m, false)) {
        if (found.instanceId == null) continue;
        const f = this.figures[found.instanceId];
        if (!f || f.staff || f.leaving) continue;
        if (!best || found.distance < best.d) best = { d: found.distance, hit: { kind: 'person', id: f.id } };
        break;
      }
    }
    return best ? best.hit : null;
  }

  // ── Frame loop: idle sway, walking, effects ──
  protected start() {
    if (this.raf) return;
    const frame = (t: number) => {
      this.raf = 0;
      const busy = this.step(t);
      this.render();
      this.onFrame?.();
      if (busy) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private render() {
    if (!this.sized) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** Poses every figure for time `now`; returns whether anything still moves. */
  private step(now: number): boolean {
    const sec = now / 1000;
    let busy = this.motion; // idle sway keeps running while motion is allowed
    // Drop figures that have finished leaving.
    const keep = this.figures.filter(f => !(f.leaving && now - f.leaving > 600));
    if (keep.length !== this.figures.length) {
      this.figures.filter(f => !keep.includes(f)).forEach(f => this.byId.delete(f.id));
      this.figures = keep;
      this.paint();
    }
    const root = new Matrix4();
    const hipsM = new Matrix4();
    const pelvis = new Matrix4();
    const chest = new Matrix4();
    const headJ = new Matrix4();
    const legJ = new Matrix4();
    const knee = new Matrix4();
    const ankle = new Matrix4();
    const shoulder = new Matrix4();
    const out = new Matrix4();
    const ringM = new Matrix4();
    let coneShown = false;

    this.figures.forEach((f, i) => {
      // Position: walking toward the target, or out on a shout errand.
      let walking = false;
      let travelDx = 0;
      let travelDz = 0;
      if (f.task) {
        const target = this.byId.get(f.task.target);
        const tgt: [number, number] = target ? [target.x - 0.6, target.z + 0.15] : [f.task.homeX, f.task.homeZ];
        const ms = now - f.task.t0;
        const back = SHOUT_MS - WALK_OUT_MS;
        if (ms < WALK_OUT_MS) {
          const u = smooth(ms / WALK_OUT_MS);
          f.x = f.task.homeX + (tgt[0] - f.task.homeX) * u; f.z = f.task.homeZ + (tgt[1] - f.task.homeZ) * u;
          walking = true; travelDx = tgt[0] - f.task.homeX; travelDz = tgt[1] - f.task.homeZ;
        } else if (ms < back) {
          f.x = tgt[0]; f.z = tgt[1];
          // Cone from the mouth to the customer's ear.
          if (target) {
            const wob = Math.sin(ms / 33) * 0.06;
            const dx = target.x - f.x;
            const dz = target.z - f.z;
            const len = Math.hypot(dx, dz) || 1;
            this.cone.position.set(f.x + (dx / len) * 0.3, 1.25, f.z + (dz / len) * 0.3);
            this.cone.rotation.set(0, Math.atan2(-dz, dx) + wob, 0);
            coneShown = true;
          }
        } else if (ms < SHOUT_MS) {
          const u = smooth((ms - back) / WALK_OUT_MS);
          f.x = tgt[0] + (f.task.homeX - tgt[0]) * u; f.z = tgt[1] + (f.task.homeZ - tgt[1]) * u;
          walking = true; travelDx = f.task.homeX - tgt[0]; travelDz = f.task.homeZ - tgt[1];
        } else {
          f.x = f.task.homeX; f.z = f.task.homeZ; f.tx = f.x; f.tz = f.z;
          f.task = null;
        }
        busy = true;
      } else if (f.walkDur > 0 && now - f.walkT0 < f.walkDur) {
        const u = (now - f.walkT0) / f.walkDur;
        f.x = f.fromX + (f.tx - f.fromX) * u;
        f.z = f.fromZ + (f.tz - f.fromZ) * u;
        walking = true; travelDx = f.tx - f.fromX; travelDz = f.tz - f.fromZ;
        busy = true;
      } else {
        f.x = f.tx; f.z = f.tz;
      }
      // Turn toward the way they walk; face the camera again when they stop.
      const want = walking && Math.hypot(travelDx, travelDz) > 0.05 ? Math.atan2(travelDx, travelDz) : FACE_CAMERA;
      let dA = want - f.facing;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      f.facing += this.motion ? dA * Math.min(1, 0.18) : dA;
      if (Math.abs(dA) > 0.01) busy = true;

      // Appear / leave: grow in, shrink away.
      let scale = 1;
      if (f.born && now - f.born < 450) { scale = smooth((now - f.born) / 450); busy = true; }
      if (f.leaving) { scale = 1 - smooth((now - f.leaving) / 550); busy = true; }

      // Pose.
      let bob = 0;
      let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, armL = 0, armR = 0;
      let shift = 0, pelvA = 0, chestA = 0, headA = 0;
      let shake = 0;
      if (walking && this.motion) {
        const d = Math.hypot(f.x - (f.task ? f.task.homeX : f.fromX), f.z - (f.task ? f.task.homeZ : f.fromZ));
        const w = (d / STRIDE) * Math.PI * 2 + f.phase;
        hipL = Math.sin(w) * 0.45; hipR = -hipL;
        kneeL = 0.15 + Math.max(0, -Math.sin(w + 0.6)) * 0.6;
        kneeR = 0.15 + Math.max(0, Math.sin(w + 0.6)) * 0.6;
        armL = -hipL * 0.8; armR = -hipR * 0.8;
        bob = Math.abs(Math.cos(w)) * 0.03;
      } else if (this.motion) {
        // Idle: weight drifts from one leg to the other, a slow breath; each person on their own clock.
        const sh = Math.sin(sec * 0.55 + f.phase);
        shift = sh * 0.025;
        pelvA = sh * 0.05; chestA = -sh * 0.07; headA = sh * 0.05;
        const relaxL = Math.max(0, -sh);
        const relaxR = Math.max(0, sh);
        hipL = -0.14 * relaxL; kneeL = 0.32 * relaxL;
        hipR = -0.14 * relaxR; kneeR = 0.32 * relaxR;
        armL = Math.sin(sec * 0.9 + f.phase) * 0.03; armR = -armL;
      }
      if (f.shoutUntil > now) { shake = Math.sin(now / 28) * 0.03; busy = true; }
      const jump = bob;

      tmpQ.setFromEuler(tmpE.set(0, f.facing, 0));
      root.compose(tmpV.set(f.x + shake, jump, f.z), tmpQ, tmpS.set(scale, scale, scale));
      joint(hipsM, root, shift, 0, 0);
      const set = (part: Part, m: Matrix4) => this.meshes.get(part)!.setMatrixAt(i, m);

      // Legs: hip → knee → ankle (the ankle undoes the leg's tilt so the foot stays flat).
      const leg = (side: -1 | 1, hipA: number, kneeA: number, thigh: Part, shin: Part, shoe: Part) => {
        joint(legJ, hipsM, side * 0.075, 0.47, 0, hipA);
        set(thigh, partAt(out, legJ, 0, -0.11, 0, 0.1, 0.24, 0.11));
        joint(knee, legJ, 0, -0.215, 0, kneeA);
        set(shin, partAt(out, knee, 0, -0.1, 0, 0.092, 0.21, 0.1));
        joint(ankle, knee, 0, -0.195, 0, -(hipA + kneeA));
        set(shoe, partAt(out, ankle, 0, -0.03, 0.035, 0.11, 0.06, 0.18));
      };
      leg(-1, hipL, kneeL, 'thighL', 'shinL', 'shoeL');
      leg(1, hipR, kneeR, 'thighR', 'shinR', 'shoeR');

      const fem = f.gender === 'F' && !f.staff;
      const tw = fem ? 0.28 : 0.32;
      joint(pelvis, hipsM, 0, 0.55, 0, 0, 0, pelvA);
      set('hips', partAt(out, pelvis, 0, -0.02, 0, fem ? 0.28 : 0.3, 0.14, 0.17));
      joint(chest, pelvis, 0, 0.05, 0, 0, 0, chestA);
      const breath = this.motion ? 1 + Math.sin(sec * 1.3 + f.phase) * 0.012 : 1;
      set('torso', partAt(out, chest, 0, 0.2 * breath, 0, tw, 0.42 * breath, 0.19));
      set('collar', f.staff ? partAt(out, chest, 0, 0.42, 0, 0.09, 0.05, 0.09) : ZERO);
      const arm = (side: -1 | 1, swing: number, part: Part, hand: Part) => {
        joint(shoulder, chest, side * (tw / 2 + 0.04), 0.37, 0, swing, 0, side * 0.05);
        set(part, partAt(out, shoulder, 0, -0.165, 0, 1, 1, 1));
        set(hand, partAt(out, shoulder, 0, -0.42, 0, 0.0525, 0.0525, 0.0525));
      };
      arm(-1, armL, 'armL', 'handL');
      arm(1, armR, 'armR', 'handR');
      set('neck', partAt(out, chest, 0, 0.45, 0, 0.05, 0.08, 0.05));
      joint(headJ, chest, 0, 0.45, 0, 0, 0, headA);
      const hy = 0.15;
      const hr = 0.19;
      set('head', partAt(out, headJ, 0, hy, 0, hr, hr, hr));
      set('eyeL', partAt(out, headJ, -hr * 0.36, hy + hr * 0.02, hr * 0.97, hr * 0.11, hr * 0.13, hr * 0.08));
      set('eyeR', partAt(out, headJ, hr * 0.36, hy + hr * 0.02, hr * 0.97, hr * 0.11, hr * 0.13, hr * 0.08));
      const beanie = f.gender === '' && !f.staff;
      set('hair', beanie
        ? partAt(out, headJ, 0, hy + hr * 0.28, -hr * 0.02, hr * 1.1, hr * 0.78, hr * 1.1)
        : partAt(out, headJ, 0, hy + hr * 0.36, -hr * 0.12, hr * 1.06, hr * 0.7, hr * 1.06)); // fringe stops above the eyes
      set('pom', beanie ? partAt(out, headJ, 0, hy + hr * 1.08, -hr * 0.05, hr * 0.22, hr * 0.22, hr * 0.22) : ZERO);
      set('hairBack', fem ? partAt(out, headJ, 0, hy - hr * 0.45, -hr * 0.4, 1, 1, 0.62) : ZERO);
      set('hairSideL', fem ? partAt(out, headJ, -hr * 0.86, hy - hr * 0.35, hr * 0.08, 1, 1, 1) : ZERO);
      set('hairSideR', fem ? partAt(out, headJ, hr * 0.86, hy - hr * 0.35, hr * 0.08, 1, 1, 1) : ZERO);

      // Floor rings follow the feet, not the sway.
      const showRing = !f.staff && f.ring && !f.task;
      ringM.compose(tmpV.set(f.x, 0.025, f.z), tmpQ.identity(), tmpS.set(showRing ? scale : 0, 1, showRing ? scale : 0));
      this.ringMesh.setMatrixAt(i, ringM);
      const pulse = f.focused && !f.staff ? (this.motion ? 1 + Math.sin(sec * 3.9) * 0.1 : 1) * scale : 0;
      ringM.compose(tmpV.set(f.x, 0.022, f.z), tmpQ.identity(), tmpS.set(pulse, 1, pulse));
      this.focusMesh.setMatrixAt(i, ringM);
      if (pulse) busy = true;
    });

    const n = this.figures.length;
    this.meshes.forEach(m => { m.count = n; m.instanceMatrix.needsUpdate = true; });
    this.ringMesh.count = n;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.focusMesh.count = n;
    this.focusMesh.instanceMatrix.needsUpdate = true;
    this.cone.visible = coneShown;

    const sel = this.picked != null ? this.byId.get(this.picked) : null;
    this.selRing.visible = !!sel && !sel.leaving;
    if (sel) this.selRing.position.set(sel.x, 0.03, sel.z);
    const hov = this.hovered != null && this.hovered !== this.picked ? this.byId.get(this.hovered) : null;
    this.hoverRing.visible = !!hov && !hov.leaving;
    if (hov) this.hoverRing.position.set(hov.x, 0.03, hov.z);
    return busy;
  }

  /** Whether a figure is mid-walk (its label must follow it every frame). */
  positionOf(id: number): [number, number] | null {
    const f = this.byId.get(id);
    return f ? [f.x, f.z] : null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.meshes.forEach(m => m.dispose());
    this.ringMesh.dispose();
    this.focusMesh.dispose();
    this.owned.forEach(o => o.dispose());
    this.staticMats.forEach(m => m.dispose());
    this.renderer.dispose();
  }
}
