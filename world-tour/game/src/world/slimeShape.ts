import shapes from '../../../pipeline/sr/schema/slime-shapes.json' with { type: 'json' };
import type { SlimeKind } from './Slimes';

/** Only the giant sinks its broad base into the road, making every lane cross its body. */
export function slimeGroundFraction(kind: SlimeKind): number {
  return kind === 'colossus' ? shapes.colossusGroundFraction : 1;
}

/** Visible height/width grows gently from .8 to 1.04 across the whole population. */
export function slimeScale(kind: SlimeKind, fraction: number): [number, number, number] {
  const shape = shapes[kind];
  const radius = shape.radius[0]! + fraction * (shape.radius[1]! - shape.radius[0]!);
  const scale = roundSlimeScale(radius);
  return [scale[0] * shape.aspect[0]!, scale[1] * 2 / (1 + slimeGroundFraction(kind)),
    scale[2] * shape.aspect[1]!];
}

export function roundSlimeScale(radius: number): [number, number, number] {
  if (radius <= shapes.popper.radius[1]!) return [radius, radius * shapes.ordinaryHeightRatio, radius];
  const fraction = Math.max(0, Math.min(1, (radius - shapes.popper.radius[0]!)
    / (shapes.colossus.radius[1]! - shapes.popper.radius[0]!)));
  const ratio = shapes.heightRatio[0]! + fraction * (shapes.heightRatio[1]! - shapes.heightRatio[0]!);
  return [radius, radius * ratio, radius];
}
