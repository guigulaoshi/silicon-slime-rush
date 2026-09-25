/**
 * The street network around a route, as the map panels want it.
 *
 * Written by the pipeline from the same OpenStreetMap ways the route was built from -- see
 * pipeline/sr/streetmap.py -- so it is already in the game's own metres and needs no projection.
 * Vector lines rather than map tiles: a tile service is someone else's copyright and someone else's
 * uptime, and lines stay sharp however far the nav panel is zoomed in.
 */
export interface StreetMapData {
  /** minX, minZ, maxX, maxZ */
  bounds: [number, number, number, number];
  /** 'a' motorway, 'b' primary, 'c' everything else; `p` is flat x,z pairs in metres */
  roads: { c: string; n?: string; p: number[] }[];
  /** the racing line, flat x,z pairs */
  line: number[];
  closed: boolean;
}

/** How each road class is drawn: line width in CSS pixels, and its colour. */
export const ROAD_STYLE: Record<string, { w: number; c: string }> = {
  a: { w: 2.6, c: 'rgba(214, 226, 240, 0.55)' },
  b: { w: 1.9, c: 'rgba(196, 210, 226, 0.42)' },
  c: { w: 1.1, c: 'rgba(178, 192, 208, 0.30)' },
};

/**
 * Load one track's street map. Never throws: the map in the corner is worth having and not worth
 * failing a race over, so a missing or broken file just means the panels draw the route alone.
 */
export async function loadStreetMap(url: string, hiddenNames: readonly string[] = []): Promise<StreetMapData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as StreetMapData;
    if (!Array.isArray(data.roads) || !Array.isArray(data.bounds)) return null;
    if (!hiddenNames.length) return data;
    const hidden = new Set(hiddenNames);
    return { ...data, roads: data.roads.map(road => road.n && hidden.has(road.n)
      ? { c: road.c, p: road.p } : road) };
  } catch {
    return null;
  }
}
