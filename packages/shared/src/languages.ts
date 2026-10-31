/**
 * Language registry.
 *
 * The app is never hardcoded to a single language pair: every screen and endpoint
 * reads from this list. Adding a language is a one-line change here, followed by
 * quality testing with the chosen provider (see docs/BENCHMARKS.md).
 */

export interface Language {
  /** ISO 639-1 code. Also what speech providers expect as a language hint. */
  code: string;
  /** Name in English, for sorting and for screen readers using English UI. */
  englishName: string;
  /** Name in the language itself, shown next to the English name. */
  nativeName: string;
  /** Text direction, applied to captions so right-to-left scripts render correctly. */
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES = [
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', dir: 'ltr' },
  { code: 'en', englishName: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', dir: 'ltr' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
  { code: 'it', englishName: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', dir: 'ltr' },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'tl', englishName: 'Tagalog', nativeName: 'Tagalog', dir: 'ltr' },
  { code: 'uk', englishName: 'Ukrainian', nativeName: 'Українська', dir: 'ltr' },
  { code: 'vi', englishName: 'Vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr' },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const byCode = new Map<string, Language>(LANGUAGES.map((language) => [language.code, language]));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && byCode.has(value);
}

export function getLanguage(code: LanguageCode): Language {
  const language = byCode.get(code);
  if (!language) throw new Error(`Unknown language code: ${code}`);
  return language;
}

/** "Japanese · 日本語", or just "English" when both names match. */
export function languageLabel(language: Language): string {
  return language.englishName === language.nativeName
    ? language.englishName
    : `${language.englishName} · ${language.nativeName}`;
}
