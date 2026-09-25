import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { FINISH_ROLLOUT_DISTANCE } from '../src/app/Racer';
import { Autopilot, autopilotSettingsFor, STOP_HOLD_DISTANCE } from '../src/bot/Autopilot';
import { Race } from '../src/track/Race';
import { parseTrack } from '../src/track/schema';
import { Spline } from '../src/track/Spline';
import { defaultVehicle, vehicleTuning } from '../src/vehicles/catalogue';
import type { TrackData } from '../src/track/types';

const path = resolve(process.cwd(), 'public/tracks/synth-p2p/track.json');

it.skipIf(!existsSync(path))('a robot car creeping up to the line still crosses it before holding still', () => {
  expect(FINISH_ROLLOUT_DISTANCE).toBeGreaterThan(STOP_HOLD_DISTANCE);
  const track = parseTrack(JSON.parse(readFileSync(path, 'utf-8')));
  const spline = new Spline(track);
  const race = new Race(track, spline); race.start();
  const vehicle = defaultVehicle(track);
  const bot = new Autopilot(spline, autopilotSettingsFor(vehicleTuning(vehicle, vehicle.tuning as TrackData['car'])));
  const at = race.progress.value;
  const p = spline.point(at.index), t = spline.tangent(at.index);
  const view = { raceTime: 0, lap: 1, x: p[0], z: p[2], speed: .2, forwardSpeed: .2, gripping: true,
    headingX: t[0], headingZ: t[2], slimeAhead: null,
    steeringTransitionSpeed: () => 99, steeringSpeedLimit: () => 99, steeringInputForCurvature: () => 0 };
  // 30 cm before the finish line, nearly stopped: the stop point is the line plus the rollout.
  expect(bot.drive(1 / 60, view, at, .3 + FINISH_ROLLOUT_DISTANCE).throttle).toBeGreaterThan(0);
  // Inside the hold distance of its stop point it does hold still.
  bot.reset();
  expect(bot.drive(1 / 60, view, at, STOP_HOLD_DISTANCE - 1).throttle).toBe(0);
});
