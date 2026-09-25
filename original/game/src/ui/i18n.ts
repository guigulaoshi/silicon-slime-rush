import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

export type Language = 'zh' | 'en';
export const LANGUAGES: Language[] = ['zh', 'en'];

export function languagePreference(value: unknown): Language | null {
  return value === 'zh' || value === 'en' ? value : null;
}

const TABLES: Record<Language, Record<string, string>> = { en, zh };

/** Browser language, falling back to English for anything that is not Chinese. */
export function detectLanguage(nav: { language?: string; languages?: readonly string[] } = navigator): Language {
  const tag = nav.languages?.[0] ?? nav.language ?? 'en';
  return /^zh(?:-|$)/i.test(tag) ? 'zh' : 'en';
}

/**
 * Text lookup with {placeholder} substitution.
 *
 * A missing key returns the key itself rather than an empty string, so a gap shows up on screen
 * during development instead of leaving a blank the eye slides past.
 */
export class I18n {
  constructor(private language: Language = 'en') {}

  get lang(): Language {
    return this.language;
  }

  set(language: Language): void {
    this.language = language;
  }

  speed(kmh: number): { value: number; unit: 'km/h' | 'mph' } {
    return this.language === 'zh'
      ? { value: Math.round(kmh), unit: 'km/h' }
      : { value: Math.round(kmh / 1.609344), unit: 'mph' };
  }

  /** Same split as speed: metric in Chinese, US units in English. */
  mass(kg: number): { value: number; unit: 'kg' | 'lbs' } {
    return this.language === 'zh'
      ? { value: Math.round(kg), unit: 'kg' }
      : { value: Math.round(kg / 0.45359237), unit: 'lbs' };
  }

  t(key: string, vars: Record<string, string | number> = {}): string {
    const table = TABLES[this.language] ?? TABLES.en;
    const raw = table[key] ?? TABLES.en[key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  }

  /** Keys present in a table, for the parity test. */
  static keys(language: Language): string[] {
    return Object.keys(TABLES[language]).sort();
  }
}
