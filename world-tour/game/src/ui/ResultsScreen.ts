import { tone } from './theme';
import { carThumbnail } from './carThumbnail';
import { el, type MenuItem, type MenuList } from './Ui';
import { brandMark, brandTitle, creatorCards, renderBrandSignature, renderLanguageToggle, fitReplica, replicaButton } from './Replica';
import type { I18n } from './i18n';
import { recordText, resultPlace, resultRecord, type ResultFacts, type Screen, personLabel } from './screens';
import { routeName } from './routeName';
import { challengeMargin } from '../app/Challenge';
import { challengeCar } from './ShareDialog';
import { formatTime } from '../track/Race';
import { starGlyphs } from '../track/Rating';
import { CATALOGUE } from '../app/tracks';

export interface ResultsScreen extends Screen { refreshMedia(): void; dispose(): void }
export function resultsScreen(t: I18n, facts: () => ResultFacts, list: MenuList,
  onPick: (item: MenuItem) => void, onStar: () => void = () => {}, options: {
    language?(): void; still?(): string;
  } = {}): ResultsScreen {
  const node = el('div', 'replica replica-screen results-replica'), frame = el('div', 'replica-frame');
  const header = el('header'), brand = el('span', '', brandTitle(t));
  const language = replicaButton('', undefined, 'language'); language.onclick = () => options.language?.();
  header.append(brand, language);
  const main = el('main'), heading = el('div', 'results-heading'), title = el('span'), subtitle = el('small');
  heading.append(title, subtitle);
  const layout = el('div', 'results-layout'), summary = el('div', 'result-summary');
  const cards = el('div', 'result-cards'), detail = document.createElement('details'), detailTitle = document.createElement('summary');
  detail.className = 'result-details'; detail.append(detailTitle);
  const records = el('div', 'result-records');
  /** The record banner, above the cards where the eye already is. */
  const record = el('p', 'result-record'); record.hidden = true; record.setAttribute('aria-live', 'polite');
  const detailBody = el('div'), standings = el('section', 'result-standings'), progress = el('div', 'result-progress');
  const ghost = el('p', 'result-ghost'), status = el('p'); status.setAttribute('role', 'status');
  detailBody.append(records, standings, progress, ghost); detail.append(detailBody); summary.append(record, cards, detail);
  const aside = el('aside', 'result-actions'), prompt = el('div', 'share-prompt'), invitation = el('h2');
  const share = replicaButton('', 'share', 'extra-primary'); share.dataset.action = 'share';
  share.append(el('span', 'action-arrow', '↗')); prompt.append(invitation, share); aside.append(prompt);
  const links = creatorCards(t, () => {}); aside.append(links); layout.append(summary, aside);
  const footer = el('div', 'result-footer'), closing = el('span');
  const text = replicaButton('', 'copy'), route = replicaButton('', 'map'), retry = replicaButton('', 'play');
  const clip = replicaButton('', 'film'); clip.dataset.action = 'clip'; clip.hidden = true;
  text.dataset.action = 'text'; route.dataset.action = 'quit'; retry.dataset.action = 'retry';
  footer.append(closing, clip, text, route, retry); main.append(heading, layout, status, footer); frame.append(header, main); node.append(frame);
  const unfit = fitReplica(node, frame), buttons = new Map<string, HTMLButtonElement>();
  for (const button of node.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    const id = button.dataset.action!; buttons.set(id, button);
    button.onclick = () => { list.select(id); const item = list.current; if (item) onPick(item); };
    button.onfocus = button.onmouseenter = () => list.select(id);
  }
  let generation = 0, animationKey = '', background = '';
  const setLabel = (button: HTMLButtonElement, key: string) => { button.querySelector('span')!.textContent = t.t(key); };
  function render() {
    const f = facts(), people = f.players ?? [f];
    renderBrandSignature(brand, t); title.textContent = t.t('replica.finishLine'); subtitle.textContent = t.t(f.players ? 'results.bothFinished' : 'replica.finishSubtitle');
    renderLanguageToggle(language, t);
    invitation.textContent = t.t('replica.sharePrompt'); setLabel(share, 'replica.shareRun');
    // The last dozen seconds of the drive, when the browser recorded them.
    clip.hidden = !f.clipSeconds;
    if (f.clipSeconds) clip.querySelector('span')!.textContent = t.t('clip.save', { seconds: Math.floor(f.clipSeconds) });
    setLabel(text, 'results.text');
    setLabel(route, 'replica.changeRoute'); setLabel(retry, 'replica.again');
    closing.textContent = t.t('replica.friendTurn');
    links.querySelector('.creator-home strong')!.textContent = t.t('replica.home');
    links.querySelector('.coffee strong')!.textContent = t.t('replica.coffee');
    list.setItems([...buttons].filter(([,b]) => !b.hidden).map(([id]) => ({id,label: buttons.get(id)!.textContent ?? ''})));
    for (const [id, button] of buttons) button.setAttribute('aria-selected', String(list.current?.id === id));
    node.dataset.players = String(people.length); records.replaceChildren();
    // A run that came in through a friend's link says who won, where the eye lands first.
    invitation.classList.toggle('result-challenge', !f.players && !!f.challenge);
    if (!f.players && f.challenge) {
      const margin = challengeMargin(f.challenge, f.time);
      invitation.textContent = t.t(margin >= 0 ? 'challenge.beat' : 'challenge.short',
        {seconds: Math.abs(margin).toFixed(2), name: f.challenge.name ?? t.t('challenge.someoneInline'), car: challengeCar(t, f.challenge.vehicleId)});
      invitation.dataset.challenge = margin >= 0 ? 'beat' : 'short';
    } else delete invitation.dataset.challenge;
    cards.classList.toggle('result-players', !!f.players); cards.dataset.players = String(people.length);
    const key = JSON.stringify([f.trackId, f.time, people.map(p => p.rating), !!f.reducedMotion]);
    const animate = animationKey !== key; animationKey = key;
    // A personal best (or a route's first finish) says so out loud, once, above the cards.
    const feat = resultRecord(f);
    record.hidden = !feat;
    if (feat) {
      record.textContent = recordText(t, feat);
      record.dataset.record = feat.kind;
      if (!f.reducedMotion && animate) { record.classList.remove('pop'); void record.offsetWidth; record.classList.add('pop'); }
    } else delete record.dataset.record;
    // A record is announced by the banner above; this line is only for a lap that fell short.
    if (!f.players && !feat && f.best !== null) records.append(el('p', '', t.t('results.behind', {seconds:(f.time-f.best).toFixed(2)})));
    const token = ++generation, starGroups: {stars: HTMLElement[]; count: number}[] = [];
    cards.replaceChildren(...people.map((person, index) => {
      const card = el('article', 'share-card' + (f.players ? ' result-player' : ''));
      if (background) card.style.backgroundImage = `linear-gradient(90deg,${tone('night', 'mist', 0.11, 0.851)},${tone('night', 'mist', 0.11, 0.333)}),url(${background})`;
      const branding = el('div', 'card-brand');
      const wordmark = el('div', 'card-brand-wordmark', brandTitle(t));
      wordmark.append(el('span', '', personLabel(t, f, index) ?? t.t('replica.cardPlace')));
      branding.append(brandMark(), wordmark);
      // The five stars take the old "RUSH HOUR. SURVIVED." slot at the same size.
      const rating = el('div', 'earned-stars result-stars card-rating'); rating.setAttribute('aria-label', t.t('results.starsLabel', {count: person.rating ?? 0}));
      const stars = Array.from({length:5}, (_, i) => {
        const star = el('span', i < (person.rating ?? 0) ? 'earned' : 'empty', '★');
        star.dataset.revealed = String(i < (person.rating ?? 0) && (!animate || !!f.reducedMotion));
        return star;
      });
      rating.append(...stars); starGroups.push({stars,count: person.rating ?? 0});
      const track = el('div', 'card-route result-track', routeName(t, f.trackId, f.direction));
      // The total includes clean-corner points (Race CLEAN_CORNER_POINTS), so it is not labelled "slime".
      const score = el('div', 'score-number', person.score.toLocaleString(t.lang)); score.append(el('span', '', t.t('replica.points')));
      const stats = el('div', 'card-stats');
      const place = resultPlace(f, index);
      for (const [value, label] of [[formatTime(person.time), 'replica.finishTime'],
        ...(place ? [[t.t('replica.placeValue', place), 'replica.place']] : []),
        [String(person.slimeHits), 'replica.slimesHit'], [`×${person.maxCombo ?? 0}`, 'replica.bestCombo']]) {
        const stat = el('span'); stat.append(el('b', '', value), document.createTextNode(t.t(label!))); stats.append(stat);
      }
      const bottom = el('div', 'card-bottom'); bottom.append(el('span', '', t.t('replica.realRoads')), el('span', '', t.t('replica.yourTurn')));
      const meta = el('p', 'result-rating-meta', person.rating ? t.t('results.ratingMeta', {best:starGlyphs(person.bestRating ?? person.rating),combo:person.maxCombo ?? 0,corners:person.cleanCorners ?? 0}) : '');
      const accessibleScore = el('span', 'result-score sr-only', t.t('results.score', {score:person.score,count:person.slimeHits}));
      card.append(branding, rating, track, score, stats, bottom, accessibleScore, visaStamp(t, f.trackId));
      if (f.players) card.append(meta); else records.append(meta);
      return card;
    }));
    if (animate && !f.reducedMotion) for (let step = 1; step <= Math.max(0, ...starGroups.map(g => g.count)); step++) {
      window.setTimeout(() => {
        if (token !== generation) return;
        for (const group of starGroups) if (group.count >= step) {
          const star = group.stars[step - 1]!; star.dataset.revealed = 'true';
          star.animate?.([{transform:'scale(.2)',opacity:0},{transform:'scale(1.45)',opacity:1},{transform:'scale(1)',opacity:1}], {duration:410,easing:'cubic-bezier(.18,.8,.3,1)'});
        }
        onStar();
      }, (step - 1) * 280);
    }
    detailTitle.textContent = t.t('replica.resultDetails');
    standings.replaceChildren(); standings.hidden = !f.standings?.length;
    if (!standings.hidden) {
      standings.append(el('h3', '', t.t('results.standings'))); const rows = el('ol', 'result-standing-list');
      for (const [index, racer] of f.standings!.entries()) {
        const row = el('li', `result-standing ${racer.role}`);
        const car = el('span', 'result-standing-car');
        car.append(carThumbnail(racer.vehicleId, 'result-standing-thumbnail'),
          el('span', 'result-standing-name', t.t(`car.${racer.vehicleId}.name`)));
        row.append(el('b', 'result-position', t.t('results.position', {position:index+1})),
          car,
          el('span', 'result-standing-owner', t.t(racer.role === 'human' ? 'results.you' : 'results.ai') + (racer.player === undefined ? '' : ` ${racer.player+1}`)),
          el('span', 'result-standing-time', racer.finished && racer.time !== null ? formatTime(racer.time) : t.t('results.dnf')));
        rows.append(row);
      }
      standings.append(rows);
    }
    const lines: HTMLElement[] = [];
    for (const id of f.newAchievements ?? []) lines.push(el('p', 'good', t.t('achievement.unlocked', {name:t.t(`achievement.${id}.name`)})));
    if (f.achievements?.length) lines.push(el('p', '', t.t('achievement.earnedList', {items:f.achievements.map(id => t.t(`achievement.${id}.name`)).join(' · ')})));
    progress.replaceChildren(...lines); ghost.hidden = !f.ghostNext; ghost.textContent = f.ghostNext ? t.t('results.ghostNext') : '';
    detail.hidden = standings.hidden && !lines.length && !f.ghostNext && !records.textContent;
    if (f.players && animate) detail.open = true;
    status.textContent = f.textCopied === undefined ? '' : t.t(f.textCopied ? 'share.copied' : 'share.copyFailed'); status.hidden = !status.textContent;
  }
  return { node, render, refreshMedia() { animationKey = ''; background = options.still?.() ?? ''; render(); },
    dispose() { generation++; unfit(); node.remove(); } };
}

/**
 * The entry stamp a passport gets on arrival, on the result card: the route's airport code, the
 * day, and "arrived". The travel theme's one ornament that says where you have just been.
 */
export function visaStamp(t: I18n, trackId: string, today = new Date()): HTMLElement {
  const stamp = el('div', 'visa-stamp');
  stamp.setAttribute('aria-hidden', 'true');
  const code = CATALOGUE.find(entry => entry.id === trackId)?.code ?? '';
  // A stamp's date is day, three-letter month, year ("23 SEP 2026"); en-GB would print "SEPT".
  const day = t.lang === 'zh' ? today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : `${String(today.getDate()).padStart(2, '0')} ${today.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${today.getFullYear()}`;
  stamp.append(el('span', 'visa-stamp-word', t.t('results.stampArrived')), el('b', 'visa-stamp-code', code),
    el('span', 'visa-stamp-date', day));
  return stamp;
}
