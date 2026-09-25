import type { I18n } from './i18n';

/** Where the badge sits: bottom-right corner, sized from the image's short side so phones and wide shots match. */
export function watermarkRect(width: number, height: number) {
  const unit = Math.max(0.5, Math.min(width, height) / 600);
  const w = Math.round(250 * unit), h = Math.round(52 * unit), margin = Math.round(14 * unit), pad = 8 * unit;
  const icon = { x: width - w - margin + pad, y: height - h - margin + pad, size: h - pad * 2 };
  return { x: width - w - margin, y: height - h - margin, width: w, height: h, unit, pad, icon };
}

/** Icon, game name and address on a dark translucent plate, readable over bright and dark scenes alike. */
export function drawWatermark(ctx: CanvasRenderingContext2D, t: I18n, icon: HTMLImageElement | null, address: string): void {
  const { x, y, width, height, unit, pad, icon: iconBox } = watermarkRect(ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.fillStyle = '#08121cb8';
  const r = 8 * unit;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath(); ctx.fill();
  const size = iconBox.size;
  if (icon) ctx.drawImage(icon, iconBox.x, iconBox.y, size, size);
  // The icon's square stays reserved even if the file failed to load, so text never lands where the icon belongs.
  const textX = iconBox.x + size + pad, textWidth = x + width - pad - textX;
  ctx.textBaseline = 'alphabetic'; ctx.shadowColor = '#000c'; ctx.shadowBlur = 3 * unit;
  ctx.fillStyle = '#dcfca6'; ctx.font = `bold ${Math.round(16 * unit)}px Arial,"PingFang SC",sans-serif`;
  ctx.fillText(t.t('app.title'), textX, y + pad + 15 * unit, textWidth);
  ctx.fillStyle = '#eef3f8'; ctx.font = `${Math.round(12 * unit)}px Arial,"PingFang SC",sans-serif`;
  ctx.fillText(address, textX, y + height - pad - 2 * unit, textWidth);
  ctx.restore();
}
