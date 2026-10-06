/**
 * Organization display currency and number format.
 * Labels amounts only. Does not convert FX and does not set Stripe currency.
 * Missing or unknown values fall back to USD and the locale format.
 */

export type OrgMoneyPrefs = {
  currencyCode: string;
  numberFormat: string;
};

export type CurrencyOption = {
  code: string;
  name: string;
};

export const DEFAULT_ORG_MONEY: OrgMoneyPrefs = {
  currencyCode: 'USD',
  numberFormat: 'auto',
};

/** Shown first in the Settings dropdown. */
export const COMMON_CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'MXN',
  'BRL',
  'ILS',
  'AED',
  'SAR',
  'IRR',
  'CHF',
  'JPY',
  'INR',
] as const;

/**
 * Active ISO 4217 alphabetic codes used as the save allowlist.
 * Metals, funds, and test codes (XAU, XTS, XXX, …) are omitted.
 */
const CURRENCY_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['AED', 'UAE Dirham'],
  ['AFN', 'Afghan Afghani'],
  ['ALL', 'Albanian Lek'],
  ['AMD', 'Armenian Dram'],
  ['ANG', 'Netherlands Antillean Guilder'],
  ['AOA', 'Angolan Kwanza'],
  ['ARS', 'Argentine Peso'],
  ['AUD', 'Australian Dollar'],
  ['AWG', 'Aruban Florin'],
  ['AZN', 'Azerbaijani Manat'],
  ['BAM', 'Bosnia-Herzegovina Convertible Mark'],
  ['BBD', 'Barbadian Dollar'],
  ['BDT', 'Bangladeshi Taka'],
  ['BGN', 'Bulgarian Lev'],
  ['BHD', 'Bahraini Dinar'],
  ['BIF', 'Burundian Franc'],
  ['BMD', 'Bermudan Dollar'],
  ['BND', 'Brunei Dollar'],
  ['BOB', 'Bolivian Boliviano'],
  ['BRL', 'Brazilian Real'],
  ['BSD', 'Bahamian Dollar'],
  ['BTN', 'Bhutanese Ngultrum'],
  ['BWP', 'Botswanan Pula'],
  ['BYN', 'Belarusian Ruble'],
  ['BZD', 'Belize Dollar'],
  ['CAD', 'Canadian Dollar'],
  ['CDF', 'Congolese Franc'],
  ['CHF', 'Swiss Franc'],
  ['CLP', 'Chilean Peso'],
  ['CNY', 'Chinese Yuan'],
  ['COP', 'Colombian Peso'],
  ['CRC', 'Costa Rican Colón'],
  ['CUP', 'Cuban Peso'],
  ['CVE', 'Cape Verdean Escudo'],
  ['CZK', 'Czech Koruna'],
  ['DJF', 'Djiboutian Franc'],
  ['DKK', 'Danish Krone'],
  ['DOP', 'Dominican Peso'],
  ['DZD', 'Algerian Dinar'],
  ['EGP', 'Egyptian Pound'],
  ['ERN', 'Eritrean Nakfa'],
  ['ETB', 'Ethiopian Birr'],
  ['EUR', 'Euro'],
  ['FJD', 'Fijian Dollar'],
  ['FKP', 'Falkland Islands Pound'],
  ['GBP', 'British Pound'],
  ['GEL', 'Georgian Lari'],
  ['GHS', 'Ghanaian Cedi'],
  ['GIP', 'Gibraltar Pound'],
  ['GMD', 'Gambian Dalasi'],
  ['GNF', 'Guinean Franc'],
  ['GTQ', 'Guatemalan Quetzal'],
  ['GYD', 'Guyanaese Dollar'],
  ['HKD', 'Hong Kong Dollar'],
  ['HNL', 'Honduran Lempira'],
  ['HTG', 'Haitian Gourde'],
  ['HUF', 'Hungarian Forint'],
  ['IDR', 'Indonesian Rupiah'],
  ['ILS', 'Israeli New Shekel'],
  ['INR', 'Indian Rupee'],
  ['IQD', 'Iraqi Dinar'],
  ['IRR', 'Iranian Rial'],
  ['ISK', 'Icelandic Króna'],
  ['JMD', 'Jamaican Dollar'],
  ['JOD', 'Jordanian Dinar'],
  ['JPY', 'Japanese Yen'],
  ['KES', 'Kenyan Shilling'],
  ['KGS', 'Kyrgystani Som'],
  ['KHR', 'Cambodian Riel'],
  ['KMF', 'Comorian Franc'],
  ['KRW', 'South Korean Won'],
  ['KWD', 'Kuwaiti Dinar'],
  ['KYD', 'Cayman Islands Dollar'],
  ['KZT', 'Kazakhstani Tenge'],
  ['LAK', 'Laotian Kip'],
  ['LBP', 'Lebanese Pound'],
  ['LKR', 'Sri Lankan Rupee'],
  ['LRD', 'Liberian Dollar'],
  ['LSL', 'Lesotho Loti'],
  ['LYD', 'Libyan Dinar'],
  ['MAD', 'Moroccan Dirham'],
  ['MDL', 'Moldovan Leu'],
  ['MGA', 'Malagasy Ariary'],
  ['MKD', 'Macedonian Denar'],
  ['MMK', 'Myanmar Kyat'],
  ['MNT', 'Mongolian Tugrik'],
  ['MOP', 'Macanese Pataca'],
  ['MRU', 'Mauritanian Ouguiya'],
  ['MUR', 'Mauritian Rupee'],
  ['MVR', 'Maldivian Rufiyaa'],
  ['MWK', 'Malawian Kwacha'],
  ['MXN', 'Mexican Peso'],
  ['MYR', 'Malaysian Ringgit'],
  ['MZN', 'Mozambican Metical'],
  ['NAD', 'Namibian Dollar'],
  ['NGN', 'Nigerian Naira'],
  ['NIO', 'Nicaraguan Córdoba'],
  ['NOK', 'Norwegian Krone'],
  ['NPR', 'Nepalese Rupee'],
  ['NZD', 'New Zealand Dollar'],
  ['OMR', 'Omani Rial'],
  ['PAB', 'Panamanian Balboa'],
  ['PEN', 'Peruvian Sol'],
  ['PGK', 'Papua New Guinean Kina'],
  ['PHP', 'Philippine Peso'],
  ['PKR', 'Pakistani Rupee'],
  ['PLN', 'Polish Zloty'],
  ['PYG', 'Paraguayan Guarani'],
  ['QAR', 'Qatari Rial'],
  ['RON', 'Romanian Leu'],
  ['RSD', 'Serbian Dinar'],
  ['RUB', 'Russian Ruble'],
  ['RWF', 'Rwandan Franc'],
  ['SAR', 'Saudi Riyal'],
  ['SBD', 'Solomon Islands Dollar'],
  ['SCR', 'Seychellois Rupee'],
  ['SDG', 'Sudanese Pound'],
  ['SEK', 'Swedish Krona'],
  ['SGD', 'Singapore Dollar'],
  ['SHP', 'Saint Helena Pound'],
  ['SLE', 'Sierra Leonean Leone'],
  ['SOS', 'Somali Shilling'],
  ['SRD', 'Surinamese Dollar'],
  ['SSP', 'South Sudanese Pound'],
  ['STN', 'São Tomé and Príncipe Dobra'],
  ['SVC', 'Salvadoran Colón'],
  ['SYP', 'Syrian Pound'],
  ['SZL', 'Swazi Lilangeni'],
  ['THB', 'Thai Baht'],
  ['TJS', 'Tajikistani Somoni'],
  ['TMT', 'Turkmenistani Manat'],
  ['TND', 'Tunisian Dinar'],
  ['TOP', 'Tongan Paʻanga'],
  ['TRY', 'Turkish Lira'],
  ['TTD', 'Trinidad and Tobago Dollar'],
  ['TWD', 'New Taiwan Dollar'],
  ['TZS', 'Tanzanian Shilling'],
  ['UAH', 'Ukrainian Hryvnia'],
  ['UGX', 'Ugandan Shilling'],
  ['USD', 'US Dollar'],
  ['UYU', 'Uruguayan Peso'],
  ['UZS', 'Uzbekistan Som'],
  ['VES', 'Venezuelan Bolívar'],
  ['VND', 'Vietnamese Dong'],
  ['VUV', 'Vanuatu Vatu'],
  ['WST', 'Samoan Tala'],
  ['XAF', 'Central African CFA Franc'],
  ['XCD', 'East Caribbean Dollar'],
  ['XOF', 'West African CFA Franc'],
  ['XPF', 'CFP Franc'],
  ['YER', 'Yemeni Rial'],
  ['ZAR', 'South African Rand'],
  ['ZMW', 'Zambian Kwacha'],
  ['ZWL', 'Zimbabwean Dollar'],
];

const CURRENCY_SET = new Set(CURRENCY_ROWS.map((row) => row[0]));

export const NUMBER_FORMATS = [
  { id: 'auto', label: 'Automatic, from my language' },
  { id: 'comma_dot_before', label: '1,234.56 — symbol before' },
  { id: 'dot_comma_after', label: '1.234,56 — symbol after' },
  { id: 'space_comma_after', label: '1 234,56 — symbol after' },
  { id: 'apostrophe_dot_before', label: "1'234.56 — symbol before" },
] as const;

export type NumberFormatId = (typeof NUMBER_FORMATS)[number]['id'];

const NUMBER_FORMAT_SET = new Set<string>(NUMBER_FORMATS.map((row) => row.id));

const PRESETS: Record<
  Exclude<NumberFormatId, 'auto'>,
  { group: string; decimal: string; symbol: 'before' | 'after' }
> = {
  comma_dot_before: { group: ',', decimal: '.', symbol: 'before' },
  dot_comma_after: { group: '.', decimal: ',', symbol: 'after' },
  space_comma_after: { group: '\u00a0', decimal: ',', symbol: 'after' },
  apostrophe_dot_before: { group: "'", decimal: '.', symbol: 'before' },
};

export function listCurrencies(): CurrencyOption[] {
  const byCode = new Map(CURRENCY_ROWS.map(([code, name]) => [code, { code, name }]));
  const common = COMMON_CURRENCY_CODES.map((code) => byCode.get(code)).filter(
    (row): row is CurrencyOption => Boolean(row)
  );
  const commonSet = new Set<string>(COMMON_CURRENCY_CODES);
  const rest = CURRENCY_ROWS.map(([code, name]) => ({ code, name }))
    .filter((row) => !commonSet.has(row.code))
    .sort((a, b) => a.code.localeCompare(b.code));
  return [...common, ...rest];
}

export function searchCurrencies(query: string): CurrencyOption[] {
  const q = query.trim().toLowerCase();
  const all = listCurrencies();
  if (!q) return all;
  return all.filter(
    (row) => row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)
  );
}

export function isAllowedCurrencyCode(value: unknown): boolean {
  return CURRENCY_SET.has(String(value || '').trim().toUpperCase());
}

/** Empty means USD. An unknown code returns null so the API can reject it. */
export function parseCurrencyCode(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return 'USD';
  const code = String(value).trim().toUpperCase();
  return CURRENCY_SET.has(code) ? code : null;
}

/** Empty means automatic. An unknown preset returns null so the API can reject it. */
export function parseNumberFormat(value: unknown): string | null {
  if (value == null || String(value).trim() === '' || String(value).trim() === 'auto') return 'auto';
  const id = String(value).trim();
  return NUMBER_FORMAT_SET.has(id) ? id : null;
}

export function resolveOrgMoneyPrefs(
  row?: {
    currencyCode?: unknown;
    currency_code?: unknown;
    numberFormat?: unknown;
    number_format?: unknown;
  } | null
): OrgMoneyPrefs {
  const rawCode = row?.currencyCode ?? row?.currency_code;
  const rawFormat = row?.numberFormat ?? row?.number_format;
  return {
    currencyCode: parseCurrencyCode(rawCode) || 'USD',
    numberFormat: parseNumberFormat(rawFormat) || 'auto',
  };
}

function fractionDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' ? digits : 2;
  } catch {
    return 2;
  }
}

function narrowSymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1);
    return parts.find((part) => part.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}

function groupThousands(intPart: string, separator: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatPreset(amount: number, currency: string, formatId: Exclude<NumberFormatId, 'auto'>, locale: string): string {
  const preset = PRESETS[formatId];
  const digits = fractionDigits(currency);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const fixed = abs.toFixed(digits);
  const [intRaw, frac] = fixed.split('.');
  const grouped = groupThousands(intRaw || '0', preset.group);
  const number = digits > 0 && frac != null ? `${grouped}${preset.decimal}${frac}` : grouped;
  const symbol = narrowSymbol(currency, locale);
  const body = preset.symbol === 'before' ? `${symbol}${number}` : `${number}\u00a0${symbol}`;
  return negative ? `-${body}` : body;
}

/**
 * Narrow currency symbol for input labels ($ , €, £).
 * Unknown or missing currency falls back to USD, whose symbol is $.
 */
export function orgCurrencySymbol(
  prefs?: {
    currencyCode?: unknown;
    currency_code?: unknown;
    numberFormat?: unknown;
    number_format?: unknown;
  } | null,
  locale?: string | null
): string {
  const resolved = resolveOrgMoneyPrefs(prefs);
  const loc = locale && String(locale).trim() ? String(locale) : 'en';
  const symbol = narrowSymbol(resolved.currencyCode, loc);
  if (symbol && symbol !== resolved.currencyCode) return symbol;
  return resolved.currencyCode === 'USD' ? '$' : resolved.currencyCode;
}

/** Replace `{symbol}` in a translated label. An empty symbol stays `$`. */
export function applyCurrencySymbol(label: string, symbol: string | null | undefined): string {
  const mark = symbol && String(symbol).trim() ? String(symbol) : '$';
  return String(label).split('{symbol}').join(mark);
}

/**
 * Format an amount in the organization currency.
 * `auto` uses Intl.NumberFormat with the caller's locale.
 * Invalid currency or format falls back to USD and the locale format.
 */
export function formatOrgMoney(
  amount: unknown,
  prefs?: {
    currencyCode?: unknown;
    currency_code?: unknown;
    numberFormat?: unknown;
    number_format?: unknown;
  } | null,
  locale?: string | null
): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  const resolved = resolveOrgMoneyPrefs(prefs);
  const loc = locale && String(locale).trim() ? String(locale) : 'en';
  if (resolved.numberFormat === 'auto') {
    try {
      return new Intl.NumberFormat(loc, {
        style: 'currency',
        currency: resolved.currencyCode,
      }).format(value);
    } catch {
      return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(value);
    }
  }
  const presetId = resolved.numberFormat as Exclude<NumberFormatId, 'auto'>;
  if (!PRESETS[presetId]) {
    return new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD' }).format(value);
  }
  return formatPreset(value, resolved.currencyCode, presetId, loc);
}
