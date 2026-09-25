import type { I18n } from './i18n';
import { el } from './Ui';

/** How long a lost 3D context may take to come back before the player is told what to do. */
export const GRAPHICS_RESTORE_SECONDS = 5;

/**
 * A phone can lose the game's 3D context mid-race (GPU memory pressure). Three.js already
 * asks the browser to restore it; this tells the player what is happening instead of leaving a frozen
 * picture, and when it does not come back, says the one thing that fixes it: a full browser restart,
 * because a browser that lost its GPU this way keeps 3D switched off for the site until then.
 */
export class GraphicsLossNotice {
  readonly node = el('div', 'graphics-loss');
  private readonly text = el('p');
  private readonly reload = el('button', 'graphics-loss-reload') as HTMLButtonElement;
  private canvas: HTMLCanvasElement | null = null;
  private timer: number | undefined;
  lost = false;

  constructor(private readonly i18n: I18n, private readonly schedule = window.setTimeout.bind(window),
    private readonly cancel = window.clearTimeout.bind(window)) {
    this.node.hidden = true;
    this.node.setAttribute('role', 'alert');
    this.reload.type = 'button';
    this.reload.onclick = () => location.reload();
    this.node.append(this.text, this.reload);
  }

  private readonly onLost = () => {
    this.lost = true;
    this.show('graphics.lost.recovering', false);
    this.cancel(this.timer);
    this.timer = this.schedule(() => { if (this.lost) this.show('graphics.lost.failed', true); }, GRAPHICS_RESTORE_SECONDS * 1000);
  };

  private readonly onRestored = () => {
    this.lost = false;
    this.cancel(this.timer);
    this.node.hidden = true;
  };

  /** Follow the canvas the game is drawing into; call again whenever the renderer is replaced. */
  watch(canvas: HTMLCanvasElement | null): void {
    this.canvas?.removeEventListener('webglcontextlost', this.onLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onRestored);
    this.canvas = canvas;
    canvas?.addEventListener('webglcontextlost', this.onLost);
    canvas?.addEventListener('webglcontextrestored', this.onRestored);
    this.onRestored();
  }

  private show(key: string, offerReload: boolean): void {
    this.text.textContent = this.i18n.t(key);
    this.reload.textContent = this.i18n.t('graphics.lost.reload');
    this.reload.hidden = !offerReload;
    this.node.hidden = false;
  }

  dispose(): void { this.watch(null); this.node.remove(); }
}
