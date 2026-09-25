import { expect, it } from 'vitest';
import en from '../src/ui/locales/en.json' with { type: 'json' };
import zh from '../src/ui/locales/zh.json' with { type: 'json' };

/**
 * No development details in what gets uploaded. The interface copy is the
 * part a player reads, so it names no script, no command and no task. `tools/release_audit.py` checks
 * the built artefact; this checks the one source the build reads its sentences from, where a new string
 * would otherwise only be caught after a build.
 */
const DEV_SPEAK = [/tools\//, /\bsr\.cli\b/, /python/i, /npm run/, /\btask \d/i, /任务\s*\d/, /\bTODO\b/];

it('says nothing to players about scripts, commands or tasks', () => {
  for (const [lang, locale] of [['en', en], ['zh', zh]] as const) {
    for (const [key, value] of Object.entries(locale as Record<string, string>)) {
      for (const pattern of DEV_SPEAK) {
        expect(value, `${lang} ${key}`).not.toMatch(pattern);
      }
    }
  }
});

it('uses one name for the freeway and one vocabulary for AI difficulty', () => {
  const values = Object.values(en as Record<string, string>).join('\n');
  expect(values).not.toMatch(/\bUS 101\b/);
  for (const locale of [en, zh] as Record<string, string>[]) {
    // Left three choices; their words live in start.aiOption.*, and nothing else may name them.
    expect(Object.keys(locale).filter(key => key.startsWith('aiDifficulty.'))).toEqual([]);
  }
});
