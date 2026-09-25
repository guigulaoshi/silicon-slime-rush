/** Small, muted road scenes behind the World condition labels. All art is decorative. */
const NS = 'http://www.w3.org/2000/svg';

type Condition = 'time' | 'direction' | 'weather' | 'slimes' | 'ai';

const hills = `<path d="M0 40 Q17 30 32 37 Q48 25 64 37 L116 37 Q130 28 145 36 Q163 27 180 39 V72 H0Z" fill="#718b7d" opacity=".45"/>`;
const road = `<path d="M73 39 H107 L180 72 H0Z" fill="#33444d" opacity=".88"/>
  <path d="M73 39 1 72 M107 39 179 72" fill="none" stroke="#9aaca8" stroke-width="1.4" opacity=".65"/>
  <path d="M90 44v3m0 7v5m0 7v6" stroke="#c0ccc3" stroke-width="1.5" opacity=".75"/>`;
const sceneBase = (extras = '') => `${hills}${road}${extras}`;
const arrow = (reverse: boolean) => reverse
  ? `<path d="M86 49h8v11h6L90 70 80 60h6z" fill="#d6ded7" opacity=".9"/>`
  : `<path d="m90 47 10 10h-6v13h-8V57h-6z" fill="#d6ded7" opacity=".9"/>`;

function slime(cx: number, cy: number, rx: number, ry: number, purple = false): string {
  const body = purple ? '#9a91ab' : '#86ad79';
  const light = purple ? '#b1a9bc' : '#a6c596';
  const eye = rx > 4 ? 1.45 : 1;
  return `<ellipse cx="${cx}" cy="${cy + ry * .78}" rx="${rx * .85}" ry="1.2" fill="#1b3235" opacity=".28"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${body}" stroke="${light}" stroke-width=".8"/>
    <ellipse cx="${cx - rx * .2}" cy="${cy - ry * .35}" rx="${rx * .42}" ry="${ry * .3}" fill="${light}" opacity=".36"/>
    <ellipse cx="${cx - rx * .3}" cy="${cy - ry * .05}" rx="${eye}" ry="${eye * 1.2}" fill="#ebf0e7"/>
    <ellipse cx="${cx + rx * .3}" cy="${cy - ry * .05}" rx="${eye}" ry="${eye * 1.2}" fill="#ebf0e7"/>
    <circle cx="${cx - rx * .3}" cy="${cy}" r=".65" fill="#213737"/>
    <circle cx="${cx + rx * .3}" cy="${cy}" r=".65" fill="#213737"/>`;
}

const cars = {
  // The rear views share the same road depth. The body type, not car count, signals difficulty.
  relaxed: `<ellipse cx="90" cy="66" rx="11" ry="2" fill="#1b3034" opacity=".4"/>
    <path d="M82 52q0-8 8-8t8 8l2 11q0 3-3 3H83q-3 0-3-3z" fill="#c5d0c9" stroke="#748d8c" stroke-width="1"/>
    <path d="M84 52q1-6 6-6t6 6v4H84z" fill="#607d87" opacity=".85"/>
    <circle cx="84" cy="60" r="1.7" fill="#9c6862"/><circle cx="96" cy="60" r="1.7" fill="#9c6862"/>
    <path d="M86 65h8" stroke="#77a4a8" stroke-width="1.5"/>`,
  rush: `<ellipse cx="90" cy="67" rx="14" ry="2" fill="#1b3034" opacity=".4"/>
    <path d="M74 50h32m-29-2h26" stroke="#343e44" stroke-width="2.2"/>
    <path d="M76 56q3-7 10-8h8q7 1 10 8l2 8q0 3-5 3H79q-5 0-5-3z" fill="#b68866" stroke="#d3ad87" stroke-width="1"/>
    <path d="M83 54q2-4 5-4h4q3 0 5 4v3H83z" fill="#394d56"/>
    <path d="M76 61h8m12 0h8" stroke="#ba6760" stroke-width="2"/>
    <path d="M81 66h18" stroke="#354149" stroke-width="2"/>`,
};

const SCENES: Record<Condition, Record<string, string>> = {
  time: {
    day: `${sceneBase('<circle cx="90" cy="27" r="9" fill="#e5e6c7" opacity=".82"/>')}`,
    night: `${sceneBase('<circle cx="90" cy="24" r="7" fill="#c0c5d4" opacity=".7"/><circle cx="93" cy="21" r="7" fill="#27394b"/><path d="M17 17h1m20 7h1m91-10h1m29 11h1" stroke="#a8b8c3" opacity=".55"/>')}`,
  },
  direction: {
    forward: sceneBase(arrow(false)),
    reverse: sceneBase(arrow(true)),
  },
  weather: {
    clear: sceneBase('<circle cx="90" cy="27" r="9" fill="#e5e6c7" opacity=".82"/><path d="M17 28h24m99-4h20" stroke="#d4dfd1" stroke-width="2" opacity=".45"/>'),
    fog: sceneBase('<path d="M0 33h180M0 45h180M0 58h180" stroke="#9aa9ad" stroke-width="9" opacity=".32"/>'),
    rain: sceneBase('<path d="M16 14 11 29m22-11-5 15m27-17-5 15m37-18-5 14m34-11-5 18m29-17-5 16m27-15-5 16" stroke="#9bb4b9" opacity=".55"/><path d="m119 36-7 10h6l-6 12 14-17h-6l5-5z" fill="#c6bb8b" opacity=".85"/>'),
    snow: sceneBase('<path d="M0 63 50 52 60 64 0 72zm180 0-50-11-10 12 60 8z" fill="#aabcc1" opacity=".45"/><path d="M23 17v8m-4-4h8m32 5v7m-4-3h8m54-16v8m-4-4h8m30 12v7m-4-3h8" stroke="#cbd6d4" opacity=".7"/>'),
  },
  slimes: {
    none: sceneBase(),
    normal: sceneBase(slime(54, 61, 12, 10) + slime(126, 59, 10, 9) + slime(97, 47, 5, 5, true)),
    many: sceneBase(slime(42, 61, 15, 12) + slime(137, 62, 16, 13) + slime(91, 61, 11, 9, true)
      + slime(69, 52, 7, 6) + slime(113, 50, 7, 6) + slime(96, 44, 4, 4)),
  },
  ai: {
    none: sceneBase(),
    relaxed: sceneBase(cars.relaxed),
    rush: sceneBase(cars.rush),
  },
};

export function conditionScene(condition: Condition, value: string): SVGSVGElement {
  const scene = document.createElementNS(NS, 'svg');
  scene.setAttribute('class', 'sm-condition-scene');
  scene.setAttribute('viewBox', '0 0 180 72');
  scene.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  scene.setAttribute('aria-hidden', 'true');
  // SVG indentation is decoration too: whitespace text nodes would change button.textContent.
  scene.innerHTML = (SCENES[condition][value] ?? '').replace(/>\s+</g, '><').trim();
  return scene;
}
