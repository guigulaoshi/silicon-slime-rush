import { delta, projectOnSample, type Projection } from '../track/Progress';
import type { Spline } from '../track/Spline';

export const TRAFFIC_HEADWAY = 1.2;
/** A car ahead blocks a lane when nearer than this, or reached within `PASS_REACH_S` at the closing speed. */
export const PASS_REACH_M = 15;
export const PASS_REACH_S = 5;
/** A new way to go must beat the current one by this much speed over PLAN_SECONDS before it is taken, m/s. */
export const LANE_GAIN_MS = 2;
/** Side clearance below which another car occupies a line; passing lines themselves keep `margin` + .15 m. */
export const LANE_MARGIN = .15;
/** The least room left behind when merging in front of another car, metres. */
export const MERGE_GAP_M = 8;
/** How far ahead, in seconds, the ways to go are compared. */
export const PLAN_SECONDS = 8;
/** Progress credited to a line with nothing in reach, metres: more than any bounded alternative. */
export const OPEN_ROAD_PROGRESS_M = 1000;
/** Road ahead needed per metre of sideways move to steer onto another line, metres. */
export const TURN_RADIUS_M = 6;
/** Distances tried when backing up, metres. */
export const REVERSE_OPTIONS_M = [3, 6] as const;
/** Planning speeds for the reverse and for pulling out afterwards, m/s. */
export const REVERSE_SPEED_MS = 2;
/** Walking pace a car may keep to steer out onto a line it has chosen and has the room to reach. */
const PASS_CRAWL_MS = 2;
/** Road left before the car ahead at which a move already under way gives up and stops. */
const PASS_CRAWL_STOP_M = 1;
export const REVERSE_EXIT_MS = 6;

/** A collision body expressed in the race's existing road frame; trailers are separate bodies. */
export interface TrafficBody {
  /** Actual hull pose, needed to check the straight reverse manoeuvre against curved road edges. */
  pose?: { x: number; z: number; headingX: number; headingZ: number; halfWidth: number; halfLength: number };
  driver: string;
  s: number;
  lateral: number;
  halfWidth: number;
  halfLength: number;
  speed: number;
}
export interface TrafficPlan { laneClear: boolean; offset: number; speed: number; following: boolean; reverse: boolean; reverseMetres?: number; reverseSafe: boolean }

/** Pick a body-sized passing corridor, or leave braking room behind the nearest blocked corridor. */
export function planTraffic(spline: Spline, at: Projection, own: readonly TrafficBody[],
  bodies: readonly TrafficBody[], speed: number, braking: number, previous: number, preferred = 0, headway = TRAFFIC_HEADWAY): TrafficPlan {
  // Road edge keeps its clearance; car to car keeps almost none. so a pass is planned to
  // the paint. What is NOT dropped is that a car still blocks the line it sits in: scoring one as a cost
  // to be paid rather than a car to be passed cost the sports car a fifth of its lap on fishermans-wharf
  // (ai-pace: 137 s -> 158 s, three quarters of it spent following) and stopped the driver dead
  // against a parked car it thought it could squeeze past (ai-driving 185).
  const margin = .8, carGap = .2;
  const halfWidth = Math.max(...own.map(body => body.halfWidth));
  const front = Math.max(...own.map(body => delta(at.s, body.s, spline.length, spline.closed) + body.halfLength));
  const rear = Math.max(...own.map(body => -delta(at.s, body.s, spline.length, spline.closed) + body.halfLength));
  const scan = Math.min(100, Math.max(30, speed * speed / (2 * braking) + speed + 15));
  const nearby = bodies.filter(body => body.driver !== own[0]!.driver).map(body => ({ body,
    distance: delta(at.s, body.s, spline.length, spline.closed) }))
    .filter(({ body, distance }) => distance + body.halfLength >= -rear - 12 && distance - body.halfLength <= scan);
  // A lane must still fit where the overtaking manoeuvre will take us, including narrow bends.
  let edge = Infinity;
  let bend = 0;
  for (let d = 0; d <= Math.min(scan, 40); d += 2)
    bend += Math.abs(spline.turnCurvature[spline.indexAt(at.s + d)] ?? 0) * 2;
  // Parallel road offsets cease to describe a usable passing lane through a hairpin.
  // Queue on the centreline before entering; resume passing once the forward corridor straightens.
  const singleFile = bend > Math.PI / 3;
  for (let d = 0; d <= Math.min(scan, 40); d += 2)
    edge = Math.min(edge, (spline.halfWidth[spline.indexAt(at.s + d)] ?? 6) - halfWidth - margin);
  edge = Math.max(0, edge);
  preferred = singleFile ? 0 : Math.max(-edge, Math.min(edge, preferred));
  // Overtake from the side like a road driver (user: "路很宽，你可以从侧面超车……像跑车这种速度快的，
  // 可以很轻松的超过前面速度慢的车"). The positions considered are where the car already is and, for each
  // car it would soon reach, just clear of that car's left and right side -- measured from both bodies,
  // so larger vehicles need no retuning. Past a car it keeps its line instead of drifting back to the
  // centre, which was one more lane change with its own speed cap.
  // Into a bend with nothing to pass, come back to the centre: a bus held in an outer lane ran wide onto
  // the synth-p2p rail. On a straight the lane is kept.
  const curving = bend > Math.PI / 6;
  const hold = singleFile ? 0 : preferred || (curving ? 0 : Math.max(-edge, Math.min(edge, previous)));
  if (!nearby.length) return { laneClear: true, offset: hold, speed: Infinity, following: false, reverse: false, reverseSafe: true };
  /* */
  const closing = (body: TrafficBody, distance: number) => {
    const gap = distance - body.halfLength - front;
    return gap < PASS_REACH_M || (speed - body.speed > 0 && gap / (speed - body.speed) < PASS_REACH_S);
  };
  const overlaps = (offset: number, body: TrafficBody) => Math.abs(offset - body.lateral) < halfWidth + body.halfWidth + LANE_MARGIN;
  const blocked = (offset: number) => nearby.filter(({ body, distance }) =>
    distance + body.halfLength > -rear - carGap && overlaps(offset, body) && (distance < 0 || closing(body, distance)));
  const current = singleFile ? 0 : preferred || hold;
  const sides = nearby.filter(({ body, distance }) => distance > 0 && closing(body, distance)).flatMap(({ body }) => [
    body.lateral - body.halfWidth - halfWidth - carGap, body.lateral + body.halfWidth + halfWidth + carGap]);
  // A slime-avoiding preference was already planned against this traffic (SlimeDriving), so it is kept.
  const candidates = singleFile || preferred ? [preferred] : [...new Set([current, 0, ...sides])]
    .filter(offset => Math.abs(offset) <= edge);
  const laneClear = candidates.filter(offset => !blocked(offset).length);
  const reachable = candidates.filter(offset => {
    // Merge in front of a car only with room for it: half a second of its travel plus whatever it gains
    // in two seconds, and never under 8 m. A sports car that cut in 3 m ahead of the bus on synth-p2p
    // set off the bus's close-stop manoeuvre at 20 m/s and slid it into the rail.
    const cutsIn = offset !== current && nearby.some(({ body, distance }) => distance < 0 && overlaps(offset, body)
      && -distance - body.halfLength - rear < Math.max(MERGE_GAP_M, body.speed * .5 + Math.max(0, body.speed - speed) * 2));
    if (cutsIn) return false;
    // Do not cut across an adjacent car while moving into another lane.
    return !own.some(self => {
      const lo = Math.min(self.lateral, offset) - self.halfWidth - carGap;
      const hi = Math.max(self.lateral, offset) + self.halfWidth + carGap;
      return nearby.some(({ body }) => {
        const distance = delta(self.s, body.s, spline.length, spline.closed);
        return distance - body.halfLength < self.halfLength + 2
          && distance + body.halfLength > -self.halfLength - 2
          && body.lateral + body.halfWidth > lo && body.lateral - body.halfWidth < hi;
      });
    });
  });
  // Every way to go is scored the same: metres gained along the route in the next PLAN_SECONDS. A line
  // with nothing it would reach in time scores as open road; otherwise the gap to the car it follows plus
  // that car's own progress.
  const scored = new Map<number, number>();
  const lineProgress = (offset: number) => scored.get(offset) ?? scored.set(offset, scoreLine(offset)).get(offset)!;
  const scoreLine = (offset: number) => {
    const ahead = blocked(offset);
    if (ahead.some(({ distance }) => distance < 0)) return -Infinity;          // a car alongside
    if (!ahead.length) return OPEN_ROAD_PROGRESS_M;
    return Math.min(...ahead.map(({ body, distance }) =>
      Math.max(0, distance - body.halfLength - front - 3) + Math.max(0, body.speed) * PLAN_SECONDS));
  };
  // A car cannot slide sideways: moving onto another line takes road ahead in proportion to the move.
  // With less room than that before the car it follows, the line is out of reach from where it stands.
  const roomAhead = Math.min(Infinity, ...nearby.filter(({ body, distance }) => distance > 0 && overlaps(at.lateral, body))
    .map(({ body, distance }) => distance - body.halfLength - front));
  // Steering out is an arc, not a diagonal: moving `d` sideways needs sqrt(2 R d) of road, so small
  // corrections are cheap and a lane's width costs about four metres. A flat metres-per-metre rate
  // promised turns the car could not finish, and it shuffled back and forth against a parked car.
  // A turn already under way is finished, not re-decided every tick: the arc is an ideal line and the real
  // car falls a little behind it, so re-deriving "is there room" abandoned the move a few centimetres
  // short, backed up, and began it again. Room for the whole turn, or a metre of road on one already begun.
  const canTurnOnto = (line: number) => roomAhead >= turnOutRoom(line)
    || (Math.abs(line - previous) < LANE_MARGIN && roomAhead > PASS_CRAWL_STOP_M);
  const turnOutRoom = (line: number) => Math.sqrt(2 * TURN_RADIUS_M * Math.abs(line - at.lateral));
  const currentProgress = lineProgress(current);
  const switchMargin = LANE_GAIN_MS * PLAN_SECONDS;
  const better = reachable.filter(offset => roomAhead >= turnOutRoom(offset) && lineProgress(offset) > currentProgress + switchMargin)
    .sort((a, b) => lineProgress(b) - lineProgress(a) || Math.abs(a - previous) - Math.abs(b - previous) || Math.abs(a) - Math.abs(b));
  const clear = laneClear.filter(offset => reachable.includes(offset));
  const offset = better[0] ?? (reachable.includes(current) ? current : clear[0] ?? current);
  // Brake for the occupied current lane until the body actually clears it, not just the target.
  let ceiling = Infinity;
  const constrain = (gap: number, leaderSpeed: number) => {
    const leader = Math.max(0, leaderSpeed), room = Math.max(0, gap - 3);
    const following = Math.min(Math.sqrt(leader * leader + 2 * braking * room), leader + room / headway);
    ceiling = Math.min(ceiling, gap <= 3 ? 0 : following);
  };
  // Right of way is one order the whole field agrees on: the car whose front is further along the route goes
  // first, a dead heat broken by driver id. Each car brakes only for cars before it in that order, so no two
  // cars can each wait for the other and no knot can lock -- its first car always has nothing to wait for.
  // Twin-peaks locked twice without it: a pickup trailer and a van each taking the other for its leader,
  // then a jeep tucked beside a pickup's tow that the trailer saw ahead while the jeep saw the tow ahead.
  const ownFront = front, me = own[0]!.driver;
  const hasRightOfWay = (body: TrafficBody, distance: number) => {
    const theirs = distance + body.halfLength;
    return theirs > ownFront || (theirs === ownFront && body.driver < me);
  };
  for (const { body, distance } of blocked(offset)) {
    if (distance < 0 || !hasRightOfWay(body, distance)) continue;
    constrain(distance - body.halfLength - front, body.speed);
  }
  // A turning trailer is behind the tow body: its lateral overlap must use its own longitudinal
  // gap. Expanding that footprint onto the tow's nose creates a phantom obstacle and stops a rig
  // whose tow is already clear from ever pulling the trailer through the available gap.
  for (const self of own) for (const { body, distance: fromLead } of nearby) {
    if (!hasRightOfWay(body, fromLead)) continue;
    const distance = delta(self.s, body.s, spline.length, spline.closed);
    if (distance < 0) continue;
    const side = Math.abs(self.lateral - body.lateral);
    if (side >= self.halfWidth + body.halfWidth + carGap) continue;
    const gap = distance - body.halfLength - self.halfLength;
    // A car level with this body and clear of it sideways is beside, not ahead: nothing to brake for.
    if (gap < 0 && side >= self.halfWidth + body.halfWidth) continue;
    constrain(gap, body.speed);
  }
  // Steering onto a line takes road, and a car whose own overlap with what it is passing holds it at
  // 0.1 m/s can never get out of that overlap. While the chosen line is clear and the road left is still
  // the road the turn needs, it may steer out at walking pace. Run that road out and it stops -- and
  // going on then scoring nothing is what makes backing up the best way on, next tick.
  if (offset !== at.lateral && !blocked(offset).length && canTurnOnto(offset))
    ceiling = Math.max(ceiling, PASS_CRAWL_MS);
  const rearClear = (room: number) => !own.some(self => {
    if (self.pose) {
      const p = self.pose;
      for (let d = 0; d <= room; d += 1) {
        const index = spline.indexAt(self.s - d), right = spline.right(index);
        const atBack = projectOnSample(spline, index, p.x - p.headingX * d, p.z - p.headingZ * d);
        const extent = Math.abs(p.headingX * right[0] + p.headingZ * right[2]) * p.halfLength
          + Math.abs(-p.headingZ * right[0] + p.headingX * right[2]) * p.halfWidth;
        if (Math.abs(atBack.lateral) + extent + margin > spline.halfWidth[index]!) return true;
      }
    }
    return nearby.some(({ body }) => {
      const distance = delta(self.s, body.s, spline.length, spline.closed);
      return distance < 0 && distance + body.halfLength > -self.halfLength - room
        && Math.abs(body.lateral - self.lateral) < body.halfWidth + self.halfWidth + carGap;
    });
  });
  // Backing up is not a stuck
  // state but one more way to go, scored like the others by progress over the next few seconds. Going on
  // is the gap it can close; backing up costs the metres reversed and pays only if, that far back, a
  // passing line opens past what blocks it. It needs the room behind, so of a knot of cars only the ones
  // with space behind them back out -- they do not all reverse into each other.
  // Only a line this car can still steer onto counts as a way forward: scoring a clear lane it no longer
  // has the road to reach made going on look perfect while the car sat still 1 m behind a parked car.
  const forwardProgress = Math.max(lineProgress(at.lateral), ...candidates.filter(canTurnOnto).map(lineProgress));
  let reverseMetres = 0;
  if (!singleFile) {
    let best = forwardProgress + switchMargin;
    for (const back of REVERSE_OPTIONS_M) {
      // Backed up `back` metres, a line opens if there is then room to turn onto it and nothing beside it.
      const opens = candidates.filter(line => roomAhead + back >= turnOutRoom(line)
        && lineProgress(line) > forwardProgress + switchMargin && !nearby.some(({ body, distance }) => {
          const ahead = distance + back;          // the same car, seen from `back` metres further back
          return ahead - body.halfLength < front + 2 && ahead + body.halfLength > -rear - 2 && overlaps(line, body);
        }));
      if (!opens.length) continue;
      const progress = -back + Math.max(0, PLAN_SECONDS - back / REVERSE_SPEED_MS) * REVERSE_EXIT_MS;
      if (progress > best && rearClear(back + 1)) { best = progress; reverseMetres = back; }
    }
  }
  return { laneClear: clear.length > 0, offset, speed: ceiling, following: Number.isFinite(ceiling),
    reverse: reverseMetres > 0, reverseMetres, reverseSafe: rearClear(2) };

}
