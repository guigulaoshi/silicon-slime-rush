import './loading-bar.css';

export interface LoadingBar {
  node: HTMLElement;
  /** Real progress in 0..1. It never moves backwards except through reset(). */
  set(fraction: number): void;
  reset(): void;
  readonly value: number;
}

/** Progress bar for the route loading screen. The caller owns what the fraction means. */
export function loadingBar(): LoadingBar {
  const node = document.createElement('div');
  node.className = 'loading-bar';
  node.setAttribute('role', 'progressbar');
  node.setAttribute('aria-valuemin', '0');
  node.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('div');
  fill.className = 'loading-bar-fill';
  node.append(fill);
  let value = 0;
  const draw = () => {
    fill.style.width = `${Math.round(value * 1000) / 10}%`;
    node.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    if (value >= 1) node.dataset.complete = 'true';
    else delete node.dataset.complete;
  };
  draw();
  return {
    node,
    get value() { return value; },
    set(fraction) {
      const next = Math.min(1, Math.max(0, fraction));
      if (next > value) { value = next; draw(); }
    },
    reset() {
      // Snap straight to empty: animating down from the previous load's 100% reads as a load that is already done.
      value = 0; fill.style.transition = 'none'; draw();
      void fill.offsetWidth; fill.style.transition = '';
    },
  };
}
