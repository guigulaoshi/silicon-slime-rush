import { legacyStarRating, type StarRating } from '../track/Rating';
import { ghostFrames, MAX_GHOST_STORAGE, MAX_GHOSTS, type GhostData } from './Ghost';
import { indexedDbGhostStore, type GhostStore } from './GhostStore';
import { languagePreference, type Language } from '../ui/i18n';
import type { Quality } from '../world/World';
import { CAMERA_MODES, type CameraMode } from '../world/ChaseCamera';
import type { TimeOfDay } from '../track/types';
import { vehicleFor } from '../vehicles/catalogue';
import garage from '../vehicles/catalogue.json' with { type: 'json' };
import { aiDifficulty, type AiDifficulty } from '../bot/difficulty';
import { achievementIds, type AchievementId, type LastRaceChoice, type ProgressData } from './Progression';
import { WEATHERS, type Weather } from '../world/Sky';
import { cleanPlayerName } from './playerName';

export type SlimeDensity = 'none' | 'normal' | 'many';

export interface SaveData {
  version: number;
  language: Language | null;
  quality: Quality | 'auto';
  volume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  /** Each local driver's remembered race view. */
  cameraModes: [CameraMode, CameraMode];
  helpDismissed: boolean;
  /** Races whose countdown has played the phone drag-to-steer hint. */
  touchGuideRaces: number;
  /** Road and scenery populations share this density setting. */
  slimeDensity: SlimeDensity;
  /** Whether a solo race shows the personal-best ghost; off by default. Best runs are still recorded when off. */
  showGhost: boolean;
  aiDifficulty: AiDifficulty;
  /** Null until a player chooses: each track supplies its own default. */
  timeOfDay: TimeOfDay | null;
  weather: Weather;
  vehicles: Record<string, string>;
  /** Best time per route and vehicle (`recordKey`), seconds. */
  best: Record<string, number>;
  /** Replays in memory; since version 15 they are kept in a `GhostStore`, not in this JSON. */
  ghosts: Record<string, GhostData>;
  ratings: Record<string, StarRating>;
  totalSlimeHits: number;
  bestRunSlimeHits: number;
  achievements: AchievementId[];
  lastRace: LastRaceChoice | null;
  /** Optional nicknames for the left and right driver, printed on what they share. */
  names: [string, string];
}

export const SAVE_VERSION = 16;
export const SAVE_KEY = 'silicon-rush.save.v1';

export const DEFAULT_SAVE: SaveData = {
  version: SAVE_VERSION,
  language: null,
  quality: 'auto',
  volume: 0.7,
  musicVolume: 0.5,
  effectsVolume: 1,
  muted: false,
  reducedMotion: false,
  cameraModes: ['chase', 'chase'],
  helpDismissed: false,
  touchGuideRaces: 0,
  // A new player starts on the most slimes.
  slimeDensity: 'many',
  showGhost: false,
  // And the field a new player meets drives on the easy tier.
  aiDifficulty: 'relaxed',
  timeOfDay: null,
  weather: 'clear',
  vehicles: {},
  best: {},
  ghosts: {},
  ratings: {},
  totalSlimeHits: 0,
  bestRunSlimeHits: 0,
  achievements: [],
  lastRace: null,
  names: ['', ''],
};

/**
 * Where a best time, its star rating and its ghost are filed: the route (`raceKey`) and the vehicle.
 *:「五星、幽灵车，都按车种」 -- a sports car's ghost never races a monster truck.
 */
export function recordKey(route: string, vehicleId: string): string {
  return `${route}@${vehicleId}`;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Shared read-only entry for the HTML startup shell and the game save owner. */
export function readSavedData(storage: Pick<Storage, 'getItem'> | null, key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Best times and preferences, in the browser's own storage.
 *
 * Everything is written through one object with a version on it. Later versions read older saves and
 * migrate; a save that cannot be understood is replaced rather than half-read, because a corrupt
 * best time is worse than no best time.
 */
export class Save {
  private data: SaveData;
  /** When each replay was recorded, for eviction; replays loaded from JSON count as oldest. */
  private readonly ghostAt = new Map<string, number>();
  /** Keys this page load has already written, which a slower disk load must not overwrite. */
  private readonly ghostTouched = new Set<string>();
  /** Replays still written into the JSON because the store has not confirmed it holds them. */
  private jsonGhosts: Record<string, GhostData> | null = null;
  private clock = 0;
  /** Settles once stored replays are in memory; a race waits for it before asking for its ghost. */
  readonly ghostsReady: Promise<void>;

  constructor(private readonly storage: Storage | null = safeStorage(),
    private readonly ghostStore: GhostStore | null = storage ? indexedDbGhostStore() : null) {
    this.data = this.load();
    if (Object.keys(this.data.ghosts).length) this.jsonGhosts = { ...this.data.ghosts };
    this.ghostsReady = this.loadGhosts();
  }

  private async loadGhosts(): Promise<void> {
    const store = this.ghostStore;
    if (!store) return;
    const legacy = this.jsonGhosts;
    if (legacy) {
      // Older saves carried replays inside the JSON: copy them over, and drop them from the JSON
      // only once every copy is confirmed, so a failed store never costs a replay.
      const copies = Object.entries(legacy).map(([key, ghost], index) => store.put({ key, ghost, at: index }));
      void Promise.all(copies).then(() => { this.jsonGhosts = null; this.flush(); }, () => {});
    }
    try {
      for (const { key, ghost, at } of await store.load()) {
        if (this.ghostTouched.has(key) || this.data.ghosts[key]) continue;
        if (!validGhost(ghost, this.data.best[key])) { void store.delete(key).catch(() => {}); continue; }
        this.data.ghosts[key] = ghost; this.ghostAt.set(key, at);
        this.clock = Math.max(this.clock, at);
      }
      this.boundGhosts();
    } catch {
      // No stored replays this visit; best times and settings live in the JSON and are unaffected.
    }
  }

  get all(): Readonly<SaveData> {
    return this.data;
  }

  private load(): SaveData {
    if (!this.storage) return { ...DEFAULT_SAVE, best: {}, ghosts: {}, ratings: {} };
    try {
      return migrate(readSavedData(this.storage, SAVE_KEY) as Partial<SaveData>);
    } catch {
      return { ...DEFAULT_SAVE, best: {}, ghosts: {}, ratings: {} };
    }
  }

  private flush(): void {
    try {
      const { ghosts: _inStore, ...rest } = this.data;
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.jsonGhosts ? { ...rest, ghosts: this.jsonGhosts } : rest));
    } catch {
      // a private window with storage disabled is not a reason to stop the race
    }
  }

  update(patch: Partial<Omit<SaveData, 'version' | 'best' | 'ghosts' | 'ratings'>>): void {
    this.data = { ...this.data, ...patch };
    this.flush();
  }

  /** Apply an automation-only choice for this page load without rewriting the player's settings. */
  useForSession(patch: Partial<Omit<SaveData, 'version' | 'best' | 'ghosts' | 'ratings'>>): void {
    this.data = { ...this.data, ...patch };
  }

  best(trackId: string): number | null {
    return this.data.best[trackId] ?? null;
  }

  recordRating(trackId: string, rating: StarRating): StarRating {
    const previous = this.data.ratings[trackId];
    if (!previous || rating > previous) {
      this.data.ratings = { ...this.data.ratings, [trackId]: rating };
      this.flush();
    }
    return this.data.ratings[trackId]!;
  }

  ghost(trackId: string): GhostData | null { return this.data.ghosts[trackId] ?? null; }

  rememberVehicle(trackId: string, vehicleId: string): void {
    if (vehicleFor(vehicleId)) this.update({ vehicles: { ...this.data.vehicles, [trackId]: vehicleId } });
  }

  rememberRace(choice: LastRaceChoice): void {
    const vehicles = choice.playerVehicles.filter(id => vehicleFor(id)).slice(0, choice.playerCount);
    if (vehicles.length !== choice.playerCount) return;
    this.data.lastRace = { ...choice, playerVehicles: vehicles };
    this.data.slimeDensity = choice.slimeDensity;
    this.data.aiDifficulty = choice.aiDifficulty;
    this.data.timeOfDay = choice.timeOfDay;
    this.data.weather = choice.weather;
    this.flush();
  }

  /** Count one newly destroyed slime and return achievements first earned by this hit. */
  recordSlimeHit(runHits: number): AchievementId[] {
    const before = new Set(this.data.achievements);
    this.data.totalSlimeHits++;
    this.data.bestRunSlimeHits = Math.max(this.data.bestRunSlimeHits, Math.max(0, Math.floor(runHits)));
    if (this.data.totalSlimeHits >= 25) before.add('slime-total-25');
    if (this.data.bestRunSlimeHits >= 15) before.add('slime-run-15');
    const added = [...before].filter(id => !this.data.achievements.includes(id));
    this.data.achievements = [...before];
    this.flush();
    return added;
  }

  recordFinish(noRescue: boolean): AchievementId[] {
    const oldAchievements = new Set(this.data.achievements);
    if (noRescue) oldAchievements.add('no-rescue');
    const achievements = [...oldAchievements].filter(id => !this.data.achievements.includes(id));
    this.data.achievements = [...oldAchievements];
    this.flush();
    return achievements;
  }

  /** Record a finish. Returns true when it beat the previous best. */
  record(trackId: string, seconds: number, ghost: GhostData | null = null): boolean {
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    const previous = this.best(trackId);
    if (previous !== null && previous <= seconds) return false;
    this.data.best = { ...this.data.best, [trackId]: seconds };
    this.ghostTouched.add(trackId);
    const ghosts = { ...this.data.ghosts }; delete ghosts[trackId];
    if (this.jsonGhosts) { const { [trackId]: _stale, ...kept } = this.jsonGhosts; this.jsonGhosts = kept; }
    if (validGhost(ghost, seconds)) {
      ghosts[trackId] = ghost!;
      const at = Math.max(Date.now(), this.clock + 1); this.clock = at; this.ghostAt.set(trackId, at);
      void this.ghostStore?.put({ key: trackId, ghost: ghost!, at }).catch(() => {});
    } else {
      this.ghostAt.delete(trackId);
      void this.ghostStore?.delete(trackId).catch(() => {});
    }
    this.data.ghosts = ghosts;
    this.boundGhosts();
    this.flush();
    return true;
  }

  /** Oldest recorded first; the store forgets what memory lets go. */
  private boundGhosts(): void {
    const ghosts = this.data.ghosts;
    const order = Object.keys(ghosts).sort((a, b) => (this.ghostAt.get(a) ?? -1) - (this.ghostAt.get(b) ?? -1));
    let bytes = order.reduce((sum, key) => sum + ghosts[key]!.data.length, 0);
    while (order.length > MAX_GHOSTS || bytes > MAX_GHOST_STORAGE) {
      const key = order.shift()!;
      bytes -= ghosts[key]!.data.length;
      delete ghosts[key]; this.ghostAt.delete(key);
      if (this.jsonGhosts) delete this.jsonGhosts[key];
      void this.ghostStore?.delete(key).catch(() => {});
    }
  }
}

export function migrate(raw: Partial<SaveData> & { obstacles?: unknown }): SaveData {
  const out: SaveData = { ...DEFAULT_SAVE, cameraModes: [...DEFAULT_SAVE.cameraModes],
    best: {}, vehicles: {}, ghosts: {}, ratings: {} };
  if (raw.vehicles && typeof raw.vehicles === 'object') {
    out.vehicles = Object.fromEntries(Object.entries(raw.vehicles).filter(([, id]) => vehicleFor(id)));
  }
  out.language = languagePreference(raw.language);
  if (raw.quality === 'high' || raw.quality === 'medium' || raw.quality === 'low' || raw.quality === 'auto') {
    out.quality = raw.quality;
  }
  if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) out.volume = raw.volume;
  for (const key of ['musicVolume', 'effectsVolume'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && value >= 0 && value <= 1) out[key] = value;
  }
  if (typeof raw.muted === 'boolean') out.muted = raw.muted;
  if (typeof raw.reducedMotion === 'boolean') out.reducedMotion = raw.reducedMotion;
  if (Array.isArray(raw.cameraModes)) {
    const valid = raw.cameraModes.filter((mode): mode is CameraMode =>
      typeof mode === 'string' && (CAMERA_MODES as readonly string[]).includes(mode));
    out.cameraModes = [valid[0] ?? 'chase', valid[1] ?? 'chase'];
  }
  if (typeof raw.helpDismissed === 'boolean') out.helpDismissed = raw.helpDismissed;
  if (typeof raw.touchGuideRaces === 'number' && Number.isFinite(raw.touchGuideRaces))
    out.touchGuideRaces = Math.max(0, Math.floor(raw.touchGuideRaces));
  out.aiDifficulty = aiDifficulty(raw.aiDifficulty);
  if (raw.timeOfDay === 'day' || raw.timeOfDay === 'night') out.timeOfDay = raw.timeOfDay;
  if (WEATHERS.includes(raw.weather as Weather)) out.weather = raw.weather as Weather;
  // Changed only the default: a save that already names a tier keeps it, whoever picked it.
  if (raw.slimeDensity === 'none' || raw.slimeDensity === 'normal' || raw.slimeDensity === 'many') {
    out.slimeDensity = raw.slimeDensity;
  } else if (typeof raw.obstacles === 'boolean') {
    out.slimeDensity = raw.obstacles ? 'normal' : 'none';
  }
  //The ghost starts off. Saves before version 16 wrote the old `true` default whether
  // or not the player chose it, so they start off too; from 16 on a saved choice is kept.
  if (typeof raw.showGhost === 'boolean' && typeof raw.version === 'number' && raw.version >= 16) out.showGhost = raw.showGhost;
  if (Array.isArray(raw.names)) out.names = [cleanPlayerName(raw.names[0]), cleanPlayerName(raw.names[1])];
  // Saves before version 14 filed records by route alone; each is moved onto the vehicle that most
  // likely set it, so an upgrade loses nothing.
  const owner = legacyRecordOwner(raw);
  if (raw.best && typeof raw.best === 'object') {
    for (const [id, time] of Object.entries(raw.best)) {
      if (typeof time === 'number' && Number.isFinite(time) && time > 0) out.best[owner(id)] = time;
    }
  }
  if (raw.ghosts && typeof raw.ghosts === 'object') {
    for (const [id, ghost] of Object.entries(raw.ghosts).slice(-MAX_GHOSTS)) {
      const key = owner(id);
      if (validGhost(ghost, out.best[key])) out.ghosts[key] = ghost;
    }
  }
  if (raw.ratings && typeof raw.ratings === 'object') {
    for (const [id, value] of Object.entries(raw.ratings)) {
      const rating = legacyStarRating(value);
      if (rating) out.ratings[owner(id)] = rating;
    }
  }
  Object.assign(out, migrateProgress(raw));
  out.version = SAVE_VERSION;
  return out;
}

/**
 * The vehicle a route-only record belongs to, most certain first: the car in its ghost (the ghost is
 * the record run itself), the car last started on that track, the car of the last race there, and
 * the catalogue's fallback car.
 */
function legacyRecordOwner(raw: Partial<SaveData>): (id: string) => string {
  const ghosts = raw.ghosts && typeof raw.ghosts === 'object' ? raw.ghosts as Record<string, Partial<GhostData>> : {};
  const vehicles = raw.vehicles && typeof raw.vehicles === 'object' ? raw.vehicles : {};
  const last = raw.lastRace && typeof raw.lastRace === 'object' ? raw.lastRace : null;
  if (typeof raw.version === 'number' && raw.version >= 14) return id => id;
  return id => {
    const track = id.replace(/:reverse$/, '');
    const vehicle = [ghosts[id]?.vehicle, vehicles[track],
      last?.trackId === track && Array.isArray(last.playerVehicles) ? last.playerVehicles[0] : undefined]
      .find(candidate => vehicleFor(candidate)) ?? garage.fallback;
    return recordKey(id, vehicle);
  };
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function migrateProgress(raw: unknown): Pick<SaveData,
  'totalSlimeHits' | 'bestRunSlimeHits' | 'achievements' | 'lastRace'> {
  if (!raw || typeof raw !== 'object') throw new Error('invalid progress');
  const value = raw as Partial<ProgressData>;
  const totalSlimeHits = nonNegativeInt(value.totalSlimeHits);
  const bestRunSlimeHits = nonNegativeInt(value.bestRunSlimeHits);
  let lastRace: LastRaceChoice | null = null;
  const last = value.lastRace;
  if (last && typeof last === 'object' && typeof last.trackId === 'string'
    && (last.direction === 'forward' || last.direction === 'reverse')
    && (last.playerCount === 1 || last.playerCount === 2) && Array.isArray(last.playerVehicles)
    && last.playerVehicles.length >= last.playerCount && last.playerVehicles.slice(0, last.playerCount).every(id => !!vehicleFor(id))
    && (last.timeOfDay === 'day' || last.timeOfDay === 'night')
    && (last.slimeDensity === 'none' || last.slimeDensity === 'normal' || last.slimeDensity === 'many')
    && typeof last.ai === 'boolean') {
    const weather = WEATHERS.includes(last.weather as Weather) ? last.weather as Weather : 'clear';
    lastRace = { trackId: last.trackId.slice(0, 80), direction: last.direction,
      playerCount: last.playerCount, playerVehicles: last.playerVehicles.slice(0, last.playerCount),
      timeOfDay: last.timeOfDay, weather, slimeDensity: last.slimeDensity, ai: last.ai,
      aiDifficulty: aiDifficulty(last.aiDifficulty) };
  }
  return { totalSlimeHits, bestRunSlimeHits, achievements: achievementIds(value.achievements), lastRace };
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('silicon-rush.probe', '1');
    s.removeItem('silicon-rush.probe');
    return s;
  } catch {
    return null;
  }
}

function validGhost(ghost: GhostData | null, seconds: number | undefined): boolean {
  if (!ghost || ghost.duration !== seconds) return false;
  const vehicle = vehicleFor(ghost.vehicle);
  return !!vehicle && !!vehicle.trailer === ghost.trailer && !!ghostFrames(ghost);
}
