import data from './catalogue.json' with { type: 'json' };
import { TUNINGS, tuningFor, type CarTuning } from '../physics/CarTuning';
import type { CarKind, Vec3 } from '../track/types';

/** Dimensions are already in game metres, including the authored detail scale baked into the exported models. */
export interface VehicleBody {
  id: string;
  /** Authored detail units to game metres for this body; the catalogue root value is the default. */
  detailScale?: number;
  size: number[];
  chassisHalf: number[];
  wheelRadius: number;
  wheelWidth: number;
  axles: number[];
  track: number;
  anchorY: number;
  suspensionRest: number;
  /** The most a drawn wheel may rise into its arch before its tread comes through the
   *  body, as measured on the GLB by vehicle-assets.test.ts. The springs may compress further;
   *  VehicleModel then lifts the drawn body instead of the wheel. */
  wheelLift: number;
  lights: VehicleLights;
  headlightProfile?: HeadlightProfile;
  hitch?: number[];
  handling?: Omit<Partial<CarTuning>, 'centreOfMass'> & { centreOfMass?: number[] };
}
export interface HeadlightProfile {
  colour: string;
  /** Nominal road reach and half width at the aim point in metres. */
  reach: number;
  width: number;
  /** Total intensity shared by up to four scene lights. */
  power: number;
}
export interface VehicleLight {
  mount?: 'roof';
  /** Local centre on the authored body, in metres. The car faces local -Z. */
  position: Vec3;
  /** Visible lens width and height, in metres. */
  size: [number, number];
}
export interface VehicleLights {
  headlights: VehicleLight[];
  brakeLights: VehicleLight[];
}
export interface VehicleDefinition extends VehicleBody {
  tuning: string;
  trailer?: VehicleBody;
  /** A local car: it exists only on this track, in the garage slot of the vehicle it `replaces`. */
  homeTrack?: string;
  replaces?: string;
  /** Engine sound: the id of a garage car whose synthesised voice this one borrows, plus overrides. */
  engine?: { base: string } & Record<string, number | string | boolean>;
}
export interface TaxiLivery { paint: string; sign: string }
export interface VehicleCatalogue {
  version: number;
  legacyDefaults: Record<string, string>;
  fallback: string;
  vehicles: VehicleDefinition[];
  /** One garage car drives each city's streets as its taxi: same body, local paint and a roof sign. */
  taxis?: { vehicle: string; liveries: Record<string, TaxiLivery> };
}

export function catalogueErrors(candidate: unknown): string[] {
  const catalogue = candidate as VehicleCatalogue;
  const errors: string[] = [];
  const ids = new Set<string>();
  const assetIds = new Set<string>();
  for (const vehicle of catalogue.vehicles) {
    if (ids.has(vehicle.id)) errors.push(`duplicate vehicle: ${vehicle.id}`);
    ids.add(vehicle.id);
    if (!Object.hasOwn(TUNINGS, vehicle.tuning)) errors.push(`${vehicle.id}: unknown tuning`);
    if (!['fwd', 'rwd', 'awd'].includes(vehicle.handling?.drive ?? '')) {
      errors.push(`${vehicle.id}: invalid drive`);
    }
    for (const body of [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]) {
      if (!/^[a-z][a-z0-9-]*$/.test(body.id)) errors.push(`${body.id}: invalid asset id`);
      if (assetIds.has(body.id)) errors.push(`duplicate asset: ${body.id}`);
      assetIds.add(body.id);
      for (const key of ['size', 'chassisHalf'] as const) {
        if (body[key].length !== 3 || body[key].some(n => !Number.isFinite(n) || n <= 0)) {
          errors.push(`${body.id}: invalid ${key}`);
        }
      }
      for (const key of ['wheelRadius', 'wheelWidth', 'track', 'suspensionRest'] as const) {
        if (!(Number.isFinite(body[key]) && body[key] > 0)) errors.push(`${body.id}: invalid ${key}`);
      }
      const expectedAxles = body === vehicle ? 2 : 1;
      if (body.axles.length !== expectedAxles || body.axles.some(n => !Number.isFinite(n)) ||
          (expectedAxles === 2 && !(body.axles[0]! < 0 && body.axles[1]! > 0))) {
        errors.push(`${body.id}: invalid axles`);
      }
      if (!Number.isFinite(body.anchorY)) errors.push(`${body.id}: invalid anchorY`);
      if (!(body.wheelLift > 0 && body.wheelLift < body.suspensionRest)) errors.push(`${body.id}: invalid wheelLift`);
      if (body.detailScale !== undefined && !(Number.isFinite(body.detailScale) && body.detailScale > 0)) {
        errors.push(`${body.id}: invalid detailScale`);
      }
      for (const [kind, lights] of Object.entries(body.lights ?? {}) as [string, VehicleLight[]][]) {
        if (!['headlights', 'brakeLights'].includes(kind) || !Array.isArray(lights)) {
          errors.push(`${body.id}: invalid lights`); continue;
        }
        for (const light of lights) {
          if (light.mount !== undefined && (light.mount !== 'roof' || kind !== 'headlights')) {
            errors.push(`${body.id}: invalid light mount`);
          }
          if (light.position?.length !== 3 || light.position.some(n => !Number.isFinite(n))
            || light.size?.length !== 2 || light.size.some(n => !Number.isFinite(n) || n <= 0)) {
            errors.push(`${body.id}: invalid ${kind}`);
          }
        }
      }
      if (!body.lights || !Array.isArray(body.lights.headlights)
        || !Array.isArray(body.lights.brakeLights) || !body.lights.brakeLights.length
        || (body === vehicle && !body.lights.headlights.length)) {
        errors.push(`${body.id}: incomplete lights`);
      }
      const profile = body.headlightProfile;
      if (body.lights?.headlights.length && (!profile || !/^#[0-9a-f]{6}$/i.test(profile.colour)
        || [profile.reach, profile.width, profile.power].some(n => !Number.isFinite(n) || n <= 0))) {
        errors.push(`${body.id}: invalid headlightProfile`);
      }
      if (body.hitch && (body.hitch.length !== 3 || body.hitch.some(n => !Number.isFinite(n)))) {
        errors.push(`${body.id}: invalid hitch`);
      }
    }
    if (vehicle.trailer && (!vehicle.hitch || !vehicle.trailer.hitch)) {
      errors.push(`${vehicle.id}: both hitch anchors required`);
    }
  }
  for (const vehicle of catalogue.vehicles) {
    if (!!vehicle.homeTrack !== !!vehicle.replaces) errors.push(`${vehicle.id}: homeTrack and replaces go together`);
    if (vehicle.replaces && !ids.has(vehicle.replaces)) errors.push(`${vehicle.id}: replaces an unknown slot`);
  }
  if (catalogue.taxis) {
    if (!ids.has(catalogue.taxis.vehicle)) errors.push('taxis: unknown vehicle');
    for (const [track, livery] of Object.entries(catalogue.taxis.liveries)) {
      if (![livery.paint, livery.sign].every(c => /^#[0-9a-f]{6}$/i.test(c ?? ''))) errors.push(`taxis.${track}: colours must be #rrggbb`);
    }
  }
  if (!ids.has(catalogue.fallback)) errors.push('invalid fallback vehicle');
  for (const legacy of Object.keys(TUNINGS)) {
    if (!ids.has(catalogue.legacyDefaults[legacy] ?? '')) errors.push(`invalid default: ${legacy}`);
  }
  return errors;
}

const problems = catalogueErrors(data);
if (problems.length) throw new Error(problems.join('\n'));
/** Every body in the catalogue, local cars included. */
export const ALL_VEHICLES: readonly VehicleDefinition[] = data.vehicles as unknown as VehicleDefinition[];
/** The garage's slots: the cars every track has. A local car stands in one of these on its own track. */
export const VEHICLES: readonly VehicleDefinition[] = ALL_VEHICLES.filter(vehicle => !vehicle.homeTrack);

export function vehicleFor(id: unknown): VehicleDefinition | undefined {
  return ALL_VEHICLES.find(vehicle => vehicle.id === id);
}

/**
 * The car in a garage slot on a given track: the track's local car where it declares one for that
 * slot, otherwise the slot's own car. The garage keeps nine slots everywhere -- menus, saves, best
 * times and ghosts all stay keyed by the slot -- and only what drives out of it changes city by city.
 */
export function forTrack(vehicle: VehicleDefinition, trackId: string | undefined): VehicleDefinition {
  if (!trackId || vehicle.homeTrack) return vehicle;
  return ALL_VEHICLES.find(local => local.homeTrack === trackId && local.replaces === vehicle.id) ?? vehicle;
}

/** The taxi paint and roof sign a car wears on a track, when it is that city's taxi. */
export function taxiLivery(vehicleId: string, trackId: string | undefined): TaxiLivery | undefined {
  const taxis = (data as unknown as VehicleCatalogue).taxis;
  if (!trackId || !taxis || taxis.vehicle !== vehicleId) return undefined;
  return taxis.liveries[trackId];
}

/** The garage slot a car occupies: itself, or the slot a local car stands in. */
export function slotOf(vehicle: VehicleDefinition): VehicleDefinition {
  return vehicle.replaces ? vehicleFor(vehicle.replaces) ?? vehicle : vehicle;
}

/** The catalogue's fallback car (the Sedan): also what the menu offers on a route the player has not picked a car for. */
export function fallbackVehicle(): VehicleDefinition {
  return vehicleFor(data.fallback)!;
}

/** Track data remains the default owner; this maps its retained legacy ids into the garage. */
export function defaultVehicle(track: { car: CarKind }): VehicleDefinition {
  return vehicleFor(data.legacyDefaults[track.car]) ?? fallbackVehicle();
}

export function resolveVehicle(id: unknown, track: { car: CarKind }): VehicleDefinition {
  return vehicleFor(id) ?? defaultVehicle(track);
}

/** Trailer origin relative to the tow body before either body is rotated. */
export function trailerRestOffset(vehicle: VehicleDefinition): Vec3 {
  return vehicle.hitch!.map((value, i) => value - vehicle.trailer!.hitch![i]!) as Vec3;
}

export function modelPath(body: VehicleBody): string {
  return `./models/cars/${body.id}.glb`;
}

/** Front axle first, left then right. These are ray origins, not static wheel centres. */
export function wheelAnchors(body: VehicleBody): Vec3[] {
  return body.axles.flatMap(z => [
    [-body.track / 2, body.anchorY, z] as Vec3,
    [body.track / 2, body.anchorY, z] as Vec3,
  ]);
}

/** Exported wheels are in fully extended suspension pose; runtime moves them with compression. */
export function wheelCentres(body: VehicleBody): Vec3[] {
  return wheelAnchors(body).map(([x, y, z]) => [x, y - body.suspensionRest + body.wheelRadius, z]);
}

/** Geometry only; driving calibration remains owned by CarTuning and. */
export function vehicleGeometry(body: VehicleBody): Pick<CarTuning,
  'chassisHalf' | 'wheels' | 'wheelRadius' | 'suspensionRest'> {
  return {
    chassisHalf: [...body.chassisHalf] as Vec3,
    wheels: wheelAnchors(body),
    wheelRadius: body.wheelRadius,
    suspensionRest: body.suspensionRest,
  };
}

/** The factor between a body's authored detail units and its delivered game metres. */
export function detailScale(body: VehicleBody): number {
  return body.detailScale ?? data.detailScale;
}

/** One calibration assembly for runtime, trailers and driving evidence. Geometry wins over tuning. */
export function vehicleTuning(body: VehicleBody, base: CarKind = 'sedan'): CarTuning {
  const handling = body.handling ?? {};
  return { ...tuningFor(base), ...structuredClone(handling), ...vehicleGeometry(body),
    inertiaScale: detailScale(body) ** 2,
    centreOfMass: [...(handling.centreOfMass ?? TUNINGS[base].centreOfMass)] as Vec3 };
}

/** Derived from the playable catalogue so obstacle physics follows garage tuning changes. */
export function minimumVehicleMass(): number {
  return Math.min(...VEHICLES.map(vehicle =>
    vehicleTuning(vehicle, vehicle.tuning as CarKind).mass));
}
