/**
 * Map free-text region input (state / province / country) to short codes.
 * Live organizations.state (and similar address columns) may still be CHAR(3);
 * a full name like "Texas" or "United States" overflows that column.
 */

export type NormalizedRegion = {
  /** USPS / Canada post abbreviation, or a short leftover code. */
  state: string | null;
  /** ISO 3166-1 alpha-3 when the input was a country (or implied by the state). */
  country: string | null;
};

const US_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  'washington dc': 'DC',
  'washington d c': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const CA_NAME_TO_ABBR: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  newfoundland: 'NL',
  labrador: 'NL',
  'northwest territories': 'NT',
  'nova scotia': 'NS',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  québec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

const US_ABBR = new Set(Object.values(US_NAME_TO_ABBR));
const CA_ABBR = new Set(Object.values(CA_NAME_TO_ABBR));

const COUNTRY_TO_ISO3: Record<string, string> = {
  us: 'USA',
  usa: 'USA',
  'u s': 'USA',
  'u s a': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  america: 'USA',
  can: 'CAN',
  canada: 'CAN',
  mex: 'MEX',
  mexico: 'MEX',
  méxico: 'MEX',
  gbr: 'GBR',
  uk: 'GBR',
  'united kingdom': 'GBR',
  'great britain': 'GBR',
  england: 'GBR',
  aus: 'AUS',
  australia: 'AUS',
};

function foldName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[_/,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lettersOnly(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

/**
 * Accept common UI input (TX, Texas, US, USA, United States) and return
 * codes that fit CHAR(2)/CHAR(3) address columns.
 */
export function normalizeRegionInput(raw?: string | null): NormalizedRegion {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { state: null, country: null };

  const name = foldName(trimmed);
  const letters = lettersOnly(trimmed);

  const countryHit = COUNTRY_TO_ISO3[name] || (letters.length <= 3 ? COUNTRY_TO_ISO3[letters.toLowerCase()] : undefined);
  if (countryHit && !US_NAME_TO_ABBR[name] && !CA_NAME_TO_ABBR[name] && !US_ABBR.has(letters) && !CA_ABBR.has(letters)) {
    return { state: null, country: countryHit };
  }

  if (letters.length === 2 && US_ABBR.has(letters)) {
    return { state: letters, country: 'USA' };
  }
  if (letters.length === 2 && CA_ABBR.has(letters)) {
    return { state: letters, country: 'CAN' };
  }

  const us = US_NAME_TO_ABBR[name];
  if (us) return { state: us, country: 'USA' };
  const ca = CA_NAME_TO_ABBR[name];
  if (ca) return { state: ca, country: 'CAN' };

  // Already a 2–3 letter code (ISO / leftover). Uppercase so "usa"/"tx" stay short.
  if (letters.length >= 2 && letters.length <= 3 && letters.length === trimmed.replace(/\s/g, '').length) {
    return { state: letters, country: COUNTRY_TO_ISO3[letters.toLowerCase()] || null };
  }

  return { state: trimmed, country: null };
}

/** State/province value to persist on organizations / tickets. */
export function normalizeStateCode(raw?: string | null): string | null {
  return normalizeRegionInput(raw).state;
}
