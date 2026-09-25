import { SHOWCASE_IMAGE } from '../app/showcase';
import { chevron, chevronLabel } from './chevron';
import type { I18n } from './i18n';
import { el } from './Ui';
import { renderBrandSignature, renderLanguageToggle } from './Replica';
import { fullscreenButton } from '../app/fullscreen';

/** One opening, one line: language changes translate the same choice. */
export function home(i18n: I18n, enter: () => void, language: () => void,
  settings: () => void, about: () => void, variant = Math.random() < .5 ? 0 : 1, share?: () => void, shortcut?: () => void,
  quick?: { start(): void; detail(): string; ready(): boolean }) {
  const node = el('section', 'home');
  const image = el('img', 'home-scene') as HTMLImageElement;
  image.alt = '';
  image.decoding = 'async';
  image.addEventListener('load', () => image.classList.add('ready'));
  image.src = SHOWCASE_IMAGE;
  // The live scene's last frame, drawn in by Game when the page gives that scene's world back. The
  // shipped picture is an older render; coming back, this frame is what stands in until the orbit runs.
  const still = el('canvas', 'home-still') as HTMLCanvasElement;
  still.setAttribute('aria-hidden', 'true');
  const header = el('header', 'home-header');
  const title = el('h1', 'home-title');
  const name = el('h1', 'home-name');
  const lang = el('button', 'home-language');
  lang.addEventListener('click', language);
  header.append(title, lang);
  const body = el('div', 'home-copy');
  const place = el('p', 'home-place');
  const slogan = el('h2', 'home-slogan');
  const story = el('p', 'home-story');
  const go = el('button', 'home-go cta') as HTMLButtonElement;
  chevron(go, 'next');
  go.addEventListener('click', enter);
  // One press into a race with the last race's settings (a first visit gets the defaults),
  // above the full three-step route choice.
  const quickButton = el('button', 'home-quick') as HTMLButtonElement;
  const quickTitle = el('span', 'home-quick-title');
  const quickDetail = el('span', 'home-quick-detail');
  quickButton.append(quickTitle, quickDetail);
  quickButton.hidden = !quick;
  if (quick) quickButton.addEventListener('click', () => { if (quick.ready()) quick.start(); });
  const promise = el('p', 'home-promise');
  // The two ways into a race come straight after the slogan, the longer story below them: behind the
  // story they sat at the very bottom of a 720-high window (使用者:.
  body.append(place, name, slogan, quickButton, go, promise, story);
  const footer = el('footer', 'home-footer');
  const settingsButton = el('button');
  const aboutButton = el('button');
  settingsButton.addEventListener('click', settings);
  aboutButton.addEventListener('click', about);
  const shareButton = el('button', 'home-share') as HTMLButtonElement;
  shareButton.hidden = !share; shareButton.onclick = share ?? null;
  const fullscreen = fullscreenButton(i18n, 'home-fullscreen', shortcut);
  footer.append(settingsButton, aboutButton, shareButton, ...fullscreen.nodes);
  node.append(image, still, header, body, footer);
  function render() {
    renderBrandSignature(title, i18n, true);
    if (i18n.lang === 'zh') {
      name.replaceChildren(document.createTextNode('史莱姆赛车'), el('span', '', '环游世界'));
    } else {
      const secondLine = el('span', '', '');
      secondLine.append(el('span', 'brand-word-rush', 'WORLD TOUR'));
      name.replaceChildren(document.createTextNode('SILICON '), el('span', 'brand-word-slime', 'SLIME RUSH'), secondLine);
    }
    renderLanguageToggle(lang, i18n);
    place.textContent = i18n.t('home.place');
    const line=i18n.t(`home.slogan.${variant}`),separator=i18n.lang==='zh'?'，':'. ';
    const split=line.indexOf(separator)+separator.length;
    slogan.replaceChildren(document.createTextNode(line.slice(0,split)),document.createElement('br'),document.createTextNode(line.slice(split)));
    story.textContent = i18n.t('home.story');
    chevronLabel(go, i18n.t('home.go'));
    quickTitle.textContent = i18n.t('home.quick');
    quickDetail.textContent = quick?.detail() ?? '';
    // Not before the route's own defaults (car, time of day) have arrived: pressed earlier, the race
    // would start with placeholders the three-step flow never lets through.
    quickButton.disabled = !quick?.ready();
    promise.textContent = i18n.t('home.promise');
    settingsButton.textContent = i18n.t('menu.settings');
    aboutButton.textContent = i18n.t('menu.about');
    shareButton.textContent = i18n.t('results.share');
    fullscreen.render();
  }
  render();
  return { node, go, quick: quickButton, still, render };
}
