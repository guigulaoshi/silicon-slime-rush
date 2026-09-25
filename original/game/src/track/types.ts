// Mirrors pipeline/sr/schema/track.schema.json. The schema is the source of truth;
// loadTrack() validates against it at load time so drift shows up as an error, not a crash later.
export type Vec3 = [number, number, number];
export type Text = { zh: string; en: string };
/**
 * Historical track field kept because the contract is add-only. Since we tracks
 * are not classed: every one is timed and rated, and the runtime reads this for nothing.
 */
export type Category = 'race' | 'scenic' | 'campus' | 'mission';
export type Mode = 'loop' | 'p2p' | 'multistop';
/**
 * Two times of day, not six.
 *
 * Six was a palette nobody was choosing from: five of them were the same picture with the sun a
 * few degrees apart, and the one that actually looked different -- the dark one -- did not exist.
 * Day and night are the two the player can tell apart from the driving seat.
 */
export type TimeOfDay = 'day' | 'night';
export type CarKind = 'sedan' | 'super' | 'convertible' | 'hatch';
export type Edition = 'web' | 'full';

export interface Checkpoint { s: number; pos: Vec3; dir: Vec3; halfWidth: number; label?: Text; stop?: boolean }
/**
 * One tile: a byte range inside the track's tile pack, not a file of its own.
 *
 * `name` is the grid cell (`t_-8_-6`) and is what a log line or an error says. It is also the key
 * the streamer, the collider sink and the load plan agree on -- one identifier, not a path that
 * happens to be unique.
 */
/** `offset`/`length` exist only in the packed shape; loose tiles are addressed by `name`. */
export interface TileRef { name: string; offset?: number; length?: number; sRanges: [number, number][]; bounds: [Vec3, Vec3] }
export interface TilePack { file: string; bytes: number }
export interface LandmarkRef { id: string; file: string; pos: Vec3; yaw: number; loadRadius: number; collision?: boolean }
export interface TrafficSpec { density: number; lanes: { offset: number; dir: 1 | -1 }[]; speedKmh: [number, number]; oncoming: boolean }

export interface TrackData {
  id: string;
  version: number;
  editions: Edition[];
  category: Category;
  mode: Mode;
  laps: number;
  name: Text;
  blurb: Text;
  story?: Text;
  origin: { lat: number; lon: number };
  timeOfDay: TimeOfDay;
  car: CarKind;
  /** Route override for scenery whose vertical separation is otherwise hidden by the default view. */
  camera?: { heightM: number };
  spline: { points: Vec3[]; s?: number[]; halfWidth: number[]; curvature?: number[]; closed: boolean; length: number };
  /** Non-racing road continuations; both paths point outward from the timing line. */
  endRoads?: { start: TrackData['spline']; finish: TrackData['spline'] };
  start: { pos: Vec3; yaw: number };
  checkpoints: Checkpoint[];
  tiles: TileRef[];
  /**
   * Present only in what the web build ships: every tile in one file, addressed by byte range.
   *
   * Absent means the tiles are loose at `tiles/<name>.glb`, which is what the pipeline writes and
   * what `npm run dev` serves. The runtime reads whichever shape the document describes.
   */
  tilePack?: TilePack;
  /** the resident distant-scenery mesh, and how far out it reaches: fog is set from that */
  backdrop?: { file: string; radiusM: number; horizonRadiusM?: number };
  /** street network for the map panels, loaded separately; see ui/MiniMap */
  map?: { file: string };
  landmarks?: LandmarkRef[];
  traffic?: TrafficSpec;
  items?: { file: string };
  rival?: { paceKmh: number };
  wind?: { sRange: [number, number]; gustN: number; periodS: number };
  countdown?: { seconds: number };
  attribution: string[];
}

/** One complete 7 owner-ad / 7 available-space cycle. Geometry carries only this content slot. */
export const BILLBOARD_SLOTS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
] as const;
export type BillboardSlot = (typeof BILLBOARD_SLOTS)[number];
export const billboardFaceMaterial = (slot: BillboardSlot) => `billboard_face_${slot}` as const;

/**
 * Material names the runtime material library must provide, in the order docs/CONTRACT.md lists
 * them. A test reads that list back out of the document, because tiles ship material names rather
 * than textures and a name the library has never heard of renders magenta.
 */
export const MATERIAL_NAMES = ['road', 'terrain',
  // the ground by what it is made of, one node each in the tiles
  'terrain_grass', 'terrain_scrub', 'terrain_wood', 'terrain_sand', 'terrain_rock',
  'terrain_saltpond', 'terrain_paved',
  'water', 'building', 'barrier', 'bridge',
  'billboard_frame', 'billboard_lamp', ...BILLBOARD_SLOTS.map(billboardFaceMaterial),
  'line_white', 'line_yellow', 'bridge_steel', 'bridge_metal', 'foliage', 'foliage_dark', 'foliage_palm',
  'foliage_orchard', 'foliage_scrub', 'trunk', 'guardrail', 'sidewalk',
  'flower_pink', 'flower_white', 'flower_blue', 'flower_purple', 'slime_scenery',
  // Facades. `building` above is the fallback and the only one that gets the procedural window
  // grid; these five carry their windows in their own texture. docs/CONTRACT.md section 4.
  'building_glass', 'building_stucco', 'building_concrete', 'building_metal',
  'building_parking', 'building_landmark_glass', 'building_landmark_pale',
  'building_landmark_solar', 'building_landmark_metal',
  'house_roof_slate', 'house_roof_tile', 'house_trim', 'building_landmark_roof'] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** Node-name prefixes in tile GLBs and the collider each implies. */
export const NODE_COLLIDERS = {
  road: 'trimesh',
  terrain: 'trimesh',
  water: 'none',
  buildings: 'boxes',
  bridge: 'trimesh',
  guardrail: 'trimesh',
  props_barrier: 'instances-box',
  props_billboard: 'none',
  props_slime: 'none',
  markings: 'none',
  bridgeworks: 'none',
  sidewalk: 'none',
  backdrop: 'none',
  trees: 'none',
  flowers: 'none',
  scenery: 'none',
  deck: 'trimesh',
} as const;

export const ITEM_TYPES = ['coffee', 'charge', 'options', 'pothole', 'stalled_robotaxi', 'cones'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
