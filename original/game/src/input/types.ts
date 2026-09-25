import type { CarInput } from '../physics/Car';

/** Menu-level actions, produced by the same devices that drive the car. */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';

export interface Commands {
  car: CarInput;
  /** Actions that fired this frame. Edge-triggered: each press appears exactly once. */
  actions: MenuAction[];
  /** One-shot game requests, also edge-triggered. */
  reset: boolean;
  restart: boolean;
  /** Cycle this driver's race camera. */
  camera: boolean;
  /** Whichever device was used most recently, for showing the right button prompts. */
  device: 'keyboard' | 'gamepad' | 'touch';
}
