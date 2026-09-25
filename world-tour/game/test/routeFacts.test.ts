import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeFacts } from '../src/track/routeFacts';
import { parseTrack } from '../src/track/schema';
import { BUILT, CATALOGUE } from '../src/app/tracks';
import { RouteDetails, ROUTE_SOURCES } from '../src/ui/RouteDetails';
import { bootScreen } from '../src/ui/screens';
import { I18n } from '../src/ui/i18n';
import example from '../../pipeline/sr/schema/examples/minimal.track.json' with { type: 'json' };

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it('counts climbing on the closing edge and every lap, but never multiplies a point-to-point route', () => {
  const track = parseTrack(structuredClone(example));
  track.mode = 'loop'; track.laps = 3;
  track.spline = { ...track.spline, closed: true, length: 1000,
    points: [[0, 0, 0], [100, 10, 0], [100, 4, 100], [0, -2, 100]] };
  expect(routeFacts(track)).toEqual({ km: 3, ascent: 36, laps: 3, minutes: [2, 4] });
  track.mode = 'p2p'; track.spline.closed = false;
  expect(routeFacts(track)).toEqual({ km: 1, ascent: 10, laps: 1, minutes: [1, 2] });
});
it('has sourced translated details and finite route metrics for every formal route', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  expect(CATALOGUE).toHaveLength(BUILT.size);
  for (const route of CATALOGUE) {
    const track = parseTrack(JSON.parse(readFileSync(`public/tracks/${route.id}/track.json`, 'utf8')));
    const facts = routeFacts(track);
    expect(facts.km).toBeGreaterThan(0); expect(Number.isFinite(facts.ascent)).toBe(true);
    expect(facts.minutes[0]).toBeGreaterThan(0);
    expect(facts.minutes[1]).toBeGreaterThanOrEqual(facts.minutes[0]!);
    expect(ROUTE_SOURCES[route.id]).toMatch(/^https:\/\//);
    for (const language of ['zh', 'en'] as const) {
      const i18n = new I18n(language);
      const details = new RouteDetails(i18n); details.setTrack(route.id, track);
      expect(details.node.querySelector('.departure-story')!.textContent).toBe(i18n.t(`track.${route.id}.fact`));
      expect(i18n.t(`track.${route.id}.fact`)).not.toContain(`track.${route.id}`);
      expect(details.node.querySelectorAll('.departure-stats span').length).toBeGreaterThanOrEqual(3);
    }
  }
});
it('keeps a direct-load failure visible with retry on the departure page', () => {
  const retry = vi.fn(); const back = vi.fn();
  const screen = bootScreen(new I18n('zh'), back);
  screen.setTrack('sydney', null); screen.render();  // goldengate's replacement (mapping table)
  screen.setFailure(retry); document.body.append(screen.node);
  expect(screen.node.querySelector('[role="status"]')!.textContent).toContain('没能加载');
  expect((screen.node.querySelector('.loading-bar') as HTMLElement).hidden).toBe(true);
  (screen.node.querySelector('.departure-retry') as HTMLButtonElement).click();
  expect(retry).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled();
  screen.setFailure(null);
  expect((screen.node.querySelector('.departure-go') as HTMLButtonElement).disabled).toBe(true);
});

it('every formal route stays within the race length for the middle car of its garage, measured, and says so in minutes', async () => {
  // The hyper-casual pace. Read from the AI pace table, not from a guessed speed: the fastest and the
  // slowest car differ by 1.9x, and a guessed 22 m/s once passed routes the fast cars finished in 50 s.
  const { middleCarSeconds, RACE_SECONDS, RACE_SECONDS_EXCEPTIONS } = await import('../src/track/routeFacts');
  for (const id of BUILT) {
    const seconds = middleCarSeconds(id);
    expect(seconds, `${id} is in the AI pace table`).toBeDefined();
    expect(Math.round(seconds!), `${id}: middle car`).toBeGreaterThanOrEqual(RACE_SECONDS[0]);
    expect(Math.round(seconds!), `${id}: middle car`).toBeLessThanOrEqual(RACE_SECONDS_EXCEPTIONS[id] ?? RACE_SECONDS[1]);
    const track = parseTrack(JSON.parse(readFileSync(`public/tracks/${id}/track.json`, 'utf8')));
    expect(routeFacts(track).minutes[1], `${id}: the menu's minutes come from the measured times`).toBeLessThanOrEqual(4);
  }
});
