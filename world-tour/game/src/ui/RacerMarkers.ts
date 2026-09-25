import { tone } from './theme';

export interface MapRacer {
  id: string;
  x: number;
  z: number;
  rank: number;
  /** Human viewport index; absent for AI. */
  player?: number;
}
export function racerColor(player?: number): string {
  return player === 0 ? tone('stampDeep', 'stampLight', 0.4) : player === 1 ? tone('seaDeep', 'seaLight', 0.52) : tone('goldDeep', 'goldLight', 0.78);
}

/** Both maps use their own existing projection; only marker appearance is shared. */
export function drawMapRacer(g: CanvasRenderingContext2D, x: number, y: number, dpr: number,
  racer: MapRacer): void {
  g.save(); g.beginPath();
  if (racer.player === undefined) g.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
  else g.rect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr);
  g.fillStyle = racerColor(racer.player);
  g.strokeStyle = tone('night', 'mist', 0.04); g.lineWidth = 1.4 * dpr;
  g.fill(); g.stroke(); g.restore();
}
