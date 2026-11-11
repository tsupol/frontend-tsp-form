import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, PCFShadowMap, Plane, PlaneGeometry, Quaternion, Raycaster, RepeatWrapping, RingGeometry,
  SRGBColorSpace, Scene, ShadowMaterial, SphereGeometry, Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FlightLayer } from './simulationFlights';
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
const CAR_CAPACITY = 64; // instances made up front; grows when a busy day needs more
// The selected person's floor ring: the app's primary blue, apart from every status colour.
const SELECT_COLOR = '#2563eb';
const HOP_MS = 320;
const HOP_UP = 0.22; // m at the top of the hop
const CAR_FADE = 3; // a car grows in / shrinks away over this much road at each end
const MOTO_LEN = 1.7;
const MOTO_IN = 0.4; // a motorcycle lane's centre, in from each kerb — clear of the car lanes (bodies start 0.71 in)
const WALKER_LEN = 0.6;

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

const zoneLimit = (type: BranchType, st: Station) => (type === 'DEAL_PARTNER' && st === 'desk' ? PARTNER_DESKS : SPOTS[st].length);
const STATION_ORDER: Station[] = ['desk', 'wait', 'sign', 'pay'];

// Today's customers past a station's own seats AND queue: out of the door, a line along the
// shop front facing in, like a shop with a queue outside — a crowd you see from afar.
// Two lines from the door leftwards; past those, a "+n" at the end of the line.
const OUTSIDE: [number, number][] = [RD + 0.65, RD + 1.3].flatMap(z => Array.from({ length: 13 }, (_, i): [number, number] => [8.0 - i * 0.62, z]));

// Contracts created before today are not people in the shop: they are files left at their
// step — a stack of folders, one per contract, with the count over it.
const STALE_AT: Record<Station, { x: number; z: number; w: number; d: number; base: number }> = {
  desk: { x: 0.4, z: 2.5, w: 0.5, d: 0.6, base: 0 }, // floor, left of the desk queue
  wait: { x: 0.4, z: 3.75, w: 0.5, d: 0.6, base: 0 }, // floor, in front of the approval block
  sign: { x: 8.25, z: 4.75, w: 0.5, d: 0.5, base: 0.68 }, // on the signing table
  pay: { x: 9.4, z: 1.1, w: 0.45, d: 0.45, base: 0.85 }, // on the cashier's desk
};
const STALE_CAP = 20;

/** A contract created before today, at its step (§ crowd: files, not people). */
export interface StaleRow { branchId: number; station: Station; age: number }
export interface StalePile { branchId: number; station: Station; n: number; oldest: number; x: number; y: number; z: number }
/** Where a "+n" goes: people past the outside line, or chatters past the chat corner. */
export interface MoreMark { branchId: number; kind: 'outside' | 'chat'; n: number; x: number; y: number; z: number }

function spotOf(type: BranchType, st: Station, i: number): Spot {
  const limit = zoneLimit(type, st);
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
/** Chatters drawn: the row and the line behind it; the rest are a "+n" on the corner. */
const CHAT_DRAWN = CHAT_SEATS.length + CHAT_OVERFLOW.length;

function chatSpotOf(i: number): Spot {
  if (i < CHAT_SEATS.length) return CHAT_SEATS[i];
  const k = i - CHAT_SEATS.length;
  const [x, z] = CHAT_OVERFLOW[k % CHAT_OVERFLOW.length];
  const lap = Math.floor(k / CHAT_OVERFLOW.length) * 0.3;
  return { x: x + lap, z: z - lap, seated: false, face: 'back' };
}

/** One row of chat[]: a seat in the chat corner of its shop, or in the company's
 *  customer-service room when its shop is in that pool (`room` = index in hq.pools). */
export interface ChatSeat {
  /** Contract id. Hits report it negated, so it can't collide with a waiting customer's. */
  id: number;
  branchId: number;
  /** Seat number in the shop's corner, or in the room when `room` is set. */
  spot: number;
  room?: number;
}

// ── Waiting for a chat reply in the customer-service room (NOTICE 2026-11-07 tag §2) ──
// A fund's chats wait on its customer-service team, so a shop in that pool has its waiting
// customers sit in the company building, not the shop: 3 rows × 7 in front of the staff
// desks, facing them. The front row is always drawn; a further row's chair only when someone
// sits in it; past 21 they sit half a body over (still one each, all counted).
const CS_COLS = Array.from({ length: 7 }, (_, i) => 1.0 + i * 1.15);
const CS_SEATS: Spot[] = [2.3, 3.3, 4.3].flatMap(z => CS_COLS.map(x => ({ x, z, seated: true, face: 'back' as Face })));
const CS_ALWAYS = CS_COLS.length;

function csSpotOf(i: number): Spot {
  const s = CS_SEATS[i % CS_SEATS.length];
  const lap = Math.floor(i / CS_SEATS.length) * 0.3;
  return { ...s, x: s.x + lap, z: s.z - lap };
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
  // Six motorcycle colours, like the cars: pick(i * 5 + seed) only cycles over a count coprime to 5.
  motos: ['#c9544d', '#2f5d8a', '#e8ecef', '#3f4750', '#d9b44a', '#4f8a5b'], helmet: '#f2f4f5', trousers: '#3c4a5c',
  shirts: ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9c89b8', '#5c677d'],
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

/** One colour baked into a geometry, so parts that keep their own colour merge into one mesh. */
function coloured(geo: BufferGeometry, color: string) {
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return geo;
}

// A motorcycle and its rider along +x, wheels on y = 0. Paint (per instance) = the bike's body
// and the rider's shirt; tyres, seat, handlebar and helmet keep their own colour.
function motoParts() {
  const wheel = (r: number, w: number) => new CylinderGeometry(r, r, w, 14).rotateX(Math.PI / 2);
  const paint = mergeGeometries([
    new BoxGeometry(1.15, 0.26, 0.3).translate(0, 0.42, 0),
    new BoxGeometry(0.26, 0.44, 0.34).translate(-0.14, 0.88, 0),
  ]);
  const fixed = mergeGeometries([
    coloured(wheel(0.26, 0.1).translate(0.6, 0.26, 0), C.tyre),
    coloured(wheel(0.26, 0.1).translate(-0.6, 0.26, 0), C.tyre),
    coloured(new BoxGeometry(0.52, 0.08, 0.28).translate(-0.18, 0.6, 0), '#2a2f35'),
    coloured(new BoxGeometry(0.08, 0.3, 0.52).translate(0.44, 0.72, 0), '#3a4048'),
    coloured(new BoxGeometry(0.36, 0.12, 0.12).translate(0.02, 0.64, 0.14), C.trousers),
    coloured(new BoxGeometry(0.36, 0.12, 0.12).translate(0.02, 0.64, -0.14), C.trousers),
    coloured(new SphereGeometry(0.17, 12, 10).translate(-0.1, 1.27, 0), C.helmet),
  ]);
  return { paint, fixed };
}

// Someone walking, facing +x, feet on y = 0. Paint (per instance) = the shirt. The legs are
// their own piece (one leg, drawn twice per walker) hinged at the hip, so they can swing.
const WALK_HIP = 0.36;
const WALK_LEG_Z = 0.065; // each leg's offset from the middle, across the walking direction
const WALK_STRIDE = 0.8; // m travelled per full step cycle (left + right), so feet don't slide
const WALK_SWING = 0.42; // rad, each leg forward/back at the far end of a step
function walkerParts() {
  const paint = new CylinderGeometry(0.15, 0.19, 0.6, 12).translate(0, 0.66, 0);
  const fixed = mergeGeometries([
    coloured(new SphereGeometry(0.16, 12, 10).translate(0, 1.13, 0), C.skin[1]),
    coloured(new SphereGeometry(0.17, 12, 10).scale(1, 0.75, 1).translate(-0.02, 1.2, 0), C.hair[0]),
  ]);
  // Top at the hinge (y = 0), hanging down to the foot; a darker toe so the swing reads.
  const leg = mergeGeometries([
    coloured(new BoxGeometry(0.1, WALK_HIP - 0.04, 0.11).translate(0, -(WALK_HIP - 0.04) / 2, 0), C.trousers),
    coloured(new BoxGeometry(0.15, 0.05, 0.11).translate(0.025, -WALK_HIP + 0.025, 0), '#2a2f35'),
  ]);
  return { paint, fixed, leg };
}

// A car along +x, wheels on y = 0. Paint is per car; glass, tyres and hubs keep their own colour.
function carParts() {
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

export type Hit = { kind: 'customer'; id: number } | { kind: 'pile'; branchId: number; key: PileKey } | { kind: 'room'; id: number } | { kind: 'hq'; index: number } | ({ kind: 'seat' } & EmptySeat) | { kind: 'stale'; branchId: number; station: Station } | null;

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
  /** Contracts created before today: folder stacks at their step, not people. */
  stale?: StaleRow[];
}

/** A number or word the page prints over the building (Thai stays sharp as HTML). */
export interface HqMark {
  room: number;
  x: number;
  y: number;
  z: number;
  /** What it is, so the page picks the words and the look. */
  kind: 'credit' | 'returned' | 'checked' | 'payout' | 'money' | 'day' | 'deskMore' | 'bubble' | 'bubbleMore' | 'clear';
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

/** One thing moving along a lane: a car, a motorcycle or someone walking. */
interface Mover { lane: number; dir: 1 | -1; speed: number; offset: number }
interface Lane { z: number; dir: 1 | -1; speed: number }
type FleetKind = 'car' | 'moto' | 'walker';
interface Fleet {
  lanes: Lane[];
  items: Mover[];
  meshes: InstancedMesh[];
  capacity: number;
  /** Length along the lane: the on-screen margin when testing whether any is visible. */
  len: number;
  /** Height of each mesh's origin: body, fixed parts, shadow patch just above the ground. */
  ys: number[];
  make: (capacity: number) => InstancedMesh[];
}

/** What the road carries, each a real figure (NOTICE 1635 §2 · work order 2026-11-05 §2):
 *  a car per contract opened today, a motorcycle per ฿100 of retail sales, someone walking
 *  per ฿100 of service fees (rounded down). The legend prints the same numbers. */
export function trafficCounts(branches: SimBranch[]) {
  const sum = (f: (b: SimBranch) => number) => branches.reduce((s, b) => s + (f(b) || 0), 0);
  return {
    cars: sum(b => b.opened.length),
    motos: Math.floor(sum(b => b.retail) / 100),
    walkers: Math.floor(sum(b => b.service) / 100),
  };
}

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
  private posById = new Map<number, [number, number, number]>();
  // Tapped-person feedback (owner 11-11): floor point of every drawn person (chatters by
  // their negated contract id, as in customerIds), the hair mesh so a hop moves the whole
  // figure, the ring under the person whose window is open, and the hop's own frame loop.
  private floorById = new Map<number, [number, number, number]>();
  private hairMesh: InstancedMesh | null = null;
  private selRing: Mesh | null = null;
  private hopRaf = 0;
  private moreList: MoreMark[] = [];
  private staleList: StalePile[] = [];
  private staleMesh: InstancedMesh | null = null;
  private staleOwner: number[] = [];
  private seatPlane = new Plane(new Vector3(0, 1, 0), -(LOT_Y + SLAB + 0.42));
  private pileList: PilePlace[] = [];
  private ray = new Raycaster();
  private floorPlane = new Plane(new Vector3(0, 1, 0), -SLAB);
  private plan: Plan;
  private fleets = {} as Record<FleetKind, Fleet>;
  private trafficRoot: Group | null = null;
  /** False under prefers-reduced-motion: the traffic stands still (and can still be counted). */
  private motion = true;
  private span = 1;
  private spanStart = 0;
  private raf = 0;
  private sized = false;
  private view = { k: 1, x: 0, y: 0, w: 1, h: 1 };
  private trafficWasVisible = true;
  private canvas: HTMLCanvasElement;
  private type: CompanyType | undefined;
  /** Envelopes and bank notes in the air (HTML), moved in the cars' frame loop. */
  private flights: FlightLayer | null = null;
  private hqData: SimHq | null = null;
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
    // Traffic starts and ends at the two ends of the drawn road, the edges of the map: ending
    // just past the frontage made cars grow in and shrink away in plain view (owner 11-11).
    this.buildTraffic(root, spanStart, span, roadZ, fd);

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

  // What moves on the road is a count, not decoration: each thing is a real figure
  // (trafficCounts), spaced evenly — never at random — so it can be counted off the screen,
  // and only along the shops' frontage so all of it is on screen at once. No figure, none.
  // Cars in the two middle lanes, motorcycles in a lane hugging each kerb, people on the
  // two footpaths. Thailand drives on the left: looking along +x the left is -z, so the
  // near side runs +x.
  private buildTraffic(root: Group, spanStart: number, span: number, roadZ: number, fd: number) {
    this.span = span;
    this.spanStart = spanStart;
    this.trafficRoot = root;
    const fleet = (lanes: Lane[], len: number, ys: number[], make: (cap: number) => InstancedMesh[]): Fleet =>
      ({ lanes, items: [], meshes: [], capacity: 0, len, ys, make });
    this.fleets = {
      car: fleet([{ z: roadZ + ROAD_D * 0.25, dir: 1, speed: 5.2 }, { z: roadZ + ROAD_D * 0.75, dir: -1, speed: 4.4 }],
        CAR_LEN, [0.04, 0.04, 0.07], cap => this.carMeshes(cap)),
      moto: fleet([{ z: roadZ + MOTO_IN, dir: 1, speed: 6.4 }, { z: roadZ + ROAD_D - MOTO_IN, dir: -1, speed: 5.8 }],
        MOTO_LEN, [0.04, 0.04, 0.07], cap => this.motoMeshes(cap)),
      walker: fleet([{ z: fd + FOOT / 2, dir: 1, speed: 1.15 }, { z: roadZ + ROAD_D + FOOT / 2, dir: -1, speed: 1.0 }],
        WALKER_LEN, [FOOT_Y, FOOT_Y, FOOT_Y + 0.02], cap => this.walkerMeshes(cap)),
    };
    this.allocate('car', CAR_CAPACITY);
    this.allocate('moto', 32);
    this.allocate('walker', 32);
  }

  /** Instanced meshes for up to `capacity` of a fleet; only as many as it has are drawn. */
  private allocate(kind: FleetKind, capacity: number) {
    const root = this.trafficRoot;
    const f = this.fleets[kind];
    if (!root || !f) return;
    f.meshes.forEach(m => { root.remove(m); m.dispose(); });
    f.meshes = f.make(capacity);
    f.meshes.forEach(m => {
      m.frustumCulled = false;
      m.castShadow = false;
      m.count = f.items.length * (kind === 'walker' && m === f.meshes[3] ? 2 : 1);
      root.add(m);
    });
    f.capacity = capacity;
  }

  /** Painted part (a colour per instance), fixed parts (vertex colours), a soft patch under it —
   *  moving things are not in the static shadow map, so each carries its own. */
  private moverMeshes(capacity: number, paint: BufferGeometry, fixed: BufferGeometry, patch: BufferGeometry, colours: string[], seed: number) {
    const paintMat = new MeshLambertMaterial({ color: '#ffffff' });
    const fixedMat = new MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    const patchMat = new MeshBasicMaterial({ color: '#10161a', transparent: true, opacity: 0.2, depthWrite: false });
    const painted = new InstancedMesh(paint, paintMat, capacity);
    for (let i = 0; i < capacity; i++) painted.setColorAt(i, new Color(pick(colours, i * 5 + seed)));
    this.owned.push(paint, fixed, patch, paintMat, fixedMat, patchMat);
    return [painted, new InstancedMesh(fixed, fixedMat, capacity), new InstancedMesh(patch, patchMat, capacity)];
  }

  private carMeshes(capacity: number) {
    const { paint, fixed } = carParts();
    return this.moverMeshes(capacity, paint, fixed, new PlaneGeometry(CAR_LEN + 0.25, 1.5).rotateX(-Math.PI / 2), C.cars, 2);
  }

  private motoMeshes(capacity: number) {
    const { paint, fixed } = motoParts();
    return this.moverMeshes(capacity, paint, fixed, new PlaneGeometry(MOTO_LEN, 0.55).rotateX(-Math.PI / 2), C.motos, 1);
  }

  /** [shirt, head + hair, shadow patch, legs] — the legs mesh holds two instances per walker. */
  private walkerMeshes(capacity: number) {
    const { paint, fixed, leg } = walkerParts();
    const meshes = this.moverMeshes(capacity, paint, fixed, new CircleGeometry(0.28, 16).rotateX(-Math.PI / 2), C.shirts, 3);
    const legMat = new MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    this.owned.push(leg, legMat);
    return [...meshes, new InstancedMesh(leg, legMat, capacity * 2)];
  }

  /** n of a fleet, split over its two lanes with even gaps. */
  private setCount(kind: FleetKind, n: number) {
    const f = this.fleets[kind];
    if (!f || n === f.items.length) return;
    f.items = [];
    f.lanes.forEach((l, lane) => {
      // Lane 0 takes the odd one out.
      const inLane = lane === 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
      for (let j = 0; j < inLane; j++) {
        // Even gaps in each lane; the second lane is shifted half a gap so the two don't pair up.
        const offset = ((j + (lane === 0 ? 0 : 0.5)) * this.span) / Math.max(inLane, 1);
        f.items.push({ lane: l.z, dir: l.dir, speed: l.speed, offset });
      }
    });
    if (n > f.capacity) this.allocate(kind, Math.max(n, f.capacity * 2));
    f.meshes.forEach(m => { m.count = f.items.length * (m === this.walkerLegs() ? 2 : 1); });
    this.trafficWasVisible = true;
    this.placeTraffic(this.motion ? performance.now() / 1000 : 0);
  }

  private walkerLegs() { return this.fleets.walker?.meshes[3]; }

  private placeTraffic(seconds: number) {
    const mat = new Matrix4();
    const pos = new Vector3();
    const scale = new Vector3(1, 1, 1);
    const flip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const none = new Quaternion();
    // Walking (owner 11-11): legs swing, the body rises a little on each step and rocks from
    // side to side. All of it is a function of distance walked, so steps match the speed.
    const base = new Matrix4();
    const local = new Matrix4();
    const turn = new Quaternion();
    const lean = new Quaternion();
    const upper = new Quaternion();
    const axisX = new Vector3(1, 0, 0);
    const axisY = new Vector3(0, 1, 0);
    const axisZ = new Vector3(0, 0, 1);
    Object.entries(this.fleets).forEach(([kind, f]) => {
      const walking = kind === 'walker';
      f.items.forEach((c, i) => {
        const travelled = c.offset + c.speed * seconds;
        const run = travelled % this.span;
        const x = this.spanStart + (c.dir > 0 ? run : this.span - run);
        // Arriving at one end and leaving at the other, rather than popping in and out.
        const s = Math.min(1, Math.max(0.001, Math.min(run, this.span - run) / CAR_FADE));
        scale.set(s, s, s);
        const heading = c.dir > 0 ? none : flip;
        if (!walking) {
          f.meshes.forEach((m, k) => {
            pos.set(x, f.ys[k], c.lane);
            m.setMatrixAt(i, mat.compose(pos, heading, scale));
            m.instanceMatrix.needsUpdate = true;
          });
          return;
        }
        // Phase from distance, offset per walker so they don't step in unison.
        const phase = (travelled / WALK_STRIDE) * Math.PI * 2 + i * 1.7;
        const step = Math.sin(phase);
        const bob = 0.035 * Math.abs(Math.cos(phase)); // highest as the legs pass each other
        // Upper body: a small roll toward the standing leg, a slight twist, and leaning in.
        turn.setFromAxisAngle(axisX, 0.07 * step)
          .multiply(lean.setFromAxisAngle(axisY, 0.09 * step))
          .multiply(lean.setFromAxisAngle(axisZ, -0.05));
        upper.copy(heading).multiply(turn);
        f.meshes.forEach((m, k) => {
          if (k === 3) return; // legs below
          const lift = k === 2 ? 0 : bob * s; // the shadow patch stays on the ground
          pos.set(x, f.ys[k] + lift, c.lane);
          m.setMatrixAt(i, mat.compose(pos, k === 2 ? heading : upper, scale));
          m.instanceMatrix.needsUpdate = true;
        });
        const legs = f.meshes[3];
        base.compose(pos.set(x, f.ys[0] + bob * s, c.lane), heading, scale);
        for (let j = 0; j < 2; j++) {
          const swing = WALK_SWING * (j === 0 ? step : -step);
          local.compose(pos.set(0, WALK_HIP, j === 0 ? WALK_LEG_Z : -WALK_LEG_Z), lean.setFromAxisAngle(axisZ, swing), scale.set(1, 1, 1));
          legs.setMatrixAt(i * 2 + j, mat.multiplyMatrices(base, local));
        }
        scale.set(s, s, s);
        legs.instanceMatrix.needsUpdate = true;
      });
    });
  }

  private trafficVisible(seconds: number) {
    const { k, x, y, w, h } = this.view;
    return Object.values(this.fleets).some(f => {
      const margin = f.len * PX * k;
      return f.items.some(c => {
        const run = (c.offset + c.speed * seconds) % this.span;
        const [px, py] = project(this.spanStart + (c.dir > 0 ? run : this.span - run), 0, c.lane);
        const sx = x + px * k;
        const sy = y + py * k;
        return sx > -margin && sx < w + margin && sy > -margin && sy < h + margin;
      });
    });
  }

  /** Starts the traffic. rAF stops by itself while the page is hidden. */
  start() {
    this.motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.raf || !this.motion) return;
    const frame = (t: number) => {
      this.raf = requestAnimationFrame(frame);
      // Flights are DOM over the canvas: moving them needs no WebGL redraw.
      this.flights?.tick(t, this.view);
      // Every display frame: a 30 fps cap chosen by elapsed time skipped frames unevenly
      // (one, then two), so the cars moved in uneven steps and the road looked jerky.
      // Nothing moving on screen: nothing has changed, so don't draw at all.
      const visible = this.trafficVisible(t / 1000);
      if (!visible && !this.trafficWasVisible) return;
      this.trafficWasVisible = visible;
      this.placeTraffic(t / 1000);
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
  setLive({ branches, customers, picked, showChat = false, chatters = [], hq = null, stale = [] }: LiveState) {
    const traffic = trafficCounts(branches);
    this.setCount('car', traffic.cars);
    this.setCount('moto', traffic.motos);
    this.setCount('walker', traffic.walkers);
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
    this.posById = new Map();
    this.floorById = new Map();
    this.moreList = [];
    const chairs = new Batch(UNIT_BOX, this.lambert);
    // Station by station, so the outside line fills in the order a contract moves.
    const ordered = [...customers].sort((a, b) => a.branchId - b.branchId
      || STATION_ORDER.indexOf(a.station) - STATION_ORDER.indexOf(b.station) || a.spot - b.spot);
    const outsideNext = new Map<number, number>();
    const outsideMore = new Map<number, number>();
    ordered.forEach((c, i) => {
      const r = byId.get(c.branchId);
      if (!r) return;
      let s: Spot;
      if (c.spot < zoneLimit(r.type, c.station) + QUEUE[c.station].length) {
        s = spotOf(r.type, c.station, c.spot);
      } else {
        const k = outsideNext.get(r.id) ?? 0;
        outsideNext.set(r.id, k + 1);
        if (k >= OUTSIDE.length) {
          outsideMore.set(r.id, (outsideMore.get(r.id) ?? 0) + 1);
          return;
        }
        s = { x: OUTSIDE[k][0], z: OUTSIDE[k][1], seated: false, face: 'back' };
      }
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
      this.posById.set(c.id, [x, headY + HEAD_R * 1.1, r.oz + s.z]);
      this.floorById.set(c.id, [x, y, r.oz + s.z]);
    });
    outsideMore.forEach((n, id) => {
      const r = byId.get(id);
      if (r) this.moreList.push({ branchId: id, kind: 'outside', n, x: r.ox + 0.25, y: 1.3, z: r.oz + RD + 1.0 });
    });

    // Chat corner (§6g): not counted as standing and doesn't colour the floor.
    if (showChat) {
      const corner = new Batch(UNIT_BOX, this.lambert);
      this.plan.rooms.forEach(r => {
        box(corner, r.ox + CHAT_PATCH.x, y, r.oz + CHAT_PATCH.z, CHAT_PATCH.w, 0.015, CHAT_PATCH.d, CHAT_SEAT.floor);
        for (const s of CHAT_SEATS.slice(0, CHAT_ALWAYS)) this.seat(corner, r.ox + s.x, r.oz + s.z, s.face, CHAT_SEAT.seat, CHAT_SEAT.base);
      });
      // The customer-service rooms' front row, always there (only once there is a building).
      const hqRooms = this.plan.hq?.rooms ?? [];
      hq?.pools.forEach((p, ri) => {
        const room = hqRooms[ri];
        if (p.kind !== 'CUSTOMER_SERVICE' || !room) return;
        for (const s of CS_SEATS.slice(0, CS_ALWAYS)) this.seat(corner, room.ox + s.x, room.oz + s.z, s.face, CHAT_SEAT.seat, CHAT_SEAT.base);
      });
      const chatMore = new Map<number, number>();
      chatters.forEach((c, i) => {
        const room = c.room != null ? hqRooms[c.room] : undefined;
        if (room) {
          const s = csSpotOf(c.spot);
          if (c.spot >= CS_ALWAYS && c.spot < CS_SEATS.length) this.seat(corner, room.ox + s.x, room.oz + s.z, s.face, CHAT_SEAT.seat, CHAT_SEAT.base);
          const base = y + 0.42;
          const x = room.ox + s.x;
          const z = room.oz + s.z - 0.03;
          bodies.add(x, base + SIT_H / 2, z, BODY_R, SIT_H, BODY_R, CHAT_COLOR);
          const headY = base + SIT_H + HEAD_R * 0.85;
          heads.add(x, headY, z, HEAD_R, HEAD_R, HEAD_R, pick(C.skin, c.id + i));
          hair.add(x, headY + HEAD_R * 0.3, z - 0.015, HEAD_R * 1.05, HEAD_R * 0.85, HEAD_R * 1.05, pick(C.hair, c.id * 3 + 2));
          box(corner, x + BODY_R - 0.02, base + SIT_H * 0.62, z - 0.07, 0.04, 0.22, 0.14, C.phone);
          this.customerIds.push(-c.id);
          this.floorById.set(-c.id, [x, y, room.oz + s.z]);
          return;
        }
        if (c.room != null) return; // a room that isn't drawn: nowhere to sit, never back in the shop
        const r = byId.get(c.branchId);
        if (!r) return;
        if (c.spot >= CHAT_DRAWN) {
          chatMore.set(r.id, (chatMore.get(r.id) ?? 0) + 1);
          return;
        }
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
        this.floorById.set(-c.id, [x, y, r.oz + s.z]);
      });
      if (corner.size) corner.build(this.live);
      chatMore.forEach((n, id) => {
        const r = byId.get(id);
        if (r) this.moreList.push({ branchId: id, kind: 'chat', n, x: r.ox + CHAT_PATCH.x + CHAT_PATCH.w + 0.35, y: 1.3, z: r.oz + RD - 1.15 });
      });
    }

    // Contracts left from earlier days: a stack of folders at their step (one per contract).
    this.staleList = [];
    this.staleOwner = [];
    const staleBatch = new Batch(UNIT_BOX, this.lambert);
    const groups = new Map<string, StaleRow[]>();
    stale.forEach(s => {
      const key = `${s.branchId}:${s.station}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    });
    groups.forEach(rows => {
      const r = byId.get(rows[0].branchId);
      if (!r) return;
      const at = STALE_AT[rows[0].station];
      const base = y + at.base;
      const k = Math.min(rows.length, STALE_CAP);
      const owner = this.staleList.length;
      for (let i = 0; i < k; i++) {
        box(staleBatch, r.ox + at.x, base + i * FOLDER_H, r.oz + at.z, at.w, FOLDER_H * 0.82, at.d, i % 2 ? '#e3d3a8' : '#cdb98a');
        this.staleOwner.push(owner);
      }
      this.staleList.push({
        branchId: r.id, station: rows[0].station, n: rows.length, oldest: Math.max(...rows.map(x => x.age)),
        x: r.ox + at.x + at.w / 2, y: base + k * FOLDER_H, z: r.oz + at.z + at.d / 2,
      });
    });
    this.staleMesh = staleBatch.size ? staleBatch.build(this.live) : null;
    if (chairs.size) chairs.build(this.live);
    this.bodies = bodies.size ? bodies.build(this.live) : null;
    this.heads = heads.size ? heads.build(this.live) : null;
    cancelAnimationFrame(this.hopRaf); // a hop's saved matrices belong to the meshes being replaced
    this.hairMesh = hair.size ? hair.build(this.live) : null;

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
    chatters.forEach(c => { if (c.room == null) taken.add(`${c.branchId}:chat:${c.spot}`); });
    this.plan.rooms.forEach(r => {
      WAIT_SEATS.slice(0, waitAlways(r.type)).forEach((s, i) => {
        if (!taken.has(`${r.id}:wait:${i}`)) this.emptySeats.push({ branchId: r.id, zone: 'wait', x: r.ox + s.x, z: r.oz + s.z });
      });
      if (showChat) CHAT_SEATS.slice(0, CHAT_ALWAYS).forEach((s, i) => {
        if (!taken.has(`${r.id}:chat:${i}`)) this.emptySeats.push({ branchId: r.id, zone: 'chat', x: r.ox + s.x, z: r.oz + s.z });
      });
    });

    this.hqMarkList = [];
    this.hqData = hq;
    if (hq && this.plan.hq) this.drawHq(hq);

    this.renderer.shadowMap.needsUpdate = true;
  }

  hqMarks() { return this.hqMarkList; }
  moreMarks() { return this.moreList; }
  stalePiles() { return this.staleList; }

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
        stack(ox + 0.8, oz + 2.14, pool.waiting, HQ_COLOR.waiting, 0.5, 0.62, y + 0.45);
        // No count over the tray: the room tag already shows the same number ('n รอตรวจ'),
        // and from the camera the tray sits right under the tag, so the count covered it.
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
      } else if (pool.unread === 0) {
        // Customer service: the customers waiting sit in the room with their unread count
        // over their heads (setLive) — the floating bubbles are gone. Nothing unread: say so.
        mark({ room: ri, x: ox + HQ_RW / 2, y: 0.12, z: oz + 5.2, kind: 'clear', value: 0 });
      }
    });
    if (things.size) things.build(this.live);
    if (bodies.size) bodies.build(this.live);
    if (balls.size) balls.build(this.live);
  }

  piles() { return this.pileList; }

  /** The flight layer this world moves each frame (it outlives a rebuilt world). */
  setFlights(layer: FlightLayer | null) { this.flights = layer; }

  /** Where a flight leaves or lands in a shop: approval chairs, cashier's desk, or the "paid out" pile. */
  shopPoint(branchId: number, at: 'approval' | 'cashier' | 'paid'): [number, number, number] | null {
    const r = this.plan.rooms.find(p => p.id === branchId);
    if (!r) return null;
    if (at === 'paid') {
      const p = this.pileList.find(x => x.branchId === branchId && x.key === 'payout');
      if (p) return [p.x, p.h + 0.3, p.z];
    }
    if (at === 'approval') return [r.ox + WAIT_COLS[2], 1.3, r.oz + 5.6];
    return [r.ox + 9, LOT_Y + SLAB + 1.1, r.oz + 1.35];
  }

  /** Where a flight leaves or lands in a pool room: the tray, or a day column's folders / money box.
   *  A date not among the columns goes to the older-backlog column ("") when there is one, else the tray. */
  hqPoint(poolId: number, at: 'tray' | 'folders' | 'money', day?: string): [number, number, number] | null {
    const place = this.plan.hq;
    const ri = this.hqData?.pools.findIndex(p => p.id === poolId) ?? -1;
    const pool = this.hqData?.pools[ri];
    const r = place?.rooms[ri];
    if (!pool || !r) return null;
    const y = LOT_Y + SLAB;
    const tray: [number, number, number] = [r.ox + 1.05, y + 0.8, r.oz + 2.45];
    if (at === 'tray' || day == null) return tray;
    let di = pool.days.findIndex(d => d.day === day);
    if (di < 0 && pool.kind === 'PAYOUT') di = pool.days.findIndex(d => d.day === '');
    if (di < 0) return tray;
    if (pool.kind === 'CREDIT') return [r.ox + 2.4 + di * 1.6, y + 0.5, r.oz + 4.05];
    const cx = r.ox + 1.95 + di * 1.4;
    return at === 'money' ? [cx, y + 0.8, r.oz + 4.65] : [cx, y + 0.5, r.oz + 3.9];
  }

  /** The ring on the floor under the person whose window is open; null hides it. `id` is the
   *  contract id, negated for someone waiting for a chat reply (as in customerIds). Call again
   *  after setLive: the person may have moved, or left the picture (the ring goes). */
  setSelected(id: number | null) {
    const at = id == null ? undefined : this.floorById.get(id);
    if (!at) {
      if (this.selRing?.visible) { this.selRing.visible = false; this.render(); }
      return;
    }
    if (!this.selRing) {
      // A flat overlay: lifted off the floor, depth offset, no depth write (threejs-guide).
      const geo = new RingGeometry(0.34, 0.5, 40).rotateX(-Math.PI / 2);
      const mat = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.selRing = new Mesh(geo, mat);
      this.selRing.renderOrder = 2;
      // In a crowd the people in front hide most of the ring: a faint copy drawn through them
      // keeps the whole ring readable, the solid one still sits under the feet.
      const ghostMat = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
      const ghost = new Mesh(geo, ghostMat);
      ghost.renderOrder = 3;
      this.selRing.add(ghost);
      this.owned.push(geo, mat, ghostMat);
      this.live.parent?.add(this.selRing);
    }
    this.selRing.position.set(at[0], at[1] + 0.025, at[2]);
    this.selRing.visible = true;
    this.render();
  }

  /** A tapped person squashes and hops once (~0.3 s), so the finger sees who it hit. Only that
   *  person's three instances move; their own frame loop, so it runs with the traffic idle. */
  hop(id: number) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const i = this.customerIds.indexOf(id);
    const body = this.bodies;
    const head = this.heads;
    const hair = this.hairMesh;
    if (i < 0 || !body || !head || !hair) return;
    cancelAnimationFrame(this.hopRaf);
    const orig = [body, head, hair].map(m => { const mt = new Matrix4(); m.getMatrixAt(i, mt); return mt; });
    const p = new Vector3();
    const q = new Quaternion();
    const sc = new Vector3();
    const m4 = new Matrix4();
    orig[0].decompose(p, q, sc);
    const bodyH = sc.y;
    const bottom = p.y - bodyH / 2; // the unit body is centred on its origin
    const t0 = performance.now();
    const step = (now: number) => {
      if (this.bodies !== body) return; // rebuilt by setLive meanwhile
      const t = Math.min(1, (now - t0) / HOP_MS);
      let f = 1; // body height factor: squash, stretch, settle
      let jump = 0;
      if (t < 0.25) f = 1 - 0.12 * (t / 0.25);
      else if (t < 0.6) { const u = (t - 0.25) / 0.35; f = 0.88 + 0.18 * u; jump = HOP_UP * Math.sin((u * Math.PI) / 2); }
      else { const u = (t - 0.6) / 0.4; f = 1.06 - 0.06 * u; jump = HOP_UP * Math.cos((u * Math.PI) / 2); }
      if (t >= 1) { f = 1; jump = 0; }
      orig[0].decompose(p, q, sc);
      sc.y = bodyH * f;
      p.y = bottom + sc.y / 2 + jump;
      body.setMatrixAt(i, m4.compose(p, q, sc));
      const lift = bodyH * (f - 1) + jump;
      [head, hair].forEach((m, k) => {
        orig[k + 1].decompose(p, q, sc);
        p.y += lift;
        m.setMatrixAt(i, m4.compose(p, q, sc));
        m.instanceMatrix.needsUpdate = true;
      });
      body.instanceMatrix.needsUpdate = true;
      this.render();
      if (t < 1) this.hopRaf = requestAnimationFrame(step);
    };
    this.hopRaf = requestAnimationFrame(step);
  }

  /** Head-top position of a customer, for a label. */
  customerAt(c: SeatedCustomer): [number, number, number] | null {
    // Where setLive actually put them — inside, in the queue, or out of the door; null = in a "+n".
    return this.posById.get(c.id) ?? null;
  }

  /** Head-top position of someone in the chat corner, for the unread bubble. */
  chatAt(c: ChatSeat): [number, number, number] | null {
    if (c.room != null) {
      const room = this.plan.hq?.rooms[c.room];
      if (!room) return null;
      const s = csSpotOf(c.spot);
      return [room.ox + s.x, 0.11 + 0.42 + SIT_H + HEAD_R * 2, room.oz + s.z];
    }
    const r = this.plan.rooms.find(p => p.id === c.branchId);
    if (!r) return null;
    if (c.spot >= CHAT_DRAWN) return null;
    const s = chatSpotOf(c.spot);
    return [r.ox + s.x, 0.11 + (s.seated ? 0.42 + SIT_H : STAND_H) + HEAD_R * 2, r.oz + s.z];
  }

  /** Pan and zoom in screen pixels: a point at project() p lands at (x + p.x·k, y + p.y·k). */
  setView(k: number, x: number, y: number, width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.view = { k, x, y, w: width, h: height };
    this.trafficWasVisible = true;
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
    test(this.staleMesh, i => {
      const p = this.staleList[this.staleOwner[i]];
      return { kind: 'stale', branchId: p.branchId, station: p.station };
    });
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
    return { frames: this.renderer.info.render.frame, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, near: this.camera.near, far: this.camera.far, piles: this.pileList.length, customers: this.customerIds.length, cars: this.fleets.car?.items.length ?? 0, carsDrawn: this.fleets.car?.meshes[0]?.count ?? 0, motos: this.fleets.moto?.items.length ?? 0, walkers: this.fleets.walker?.items.length ?? 0 };
  }

  dispose() {
    cancelAnimationFrame(this.hopRaf);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.flights = null;
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.live.children.forEach(ch => (ch as InstancedMesh).dispose?.());
    this.owned.forEach(o => o.dispose());
    Object.values(this.fleets).forEach(f => f.meshes.forEach(m => m.dispose()));
    this.lambert.dispose();
    this.crown.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
