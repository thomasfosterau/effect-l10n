// Locale negotiation and fallback over canonical BCP 47 tags. Plain
// JavaScript with no imports, so the web target can inline it into the
// runtime it emits.

const lower = (tag: string): string => tag.toLowerCase();

/** The tag with its last subtag dropped, and any single-letter one before it. */
const truncate = (tag: string): string | undefined => {
  const subtags = tag.split("-");
  subtags.pop();
  while (subtags.length > 0 && subtags[subtags.length - 1]?.length === 1) subtags.pop();
  return subtags.length > 0 ? subtags.join("-") : undefined;
};

/**
 * RFC 4647 lookup: the first available tag that a requested range, or a
 * truncation of it, names.
 */
export const lookup = (
  requested: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
): string | undefined => {
  const byLower = new Map(available.map((tag) => [lower(tag), tag]));
  for (const range of requested) {
    for (let tag: string | undefined = range; tag !== undefined; tag = truncate(tag)) {
      const found = byLower.get(lower(tag));
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

interface Parts {
  readonly language: string;
  readonly script: string | undefined;
  readonly region: string | undefined;
}

const parts = (tag: string): Parts => {
  const locale = new Intl.Locale(tag);
  const maximized = locale.maximize();
  return {
    language: locale.language,
    script: maximized.script,
    region: locale.region,
  };
};

/**
 * Best fit: a requested locale's own match first, then an available locale
 * of the same language and script (`en-AU` for `en-GB`, never `zh-Hant` for
 * `zh-CN`), preferring one without a region.
 */
export const bestFit = (
  requested: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
): string | undefined => {
  const candidates = available.map((tag) => ({ tag, parts: parts(tag) }));
  for (const range of requested) {
    const exact = lookup([range], available);
    if (exact !== undefined) return exact;
    const want = parts(range);
    const same = candidates.filter(
      ({ parts: have }) => have.language === want.language && have.script === want.script,
    );
    const best = same.find(({ parts: have }) => have.region === undefined) ?? same[0];
    if (best !== undefined) return best.tag;
  }
  return undefined;
};

// CLDR `parentLocales` for the commonly used regional variants; others
// truncate. See https://github.com/unicode-org/cldr-json (supplemental).
const parents: Readonly<Record<string, string>> = {
  "en-150": "en-001",
  "en-AU": "en-001",
  "en-CA": "en-001",
  "en-GB": "en-001",
  "en-HK": "en-001",
  "en-IE": "en-001",
  "en-IN": "en-001",
  "en-NZ": "en-001",
  "en-SG": "en-001",
  "en-ZA": "en-001",
  "en-AT": "en-150",
  "en-BE": "en-150",
  "en-CH": "en-150",
  "en-DE": "en-150",
  "en-DK": "en-150",
  "en-FI": "en-150",
  "en-NL": "en-150",
  "en-SE": "en-150",
  "es-AR": "es-419",
  "es-BO": "es-419",
  "es-CL": "es-419",
  "es-CO": "es-419",
  "es-CR": "es-419",
  "es-CU": "es-419",
  "es-DO": "es-419",
  "es-EC": "es-419",
  "es-GT": "es-419",
  "es-HN": "es-419",
  "es-MX": "es-419",
  "es-NI": "es-419",
  "es-PA": "es-419",
  "es-PE": "es-419",
  "es-PR": "es-419",
  "es-PY": "es-419",
  "es-SV": "es-419",
  "es-US": "es-419",
  "es-UY": "es-419",
  "es-VE": "es-419",
  "pt-AO": "pt-PT",
  "pt-CH": "pt-PT",
  "pt-CV": "pt-PT",
  "pt-GQ": "pt-PT",
  "pt-GW": "pt-PT",
  "pt-LU": "pt-PT",
  "pt-MO": "pt-PT",
  "pt-MZ": "pt-PT",
  "pt-ST": "pt-PT",
  "pt-TL": "pt-PT",
  "zh-Hant-MO": "zh-Hant-HK",
};

/**
 * The CLDR parent of a canonical tag: a `parentLocales` entry, else the
 * truncation, except that a script other than the language's default (such
 * as `zh-Hant` or `sr-Latn`) has no parent but the root.
 */
export const parent = (tag: string): string | undefined => {
  const listed = parents[tag];
  if (listed !== undefined) return listed;
  const locale = new Intl.Locale(tag);
  const otherScript =
    locale.script !== undefined &&
    locale.region === undefined &&
    new Intl.Locale(locale.language).maximize().script !== locale.script;
  return otherScript ? undefined : truncate(tag);
};
