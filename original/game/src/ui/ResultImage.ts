import { formatTime } from '../track/Race';
import { starGlyphs } from '../track/Rating';
import type { I18n } from './i18n';
import { brandTitle } from './Replica';
import { personLabel, recordText, resultPlace, resultRecord, type ResultFacts } from './screens';
import { roundRect } from './TextCardImage';
import type { ShareImage } from './ShareDialog';
import { routeName } from './routeName';

/** The accepted share image uses the real scene and race values instead of prototype samples. */
export function drawResultImage(canvas: HTMLCanvasElement, t: I18n, result: ResultFacts, source: ShareImage | null): void {
  canvas.width = 1000; canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#233e4c'; ctx.fillRect(0,0,1000,600);
  if (source) ctx.drawImage(source,0,0,1000,600);
  ctx.fillStyle = '#102333bf'; ctx.fillRect(0,0,1000,600);
  // The share image sells the game: the name is the headline, the stars sit where the old slogan was.
  ctx.fillStyle = '#fff'; ctx.font = 'bold 52px Arial,"PingFang SC",sans-serif'; ctx.fillText(brandTitle(t),48,96,904);
  // A solo nickname leads the place line in the card's own white, so the card says whose run it is.
  let placeX = 48;
  if (!result.players && result.name) {
    ctx.font = 'bold 26px Arial,"PingFang SC",sans-serif'; ctx.fillStyle = '#fff';
    const label = `${result.name} · `; ctx.fillText(label,48,131,600); placeX += Math.min(600, ctx.measureText(label).width);
  }
  ctx.font = '20px Arial,"PingFang SC",sans-serif'; ctx.fillStyle = '#c5d5da'; ctx.fillText(t.t('replica.cardPlace'),placeX,130,952 - placeX);
  const people = result.players ?? [result], dual = people.length > 1;
  people.forEach((person,index) => {
    const x = dual ? 48 + index * 466 : 48, width = dual ? 435 : 904;
    ctx.fillStyle = '#ffe594'; ctx.font = '46px Arial,"PingFang SC",sans-serif';
    ctx.fillText(starGlyphs(person.rating ?? 1),x,209,width);
    if (dual) { ctx.fillStyle='#fff';ctx.font='20px Arial,"PingFang SC",sans-serif';ctx.fillText(personLabel(t,result,index)!,x,247,width); }
    ctx.fillStyle = '#dcfca6'; ctx.font = `${dual ? 72 : 90}px Arial,"PingFang SC",sans-serif`; ctx.fillText(person.score.toLocaleString(t.lang),x,326,width);
    ctx.fillStyle = '#fff'; ctx.font = `${dual ? 21 : 25}px Arial,"PingFang SC",sans-serif`;
    const place = resultPlace(result,index);
    const placeText = place ? `${t.t('replica.placeValue',place)} ${t.t('replica.place')}` : null;
    const values = [routeName(t,result.trackId,result.direction), formatTime(person.time),
      ...(placeText ? [placeText] : []),
      `${person.slimeHits} ${t.t('replica.slimesHit')}`, `×${person.maxCombo ?? 0} ${t.t('replica.bestCombo')}`];
    // Half-width columns: the place rides on the route line so the stats line is not squeezed.
    if (dual) { ctx.fillText([values[0]!, ...(placeText ? [placeText] : [])].join(' · '),x,376,width);
      ctx.fillText(values.slice(1).filter(value => value !== placeText).join(' · '),x,414,width); }
    else ctx.fillText(values.join(' · '),x,392,width);
  });
  // A record run is marked on the picture, top right, where a sticker would go.
  const feat = resultRecord(result);
  if (feat) {
    ctx.font = 'bold 30px Arial,"PingFang SC",sans-serif';
    const label = recordText(t, feat).replace(/^[^·]*·\s*/, m => feat.kind === 'best' ? `${t.t('card.record')} · ` : m);
    const pad = 18, textWidth = Math.min(700, ctx.measureText(label).width), boxWidth = textWidth + pad * 2;
    ctx.fillStyle = feat.kind === 'best' ? '#c8f57a' : '#7fd3ff';
    // Below the name row: the headline keeps the top line to itself.
    roundRect(ctx, 952 - boxWidth, 152, boxWidth, 54, 12); ctx.fill();
    ctx.fillStyle = '#0f2230'; ctx.fillText(label, 952 - boxWidth + pad, 189, textWidth);
  }
  ctx.fillStyle='#fff';ctx.font='22px Arial,"PingFang SC",sans-serif';ctx.fillText(t.t('replica.realRoads'),48,536,904);
}
