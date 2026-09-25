import { clamp, engineHz, IDLE_HZ, REDLINE_HZ } from './curves';

export interface EngineVoice {
  electric: boolean;
  idle: number;
  redline: number;
  speedScale: number;
  wave: OscillatorType;
  subWave: OscillatorType;
  ratio: number;
  detune: number;
  gain: number;
  intake: number;
}

/** Original synthetic voices: no manufacturer recordings or additional downloads. */
export const ENGINE_VOICES: Readonly<Record<string, EngineVoice>> = {
  'micro-hatch': { electric: true, idle: 110, redline: 470, speedScale: 1, wave: 'sine', subWave: 'sine', ratio: 2, detune: 0, gain: 0.28, intake: 0.015 },
  'sports-car': { electric: false, idle: 52, redline: 190, speedScale: 1, wave: 'sawtooth', subWave: 'sawtooth', ratio: 0.5, detune: 9, gain: 1, intake: 1 },
  'lightweight-sports': { electric: false, idle: 68, redline: 248, speedScale: 1.08, wave: 'triangle', subWave: 'sawtooth', ratio: 1.5, detune: 6, gain: 0.82, intake: 0.72 },
  jeep: { electric: false, idle: 44, redline: 142, speedScale: 1.22, wave: 'triangle', subWave: 'sawtooth', ratio: 0.75, detune: 5, gain: 0.9, intake: 0.65 },
  'pickup-travel-trailer': { electric: false, idle: 32, redline: 108, speedScale: 1.4, wave: 'triangle', subWave: 'square', ratio: 0.5, detune: 4, gain: 0.75, intake: 0.5 },
  'monster-truck': { electric: false, idle: 28, redline: 96, speedScale: 1.3, wave: 'sawtooth', subWave: 'square', ratio: 0.5, detune: 3, gain: 1.05, intake: 1.25 },
  'school-bus': { electric: false, idle: 26, redline: 76, speedScale: 1.8, wave: 'sawtooth', subWave: 'triangle', ratio: 0.5, detune: 15, gain: 0.85, intake: 1.4 },
  'retro-van': { electric: false, idle: 39, redline: 126, speedScale: 1.55, wave: 'square', subWave: 'triangle', ratio: 1.5, detune: 12, gain: 0.55, intake: 1.2 },
  'city-pod': { electric: true, idle: 180, redline: 780, speedScale: 1, wave: 'sine', subWave: 'triangle', ratio: 3, detune: 0, gain: 0.18, intake: 0.008 },
};

export function voiceHz(voice: EngineVoice, speed: number, throttle: number): number {
  if (voice.electric) return voice.idle + Math.min(Math.abs(speed) / 38, 1.4) * (voice.redline - voice.idle);
  // Keep the existing gearbox owner; each engine changes its register and shift road speeds.
  const fraction = (engineHz(speed * voice.speedScale, throttle) - IDLE_HZ) / (REDLINE_HZ - IDLE_HZ);
  return voice.idle + fraction * (voice.redline - voice.idle);
}

/** Runtime note driven by the same measured powertrain state shown on the instrument. */
export function voiceHzFromRpm(voice: EngineVoice, rpmFraction: number, throttle: number): number {
  const load = voice.electric ? 1 : 0.94 + 0.06 * clamp(throttle, 0, 1);
  return (voice.idle + clamp(rpmFraction, 0, 1) * (voice.redline - voice.idle)) * load;
}

export function voiceLevel(voice: EngineVoice, speed: number): number {
  // Electric drive is silent while stationary, even with a pedal held; no combustion idle.
  return voice.gain * (voice.electric ? clamp(Math.abs(speed) / 4, 0, 1) : 1);
}
