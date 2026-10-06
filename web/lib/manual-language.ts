/**
 * Catalog language for public.manuals.
 *
 * ISO 639-1 codes. English is the default and is not badged.
 * A trailing title suffix such as "(German)" or "(Service Manual, German)" is parsed into the code.
 * The stored title keeps that suffix: it is how copies are told apart on
 * the shelf, in citations, and in doc-kind classifiers. The column is the
 * filter key. A non-English suffix still wins over a stored "en" so the
 * column default does not hide a labeled copy before the backfill runs.
 */

export const ALL_MANUAL_LANGUAGES = 'all';

/** Lowercased trailing "(…)" text → ISO 639-1. Keep in sync with the language migration VALUES list. */
export const MANUAL_TITLE_LANGUAGE_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ['german', 'de'],
  ['deutsch', 'de'],
  ['spanish', 'es'],
  ['español', 'es'],
  ['espanol', 'es'],
  ['french', 'fr'],
  ['français', 'fr'],
  ['francais', 'fr'],
  ['italian', 'it'],
  ['italiano', 'it'],
  ['japanese', 'ja'],
  ['日本語', 'ja'],
  ['portuguese', 'pt'],
  ['português', 'pt'],
  ['portugues', 'pt'],
  ['brazilian portuguese', 'pt'],
  ['português do brasil', 'pt'],
  ['portugues do brasil', 'pt'],
  ['chinese', 'zh'],
  ['中文', 'zh'],
  ['mandarin', 'zh'],
  ['simplified chinese', 'zh'],
  ['traditional chinese', 'zh'],
  ['dutch', 'nl'],
  ['nederlands', 'nl'],
  ['korean', 'ko'],
  ['한국어', 'ko'],
  ['russian', 'ru'],
  ['русский', 'ru'],
  ['arabic', 'ar'],
  ['العربية', 'ar'],
  ['hebrew', 'he'],
  ['עברית', 'he'],
  ['polish', 'pl'],
  ['polski', 'pl'],
  ['swedish', 'sv'],
  ['svenska', 'sv'],
  ['danish', 'da'],
  ['dansk', 'da'],
  ['norwegian', 'no'],
  ['norsk', 'no'],
  ['finnish', 'fi'],
  ['suomi', 'fi'],
  ['turkish', 'tr'],
  ['türkçe', 'tr'],
  ['turkce', 'tr'],
  ['greek', 'el'],
  ['ελληνικά', 'el'],
  ['czech', 'cs'],
  ['čeština', 'cs'],
  ['cestina', 'cs'],
  ['hungarian', 'hu'],
  ['magyar', 'hu'],
  ['romanian', 'ro'],
  ['română', 'ro'],
  ['romana', 'ro'],
  ['thai', 'th'],
  ['ไทย', 'th'],
  ['vietnamese', 'vi'],
  ['tiếng việt', 'vi'],
  ['tieng viet', 'vi'],
  ['indonesian', 'id'],
  ['bahasa indonesia', 'id'],
  ['malay', 'ms'],
  ['bahasa melayu', 'ms'],
  ['hindi', 'hi'],
  ['हिन्दी', 'hi'],
  ['farsi', 'fa'],
  ['persian', 'fa'],
  ['فارسی', 'fa'],
  ['ukrainian', 'uk'],
  ['українська', 'uk'],
  ['english', 'en'],
  ['en', 'en'],
  ['de', 'de'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['it', 'it'],
  ['ja', 'ja'],
  ['pt', 'pt'],
  ['zh', 'zh'],
  ['nl', 'nl'],
  ['ko', 'ko'],
  ['ru', 'ru'],
  ['ar', 'ar'],
  ['he', 'he'],
  ['pl', 'pl'],
  ['sv', 'sv'],
  ['da', 'da'],
  ['no', 'no'],
  ['fi', 'fi'],
  ['tr', 'tr'],
  ['el', 'el'],
  ['cs', 'cs'],
  ['hu', 'hu'],
  ['ro', 'ro'],
  ['th', 'th'],
  ['vi', 'vi'],
  ['id', 'id'],
  ['ms', 'ms'],
  ['hi', 'hi'],
  ['fa', 'fa'],
  ['uk', 'uk'],
];

const SUFFIX_TO_CODE = new Map(MANUAL_TITLE_LANGUAGE_SUFFIXES.map(([suffix, code]) => [suffix, code]));

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  pt: 'Portuguese',
  zh: 'Chinese',
  nl: 'Dutch',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  he: 'Hebrew',
  fa: 'Farsi',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  tr: 'Turkish',
  el: 'Greek',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  hi: 'Hindi',
  uk: 'Ukrainian',
};

export function normalizeManualLanguage(raw: unknown): string | null {
  const code = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .split('-')[0];
  if (/^[a-z]{2}$/.test(code)) return code;
  return null;
}

/**
 * Single-word language names used when the trailing brackets contain more
 * than the language. "(Service Manual, German)" and "(… German)" match
 * because the last word is a known name. Bare ISO codes are not last-word
 * names, so "(Model No)" and "(Service Manual, DE)" stay untagged.
 * Keep in sync with the last-word backfill migration.
 */
export const MANUAL_TITLE_LANGUAGE_LAST_WORDS: ReadonlyArray<readonly [string, string]> =
  MANUAL_TITLE_LANGUAGE_SUFFIXES.filter(
    ([suffix]) => !suffix.includes(' ') && !/^[a-z]{2}$/.test(suffix)
  );

const LAST_WORD_TO_CODE = new Map(MANUAL_TITLE_LANGUAGE_LAST_WORDS);

/** Longer phrases first so "brazilian portuguese" is not split into a leftover word. */
const LANGUAGE_NAME_ALIASES: ReadonlyArray<readonly [string, string]> = MANUAL_TITLE_LANGUAGE_SUFFIXES.filter(
  ([suffix]) => !/^[a-z]{2}$/.test(suffix)
).sort((a, b) => b[0].length - a[0].length);

function trailingParenInner(title: unknown): string | null {
  const match = String(title ?? '').match(/\(\s*([^)]+?)\s*\)\s*$/u);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim().toLowerCase();
}

function lastParenWord(inner: string): string {
  const parts = inner
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Language named by a trailing parenthetical, or null when that note is not a language.
 * The whole bracket can be a language ("(German)", "(Brazilian Portuguese)", "(EN)").
 * Otherwise only the last word counts ("(Service Manual, German)").
 */
export function languageSuffixFromTitle(title: unknown): string | null {
  const suffix = trailingParenInner(title);
  if (!suffix) return null;
  const exact = SUFFIX_TO_CODE.get(suffix);
  if (exact) return exact;
  return LAST_WORD_TO_CODE.get(lastParenWord(suffix)) || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Language names in a library query are tag filters, not text.
 * "spanish" and "español" both require language es. Leftover words stay a text query.
 * Two-letter codes are not names, so a query of "id" or "no" still searches text.
 */
export function manualQueryLanguageMatch(query: string): { codes: string[]; textQuery: string } {
  let rest = String(query ?? '')
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const codes: string[] = [];
  const seen = new Set<string>();
  for (let guard = 0; rest && guard < LANGUAGE_NAME_ALIASES.length; guard += 1) {
    let hit = false;
    for (const [alias, code] of LANGUAGE_NAME_ALIASES) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`, 'u');
      if (!re.test(rest)) continue;
      rest = rest.replace(re, ' ').replace(/\s+/g, ' ').trim();
      if (!seen.has(code)) {
        seen.add(code);
        codes.push(code);
      }
      hit = true;
      break;
    }
    if (!hit) break;
  }
  return { codes, textQuery: rest };
}

/**
 * Column when it is set, except a non-English title suffix overrides stored
 * English (the column default) so "(German)" still badges before backfill.
 */
export function resolveManualLanguage(manual: {
  language?: unknown;
  title?: string | null;
} | null | undefined): string {
  const fromTitle = languageSuffixFromTitle(manual?.title);
  const stored = normalizeManualLanguage(manual?.language);
  if (fromTitle && fromTitle !== 'en') return fromTitle;
  if (stored) return stored;
  return fromTitle || 'en';
}

export function manualLanguageLabel(code: string | null | undefined): string {
  const normalized = normalizeManualLanguage(code) || 'en';
  return LANGUAGE_NAMES[normalized] || normalized.toUpperCase();
}

/** Null for English so spines and the viewer stay unbadged. */
export function manualLanguageBadge(code: string | null | undefined): { code: string; label: string } | null {
  const normalized = normalizeManualLanguage(code);
  if (!normalized || normalized === 'en') return null;
  return { code: normalized.toUpperCase(), label: manualLanguageLabel(normalized) };
}

export type ManualLanguageOption = { value: string; label: string };

/**
 * All, then English, then other languages that these rows actually use.
 * A language with no manuals on this list is omitted, including English.
 */
export function manualLanguageFilterOptions(
  rows: Array<{ language?: unknown; title?: string | null }>
): ManualLanguageOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = resolveManualLanguage(row);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const rest = [...counts.keys()]
    .filter((code) => code !== 'en' && (counts.get(code) || 0) > 0)
    .sort((a, b) => manualLanguageLabel(a).localeCompare(manualLanguageLabel(b), 'en'));
  const options: ManualLanguageOption[] = [{ value: ALL_MANUAL_LANGUAGES, label: 'All languages' }];
  if ((counts.get('en') || 0) > 0) options.push({ value: 'en', label: 'English' });
  for (const code of rest) options.push({ value: code, label: manualLanguageLabel(code) });
  return options;
}
