import { createRequire } from 'module';

const require = createRequire(import.meta.url);

interface CityRecord {
  cityId?: string;
  id?: string | number;
  name?: string;
  country?: string;
  adminCode?: string;
  population?: number;
  loc?: {
    coordinates?: [number, number];
  };
}

export interface LocationSuggestion {
  id: string;
  label: string;
  city: string;
  region?: string;
  countryCode: string;
  countryName: string;
  latitude: number;
  longitude: number;
  population: number;
}

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

interface ResolveHint {
  countryCode?: string | undefined;
  region?: string | undefined;
}

const cityRecords = (require('all-the-cities') as CityRecord[])
  .filter((city) => {
    const coordinates = city.loc?.coordinates;
    return Boolean(city.name && city.country && Array.isArray(coordinates) && coordinates.length >= 2);
  });

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const usStateNames: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DC: 'District of Columbia',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  ME: 'Maine',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WV: 'West Virginia',
  WY: 'Wyoming',
};

function normalizeLocationToken(value?: string | null) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countryName(countryCode: string) {
  return countryNames.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
}

const countryCodes = Array.from(new Set(cityRecords
  .map((city) => city.country?.toUpperCase())
  .filter((code): code is string => Boolean(code))));
const usStateCodes = new Set(Object.keys(usStateNames));
const countryAliases = new Map<string, string>();

countryCodes.forEach((code) => {
  const name = normalizeLocationToken(countryName(code));
  if (name) countryAliases.set(name, code);
});

[
  ['united states of america', 'US'],
  ['united states', 'US'],
  ['u s a', 'US'],
  ['u.s.a.', 'US'],
  ['u.s.a', 'US'],
  ['usa', 'US'],
  ['u s', 'US'],
  ['u.s.', 'US'],
  ['u.s', 'US'],
  ['united kingdom', 'GB'],
  ['great britain', 'GB'],
  ['britain', 'GB'],
  ['england', 'GB'],
  ['scotland', 'GB'],
  ['wales', 'GB'],
  ['northern ireland', 'GB'],
  ['u k', 'GB'],
  ['u.k.', 'GB'],
  ['u.k', 'GB'],
  ['uk', 'GB'],
].forEach(([alias, code]) => countryAliases.set(alias!, code!));

const countryAliasEntries = Array.from(countryAliases.entries())
  .sort((first, second) => second[0].length - first[0].length);

function regionLabel(city: CityRecord) {
  if (!city.adminCode) return undefined;
  if (city.country?.toUpperCase() === 'US') return city.adminCode.toUpperCase();

  return city.adminCode;
}

function fullRegionName(city: CityRecord) {
  const region = regionLabel(city);
  if (!region) return undefined;
  if (city.country?.toUpperCase() === 'US') return usStateNames[region] ?? region;

  return region;
}

function toSuggestion(city: CityRecord): LocationSuggestion | undefined {
  const coordinates = city.loc?.coordinates;
  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];
  if (!city.name || !city.country || typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;

  const region = regionLabel(city);
  const resolvedCountryName = countryName(city.country);
  return {
    id: String(city.cityId ?? city.id ?? `${city.name}-${city.country}-${region ?? ''}`),
    label: [city.name, region, resolvedCountryName].filter(Boolean).join(', '),
    city: city.name,
    countryCode: city.country.toUpperCase(),
    countryName: resolvedCountryName,
    latitude,
    longitude,
    population: city.population ?? 0,
    ...(region ? { region } : {}),
  };
}

const citiesByName = new Map<string, CityRecord[]>();

cityRecords.forEach((city) => {
  const name = normalizeLocationToken(city.name);
  if (!name) return;

  const existing = citiesByName.get(name) ?? [];
  existing.push(city);
  citiesByName.set(name, existing);
});

citiesByName.forEach((cities) => {
  cities.sort((first, second) => (second.population ?? 0) - (first.population ?? 0));
});

function locationSearchText(city: CityRecord) {
  return normalizeLocationToken([
    city.name,
    regionLabel(city),
    fullRegionName(city),
    city.country,
    countryName(city.country ?? ''),
  ].filter(Boolean).join(' '));
}

export function suggestLocations(query: string, limit = 8): LocationSuggestion[] {
  const normalizedQuery = normalizeLocationToken(query);
  if (normalizedQuery.length < 2) return [];

  const scored = cityRecords
    .map((city) => {
      const cityName = normalizeLocationToken(city.name);
      const haystack = locationSearchText(city);
      if (!haystack.includes(normalizedQuery)) return undefined;

      let score = 0;
      if (cityName === normalizedQuery) score += 500;
      else if (cityName.startsWith(normalizedQuery)) score += 260;
      else if (haystack.startsWith(normalizedQuery)) score += 160;
      else score += 40;
      score += Math.min(Math.log10((city.population ?? 0) + 1) * 25, 160);

      return { city, score };
    })
    .filter((entry): entry is { city: CityRecord; score: number } => Boolean(entry))
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.max(1, Math.min(limit, 20)));

  return scored
    .map((entry) => toSuggestion(entry.city))
    .filter((entry): entry is LocationSuggestion => Boolean(entry));
}

interface CityCandidate {
  city: CityRecord;
  nameScore: number;
}

function locationParts(locationText: string) {
  return locationText
    .split(/\s*(?:,|;|\/|\||\u2022|\s+-\s+)\s*/g)
    .map((part) => normalizeLocationToken(part)
      .replace(/\b(remote|hybrid|onsite|on site|office|metro|metropolitan|area|greater|region|based)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-.\s]+|[-.\s]+$/g, '')
      .trim())
    .filter((part) => part.length > 1);
}

function cityCandidates(locationText: string) {
  const names = new Map<string, number>();
  const parts = locationParts(locationText);

  parts.forEach((part, partIndex) => {
    names.set(part, Math.max(names.get(part) ?? 0, 6_000_000 - (partIndex * 350_000)));
    const tokens = part.split(/\s+/).filter((token) => token.length > 1);

    for (let start = 0; start < tokens.length; start += 1) {
      for (let length = 1; length <= 4 && start + length <= tokens.length; length += 1) {
        const name = tokens.slice(start, start + length).join(' ');
        const score = 2_000_000 - (partIndex * 200_000) - (start * 80_000) + (length * 20_000);
        names.set(name, Math.max(names.get(name) ?? 0, score));
      }
    }
  });

  const candidates = new Map<string, CityCandidate>();
  names.forEach((nameScore, name) => {
    (citiesByName.get(name) ?? []).forEach((city) => {
      const coordinates = city.loc?.coordinates ?? [];
      const key = String(city.cityId ?? city.id ?? `${city.name}-${city.country}-${city.adminCode}-${coordinates.join(':')}`);
      const existing = candidates.get(key);
      if (!existing || existing.nameScore < nameScore) candidates.set(key, { city, nameScore });
    });
  });

  return { candidates: Array.from(candidates.values()), parts };
}

function containsPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

function detectUsRegion(normalizedText: string, parts: string[], candidates: CityCandidate[]) {
  for (const [code, name] of Object.entries(usStateNames)) {
    const hasCode = parts.some((part) => part === code.toLowerCase());
    const hasName = containsPhrase(normalizedText, normalizeLocationToken(name));
    if (!hasCode && !hasName) continue;

    const hasMatchingCity = candidates.some(({ city }) => (
      city.country?.toUpperCase() === 'US' && city.adminCode?.toUpperCase() === code
    ));
    if (hasMatchingCity) return code;
  }

  return undefined;
}

function detectCountry(normalizedText: string, parts: string[], usRegion?: string) {
  if (usRegion) return 'US';

  const matchedAlias = countryAliasEntries.find(([alias]) => containsPhrase(normalizedText, alias));
  if (matchedAlias) return matchedAlias[1];

  const explicitCode = parts.find((part) => (
    part.length === 2
    && !usStateCodes.has(part.toUpperCase())
    && countryCodes.includes(part.toUpperCase())
  ));

  return explicitCode?.toUpperCase();
}

function candidateScore(
  candidate: CityCandidate,
  normalizedText: string,
  explicitCountry?: string,
  explicitRegion?: string,
  hint?: ResolveHint,
) {
  const city = candidate.city;
  const countryCode = city.country?.toUpperCase() ?? '';
  const region = regionLabel(city)?.toUpperCase();
  const regionName = normalizeLocationToken(fullRegionName(city));
  let score = candidate.nameScore + Math.min(city.population ?? 0, 5_000_000);

  if (explicitCountry) {
    score += countryCode === explicitCountry ? 100_000_000 : -100_000_000;
  } else if (hint?.countryCode && countryCode === hint.countryCode.toUpperCase()) {
    score += 10_000_000;
  }

  if (explicitRegion) {
    if (countryCode === 'US' && region === explicitRegion.toUpperCase()) score += 50_000_000;
    else if (countryCode === 'US') score -= 25_000_000;
  } else if (!explicitCountry && hint?.region && region === hint.region.toUpperCase()) {
    score += 5_000_000;
  }

  if (regionName && containsPhrase(normalizedText, regionName)) score += 1_000_000;

  return score;
}

export function resolveLocationCoordinate(locationText?: string | null, hint?: ResolveHint): GeoCoordinate | undefined {
  if (!locationText || /^(remote|worldwide|anywhere|global|not specified)$/i.test(locationText.trim())) return undefined;

  const normalizedText = normalizeLocationToken(locationText);
  const { candidates, parts } = cityCandidates(locationText);
  const explicitRegion = detectUsRegion(normalizedText, parts, candidates);
  const explicitCountry = detectCountry(normalizedText, parts, explicitRegion);
  const [best] = candidates.sort((first, second) => (
    candidateScore(second, normalizedText, explicitCountry, explicitRegion, hint)
    - candidateScore(first, normalizedText, explicitCountry, explicitRegion, hint)
  ));
  const suggestion = best ? toSuggestion(best.city) : undefined;
  if (suggestion) return { latitude: suggestion.latitude, longitude: suggestion.longitude };

  return undefined;
}

export function distanceMiles(first: GeoCoordinate, second: GeoCoordinate) {
  const earthRadiusMiles = 3958.7613;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = toRadians(second.latitude - first.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}
