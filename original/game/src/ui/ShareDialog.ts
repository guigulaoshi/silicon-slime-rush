import { drawResultImage } from './ResultImage';
import { textCard } from './TextCard';
import { drawTextCardImage } from './TextCardImage';
import { routeName } from './routeName';
import type { I18n } from './i18n';
import { el } from './Ui';
import { formatTime } from '../track/Race';
import { personLabel, recordText, resultRecord, type ResultFacts } from './screens';
import { PUBLIC_GAME_URL, watermarkAddress } from '../app/Publication';
import { MAX_PLAYER_NAME } from '../app/playerName';
import { starGlyphs } from '../track/Rating';
import { actionIcon, BRAND_MARK_SRC, fitReplica, replicaButton } from './Replica';
import { drawWatermark, watermarkRect } from './ShareWatermark';

export function shareLines(t: I18n, result: ResultFacts | null, url: string | null): string[] {
  const lines = [t.t('app.title')];
  if (!result) lines.push(t.t('home.slogan.0'));
  else {
    lines.push(routeName(t, result.trackId, result.direction));
    const feat = resultRecord(result);
    if (feat) lines.push(recordText(t, feat, true));
    if (result.capturedAt) lines.push(t.t('photo.date', {date: result.capturedAt}));
    const players = result.players ?? [result];
    players.forEach((player, index) => {
      const who = personLabel(t, result, index);
      const label = who ? `${who} · ` : '';
      lines.push(label + formatTime(player.time));
      lines.push(t.t('results.score', {score: player.score, count: player.slimeHits}));
      if (player.rating) lines.push(t.t('results.rating', {
        stars: starGlyphs(player.rating), combo: player.maxCombo ?? 0,
        corners: player.cleanCorners ?? 0, best: starGlyphs(player.bestRating ?? player.rating),
      }));
    });
    if (result.standings?.length) {
      lines.push(t.t('results.standings'));
      result.standings.forEach((racer, index) => lines.push(t.t('results.standingLine', {
        position: index + 1,
        car: t.t(`car.${racer.vehicleId}.name`),
        result: racer.finished && racer.time !== null ? formatTime(racer.time) : t.t('results.dnf'),
      })));
    }
    if (result.ghostNext) lines.push(t.t('results.ghostNext'));
    if (result.achievements?.length) lines.push(t.t('achievement.share', {
      items: result.achievements.map(id => t.t(`achievement.${id}.name`)).join(' · '),
    }));
    lines.push(...challengeLines(t, result));
  }
  if (url && !result?.challengeUrl) lines.push(url);
  return lines;
}

/** The lines that turn a result into a dare: a sentence and the link. */
export function challengeLines(t: I18n,
  result: Pick<ResultFacts, 'challengeCode' | 'challengeUrl' | 'challengeVehicleId' | 'trackId' | 'direction' | 'time'>): string[] {
  if (!result.challengeCode) return [];
  const lines = [t.t('challenge.shareLine', { car: challengeCar(t, result.challengeVehicleId),
    route: routeName(t, result.trackId, result.direction), time: formatTime(result.time) })];
  if (result.challengeUrl) lines.push(result.challengeUrl);
  return lines;
}

/** A dare's car by name; cars differ in pace, so the time means little without it. */
export const challengeCar = (t: I18n, vehicleId: string | undefined): string =>
  vehicleId ? t.t(`car.${vehicleId}.name`) : t.t('challenge.anyCar');

/**
 * A saved picture or clip is named after its route and the local moment it was made, so two
 * saves never share a name: silicon-slime-rush-lombard-reverse-20260918-071230.png. Seconds, not
 * minutes, because two runs on a short route fit inside one minute.
 */
export function shareFileName(result: Pick<ResultFacts, 'trackId' | 'direction'> | null, extension: string,
  kind = '', now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`
    + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const route = result ? [result.trackId, ...(result.direction === 'reverse' ? ['reverse'] : [])] : [];
  return ['silicon-slime-rush', ...(kind ? [kind] : []), ...route, stamp].join('-') + '.' + extension;
}

/**
 * Puts `text` on the clipboard. The async Clipboard API comes first; when it is missing or refused --
 * itch.io embeds the game in an iframe whose allow list has no clipboard-write, so Chrome and Edge
 * reject it -- the old selection copy still works there, because it needs only the
 * click's user activation, which outlives the rejected promise.
 */
export async function copyShareText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* refused: fall through to the selection copy */ }
  return legacyCopy(text);
}

/** `document.execCommand('copy')` on a hidden textarea placed where the open modal (if any) leaves it selectable. */
function legacyCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A modal dialog makes everything outside it inert, and an inert textarea cannot be selected.
  const host = previous?.closest('dialog[open]') ?? document.querySelector('dialog[open]') ?? document.body;
  const area = document.createElement('textarea');
  area.value = text; area.readOnly = true; area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  host.append(area);
  try {
    area.focus({preventScroll: true}); area.select(); area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch { return false; }
  finally { area.remove(); previous?.focus({preventScroll: true}); }
}

export type ShareImage = HTMLImageElement | HTMLCanvasElement;

/**
 * Which of the share window's buttons a card leaves out. The game card from home or pause has them
 * all; a result card offers the game link too but not the language
 * switch; photos and clips keep their row short.
 */
export function shareButtonHidden(key: string, mode: 'home' | 'score' | 'photo' | 'clip', hasUrl: boolean, canShare: boolean): boolean {
  if (key === 'link') return !hasUrl || mode === 'photo' || mode === 'clip';
  if (key === 'language') return mode !== 'home';
  if (key === 'system') return mode === 'home' && !canShare;
  return false;
}

let watermarkIcon: Promise<HTMLImageElement | null> | null = null;
/** The game icon for the watermark, loaded once; a failed load is retried next time and leaves this badge without it. */
export function watermarkMark(): Promise<HTMLImageElement | null> {
  watermarkIcon ??= new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { watermarkIcon = null; resolve(null); };
    image.src = BRAND_MARK_SRC;
  });
  return watermarkIcon;
}
/**
 * The home card: the screenshot edge to edge with the words laid over it. Its shape is the dialog's desktop preview box (670 × 290 CSS px), so the
 * preview shows the picture and nothing around it.
 */
export const HOME_CARD = { width: 1200, height: 520 } as const;

/** The centred part of a `width` × `height` screenshot that covers the home card without stretching. */
export function coverShareImage(width: number, height: number) {
  const scale = Math.max(HOME_CARD.width / width, HOME_CARD.height / height);
  const w = HOME_CARD.width / scale, h = HOME_CARD.height / scale;
  return {x: (width - w) / 2, y: (height - h) / 2, width: w, height: h};
}

export class ShareDialog {
  readonly node = document.createElement('dialog');
  private readonly title = el('h2');
  private readonly canvas = document.createElement('canvas');
  /** A recorded video of the drive, previewed as a video rather than a picture. */
  private readonly clip = document.createElement('video');
  private clipMode = false;
  /** WebM carries no duration until it is fully parsed, so the recorded length is kept here. */
  private clipSeconds = 0;
  private scoreMode = false;
  private photoMode = false;
  private readonly status = el('p');
  private readonly actions = el('div', 'share-actions');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private file: File | null = null;
  private text = '';
  private generation = 0;
  private source: ShareImage | null = null;
  private result: ResultFacts | null = null;
  private objectUrl: string | null = null;
  private readonly frame = el('div', 'replica-frame');
  private readonly overlay = el('div', 'extra-modal media-modal');
  private readonly textPreview = document.createElement('textarea');
  private readonly unfit: () => void;
  /** An optional nickname, one press away and never a step on the way to sharing. */
  private readonly names = el('div', 'share-names');
  private readonly nameToggle = replicaButton('', 'user', 'modal-secondary share-name-toggle');
  private readonly nameFields = el('div', 'share-name-fields');
  private namesOpen = false;
  /** A result is shared as the photo score card or as the emoji text card's picture. */
  private readonly kinds = el('div', 'share-kinds');
  private cardKind: 'score' | 'text' = 'score';

  constructor(private readonly t: I18n, private readonly language: () => void,
    private readonly rename?: (result: ResultFacts, index: number, name: string) => ResultFacts) {
    this.node.className = 'share-dialog replica replica-dialog'; this.node.setAttribute('aria-label', t.t('results.share'));
    this.canvas.width = 1200; this.canvas.height = 1000;
    this.status.setAttribute('role', 'status');
    for (const key of ['system', 'save', 'copy', 'link', 'language', 'close']) {
      const button = replicaButton('', undefined, key === 'system' ? 'extra-primary' : key === 'save' ? 'media-save' : 'modal-secondary');
      button.dataset.share = key; this.buttons.set(key, button); this.actions.append(button);
    }
    this.buttons.get('system')!.onclick = () => { void this.system(); };
    this.buttons.get('save')!.onclick = () => this.save();
    this.buttons.get('copy')!.onclick = () => { if (this.scoreMode || this.photoMode || this.clipMode) void this.showText(); else void this.copy(this.text); };
    this.buttons.get('link')!.onclick = () => { if (PUBLIC_GAME_URL) void this.copy(PUBLIC_GAME_URL); };
    this.buttons.get('language')!.onclick = () => { this.language(); void this.renderCard(); };
    this.buttons.get('close')!.onclick = () => this.close();
    this.node.addEventListener('close', () => { this.generation++; this.release(); });
    this.node.addEventListener('keydown', e => { if (e.code !== 'Tab') e.stopPropagation(); });
    this.clip.className = 'share-clip media-preview'; this.clip.hidden = true;
    this.clip.controls = true; this.clip.loop = true; this.clip.muted = true; this.clip.playsInline = true;
    // The preview takes the recording's own shape, read from the file rather than assumed (16:9 today); until the
    // metadata arrives the element keeps the last clip's shape or the browser's default, never a fixed one.
    this.clip.addEventListener('loadedmetadata', () => {
      if (this.clip.videoWidth && this.clip.videoHeight) this.clip.style.aspectRatio = `${this.clip.videoWidth} / ${this.clip.videoHeight}`;
    });
    this.canvas.className = 'media-preview'; this.textPreview.readOnly = true; this.textPreview.hidden = true;
    this.actions.className = 'media-actions'; this.status.className = 'media-status';
    const shell = el('section', 'modal-shell'), header = el('div', 'modal-header');
    // The card switch rides in the header, so the window is no taller than before.
    header.append(this.title, this.kinds, this.buttons.get('close')!);
    this.nameToggle.dataset.share = 'name';
    this.nameToggle.onclick = () => { this.namesOpen = true; this.nameFieldsFor(); this.nameFields.querySelector('input')?.focus(); };
    this.names.append(this.nameToggle, this.nameFields);
    for (const kind of ['score', 'text'] as const) {
      const button = replicaButton('', undefined, 'modal-secondary share-kind'); button.dataset.shareKind = kind;
      button.onclick = () => { if (this.cardKind === kind) return; this.cardKind = kind; void this.renderCard(); };
      this.kinds.append(button);
    }
    shell.append(header, this.canvas, this.clip, this.textPreview, this.names, this.actions, this.status);
    this.overlay.append(shell); this.frame.append(this.overlay); this.node.append(this.frame);
    document.body.append(this.node);
    this.unfit = fitReplica(this.node, this.frame);
  }

  get open(): boolean { return this.node.open; }
  /**
   * Opened with focus on ×. Left to the browser, the first open focused the window body before the frame was
   * fitted, so Esc closed this and also reached the game as "back", taking Settings or About behind it away too.
   */
  private showModal(): void { this.node.showModal(); this.buttons.get('close')!.focus({ preventScroll: true }); }
  close(): void { this.node.close(); }
  // A media element keeps playing what it already loaded when its src attribute is merely removed,
  // so the clip is paused and reloaded; otherwise it decodes in the background all session.
  private release(): void { this.clip.pause(); this.clip.removeAttribute('src'); this.clip.load(); this.clip.style.removeProperty('aspect-ratio'); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; this.file = null; }

  async show(result: ResultFacts | null, image: () => Promise<ShareImage>): Promise<void> {
    this.textPreview.hidden = true; this.actions.hidden = false; this.overlay.classList.add('media-modal');
    this.scoreMode = !!result && !result.capturedAt;
    this.clipMode = false;
    this.namesOpen = false; this.nameFields.replaceChildren(); this.cardKind = 'score';
    this.photoMode = !!result?.capturedAt;
    this.clip.hidden = true; this.canvas.hidden = false;
    this.result = result; this.source = null; this.release();
    const token = ++this.generation;
    this.labels(); this.status.textContent = this.t.t('share.preparing'); this.showModal();
    try { const source = await image(); if (token !== this.generation) return; this.source = source; }
    catch { if (token !== this.generation) return; }
    await this.renderCard();
  }

  /**
   * The last dozen seconds of driving as a file: shown as a playable video, shared or
   * saved like every other card. `record` stops one of the rolling recorders and hands back its file.
   */
  async showClip(result: ResultFacts | null, record: () => Promise<{ blob: Blob; seconds: number } | null>,
    route: Pick<ResultFacts, 'trackId' | 'direction'> | null = result): Promise<void> {
    this.textPreview.hidden = true; this.actions.hidden = false; this.overlay.classList.add('media-modal');
    this.scoreMode = false; this.photoMode = false; this.clipMode = true; this.clipSeconds = 0;
    this.canvas.hidden = true; this.clip.hidden = true;
    this.result = result; this.source = null; this.release();
    const token = ++this.generation;
    this.labels(); this.status.textContent = this.t.t('clip.preparing'); this.showModal();
    let saved: { blob: Blob; seconds: number } | null = null;
    try { saved = await record(); } catch { saved = null; }
    if (token !== this.generation || !this.node.open) return;
    if (!saved) { this.status.textContent = this.t.t('share.failed'); return; }
    this.clipSeconds = saved.seconds;
    // Named after what the recorder actually produced: mp4 where the browser can, WebM on Firefox.
    const type = saved.blob.type || 'video/webm';
    // The pause menu's clip has no result yet, but it still names its route.
    const name = shareFileName(route, type.startsWith('video/mp4') ? 'mp4' : 'webm');
    this.file = new File([saved.blob], name, { type });
    this.objectUrl = URL.createObjectURL(saved.blob);
    this.clip.src = this.objectUrl; this.clip.hidden = false;
    void this.clip.play().catch(() => { /* a preview that will not autoplay still saves and shares */ });
    this.text = shareLines(this.t, this.result, PUBLIC_GAME_URL).join('\n');
    this.labels();
    this.status.textContent = this.t.t('clip.ready', { seconds: Math.floor(saved.seconds) });
  }

  private labels(): void {
    this.nameFieldsFor();
    this.kinds.hidden = !this.scoreMode || !this.result || !this.textPreview.hidden || this.clipMode;
    for (const button of this.kinds.querySelectorAll<HTMLButtonElement>('[data-share-kind]')) {
      const kind = button.dataset.shareKind!;
      button.replaceChildren(el('span', '', this.t.t(`share.kind.${kind}`)));
      button.setAttribute('aria-pressed', String(kind === this.cardKind));
    }
    this.title.textContent = this.clipMode ? this.t.t('clip.title', { seconds: Math.floor(this.clipSeconds) })
      : this.t.t(this.scoreMode ? 'replica.shareScoreTitle' : this.photoMode ? 'replica.sharePhotoTitle' : 'share.preview');
    this.node.setAttribute('aria-label', this.title.textContent);
    for (const [key, button] of this.buttons) {
      const mediaLabels: Record<string, string> = { system: 'replica.mediaShare', save: 'replica.mediaSave', copy: 'replica.mediaCopy' };
      const icons: Record<string, string> = { system: 'share', save: 'download', copy: 'copy', link: 'link' };
      button.replaceChildren();
      if (icons[key]) button.append(actionIcon(icons[key]!));
      button.append(el('span', '', key === 'close' ? '×' : key === 'language' ? (this.t.lang === 'zh' ? 'English' : '中文')
        : this.t.t(mediaLabels[key] ?? `share.${key}`)));
      if (key === 'close') button.setAttribute('aria-label', this.t.t('share.close'));
      button.hidden = shareButtonHidden(key, this.clipMode ? 'clip' : this.photoMode ? 'photo' : this.scoreMode ? 'score' : 'home',
        !!PUBLIC_GAME_URL, !!navigator.share);
      button.disabled = ['system','save','copy','link','language'].includes(key) && !this.file;
    }
  }

  /** The nickname control: a button until pressed, then one field per driver; changes redraw the card. */
  private nameFieldsFor(): void {
    const result = this.result;
    this.names.hidden = !this.rename || !this.scoreMode || !result || !this.textPreview.hidden || this.clipMode;
    if (this.names.hidden || !result) return;
    const count = result.players?.length ?? 1;
    const current = Array.from({ length: count }, (_, index) => (result.players ? result.players[index]?.name : result.name) ?? '');
    this.nameToggle.hidden = this.namesOpen;
    this.nameToggle.querySelector('span')!.textContent = current.some(Boolean)
      ? this.t.t('share.nameEdit', { name: current.filter(Boolean).join(' · ') }) : this.t.t('share.nameAdd');
    this.nameFields.hidden = !this.namesOpen;
    if (!this.namesOpen) return;
    const inputs = [...this.nameFields.querySelectorAll('input')];
    if (inputs.length !== count) {
      this.nameFields.replaceChildren(...current.map((_, index) => {
        const input = document.createElement('input');
        input.type = 'text'; input.maxLength = MAX_PLAYER_NAME * 2; input.autocomplete = 'off'; input.spellcheck = false;
        input.dataset.shareName = String(index);
        input.onchange = () => {
          if (!this.result || !this.rename) return;
          this.result = this.rename(this.result, index, input.value);
          void this.renderCard();
        };
        return input;
      }));
    }
    for (const [index, input] of [...this.nameFields.querySelectorAll('input')].entries()) {
      input.placeholder = count > 1 ? this.t.t(`settings.name${index ? '2' : ''}`) : this.t.t('settings.namePlaceholder');
      if (document.activeElement !== input) input.value = current[index] ?? '';
    }
  }

  /** Shows the text selected for a manual copy, and copies it too -- the button says "Copy text". */
  private async showText(): Promise<void> {
    this.overlay.classList.remove('media-modal'); this.title.textContent = this.t.t('replica.textTitle');
    this.canvas.hidden = true; this.clip.hidden = true; this.actions.hidden = true;
    this.textPreview.hidden = false; this.textPreview.value = this.text;
    this.textPreview.setAttribute('aria-label', this.title.textContent);
    this.status.textContent = this.t.t('replica.textNote'); this.textPreview.focus(); this.textPreview.select();
    const text = this.text;
    if (await copyShareText(text) && this.node.open && !this.textPreview.hidden && this.text === text) {
      this.status.textContent = this.t.t('share.copied'); this.textPreview.select();
    }
  }

  private async renderCard(): Promise<void> {
    if (!this.node.open) return;
    const token = ++this.generation; this.release(); this.labels();
    this.canvas.classList.toggle('share-home-card', !this.scoreMode && !this.photoMode);
    const lines = shareLines(this.t, this.result, PUBLIC_GAME_URL);
    // The words follow the chosen picture: the text card's rows with its picture, the score lines with the score card.
    this.text = this.scoreMode && this.result && this.cardKind === 'text' ? textCard(this.t, this.result) : lines.join('\n');
    const icon = await watermarkMark();
    if (token !== this.generation || !this.node.open) return;
    if (this.photoMode) {
      if (!this.source) { this.status.textContent = this.t.t('share.failed'); return; }
      this.canvas.width = this.source instanceof HTMLImageElement ? this.source.naturalWidth : this.source.width;
      this.canvas.height = this.source instanceof HTMLImageElement ? this.source.naturalHeight : this.source.height;
      this.canvas.getContext('2d')!.drawImage(this.source, 0, 0);
    } else if (this.scoreMode && this.result && this.cardKind === 'text') drawTextCardImage(this.canvas, this.t, this.result);
    else if (this.scoreMode && this.result) drawResultImage(this.canvas, this.t, this.result, this.source);
    else {
    const { width: W, height: H } = HOME_CARD;
    this.canvas.width = W; this.canvas.height = H;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#0a1723'; ctx.fillRect(0, 0, W, H);
    if (this.source) {
      const width = this.source instanceof HTMLImageElement ? this.source.naturalWidth : this.source.width;
      const height = this.source instanceof HTMLImageElement ? this.source.naturalHeight : this.source.height;
      const crop = coverShareImage(width, height);
      ctx.drawImage(this.source, crop.x, crop.y, crop.width, crop.height, 0, 0, W, H);
    }
    // The words sit on the picture's lower left, on a shade that darkens only as far up as they reach.
    const step = 50, bottom = H - 36, top = bottom - 36 - (lines.length - 1) * step;
    const gradient = ctx.createLinearGradient(0, top - 90, 0, H);
    gradient.addColorStop(0, '#0a172300'); gradient.addColorStop(.55, '#0a1723b3'); gradient.addColorStop(1, '#0a1723e6');
    ctx.fillStyle = gradient; ctx.fillRect(0, top - 90, W, H - top + 90);
    this.text = lines.join('\n');
    // Clear of the watermark badge in the bottom-right corner.
    const room = watermarkRect(W, H).x - 44 - 24;
    ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 6;
    lines.forEach((line, index) => {
      ctx.fillStyle = index === 0 ? '#ffb36b' : '#eef3f8';
      ctx.font = `${index === 0 ? 'bold 44' : '26'}px system-ui,sans-serif`;
      ctx.fillText(line, 44, bottom - (lines.length - 1 - index) * step, room);
    });
    ctx.restore();
    }
    // Every saved or shared picture carries the name, icon and address in a corner.
    drawWatermark(this.canvas.getContext('2d')!, this.t, icon, watermarkAddress());
    const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/png'));
    if (token !== this.generation || !this.node.open) return;
    if (!blob) { this.status.textContent = this.t.t('share.failed'); return; }
    this.file = new File([blob], shareFileName(this.result, 'png', this.scoreMode && this.cardKind === 'text' ? 'text-card' : ''), {type: 'image/png'});
    this.objectUrl = URL.createObjectURL(blob); this.labels();
    this.status.textContent = this.scoreMode || this.photoMode ? '' : this.t.t('share.ready');
  }

  private async copy(text: string): Promise<void> {
    const copied = await copyShareText(text);
    this.status.textContent = this.t.t(copied ? 'share.copied' : 'share.copyFailed');
  }
  private save(): void {
    if (!this.objectUrl || !this.file) return;
    const link = document.createElement('a'); link.href = this.objectUrl; link.download = this.file.name; link.click();
    this.status.textContent = this.t.t('share.saveStarted');
  }
  private async system(): Promise<void> {
    if (!this.file) return;
    if (!navigator.share) { this.status.textContent = this.t.t('replica.shareUnavailable'); return; }
    const files = [this.file];
    const data: ShareData = {title: this.t.t('app.title'), text: this.text,
      ...(navigator.canShare?.({files}) ? {files} : {})};
    try { await navigator.share(data); this.status.textContent = this.t.t('share.handedOff'); }
    catch (error) { this.status.textContent = this.t.t(error instanceof Error && error.name === 'AbortError' ? 'share.cancelled' : 'share.failed'); }
  }
  dispose(): void { this.close(); this.release(); this.unfit(); this.node.remove(); }
}
