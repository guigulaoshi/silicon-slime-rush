import { describe, expect, it } from 'vitest';
import en from '../src/ui/locales/en.json' with { type: 'json' };
import zh from '../src/ui/locales/zh.json' with { type: 'json' };

/**
 * A player gets a file, not a format quiz. 定 GIF / MP4 / WebM 一个都不许
 *出现在玩家看得见的地方 -- so this reads every string the game can show, rather than checking one
 * dialog in one state and calling the rule kept.
 */
describe('player-visible copy', () => {
  it('never names a video or image container', () => {
    const offenders: string[] = [];
    for (const [lang, table] of [['en', en], ['zh', zh]] as const) {
      for (const [key, value] of Object.entries(table as Record<string, string>)) {
        if (/\b(gif|mp4|webm|h\.?264|avc1)\b/i.test(value)) offenders.push(`${lang}:${key} = ${value}`);
      }
    }
    expect(offenders, 'these strings tell the player a container name').toEqual([]);
  });
});
