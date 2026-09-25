import type { AiDifficulty } from '../bot/difficulty';
import type { RaceDirection } from '../track/Direction';
import type { TimeOfDay } from '../track/types';
import type { SlimeDensity } from './Save';
import type { Weather } from '../world/Sky';

export interface LastRaceChoice {
  trackId: string;
  direction: RaceDirection;
  playerVehicles: string[];
  playerCount: 1 | 2;
  timeOfDay: TimeOfDay;
  weather: Weather;
  slimeDensity: SlimeDensity;
  ai: boolean;
  aiDifficulty: AiDifficulty;
}

export interface ProgressData {
  totalSlimeHits: number;
  bestRunSlimeHits: number;
  achievements: string[];
  lastRace: LastRaceChoice | null;
}

export const ACHIEVEMENTS = [
  { id: 'slime-total-25', threshold: 25 },
  { id: 'slime-run-15', threshold: 15 },
  { id: 'no-rescue', threshold: 1 },
] as const;
export type AchievementId = typeof ACHIEVEMENTS[number]['id'];

export function achievementIds(value: unknown): AchievementId[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(ACHIEVEMENTS.map(item => item.id));
  return [...new Set(value.filter((id): id is AchievementId => typeof id === 'string' && valid.has(id)))];
}

/** FNV-1a as a short base-36 tag that keeps a challenge code from being edited by hand. */
export const fnvChecksum = (text: string): string => {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
};
