import { raceKey, type RaceDirection } from '../track/Direction';
import { routeName } from './routeName';
import type { TrackData } from '../track/types';
import { routeFacts } from '../track/routeFacts';
import type { I18n } from './i18n';
import { MiniMap } from './MiniMap';
import { el } from './Ui';

/** References for the separately localized place facts; no fetched content enters the game. */
export const ROUTE_SOURCES: Record<string, string> = {
  goldengate: 'https://www.goldengate.org/bridge/history-research/moments-events/key-dates/',
  'bayshore-101': 'https://www.paloalto.gov/Departments/Community-Services/Parks-Open-Space-Golf-Division/Neighborhood-Parks/Baylands-Nature-Preserve',
  'twin-peaks': 'https://www.sfrecpark.org/facilities/facility/details/Twin-Peaks-384',
  lombard: 'https://www.sftravel.com/things-to-do/attractions/iconic-sf/lombard-street',
  'fishermans-wharf': 'https://www.fishermanswharf.org/plan-your-visit/wharf-history/wharfs-fishing-fleet/',
  shoreline: 'https://www.mountainview.gov/Home/Components/News/News/713/284',
  'moffett-field': 'https://historicproperties.arc.nasa.gov/hangar1/overview.html',
  'wolfe-pruneridge': 'https://www.fosterandpartners.com/studio/san-francisco',
};

/** Shared content for loading and ready screens. MiniMap remains the projection owner. */
export class RouteDetails {
  readonly node = el('section', 'departure-details');
  private readonly title = el('h1');
  private readonly blurb = el('p');
  private readonly stats = el('div', 'departure-stats');
  private readonly story = el('p', 'departure-story');
  private readonly source = el('a', 'departure-source') as HTMLAnchorElement;
  private readonly map = new MiniMap(240);
  private id = '';
  private direction: RaceDirection = 'forward';
  private track: TrackData | null = null;

  constructor(private readonly i18n: I18n) {
    const copy = el('div', 'departure-copy');
    copy.append(this.title, this.blurb, this.stats, this.story, this.source);
    this.map.node.setAttribute('role', 'img');
    this.source.target = '_blank'; this.source.rel = 'noopener noreferrer';
    this.source.addEventListener('keydown', event => {
      // The link keeps its native action; reading a source must not also confirm the race.
      if (event.code === 'Enter' || event.code === 'Space') event.stopPropagation();
    });
    this.node.append(copy, this.map.node);
  }

  setTrack(id: string, track: TrackData | null, direction: RaceDirection = 'forward'): void {
    this.id = id; this.track = track; this.direction = direction; this.render();
  }

  render(): void {
    const t = this.i18n;
    this.title.textContent = routeName(t, this.id, this.direction);
    this.blurb.textContent = t.t(`track.${this.id}.blurb`);
    this.story.textContent = ROUTE_SOURCES[this.id] ? t.t(`track.${this.id}.fact`) : '';
    this.source.hidden = !ROUTE_SOURCES[this.id];
    this.source.href = ROUTE_SOURCES[this.id] ?? '';
    this.source.textContent = t.t('departure.source');
    this.map.node.setAttribute('aria-label', t.t('departure.map'));
    this.map.node.hidden = !this.track;
    this.stats.replaceChildren();
    if (!this.track) return;
    const facts = routeFacts(this.track);
    for (const text of [t.t('intro.length', { km: facts.km.toFixed(1) }),
      t.t('departure.ascent', { metres: facts.ascent }),
      t.t('departure.time', { minutes: [...new Set(facts.minutes)].join('–') }),
      ...(facts.laps > 1 ? [t.t('intro.laps', { count: facts.laps })] : [])]) {
      this.stats.append(el('span', '', text));
    }
    this.map.setRoute({ id: raceKey(this.track.id, this.direction), points: this.track.spline.points, s: this.track.spline.s,
      checkpoints: this.track.checkpoints.map(c => c.s), length: this.track.spline.length,
      closed: this.track.spline.closed });
    this.map.draw({ x: this.track.start.pos[0], z: this.track.start.pos[2],
      headingX: Math.sin(this.track.start.yaw), headingZ: Math.cos(this.track.start.yaw), s: 0 });
  }
}
