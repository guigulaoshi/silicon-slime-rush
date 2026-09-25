/**
 * Phone driving controls. The left half of the screen is a floating, left/right-only stick:
 * wherever a finger lands becomes the centre (except on the drawn arrows: those start at
 * full lock) and the horizontal drag decides how much to steer, so a
 * driver never has to find a small button while watching the road and can hold half lock through a
 * bend. The brake stays a large button on the right; throttle is automatic after the first touch.
 */
export type TouchControl = 'steer' | 'brake';

/** A small dead zone keeps a resting thumb straight; full lock is about a thumb's width away. */
export const STEER_DEAD_PX = 8;
export const STEER_FULL_PX = 72;

export function dragSteer(dx: number): number {
  const reach = Math.abs(dx);
  if (reach <= STEER_DEAD_PX) return 0;
  return Math.sign(dx) * Math.min(1, (reach - STEER_DEAD_PX) / (STEER_FULL_PX - STEER_DEAD_PX));
}

export interface TouchStick { originX: number; originY: number; dx: number }

/**
 * The resting bar is drawn with ◀ and ▶, and on an iPad players press them like buttons.
 * A finger that lands on an arrow end of the resting bar starts at full lock that way, so holding ◀
 * steers left and holding ▶ steers right, and dragging back toward the middle eases off. A finger
 * anywhere else -- the middle of the bar included, where a thumb rests -- is the centre of a floating
 * stick exactly as before, so a resting thumb never steers by itself.
 */
export const STICK_HIT_SLOP_PX = 16;
/** How far in from each end of the bar counts as the arrow: about one thumb. */
export const STICK_ARROW_PX = 44;
export interface BarBox { left: number; top: number; right: number; bottom: number }

export function barOrigin(x: number, y: number, bar: BarBox | null | undefined): { x: number; y: number } | null {
  if (!bar || bar.right <= bar.left) return null;
  if (x < bar.left - STICK_HIT_SLOP_PX || x > bar.right + STICK_HIT_SLOP_PX
    || y < bar.top - STICK_HIT_SLOP_PX || y > bar.bottom + STICK_HIT_SLOP_PX) return null;
  const centreY = (bar.top + bar.bottom) / 2;
  if (x <= bar.left + STICK_ARROW_PX) return { x: x + STEER_FULL_PX, y: centreY };
  if (x >= bar.right - STICK_ARROW_PX) return { x: x - STEER_FULL_PX, y: centreY };
  return null;
}

/**
 * Follow-up: on the live itch.io page on the player's iPad mini the ◀ / ▶ hold zones did not
 * steer at all and the brake zone's hit area did not match its drawn button, while the plain pause
 * <button> worked exactly. That points at the pointer path -- an invisible zone, pointer capture and
 * a lift on pointercancel / lostpointercapture -- which Safari in that iframe cuts short. On iPhone
 * and iPad the visible buttons therefore listen to native touch events themselves: touchstart holds
 * the control for each new touch identifier, touchend / touchcancel release exactly those, and nothing
 * depends on pointer capture, pointermove or lostpointercapture. Android keeps the pointer path.
 */
export type TouchButtonControl = 'left' | 'right' | 'brake';
let activeTouchInput: TouchInput | null = null;

interface TouchLikeEvent extends Event { changedTouches: ArrayLike<{ identifier: number }> }
export function bindTouchButton(button: HTMLElement, control: TouchButtonControl, held: HTMLElement = button): void {
  const start = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
    for (const t of Array.from((e as TouchLikeEvent).changedTouches ?? [])) activeTouchInput?.pressTouch(t.identifier, control, held);
  };
  const end = (e: Event): void => {
    for (const t of Array.from((e as TouchLikeEvent).changedTouches ?? [])) activeTouchInput?.releaseTouch(t.identifier);
  };
  button.addEventListener('touchstart', start, { passive: false });
  button.addEventListener('touchend', end);
  button.addEventListener('touchcancel', end);
}

export class TouchInput {
  /** Menus count as a first gesture, but only the driving controls can hold one. */
  used = false;
  private steering: { id: number; originX: number; originY: number; x: number; zone?: HTMLElement } | null = null;
  private readonly brakes = new Map<number, HTMLElement | undefined>();
  /** Native touch identifiers held on the iPhone / iPad buttons (see bindTouchButton). */
  private readonly touches = new Map<number, { control: TouchButtonControl; element?: HTMLElement }>();
  private attached: EventTarget | null = null;

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.used = true;
    const element = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-touch-control]') : null;
    const control = element?.dataset.touchControl;
    if (control !== 'steer' && control !== 'brake') return;
    e.preventDefault();
    if (control === 'brake') this.brakes.set(e.pointerId, element!);
    else if (!this.steering) {
      const bar = element!.ownerDocument.querySelector<HTMLElement>('[data-touch-anchor="steer"]')?.getBoundingClientRect();
      const origin = barOrigin(e.clientX, e.clientY, bar) ?? { x: e.clientX, y: e.clientY };
      this.steering = { id: e.pointerId, originX: origin.x, originY: origin.y, x: e.clientX, zone: element! };
    } else return;
    element!.dataset.held = 'true';
    // Captured, so a drag that leaves the left half keeps steering until the finger lifts.
    if (e.isTrusted) element!.setPointerCapture(e.pointerId);
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (this.steering?.id === e.pointerId) this.steering.x = e.clientX;
  };
  private readonly onUp = (e: PointerEvent): void => { this.lift(e.pointerId); };
  /**
   * A pointerdown's preventDefault does not stop the browser's own touch gestures. On iOS the
   * page pan (the game sits in itch.io's scrolling page on an iPad), the long-press callout and the
   * text loupe all start from touchstart/touchmove, take the finger over and send pointercancel, which
   * lifts the stick. Cancelling the touch events themselves keeps the finger with the game. Safari
   * makes window listeners passive by default, so these are registered with passive:false.
   */
  private readonly onTouchStart = (e: TouchEvent): void => {
    if (!e.cancelable) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-touch-control]')) e.preventDefault();
  };
  private readonly onTouchMove = (e: TouchEvent): void => {
    if (e.cancelable && (this.steering || this.brakes.size || this.touches.size)) e.preventDefault();
  };
  private readonly onContextMenu = (e: Event): void => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.touch-controls')) e.preventDefault();
  };

  attach(target: EventTarget): this {
    if (this.attached) return this;
    target.addEventListener('pointerdown', this.onDown as EventListener);
    target.addEventListener('pointermove', this.onMove as EventListener);
    target.addEventListener('pointerup', this.onUp as EventListener);
    target.addEventListener('pointercancel', this.onUp as EventListener);
    target.addEventListener('lostpointercapture', this.onUp as EventListener);
    target.addEventListener('touchstart', this.onTouchStart as EventListener, { passive: false });
    target.addEventListener('touchmove', this.onTouchMove as EventListener, { passive: false });
    target.addEventListener('contextmenu', this.onContextMenu);
    this.attached = target;
    activeTouchInput = this;
    return this;
  }

  detach(): void {
    const target = this.attached;
    if (!target) return;
    target.removeEventListener('pointerdown', this.onDown as EventListener);
    target.removeEventListener('pointermove', this.onMove as EventListener);
    target.removeEventListener('pointerup', this.onUp as EventListener);
    target.removeEventListener('pointercancel', this.onUp as EventListener);
    target.removeEventListener('lostpointercapture', this.onUp as EventListener);
    target.removeEventListener('touchstart', this.onTouchStart as EventListener);
    target.removeEventListener('touchmove', this.onTouchMove as EventListener);
    target.removeEventListener('contextmenu', this.onContextMenu);
    this.attached = null;
    if (activeTouchInput === this) activeTouchInput = null;
    this.clear();
  }

  clear(): void {
    if (this.steering?.zone) delete this.steering.zone.dataset.held;
    for (const element of this.brakes.values()) if (element) delete element.dataset.held;
    for (const held of this.touches.values()) if (held.element) delete held.element.dataset.held;
    this.steering = null;
    this.brakes.clear();
    this.touches.clear();
  }

  get brake(): number { return this.brakes.size || [...this.touches.values()].some(t => t.control === 'brake') ? 1 : 0; }

  pressTouch(identifier: number, control: TouchButtonControl, element?: HTMLElement): void {
    this.used = true;
    this.touches.set(identifier, { control, element });
    if (element) element.dataset.held = 'true';
  }

  releaseTouch(identifier: number): void {
    const held = this.touches.get(identifier);
    if (!held || !this.touches.delete(identifier)) return;
    if (held.element && ![...this.touches.values()].some(t => t.element === held.element)) delete held.element.dataset.held;
  }

  /** Continuous -1..1 from the drag, or full lock from a held ◀ / ▶ (both held cancel out); zero when no steering finger is down. */
  get steer(): number {
    if (this.steering) return dragSteer(this.steering.x - this.steering.originX);
    const dirs = new Set<number>();
    for (const t of this.touches.values()) if (t.control !== 'brake') dirs.add(t.control === 'left' ? -1 : 1);
    let sum = 0;
    for (const dir of dirs) sum += dir;
    return sum;
  }

  /** True while a finger owns the stick: its value then goes to the car directly, like a pad stick. */
  get steeringHeld(): boolean {
    return this.steering !== null || [...this.touches.values()].some(t => t.control !== 'brake');
  }

  get stick(): TouchStick | null {
    const s = this.steering;
    return s ? { originX: s.originX, originY: s.originY, dx: s.x - s.originX } : null;
  }

  /** Test seam: put a finger on a control; a steering finger can then be dragged with `drag`. */
  simulate(id: number, control: TouchControl, x = 0, y = 0): void {
    this.used = true;
    if (control === 'brake') this.brakes.set(id, undefined);
    else if (!this.steering) this.steering = { id, originX: x, originY: y, x };
  }

  drag(id: number, dx: number): void {
    if (this.steering?.id === id) this.steering.x = this.steering.originX + dx;
  }

  lift(id: number): void {
    if (this.steering?.id === id) {
      if (this.steering.zone) delete this.steering.zone.dataset.held;
      this.steering = null;
    }
    const element = this.brakes.get(id);
    if (!this.brakes.delete(id)) return;
    if (element && ![...this.brakes.values()].includes(element)) delete element.dataset.held;
  }
}
