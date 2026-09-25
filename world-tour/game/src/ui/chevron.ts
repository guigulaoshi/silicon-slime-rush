import './chevron.css';

/**
 * Directional buttons drawn as a chevron: a 120° nose on the side it goes to and a notch of the same
 * angle on the other, like the chevron boards on a sharp bend. The outline is an SVG sized to the
 * button's real pixels, because a stretched viewBox would bend the nose away from 120°, and CSS
 * clip-path can neither round the corners nor keep an outline on the slanted edges.
 */
export type ChevronDirection = 'next' | 'back';

const SVG = 'http://www.w3.org/2000/svg';
const NOSE = Math.PI * 2 / 3;

/** Nose depth for a given height: half the height over tan(half the nose angle). */
export function chevronDepth(height: number): number {
  return height / 2 / Math.tan(NOSE / 2);
}

/** Outline of a `width` x `height` chevron, inset so a stroke of twice `inset` stays inside the box. */
export function chevronPath(width: number, height: number, direction: ChevronDirection, inset = 2): string {
  const x0 = inset, x1 = width - inset, y0 = inset, y1 = height - inset, mid = height / 2;
  const d = chevronDepth(y1 - y0), f = (n: number) => n.toFixed(1);
  const points = direction === 'next'
    ? [[x0, y0], [x1 - d, y0], [x1, mid], [x1 - d, y1], [x0, y1], [x0 + d, mid]]
    : [[x0 + d, y0], [x1, y0], [x1 - d, mid], [x1, y1], [x0 + d, y1], [x0, mid]];
  return `M${points.map(([x, y]) => `${f(x!)},${f(y!)}`).join(' L')} Z`;
}

function draw(target: Element): void {
  const svg = target.querySelector(':scope > .chevron-shape');
  const button = target as HTMLElement;
  const w = button.offsetWidth, h = button.offsetHeight;
  if (!svg || !w || !h) return;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.firstElementChild!.setAttribute('d', chevronPath(w, h, button.dataset.chevron as ChevronDirection));
}

const sizes = typeof ResizeObserver === 'undefined' ? null
  : new ResizeObserver(entries => { for (const entry of entries) draw(entry.target); });

/** Turns `button` into a chevron. Text set later must go through `chevronLabel`, not textContent. */
export function chevron(button: HTMLElement, direction: ChevronDirection): void {
  button.classList.add('chevron');
  button.dataset.chevron = direction;
  if (!button.querySelector(':scope > .chevron-shape')) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'chevron-shape'); svg.setAttribute('aria-hidden', 'true');
    svg.appendChild(document.createElementNS(SVG, 'path'));
    button.prepend(svg);
  }
  sizes?.observe(button);
  draw(button);
}

/** Sets a chevron button's text while keeping its outline. */
export function chevronLabel(button: HTMLElement, text: string): void {
  let label = button.querySelector<HTMLElement>(':scope > .chevron-label');
  if (!label) { label = document.createElement('span'); label.className = 'chevron-label'; button.append(label); }
  label.textContent = text;
}
