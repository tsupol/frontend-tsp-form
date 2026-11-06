import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, PCFShadowMap, Plane, PlaneGeometry, Quaternion, Raycaster, RepeatWrapping,
  SRGBColorSpace, Scene, ShadowMaterial, SphereGeometry, Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOOR, PILES, SOLD_EDGE, companyEdge, stateColor, type CompanyType, type HqCreditDay, type HqPayoutDay, type PileKey, type SimBranch, type SimHq } from './simulationTypes';

type BranchType = SimBranch['type'];

// A picture of the shops: one furnished shop per branch, every customer in it a real
// contract. Only the traffic moves. People and furniture change when an answer arrives,
// and the shadow map is redrawn only then, so the cars cost one plain pass per frame.
//
// World frame: x along the shop's width, y up, z from the back wall towards the viewer.
// One unit is about a metre. The camera sits at +x +y +z and never turns, so a world
// point has one fixed place on screen (project), and pan and zoom are only the
// orthographic frustum sliding and scaling over it.

export const RW = 12;
export const RD = 10.2;
const GAP = 2.6;
const PAD = 1.8;
const PAVE_CELL = 1.5;
const FOOT = PAVE_CELL; // footpath, exactly one paving cell wide, on both sides of the road
const ROAD_D = 5.4;
const LOT_Y = 0.05;
const FOOT_Y = 0.1;
const WALL = 0.22;
const BACK_H = 1.5;
const LOW_H = 0.55;
const SLAB = 0.06;
const PILE_X = 10.45;
const PILE_Z = 0.55;
const PILE_W = 0.8;
const PILE_STEP = 0.98;
const PILE_MAX = 2.4;
const BODY_R = 0.26;
const HEAD_R = 0.21;
const SIT_H = 0.5;
const STAND_H = 0.85;
const DOOR: [number, number] = [6.6, 9.4];
const CAR_LEN = 2.9;
const CAR_FPS = 30;
const CAR_CAPACITY = 64; // instances made up front; grows when a busy day needs more
const CAR_RUNOFF = 6; // road beyond the frontage the cars still use, each end
const CAR_FADE = 3; // a car grows in / shrinks away over this much road at each end

const PX = 30; // screen pixels per world unit at zoom 1
const AZ = Math.PI / 4;
const EL = (36 * Math.PI) / 180;
const DIR = new Vector3(Math.cos(EL) * Math.sin(AZ), Math.sin(EL), Math.cos(EL) * Math.cos(AZ));
const RIGHT = new Vector3(Math.cos(AZ), 0, -Math.sin(AZ));
const UP = new Vector3(-Math.sin(EL) * Math.sin(AZ), Math.cos(EL), -Math.sin(EL) * Math.cos(AZ));

/** Where a world point lands on screen at zoom 1, before the pan. */
export const project = (x: number, y: number, z: number): [number, number] => [
  (x * RIGHT.x + z * RIGHT.z) * PX,
  -(x * UP.x + y * UP.y + z * UP.z) * PX,
];

// ── Who sits where ───────────────────────────────────────────────────────────
export type Station = 'desk' | 'wait' | 'sign' | 'pay';
type Face = 'back' | 'front'; // 'back' looks at the back wall, so the backrest is on the viewer's side and must stay low
interface Spot { x: number; z: number; seated: boolean; face: Face }

const BOOTH_W = 1.75;
const BOOTH_X = 0.5;
const BOOTH_COUNT = 4;
const boothCentre = (i: number) => BOOTH_X + i * BOOTH_W + BOOTH_W / 2;
// The room in the order a contract moves, left to right: contract desks (back left) →
// approval rows (middle left) → signing table (middle right) → cashier (back right). The
// front strip is the chat corner on the left and a clear way in from the door on the right.
// When a station is full, its customers queue INSIDE that station's own area (QUEUE), so a
// crowd always shows where it is stuck — never one shared heap by the door.
// Approval: 2 × 5 chairs, always there, facing the counters on the back wall (Ton 11-06).
// Set about 2 m in front of the desks' chairs, so the contract-desk queue and the approval
// sign sit in between and the two zones never read as one line. Columns 1.2 apart keep
// the block clear of the signing chairs (x >= 7.63), leaving two standing columns on its right.
export const WAIT_COLS = [1.0, 2.2, 3.4, 4.6, 5.8];
const WAIT_SEATS: Spot[] = Array.from({ length: 10 }, (_, i) => ({ x: WAIT_COLS[i % 5], z: 5.0 + Math.floor(i / 5) * 1.2, seated: true, face: 'back' as Face }));
const SIGN_TABLE = { x: 7.4, z: 4.6, w: 2.2, d: 0.8 };
const SPOTS: Record<Station, Spot[]> = {
  desk: Array.from({ length: BOOTH_COUNT }, (_, i) => ({ x: boothCentre(i), z: 2.15, seated: true, face: 'back' as Face })),
  wait: WAIT_SEATS,
  sign: [
    { x: 7.95, z: 3.95, seated: true, face: 'front' },
    { x: 9.05, z: 3.95, seated: true, face: 'front' },
    { x: 7.95, z: 6.05, seated: true, face: 'back' },
    { x: 9.05, z: 6.05, seated: true, face: 'back' },
  ],
  pay: [{ x: 8.5, z: 2.1, seated: false, face: 'back' }, { x: 9.5, z: 2.1, seated: false, face: 'back' }],
};
const row = (xs: number[], z: number): [number, number][] => xs.map(x => [x, z]);
const QUEUE: Record<Station, [number, number][]> = {
  // In front of the booths, before the approval rows.
  desk: row([1.3, 2.15, 3.0, 3.85, 4.7, 5.55, 6.4], 3.0),
  // Standing round the chairs (standing takes less room): behind the rows first, then down
  // their right side, then a second row behind — all inside the approval zone.
  wait: [
    ...row(WAIT_COLS, 7.0),
    ...[5.0, 5.6, 6.2, 6.8].flatMap(z => row([6.55, 7.1], z)),
    ...row(WAIT_COLS, 7.6),
  ],
  // Down the right wall beside the table, below the money piles.
  sign: [4.9, 5.6, 6.3, 7.0, 7.7].flatMap(z => row([10.5, 11.2], z)),
  // In front of the till, short of the signing chairs.
  pay: [...row([8.2, 9.0, 9.8], 2.8), ...row([8.2, 9.0, 9.8], 3.35)],
};
// A deal-partner shop is smaller inside: two desks and two rows of chairs, the rest is the phone counter.
const PARTNER_DESKS = 2;
/** All eight approval chairs are always drawn, in every shop; past them people stand. */
const waitAlways = (_type: BranchType) => WAIT_SEATS.length;

// Zone names: the two counters' on the back wall above them, the other two on the floor
// (approval: just in front of its rows · signing: between its chairs and the door).
export const zoneLabels = (type: BranchType, _chat = false): [Station, number, number, number][] => [
  ['desk', type === 'DEAL_PARTNER' ? 2.2 : 4, 1.15, 0.24], ['wait', 3.0, 0.12, 4.1], ['sign', 8.5, 0.12, 6.75], ['pay', 9, 1.15, 0.24],
];

function spotOf(type: BranchType, st: Station, i: number): Spot {
  const limit = type === 'DEAL_PARTNER' && st === 'desk' ? PARTNER_DESKS : SPOTS[st].length;
  if (i < limit) return SPOTS[st][i];
  const k = i - limit;
  const q = QUEUE[st];
  const [x, z] = q[k % q.length];
  // A queue longer than its area doubles up, half a body to the side.
  const lap = Math.floor(k / q.length) * 0.3;
  return { x: x + lap, z, seated: false, face: 'back' };
}

export interface SeatedCustomer {
  id: number;
  branchId: number;
  state: string;
  station: Station;
  spot: number;
}

// ── Waiting for a chat reply (156 §6g, mig 1628) ────────────────────────────
// A fixed row of four teal chairs along the front wall, left of the door, facing the
// counters — in the same four columns as the approval chairs, so the room reads as one
// grid. Always drawn; past four, people stand just behind the row on the same patch.
// Clear of the approval standing rows (end z 7.86) and of the door (x 6.6).
const CHAT_COLS = WAIT_COLS.slice(0, 4);
const CHAT_SEATS: Spot[] = CHAT_COLS.map(x => ({ x, z: RD - 0.75, seated: true, face: 'back' as Face }));
const CHAT_OVERFLOW: [number, number][] = CHAT_COLS.map(x => [x, RD - 1.55]);
const CHAT_PATCH = { x: 0.55, z: RD - 1.95, w: 5.1, d: 1.65 };
export const CHAT_COLOR = '#1fa3ad';
const CHAT_SEAT = { seat: '#5cc6cb', base: '#3aa3a9', floor: '#d3f0f1' };
const CHAT_ALWAYS = CHAT_SEATS.length;

function chatSpotOf(i: number): Spot {
  if (i < CHAT_SEATS.length) return CHAT_SEATS[i];
  const k = i - CHAT_SEATS.length;
  const [x, z] = CHAT_OVERFLOW[k % CHAT_OVERFLOW.length];
  const lap = Math.floor(k / CHAT_OVERFLOW.length) * 0.3;
  return { x: x + lap, z: z - lap, seated: false, face: 'back' };
}

/** One row of chat[]: a seat in the chat corner of its shop. */
export interface ChatSeat {
  /** Contract id. Hits report it negated, so it can't collide with a waiting customer's. */
  id: number;
  branchId: number;
  spot: number;
}

/** Where the chat corner's sign goes: on the patch, under the row's middle. */
export const CHAT_LABEL: [number, number, number] = [CHAT_PATCH.x + CHAT_PATCH.w / 2, 0.12, CHAT_PATCH.z + CHAT_PATCH.d / 2];

// ── Layout ───────────────────────────────────────────────────────────────────
export interface ShopRef { id: number; type: BranchType }
export interface RoomPlace extends ShopRef { ox: number; oz: number }
/** The company building (156 §6h): its lot and one room per pool, in hq.pools order. */
export interface HqPlace { x: number; z: number; w: number; d: number; rooms: { ox: number; oz: number }[] }
export interface Plan {
  fw: number;
  fd: number;
  rooms: RoomPlace[];
  hq: HqPlace | null;
  /** Everything drawn: the shops' plot plus the building, for fitting the view. */
  extent: { x1: number; z0: number; z1: number };
}

// The company building: rooms side by side along x, at most three a row; past three it
// gets a second row. Across a walkway on the right of the shops, set at the middle of
// the plot's depth and never past its front, so the road in front stays clear.
export const HQ_RW = 9;
export const HQ_RD = 6.4;
const HQ_PAD = 1.0;
const HQ_GAP = 0.5;
const HQ_WALK = 6;
export const HQ_BACK_H = 2.6;

export function planOf(shops: ShopRef[], hqRooms = 0): Plan {
  const n = shops.length;
  const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const fw = cols * RW + (cols - 1) * GAP + PAD * 2;
  const fd = rows * RD + (rows - 1) * GAP + PAD * 2;
  let hq: HqPlace | null = null;
  if (hqRooms > 0) {
    const hc = Math.min(3, hqRooms);
    const hr = Math.ceil(hqRooms / hc);
    const w = hc * HQ_RW + (hc - 1) * HQ_GAP + HQ_PAD * 2;
    const d = hr * HQ_RD + (hr - 1) * HQ_GAP + HQ_PAD * 2;
    const z = d <= fd ? (fd - d) / 2 : fd - d;
    const x = fw + HQ_WALK;
    hq = {
      x, z, w, d,
      rooms: Array.from({ length: hqRooms }, (_, i) => ({ ox: x + HQ_PAD + (i % hc) * (HQ_RW + HQ_GAP), oz: z + HQ_PAD + Math.floor(i / hc) * (HQ_RD + HQ_GAP) })),
    };
  }
  return {
    fw, fd, hq,
    rooms: shops.map((sh, i) => ({ ...sh, ox: PAD + (i % cols) * (RW + GAP), oz: PAD + Math.floor(i / cols) * (RD + GAP) })),
    extent: { x1: hq ? hq.x + hq.w : fw, z0: hq ? Math.min(0, hq.z) : 0, z1: fd },
  };
}

// ── Colours: an illustration with its own palette in both app themes ─────────
const C = {
  grass: '#65b779', lot: '#cfcbc1', lotLine: '#c2bdb2', foot: '#e0dbd0', footLine: '#cdc8bb', kerb: '#aaa69b', road: '#7c848b', dash: '#e6e9eb',
  wall: '#e6e9eb', slabSide: '#cdd4d8', seat: '#aac4e6', seatBase: '#8ba9d0', desk: '#ecdcb6', screen: '#59677a', stand: '#c5ccd2', paper: '#ffffff',
  coat: '#f6f8f9', pot: '#c9a27c', leaf: ['#37945f', '#2e8654', '#42a06a'], trunk: '#8a6a4a', mat: '#b8bfc4',
  skin: ['#f1cdb0', '#e7b996', '#d9a67f'], hair: ['#3b2d24', '#5a4232', '#26211e', '#6b5a48'],
  cars: ['#e8ecef', '#5f7f9e', '#c9544d', '#3f4750', '#d9b44a', '#8fa3ad'], glass: '#6d8091', tyre: '#23272b', hub: '#aeb5ba',
  shelf: '#d9c7a3', phone: '#2f3640', awning: '#ffffff',
};

const pick = <T,>(list: T[], n: number) => list[Math.abs(Math.floor(n)) % list.length];
/** A slightly darker tone, so stacked folders read as separate sheets. */
const shade = (hex: string) => '#' + new Color(hex).multiplyScalar(0.86).getHexString();

// One geometry, one material and a colour per instance, so a whole company is a handful of draw calls.
const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_BODY = new CylinderGeometry(0.78, 1, 1, 18);
const UNIT_POST = new CylinderGeometry(1, 1, 1, 12);
const UNIT_BALL = new SphereGeometry(1, 20, 14);
const UNIT_CROWN = new IcosahedronGeometry(1, 1);

// A car along +x, wheels on y = 0. Paint is per car; glass, tyres and hubs keep their own colour.
function carParts() {
  const coloured = (geo: BufferGeometry, color: string) => {
    const c = new Color(color);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    return geo;
  };
  const wheel = (r: number, w: number) => new CylinderGeometry(r, r, w, 18).rotateX(Math.PI / 2);
  const paint = mergeGeometries([
    new BoxGeometry(CAR_LEN, 0.38, 1.28).translate(0, 0.41, 0),
    new BoxGeometry(1.34, 0.05, 1.04).translate(-0.12, 0.985, 0),
  ]);
  const wheels = [[0.88, 0.6], [0.88, -0.6], [-0.88, 0.6], [-0.88, -0.6]];
  const fixed = mergeGeometries([
    coloured(new BoxGeometry(1.5, 0.36, 1.14).translate(-0.12, 0.78, 0), C.glass),
    ...wheels.map(([x, z]) => coloured(wheel(0.23, 0.16).translate(x, 0.23, z), C.tyre)),
    ...wheels.map(([x, z]) => coloured(wheel(0.11, 0.18).translate(x, 0.23, z), C.hub)),
  ]);
  return { paint, fixed };
}

class Batch {
  private m: Matrix4[] = [];
  private c: Color[] = [];
  private geo: BufferGeometry;
  private mat: Material;
  constructor(geo: BufferGeometry, mat: Material) {
    this.geo = geo;
    this.mat = mat;
  }
  get size() { return this.m.length; }
  /** Centre + size. */
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
    this.m.push(new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz)));
    this.c.push(new Color(color));
  }
  build(parent: Group, cast = true, receive = true) {
    const mesh = new InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((m, i) => mesh.setMatrixAt(i, m));
    this.c.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    return mesh;
  }
}

// `box` takes the min corner, because walls and furniture are measured from one corner.
const box = (b: Batch, x: number, y: number, z: number, w: number, h: number, d: number, color: string) =>
  b.add(x + w / 2, y + h / 2, z + d / 2, w, h, d, color);

function tileTexture(line: string, base: string, cells: number) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let i = 0; i < cells; i++) {
    const p = (i * size) / cells + 1;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** An empty chair someone could sit in — pointing at it says which zone it belongs to. */
export interface EmptySeat { branchId: number; zone: 'wait' | 'chat'; x: number; z: number }

export type Hit = { kind: 'customer'; id: number } | { kind: 'pile'; branchId: number; key: PileKey } | { kind: 'room'; id: number } | { kind: 'hq'; index: number } | ({ kind: 'seat' } & EmptySeat) | null;

export interface PilePlace { branchId: number; key: PileKey; x: number; z: number; h: number; value: number; color: string }

const pileHeight = (v: number, max: number) => (v <= 0 || max <= 0 ? 0 : 0.28 + (PILE_MAX - 0.28) * Math.sqrt(v / max));

export interface LiveState {
  branches: SimBranch[];
  customers: SeatedCustomer[];
  picked: number | null;
  /** can_see_chat: draw the chat corner (chairs even when empty) and who sits in it. */
  showChat?: boolean;
  chatters?: ChatSeat[];
  /** can_see_hq's building contents; null/absent = nothing in the rooms. */
  hq?: SimHq | null;
}

/** A number or word the page prints over the building (Thai stays sharp as HTML). */
export interface HqMark {
  room: number;
  x: number;
  y: number;
  z: number;
  /** What it is, so the page picks the words and the look. */
  kind: 'tray' | 'credit' | 'returned' | 'checked' | 'payout' | 'money' | 'day' | 'deskMore' | 'bubble' | 'bubbleMore' | 'clear';
  value: number;
  /** The day column's date ("" = older backlog), for 'day'. */
  day?: string;
  today?: boolean;
}

// Folder colours: waiting yellow, approved/paid green, returned red, checked blue, in a payout run purple.
export const HQ_COLOR = { waiting: '#e9c46a', approved: '#4aa25e', returned: '#d1495b', checked: '#4d8ed2', inPayout: '#9478c9', money: '#3f9153' };
const FOLDER_H = 0.05;
const FOLDER_CAP = 24; // a taller stack says nothing more; the number over it does
const HQ_DESKS = 8;

interface Car { lane: number; dir: 1 | -1; speed: number; offset: number }

export class ShopWorld {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 40, 420);
  private live = new Group();
  private lambert = new MeshLambertMaterial({ color: '#ffffff' });
  private crown = new MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  private floors = new Map<number, MeshLambertMaterial>();
  private owned: { dispose: () => void }[] = [];
  private bodies: InstancedMesh | null = null;
  private heads: InstancedMesh | null = null;
  private pileMesh: InstancedMesh | null = null;
  private customerIds: number[] = [];
  private hqMarkList: HqMark[] = [];
  private emptySeats: EmptySeat[] = [];
  private seatPlane = new Plane(new Vector3(0, 1, 0), -(LOT_Y + SLAB + 0.42));
  private pileList: PilePlace[] = [];
  private ray = new Raycaster();
  private floorPlane = new Plane(new Vector3(0, 1, 0), -SLAB);
  private plan: Plan;
  private cars: Car[] = [];
  private carMeshes: InstancedMesh[] = [];
  private carRoot: Group | null = null;
  private carCapacity = 0;
  private lanes: { z: number; dir: 1 | -1; speed: number }[] = [];
  /** False under prefers-reduced-motion: the cars stand still (and can still be counted). */
  private motion = true;
  private span = 1;
  private spanStart = 0;
  private raf = 0;
  private lastFrame = 0;
  private sized = false;
  private view = { k: 1, x: 0, y: 0, w: 1, h: 1 };
  private carsWereVisible = true;
  private canvas: HTMLCanvasElement;
  private type: CompanyType | undefined;
  private onRestored = () => { this.renderer.shadowMap.needsUpdate = true; this.render(); };

  constructor(canvas: HTMLCanvasElement, shops: ShopRef[], type: CompanyType | undefined, hqRooms = 0) {
    this.canvas = canvas;
    this.type = type;
    this.plan = planOf(shops, hqRooms);
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(C.grass);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // a still scene: only redrawn when the data changes
    canvas.addEventListener('webglcontextrestored', this.onRestored);

    this.camera.position.copy(DIR).multiplyScalar(220);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);

    this.lights();
    this.scene.add(this.buildStatic());
    this.scene.add(this.live);
  }

  private lights() {
    const { extent } = this.plan;
    const fw = extent.x1;
    const fd = extent.z1 - extent.z0;
    const cx = fw / 2;
    const cz = extent.z0 + fd / 2;
    this.scene.add(new HemisphereLight('#ffffff', '#cfd4d6', 1.75));
    const sun = new DirectionalLight('#fff6ea', 1.75);
    sun.position.set(cx + 24, 48, cz + 12);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const reach = Math.max(fw, fd) * 0.85 + 26;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096);
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  private buildStatic() {
    const root = new Group();
    const { fw, fd, rooms } = this.plan;
    const boxes = new Batch(UNIT_BOX, this.lambert);
    const bodies = new Batch(UNIT_BODY, this.lambert);
    const balls = new Batch(UNIT_BALL, this.lambert);
    const posts = new Batch(UNIT_POST, this.lambert);
    const crowns = new Batch(UNIT_CROWN, this.crown);
    const accent = companyEdge(this.type);

    // Grass is the clear colour; this only catches the trees' shadows.
    const reach = Math.max(fw, fd) * 2 + 80;
    const shadowCatcher = new Mesh(new PlaneGeometry(reach, reach), new ShadowMaterial({ opacity: 0.16 }));
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(fw / 2, 0, fd / 2);
    shadowCatcher.receiveShadow = true;
    root.add(shadowCatcher);
    this.owned.push(shadowCatcher.geometry, shadowCatcher.material);

    // The plot, then footpath, road, footpath along its front. Slabs meet edge to edge, never overlap.
    const span = reach;
    const spanStart = fw / 2 - span / 2;
    const slab = (x: number, z: number, w: number, d: number, h: number, line: string, base: string, side: string) => {
      const tex = tileTexture(line, base, 2);
      tex.repeat.set(w / (PAVE_CELL * 2), d / (PAVE_CELL * 2));
      const top = new MeshLambertMaterial({ map: tex });
      const edge = new MeshLambertMaterial({ color: side });
      const mesh = new Mesh(new BoxGeometry(w, h, d), [edge, edge, top, edge, edge, edge]);
      mesh.position.set(x + w / 2, h / 2, z + d / 2);
      mesh.receiveShadow = true;
      root.add(mesh);
      this.owned.push(tex, top, edge, mesh.geometry);
    };
    const roadZ = fd + FOOT;
    slab(0, 0, fw, fd, LOT_Y, C.lotLine, C.lot, C.kerb);
    slab(spanStart, fd, span, FOOT, FOOT_Y, C.footLine, C.foot, C.kerb);
    slab(spanStart, roadZ + ROAD_D, span, FOOT, FOOT_Y, C.footLine, C.foot, C.kerb);
    box(boxes, spanStart, 0, roadZ, span, 0.04, ROAD_D, C.road);
    for (let x = spanStart; x < spanStart + span; x += 5) box(boxes, x, 0.04, roadZ + ROAD_D / 2 - 0.07, 2.6, 0.012, 0.14, C.dash);
    // Cars run only along the shops' frontage (plus a little either side), so every
    // one of them is on screen at once and the count can be read.
    this.buildCars(root, -CAR_RUNOFF, fw + CAR_RUNOFF * 2, roadZ);

    const tree = (x: number, z: number, s: number, n: number) => {
      posts.add(x, 0.4 * s, z, 0.1 * s, 0.8 * s, 0.1 * s, C.trunk);
      crowns.add(x, 1.25 * s, z, 0.62 * s, 0.72 * s, 0.62 * s, pick(C.leaf, n));
    };
    // Trees stand round the plot, clear of the road, and at the corners between shops.
    const ringN = Math.round((fw + fd) / 3.2);
    for (let i = 0; i < ringN; i++) {
      const a = (i * 137.5 * Math.PI) / 180;
      const s = 1.1 + ((i * 7) % 5) * 0.16;
      const d = 5 + ((i * 11) % 9);
      const edge = (i * 0.618) % 1;
      const side = i % 3;
      const x = side === 0 ? edge * fw : side === 1 ? -d : fw + d;
      const z = side === 0 ? -d : edge * (fd - 2);
      const tx = x + Math.cos(a);
      const tz = z + Math.sin(a);
      // Clear of the company building and the walkway to it.
      const h = this.plan.hq;
      if (h && tx > fw - 1 && tx < h.x + h.w + 1.5 && tz > h.z - 1.5 && tz < h.z + h.d + 1.5) continue;
      tree(tx, tz, s, i);
    }
    rooms.forEach((r, i) => {
      const onRight = r.ox + RW + GAP < fw;
      const onFront = r.oz + RD + GAP < fd;
      if (onRight && onFront) {
        const x = r.ox + RW + GAP / 2;
        const z = r.oz + RD + GAP / 2;
        posts.add(x, 0.2, z, 0.34, 0.4, 0.34, C.pot);
        crowns.add(x, 0.82, z, 0.42, 0.5, 0.42, pick(C.leaf, i));
      }
    });

    const floorTex = tileTexture('#dfe3e5', '#ffffff', 2);
    floorTex.repeat.set(RW / 2, RD / 2);
    const slabSide = new MeshLambertMaterial({ color: C.slabSide });
    const slabGeo = new BoxGeometry(RW, SLAB, RD);
    this.owned.push(floorTex, slabSide, slabGeo);
    rooms.forEach((r, i) => {
      const top = new MeshLambertMaterial({ map: floorTex, color: FLOOR.idle });
      this.floors.set(r.id, top);
      this.owned.push(top);
      const floor = new Mesh(slabGeo, [slabSide, slabSide, top, slabSide, slabSide, slabSide]);
      floor.position.set(r.ox + RW / 2, SLAB / 2 + LOT_Y, r.oz + RD / 2);
      floor.receiveShadow = true;
      root.add(floor);
      this.shop(boxes, bodies, balls, posts, crowns, r, accent, i);
    });

    if (this.plan.hq) this.buildHq(root, boxes, slab, accent);

    boxes.build(root);
    bodies.build(root);
    balls.build(root);
    posts.build(root);
    crowns.build(root);
    return root;
  }

  // The company building's shell (156 §6h): a lot, a walkway from the shops, tall back and
  // left walls with windows (proud of the wall, never on its face), low front and right
  // walls and low partitions so every room can be seen into. What is IN the rooms is
  // live data and is drawn by setLive.
  private buildHq(
    root: Group,
    boxes: Batch,
    slab: (x: number, z: number, w: number, d: number, h: number, line: string, base: string, side: string) => void,
    accent: string,
  ) {
    const h = this.plan.hq!;
    const { fw } = this.plan;
    const y = LOT_Y + SLAB;
    slab(h.x, h.z, h.w, h.d, LOT_Y, C.lotLine, C.lot, C.kerb);
    // Walkway between the plot and the building, half-way down the building's depth.
    const wz = h.z + h.d / 2 - FOOT;
    slab(fw, wz, h.x - fw, FOOT * 2, FOOT_Y, C.footLine, C.foot, C.kerb);
    // Zebra across the walkway's middle: stripes ON the footpath, lifted clear of its top.
    const stripes = 5;
    for (let i = 0; i < stripes; i++) box(boxes, fw + 1.2 + i * ((h.x - fw - 2.4) / stripes), FOOT_Y, wz + 0.25, 0.45, 0.012, FOOT * 2 - 0.5, '#ffffff');

    const floorGeo = new BoxGeometry(HQ_RW, SLAB, HQ_RD);
    const side = new MeshLambertMaterial({ color: C.slabSide });
    this.owned.push(floorGeo, side);
    h.rooms.forEach(r => {
      const top = new MeshLambertMaterial({ color: '#f7f8fa' });
      this.owned.push(top);
      const floor = new Mesh(floorGeo, [side, side, top, side, side, side]);
      floor.position.set(r.ox + HQ_RW / 2, LOT_Y + SLAB / 2, r.oz + HQ_RD / 2);
      floor.receiveShadow = true;
      root.add(floor);
      // Partitions round each room: tall at the back and left, low at the front and right.
      box(boxes, r.ox, y, r.oz, HQ_RW, HQ_BACK_H, WALL, C.wall);
      box(boxes, r.ox, y, r.oz + WALL, WALL, HQ_BACK_H, HQ_RD - WALL, C.wall);
      box(boxes, r.ox + HQ_RW - WALL, y, r.oz + WALL, WALL, LOW_H, HQ_RD - WALL, C.wall);
      // Front: low wall with a doorway in the middle.
      const door = 1.6;
      const half = (HQ_RW - door) / 2;
      box(boxes, r.ox + WALL, y, r.oz + HQ_RD - WALL, half - WALL, LOW_H, WALL, C.wall);
      box(boxes, r.ox + half + door, y, r.oz + HQ_RD - WALL, half - WALL, LOW_H, WALL, C.wall);
      // Windows on the back wall: glass panes standing proud of the wall's face.
      for (let i = 0; i < 4; i++) box(boxes, r.ox + 0.8 + i * 2.1, y + 1.35, r.oz + WALL, 1.3, 0.85, 0.04, C.glass);
      // The company's colour along the top of the back wall, with its own top face.
      box(boxes, r.ox + 0.3, y + HQ_BACK_H - 0.22, r.oz + WALL, HQ_RW - 0.6, 0.16, 0.06, accent);
    });
  }

  // The cars on the road in front are a count, not decoration (work order 2026-11-05 §2):
  // one car per contract the company opened today, the figure on the "สัญญาวันนี้" card.
  // No contract, empty road. They are spaced evenly, never at random, so the count
  // can be read off the screen; the side roads carry none.
  // Thailand drives on the left: looking along +x the left is -z, so the lane by the plot runs +x.
  private buildCars(root: Group, spanStart: number, span: number, roadZ: number) {
    this.span = span;
    this.spanStart = spanStart;
    this.carRoot = root;
    this.lanes = [
      { z: roadZ + ROAD_D * 0.25, dir: 1, speed: 5.2 },
      { z: roadZ + ROAD_D * 0.75, dir: -1, speed: 4.4 },
    ];
    this.allocateCars(CAR_CAPACITY);
  }

  /** Instanced meshes for up to `capacity` cars; only `count` of them are drawn. */
  private allocateCars(capacity: number) {
    const root = this.carRoot;
    if (!root) return;
    this.carMeshes.forEach(m => { root.remove(m); m.dispose(); });
    const { paint, fixed } = carParts();
    const paintMat = new MeshLambertMaterial({ color: '#ffffff' });
    const fixedMat = new MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    // Moving cars are not in the static shadow map; each carries a soft patch under it instead.
    const patchGeo = new PlaneGeometry(CAR_LEN + 0.25, 1.5).rotateX(-Math.PI / 2);
    const patchMat = new MeshBasicMaterial({ color: '#10161a', transparent: true, opacity: 0.2, depthWrite: false });
    const painted = new InstancedMesh(paint, paintMat, capacity);
    for (let i = 0; i < capacity; i++) painted.setColorAt(i, new Color(pick(C.cars, i * 5 + 2)));
    const meshes = [painted, new InstancedMesh(fixed, fixedMat, capacity), new InstancedMesh(patchGeo, patchMat, capacity)];
    meshes.forEach(m => {
      m.frustumCulled = false;
      m.castShadow = false;
      m.count = 0;
      root.add(m);
    });
    this.carMeshes = meshes;
    this.carCapacity = capacity;
    this.owned.push(paint, fixed, patchGeo, paintMat, fixedMat, patchMat);
  }

  /** One car per contract opened today, split over the two lanes. */
  private setCarCount(n: number) {
    if (n === this.cars.length) return;
    if (n > this.carCapacity) this.allocateCars(Math.max(n, this.carCapacity * 2));
    this.cars = [];
    this.lanes.forEach((l, lane) => {
      // Lane 0 takes the odd one out.
      const inLane = lane === 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
      for (let j = 0; j < inLane; j++) {
        // Even gaps in each lane; the second lane is shifted half a gap so the two don't pair up.
        const offset = ((j + (lane === 0 ? 0 : 0.5)) * this.span) / Math.max(inLane, 1);
        this.cars.push({ lane: l.z, dir: l.dir, speed: l.speed, offset });
      }
    });
    this.carMeshes.forEach(m => { m.count = this.cars.length; });
    this.carsWereVisible = true;
    this.placeCars(this.motion ? performance.now() / 1000 : 0);
  }

  private placeCars(seconds: number) {
    const mat = new Matrix4();
    const pos = new Vector3();
    const scale = new Vector3(1, 1, 1);
    const flip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const none = new Quaternion();
    this.cars.forEach((c, i) => {
      const run = (c.offset + c.speed * seconds) % this.span;
      const x = this.spanStart + (c.dir > 0 ? run : this.span - run);
      // Arriving at one end and leaving at the other, rather than popping in and out.
      const s = Math.min(1, Math.max(0.001, Math.min(run, this.span - run) / CAR_FADE));
      scale.set(s, s, s);
      this.carMeshes.forEach((m, k) => {
        pos.set(x, k === 2 ? 0.07 : 0.04, c.lane);
        m.setMatrixAt(i, mat.compose(pos, c.dir > 0 ? none : flip, scale));
        m.instanceMatrix.needsUpdate = true;
      });
    });
  }

  private carsVisible(seconds: number) {
    const { k, x, y, w, h } = this.view;
    const margin = CAR_LEN * PX * k;
    return this.cars.some(c => {
      const run = (c.offset + c.speed * seconds) % this.span;
      const [px, py] = project(this.spanStart + (c.dir > 0 ? run : this.span - run), 0, c.lane);
      const sx = x + px * k;
      const sy = y + py * k;
      return sx > -margin && sx < w + margin && sy > -margin && sy < h + margin;
    });
  }

  /** Starts the traffic. rAF stops by itself while the page is hidden. */
  start() {
    this.motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.raf || !this.motion) return;
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      if (t - this.lastFrame < 1000 / CAR_FPS - 2) return;
      this.lastFrame = t;
      // No car on screen: nothing has changed, so don't draw at all.
      const visible = this.carsVisible(t / 1000);
      if (!visible && !this.carsWereVisible) return;
      this.carsWereVisible = visible;
      this.placeCars(t / 1000);
      this.render();
    };
    this.raf = requestAnimationFrame(frame);
  }

  private person(bodies: Batch, balls: Batch, x: number, base: number, z: number, h: number, color: string, n: number) {
    bodies.add(x, base + h / 2, z, BODY_R, h, BODY_R, color);
    const headY = base + h + HEAD_R * 0.85;
    balls.add(x, headY, z, HEAD_R, HEAD_R, HEAD_R, pick(C.skin, n));
    balls.add(x, headY + HEAD_R * 0.3, z - 0.015, HEAD_R * 1.05, HEAD_R * 0.85, HEAD_R * 1.05, pick(C.hair, n * 3 + 1));
  }

  private seat(b: Batch, x: number, z: number, face: Face, seat = C.seat, base = C.seatBase) {
    const y = LOT_Y + SLAB;
    box(b, x - 0.2, y, z - 0.2, 0.4, 0.3, 0.4, base);
    box(b, x - 0.32, y + 0.3, z - 0.32, 0.64, 0.12, 0.64, seat);
    box(b, x - 0.32, y + 0.42, face === 'back' ? z + 0.22 : z - 0.32, 0.64, face === 'back' ? 0.24 : 0.52, 0.1, seat);
  }

  private shop(boxes: Batch, bodies: Batch, balls: Batch, posts: Batch, crowns: Batch, r: RoomPlace, accent: string, n: number) {
    const { ox, oz } = r;
    const partner = r.type === 'DEAL_PARTNER';
    const y = LOT_Y + SLAB;
    const staff = (x: number, z: number, k: number) => {
      const px = ox + x;
      const pz = oz + z;
      this.person(bodies, balls, px, y, pz, STAND_H, C.coat, n + k);
      bodies.add(px, y + STAND_H - 0.04, pz, BODY_R * 0.8, 0.09, BODY_R * 0.8, accent); // collar: the company's colour
    };

    // Walls: tall at the back and left, low at the front and right so the room stays visible.
    box(boxes, ox, y, oz, RW, BACK_H, WALL, C.wall);
    box(boxes, ox, y, oz + WALL, WALL, BACK_H, RD - WALL, C.wall);
    box(boxes, ox + RW - WALL, y, oz + WALL, WALL, LOW_H, RD - WALL, C.wall);
    box(boxes, ox + WALL, y, oz + RD - WALL, DOOR[0] - WALL, LOW_H, WALL, C.wall);
    box(boxes, ox + DOOR[1], y, oz + RD - WALL, RW - WALL - DOOR[1], LOW_H, WALL, C.wall);
    // Sign along the back wall, proud of it and with its own top, so no face lies on the wall's.
    box(boxes, ox + 0.5, y + BACK_H - 0.34, oz + WALL - 0.02, RW - 1, 0.28, 0.08, accent);
    box(boxes, ox + DOOR[0] + 0.5, y, oz + RD - 1.05, DOOR[1] - DOOR[0] - 1, 0.015, 0.8, C.mat);

    // Contract counter: booths with a member of staff behind each desk and a chair in front.
    const booths = partner ? PARTNER_DESKS : BOOTH_COUNT;
    for (let i = 0; i <= booths; i++) box(boxes, ox + BOOTH_X + i * BOOTH_W - 0.06, y, oz + WALL, 0.12, 0.95, 2.4, C.wall);
    for (let i = 0; i < booths; i++) {
      const cx = boothCentre(i);
      box(boxes, ox + cx - 0.68, y, oz + 1.05, 1.36, 0.72, 0.6, C.desk);
      box(boxes, ox + cx - 0.27, y + 0.72, oz + 1.2, 0.54, 0.32, 0.05, C.screen);
      staff(cx, 0.65, i);
      this.seat(boxes, ox + cx, oz + 2.15, 'back');
    }

    // Cashier.
    box(boxes, ox + 8, y, oz + 1.05, 2, 0.85, 0.6, C.desk);
    box(boxes, ox + 8.72, y + 0.85, oz + 1.2, 0.56, 0.32, 0.05, C.screen);
    staff(9, 0.65, 7);

    // Waiting for approval: a few chairs always, so an empty room still reads as a place to
    // wait; the rest appear only under someone sitting (setLive) — 15 empty seats were noise.
    for (const s of WAIT_SEATS.slice(0, waitAlways(r.type))) this.seat(boxes, ox + s.x, oz + s.z, s.face);

    if (partner) {
      // What makes it a phone shop: display counters with phones on them, and an awning over the door.
      const cases: [number, number][] = [[4.3, 0.5], [4.3, 1.75]];
      for (const [cx, cz] of cases) {
        box(boxes, ox + cx, y, oz + cz, 3, 0.8, 0.62, C.shelf);
        for (let i = 0; i < 7; i++) box(boxes, ox + cx + 0.15 + i * 0.4, y + 0.8, oz + cz + 0.14, 0.2, 0.025, 0.34, C.phone);
      }
      const stripes = 12;
      const from = DOOR[0] - 1.2;
      const w = (DOOR[1] - DOOR[0] + 2.4) / stripes;
      for (const dx of [DOOR[0] - 1.05, DOOR[1] + 0.85]) box(boxes, ox + dx, y, oz + RD - 0.16, 0.2, 1.35, 0.14, accent);
      for (let i = 0; i < stripes; i++) box(boxes, ox + from + i * w, y + 1.35, oz + RD - 0.28, w, 0.07, 1, i % 2 ? C.awning : accent);
    }

    // Signing table.
    box(boxes, ox + SIGN_TABLE.x, y, oz + SIGN_TABLE.z, SIGN_TABLE.w, 0.68, SIGN_TABLE.d, C.desk);
    box(boxes, ox + SIGN_TABLE.x + 0.28, y + 0.68, oz + SIGN_TABLE.z + 0.15, 0.5, 0.012, 0.5, C.paper);
    box(boxes, ox + SIGN_TABLE.x + 1.42, y + 0.68, oz + SIGN_TABLE.z + 0.15, 0.5, 0.012, 0.5, C.paper);
    for (const s of SPOTS.sign) this.seat(boxes, ox + s.x, oz + s.z, s.face);

    // A plant in the front-right corner (the front-left one is the chat row's now).
    for (const [px, pz] of [[11.2, RD - 0.9]]) {
      posts.add(ox + px, y + 0.2, oz + pz, 0.22, 0.4, 0.22, C.pot);
      crowns.add(ox + px, y + 0.72, oz + pz, 0.38, 0.46, 0.38, pick(C.leaf, n + px));
    }
  }

  /** Called when an answer arrives or the selection changes. */
  setLive({ branches, customers, picked, showChat = false, chatters = [], hq = null }: LiveState) {
    this.setCarCount(branches.reduce((s, b) => s + b.opened.length, 0));
    this.live.children.forEach(ch => (ch as InstancedMesh).dispose?.());
    this.live.clear();
    const y = LOT_Y + SLAB;
    const byId = new Map(this.plan.rooms.map(r => [r.id, r]));
    const lines = new Batch(UNIT_BOX, this.lambert);
    const standing = new Map<number, number>();
    customers.forEach(c => standing.set(c.branchId, (standing.get(c.branchId) ?? 0) + 1));

    branches.forEach(b => {
      const r = byId.get(b.id);
      if (!r) return;
      const n = standing.get(b.id) ?? 0;
      const sold = b.opened.length > 0;
      // §6a priority: ≥3 customers pink → 1–2 yellow → sold, nobody in the shop light green → closed grey → white.
      this.floors.get(b.id)?.color.set(n >= 3 ? FLOOR.busy : n >= 1 ? FLOOR.guest : sold ? FLOOR.sold : b.day_closed ? FLOOR.closed : FLOOR.idle);
      if (sold) {
        // A shop that sold keeps its green line in every case, so "sold" never disappears.
        const a = 0.34;
        box(lines, r.ox + a, y, r.oz + a, RW - a * 2, 0.02, 0.1, SOLD_EDGE);
        box(lines, r.ox + a, y, r.oz + RD - a - 0.1, RW - a * 2, 0.02, 0.1, SOLD_EDGE);
        box(lines, r.ox + a, y, r.oz + a + 0.1, 0.1, 0.02, RD - a * 2 - 0.2, SOLD_EDGE);
        box(lines, r.ox + RW - a - 0.1, y, r.oz + a + 0.1, 0.1, 0.02, RD - a * 2 - 0.2, SOLD_EDGE);
      }
      if (b.id === picked) {
        const color = companyEdge(this.type);
        const t = 0.16;
        box(lines, r.ox - t, LOT_Y, r.oz - t, RW + t * 2, 0.12, t, color);
        box(lines, r.ox - t, LOT_Y, r.oz + RD, RW + t * 2, 0.12, t, color);
        box(lines, r.ox - t, LOT_Y, r.oz, t, 0.12, RD, color);
        box(lines, r.ox + RW, LOT_Y, r.oz, t, 0.12, RD, color);
      }
    });
    if (lines.size) lines.build(this.live, false, true);

    const bodies = new Batch(UNIT_BODY, this.lambert);
    const heads = new Batch(UNIT_BALL, this.lambert);
    const hair = new Batch(UNIT_BALL, this.lambert);
    this.customerIds = [];
    const chairs = new Batch(UNIT_BOX, this.lambert);
    customers.forEach((c, i) => {
      const r = byId.get(c.branchId);
      if (!r) return;
      const s = spotOf(r.type, c.station, c.spot);
      // Approval seats exist only while taken (the counters' chairs are furniture, drawn always).
      if (c.station === 'wait' && s.seated && c.spot >= waitAlways(r.type)) this.seat(chairs, r.ox + s.x, r.oz + s.z, s.face);
      const base = s.seated ? y + 0.42 : y;
      const h = s.seated ? SIT_H : STAND_H;
      const x = r.ox + s.x;
      const z = r.oz + s.z - (s.seated ? (s.face === 'back' ? 0.03 : -0.03) : 0);
      bodies.add(x, base + h / 2, z, BODY_R, h, BODY_R, stateColor(c.state));
      const headY = base + h + HEAD_R * 0.85;
      heads.add(x, headY, z, HEAD_R, HEAD_R, HEAD_R, pick(C.skin, c.id + i));
      hair.add(x, headY + HEAD_R * 0.3, z - 0.015, HEAD_R * 1.05, HEAD_R * 0.85, HEAD_R * 1.05, pick(C.hair, c.id * 3 + 1));
      this.customerIds.push(c.id);
    });

    // Chat corner (§6g): not counted as standing and doesn't colour the floor.
    if (showChat) {
      const corner = new Batch(UNIT_BOX, this.lambert);
      this.plan.rooms.forEach(r => {
        box(corner, r.ox + CHAT_PATCH.x, y, r.oz + CHAT_PATCH.z, CHAT_PATCH.w, 0.015, CHAT_PATCH.d, CHAT_SEAT.floor);
        for (const s of CHAT_SEATS.slice(0, CHAT_ALWAYS)) this.seat(corner, r.ox + s.x, r.oz + s.z, s.face, CHAT_SEAT.seat, CHAT_SEAT.base);
      });
      chatters.forEach((c, i) => {
        const r = byId.get(c.branchId);
        if (!r) return;
        const s = chatSpotOf(c.spot);
        if (s.seated && c.spot >= CHAT_ALWAYS) this.seat(corner, r.ox + s.x, r.oz + s.z, s.face, CHAT_SEAT.seat, CHAT_SEAT.base);
        const base = s.seated ? y + 0.42 : y;
        const h = s.seated ? SIT_H : STAND_H;
        const x = r.ox + s.x;
        const z = r.oz + s.z - (s.seated ? 0.03 : 0);
        bodies.add(x, base + h / 2, z, BODY_R, h, BODY_R, CHAT_COLOR);
        const headY = base + h + HEAD_R * 0.85;
        heads.add(x, headY, z, HEAD_R, HEAD_R, HEAD_R, pick(C.skin, c.id + i));
        hair.add(x, headY + HEAD_R * 0.3, z - 0.015, HEAD_R * 1.05, HEAD_R * 0.85, HEAD_R * 1.05, pick(C.hair, c.id * 3 + 2));
        // The phone in their hand, held at the side the viewer sees.
        box(corner, x + BODY_R - 0.02, base + h * 0.62, z - 0.07, 0.04, 0.22, 0.14, C.phone);
        this.customerIds.push(-c.id);
      });
      if (corner.size) corner.build(this.live);
    }
    if (chairs.size) chairs.build(this.live);
    this.bodies = bodies.size ? bodies.build(this.live) : null;
    this.heads = heads.size ? heads.build(this.live) : null;
    if (hair.size) hair.build(this.live);

    const maxPile = Math.max(1, ...branches.flatMap(b => PILES[b.company_type].map(p => b[p.key])));
    const piles = new Batch(UNIT_BOX, this.lambert);
    const bands = new Batch(UNIT_BOX, this.lambert);
    this.pileList = [];
    branches.forEach(b => {
      const r = byId.get(b.id);
      if (!r) return;
      PILES[b.company_type].forEach((p, i) => {
        const h = pileHeight(b[p.key], maxPile);
        if (h <= 0) return; // ฿0 today: no pile.
        const x = r.ox + PILE_X;
        const z = r.oz + PILE_Z + i * PILE_STEP;
        box(piles, x, y, z, PILE_W, h, PILE_W, p.c[2]);
        box(bands, x - 0.02, y + h * 0.42, z - 0.02, PILE_W + 0.04, Math.min(0.2, h * 0.3), PILE_W + 0.04, '#f8f6ef');
        this.pileList.push({ branchId: b.id, key: p.key, x: x + PILE_W / 2, z: z + PILE_W / 2, h: y + h, value: b[p.key], color: p.c[1] });
      });
    });
    this.pileMesh = piles.size ? piles.build(this.live) : null;
    if (bands.size) bands.build(this.live);

    // The always-drawn chairs nobody sits in right now, for pointing at (§ empty chairs).
    this.emptySeats = [];
    const taken = new Set<string>();
    customers.forEach(c => { if (c.station === 'wait') taken.add(`${c.branchId}:wait:${c.spot}`); });
    chatters.forEach(c => taken.add(`${c.branchId}:chat:${c.spot}`));
    this.plan.rooms.forEach(r => {
      WAIT_SEATS.slice(0, waitAlways(r.type)).forEach((s, i) => {
        if (!taken.has(`${r.id}:wait:${i}`)) this.emptySeats.push({ branchId: r.id, zone: 'wait', x: r.ox + s.x, z: r.oz + s.z });
      });
      if (showChat) CHAT_SEATS.slice(0, CHAT_ALWAYS).forEach((s, i) => {
        if (!taken.has(`${r.id}:chat:${i}`)) this.emptySeats.push({ branchId: r.id, zone: 'chat', x: r.ox + s.x, z: r.oz + s.z });
      });
    });

    this.hqMarkList = [];
    if (hq && this.plan.hq) this.drawHq(hq);

    this.renderer.shadowMap.needsUpdate = true;
  }

  hqMarks() { return this.hqMarkList; }

  // What sits in each pool's room (156 par. 6h). Counted things are the real numbers: a desk per
  // member, someone at it for each who acted today, a folder per document, a bubble per
  // unread message. Past what fits, the number over it carries the rest.
  private drawHq(hq: SimHq) {
    const place = this.plan.hq!;
    const y = LOT_Y + SLAB;
    const things = new Batch(UNIT_BOX, this.lambert);
    const bodies = new Batch(UNIT_BODY, this.lambert);
    const balls = new Batch(UNIT_BALL, this.lambert);
    const today = hq.days[hq.days.length - 1] ?? '';
    const mark = (m: HqMark) => this.hqMarkList.push(m);
    const stack = (x: number, z: number, n: number, color: string, w = 0.5, d = 0.62, base = y) => {
      const k = Math.min(n, FOLDER_CAP);
      for (let i = 0; i < k; i++) box(things, x, base + i * FOLDER_H, z, w, FOLDER_H * 0.82, d, i % 2 ? color : shade(color));
      return base + k * FOLDER_H;
    };

    hq.pools.forEach((pool, ri) => {
      const r = place.rooms[ri];
      if (!r) return;
      const { ox, oz } = r;

      // Desks along the back wall, staff facing the viewer.
      const desks = Math.min(pool.members, HQ_DESKS);
      const active = Math.min(pool.active_today, desks);
      for (let j = 0; j < desks; j++) {
        const cx = ox + 0.75 + j * 1.05;
        box(things, cx - 0.42, y, oz + 0.95, 0.84, 0.7, 0.5, C.desk);
        box(things, cx - 0.2, y + 0.7, oz + 1.0, 0.4, 0.26, 0.04, C.screen);
        this.seat(things, cx, oz + 0.62, 'front');
        if (j < active) this.person(bodies, balls, cx, y + 0.42, oz + 0.6, SIT_H, C.coat, ri * 11 + j);
      }
      if (pool.members > HQ_DESKS) mark({ room: ri, x: ox + 0.75 + (HQ_DESKS - 1) * 1.05, y: 1.4, z: oz + 1.2, kind: 'deskMore', value: pool.members - HQ_DESKS });

      // The tray of documents waiting to be checked, on the left.
      if (pool.waiting != null) {
        box(things, ox + 0.55, y, oz + 2.05, 1.0, 0.45, 0.8, C.shelf);
        const top = stack(ox + 0.8, oz + 2.14, pool.waiting, HQ_COLOR.waiting, 0.5, 0.62, y + 0.45);
        mark({ room: ri, x: ox + 1.05, y: top + 0.25, z: oz + 2.45, kind: 'tray', value: pool.waiting });
      }

      if (pool.kind === 'CREDIT') {
        (pool.days as HqCreditDay[]).forEach((d, di) => {
          const cx = ox + 2.4 + di * 1.6;
          const isToday = d.day === today;
          box(things, cx - 0.6, y, oz + 3.5, 1.2, 0.012, 1.7, isToday ? '#cdeccf' : '#e9ecee');
          const g = stack(cx - 0.55, oz + 3.75, d.approved, HQ_COLOR.approved);
          const rd = stack(cx + 0.05, oz + 3.75, d.returned, HQ_COLOR.returned);
          if (d.approved > 0) mark({ room: ri, x: cx - 0.3, y: g + 0.18, z: oz + 4.05, kind: 'credit', value: d.approved });
          if (d.returned > 0) mark({ room: ri, x: cx + 0.3, y: rd + 0.18, z: oz + 4.05, kind: 'returned', value: d.returned });
          mark({ room: ri, x: cx, y: 0.12, z: oz + 5.45, kind: 'day', value: d.submitted, day: d.day, today: isToday });
        });
      } else if (pool.kind === 'PAYOUT') {
        const days = pool.days as HqPayoutDay[];
        const maxPaid = Math.max(1, ...days.map(d => d.paid));
        days.forEach((d, di) => {
          const cx = ox + 1.95 + di * 1.4;
          const isToday = d.day === today;
          box(things, cx - 0.55, y, oz + 3.5, 1.1, 0.012, 1.7, d.day === '' ? '#f6d9dc' : isToday ? '#cdeccf' : '#e9ecee');
          const b = stack(cx - 0.5, oz + 3.65, d.checked, HQ_COLOR.checked, 0.42, 0.5);
          const p = stack(cx + 0.06, oz + 3.65, d.in_payout, HQ_COLOR.inPayout, 0.42, 0.5);
          if (d.checked > 0) mark({ room: ri, x: cx - 0.29, y: b + 0.18, z: oz + 3.9, kind: 'checked', value: d.checked });
          if (d.in_payout > 0) mark({ room: ri, x: cx + 0.27, y: p + 0.18, z: oz + 3.9, kind: 'payout', value: d.in_payout });
          if (d.paid > 0) {
            // Money paid out: a green box, taller by the square root so small days still show.
            const h = 0.15 + 0.9 * Math.sqrt(d.paid / maxPaid);
            box(things, cx - 0.35, y, oz + 4.4, 0.7, h, 0.55, HQ_COLOR.money);
            box(things, cx - 0.37, y + h * 0.45, oz + 4.38, 0.74, Math.min(0.12, h * 0.25), 0.59, '#f8f6ef');
            mark({ room: ri, x: cx, y: y + h + 0.2, z: oz + 4.65, kind: 'money', value: d.paid });
          }
          mark({ room: ri, x: cx, y: 0.12, z: oz + 5.45, kind: 'day', value: d.pending, day: d.day, today: isToday });
        });
      } else if (pool.unread != null) {
        // Customer service: one floating bubble per unread message (the page draws them), at most 18.
        const shown = Math.min(pool.unread, 18);
        for (let i = 0; i < shown; i++) {
          mark({ room: ri, x: ox + 1.6 + (i % 6) * 1.15, y: 1.5 + Math.floor(i / 6) * 0.55 + ((i * 37) % 5) * 0.06, z: oz + 3.2 + Math.floor(i / 6) * 0.7, kind: 'bubble', value: i });
        }
        if (pool.unread > shown) mark({ room: ri, x: ox + 1.6 + 6 * 1.15, y: 1.6, z: oz + 3.9, kind: 'bubbleMore', value: pool.unread - shown });
        if (pool.unread === 0) mark({ room: ri, x: ox + HQ_RW / 2, y: 0.12, z: oz + 4.2, kind: 'clear', value: 0 });
      }
    });
    if (things.size) things.build(this.live);
    if (bodies.size) bodies.build(this.live);
    if (balls.size) balls.build(this.live);
  }

  piles() { return this.pileList; }

  /** Head-top position of a customer, for a label. */
  customerAt(c: SeatedCustomer): [number, number, number] | null {
    const r = this.plan.rooms.find(p => p.id === c.branchId);
    if (!r) return null;
    const s = spotOf(r.type, c.station, c.spot);
    return [r.ox + s.x, 0.11 + (s.seated ? 0.42 + SIT_H : STAND_H) + HEAD_R * 2, r.oz + s.z];
  }

  /** Head-top position of someone in the chat corner, for the unread bubble. */
  chatAt(c: ChatSeat): [number, number, number] | null {
    const r = this.plan.rooms.find(p => p.id === c.branchId);
    if (!r) return null;
    const s = chatSpotOf(c.spot);
    return [r.ox + s.x, 0.11 + (s.seated ? 0.42 + SIT_H : STAND_H) + HEAD_R * 2, r.oz + s.z];
  }

  /** Pan and zoom in screen pixels: a point at project() p lands at (x + p.x·k, y + p.y·k). */
  setView(k: number, x: number, y: number, width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.view = { k, x, y, w: width, h: height };
    this.carsWereVisible = true;
    const s = k * PX;
    this.camera.left = -x / s;
    this.camera.right = (width - x) / s;
    this.camera.top = y / s;
    this.camera.bottom = (y - height) / s;
    this.camera.updateProjectionMatrix();
    this.sized = true;
  }

  render() {
    if (!this.sized) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** What is under a canvas point, front to back: a customer or a pile, else the shop's floor. */
  hit(px: number, py: number): Hit {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.ray.setFromCamera(new Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    let best: { d: number; hit: Hit } | null = null;
    const test = (mesh: InstancedMesh | null, make: (i: number) => Hit) => {
      if (!mesh) return;
      const found = this.ray.intersectObject(mesh, false)[0];
      if (found && found.instanceId != null && (!best || found.distance < best.d)) best = { d: found.distance, hit: make(found.instanceId) };
    };
    const customer = (i: number): Hit => ({ kind: 'customer', id: this.customerIds[i] });
    test(this.bodies, customer);
    test(this.heads, customer);
    test(this.pileMesh, i => ({ kind: 'pile', branchId: this.pileList[i].branchId, key: this.pileList[i].key }));
    if (best) return (best as { hit: Hit }).hit;
    // An empty chair: test at seat height, where the eye sees it, not on the floor below.
    const sp = this.ray.ray.intersectPlane(this.seatPlane, new Vector3());
    if (sp) {
      const seat = this.emptySeats.find(e => Math.abs(sp.x - e.x) < 0.36 && Math.abs(sp.z - e.z) < 0.36);
      if (seat) return { kind: 'seat', ...seat };
    }
    const p = this.ray.ray.intersectPlane(this.floorPlane, new Vector3());
    if (!p) return null;
    const room = this.plan.rooms.find(r => p.x >= r.ox && p.x <= r.ox + RW && p.z >= r.oz && p.z <= r.oz + RD);
    if (room) return { kind: 'room', id: room.id };
    const hqIndex = this.plan.hq?.rooms.findIndex(r => p.x >= r.ox && p.x <= r.ox + HQ_RW && p.z >= r.oz && p.z <= r.oz + HQ_RD) ?? -1;
    return hqIndex >= 0 ? { kind: 'hq', index: hqIndex } : null;
  }

  /** The numbers a probe reads to check the scene, not the formula that built it. */
  stats() {
    return { frames: this.renderer.info.render.frame, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, near: this.camera.near, far: this.camera.far, piles: this.pileList.length, customers: this.customerIds.length, cars: this.cars.length, carsDrawn: this.carMeshes[0]?.count ?? 0 };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.live.children.forEach(ch => (ch as InstancedMesh).dispose?.());
    this.owned.forEach(o => o.dispose());
    this.carMeshes.forEach(m => m.dispose());
    this.lambert.dispose();
    this.crown.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
