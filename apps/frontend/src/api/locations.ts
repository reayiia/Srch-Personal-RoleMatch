import { API_BASE_URL, buildQuery, readJson } from './client';

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

export async function fetchLocationSuggestions(query: string): Promise<LocationSuggestion[]> {
  const response = await fetch(`${API_BASE_URL}/api/locations/suggest?${buildQuery({ q: query, limit: 8 })}`);
  const data = await readJson<{ locations: LocationSuggestion[] }>(response);

  return data.locations;
}
