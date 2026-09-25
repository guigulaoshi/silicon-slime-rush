import Ajv2020 from 'ajv/dist/2020';
import schema from '../../../pipeline/sr/schema/track.schema.json' with { type: 'json' };
import type { TrackData } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateShape = ajv.compile(schema);
const loadedTracks = new Map<string, Promise<TrackData>>();

/** Schema violations plus the cross-field rules the schema cannot express. Empty means valid. */
export function trackErrors(data: unknown): string[] {
  if (!validateShape(data)) {
    return (validateShape.errors ?? []).map((e) => `${e.instancePath || '<root>'}: ${e.message ?? 'invalid'}`);
  }
  const t = data as unknown as TrackData;
  const errors: string[] = [];
  if (t.spline.halfWidth.length !== t.spline.points.length) errors.push('spline/halfWidth: must have one entry per point');
  if (t.spline.s) {
    if (t.spline.s.length !== t.spline.points.length) errors.push('spline/s: must have one entry per point');
    else {
      const measured = [0];
      for (let i = 1; i < t.spline.points.length; i++) {
        const a = t.spline.points[i - 1]!, b = t.spline.points[i]!;
        measured.push(measured[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      const closing = t.spline.closed ? Math.hypot(...t.spline.points[0]!.map((v, i) => v - t.spline.points.at(-1)![i]!)) : 0;
      if (t.spline.s[0] !== 0 || t.spline.s.some((s, i) => i > 0 && s < t.spline.s![i - 1]!))
        errors.push('spline/s: must start at zero and be non-decreasing');
      if (t.spline.s.some((s, i) => Math.abs(s - measured[i]!) > 1e-5))
        errors.push('spline/s: must be the three-dimensional arc length of points');
      if (Math.abs(t.spline.length - measured.at(-1)! - closing) > 1e-5)
        errors.push('spline/length: must equal the three-dimensional centreline length');
    }
  }
  if (t.spline.curvature && t.spline.curvature.length !== t.spline.points.length) errors.push('spline/curvature: must have one entry per point');
  const ss = t.checkpoints.map((c) => c.s);
  for (let i = 1; i < ss.length; i++) if (ss[i]! < ss[i - 1]!) { errors.push('checkpoints: s must be non-decreasing'); break; }
  if (ss.length && ss[ss.length - 1]! > t.spline.length) errors.push('checkpoints: s beyond spline length');
  if (t.mode !== 'multistop' && t.checkpoints.some((c) => c.stop)) errors.push('checkpoints: stop=true only allowed in multistop mode');
  return errors;
}

/** Parse and validate a track.json object. Throws with every violation listed. */
export function parseTrack(data: unknown): TrackData {
  const errors = trackErrors(data);
  if (errors.length) throw new Error(`invalid track.json:\n  ${errors.join('\n  ')}`);
  return data as TrackData;
}

/** Fetch a track.json by id from the public tracks directory. */
export async function loadTrack(id: string, base = './tracks'): Promise<TrackData> {
  const url = `${base}/${id}/track.json`;
  let pending = loadedTracks.get(url);
  if (!pending) {
    const request = fetch(url).then(async res => {
      if (!res.ok) throw new Error(`track ${id}: HTTP ${res.status}`);
      return parseTrack(await res.json());
    });
    loadedTracks.set(url, request);
    pending = request;
  }
  try {
    // Callers may reverse or otherwise prepare a route. Keep the cached validated source pristine.
    return structuredClone(await pending);
  } catch (error) {
    if (loadedTracks.get(url) === pending) loadedTracks.delete(url);
    throw error;
  }
}
