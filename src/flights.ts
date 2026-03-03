import { lookupByIata, lookupByCity, lookupByCityAndCountry } from "./airports.js";

const API_URL = "https://airport.ee/wp-json/airport/v1/destination-data";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface Route {
  city: string;
  airport: string;
  country: string;
  iata: string;
  lat: number;
  lon: number;
  airlines: string[];
}

interface ApiDestination {
  id: number;
  start_date: string;
  end_date: string;
  flight_number: string;
  service_provider: string;
  direction: string;
  destination: string;
  destination_et?: string;
  iata?: string;
  country?: string;
  [key: string]: unknown;
}

// Cache raw API data so date filtering is free (no re-fetch needed)
let rawCache: { data: ApiDestination[]; fetchedAt: number } | null = null;

async function getRawFlights(): Promise<ApiDestination[]> {
  if (rawCache && Date.now() - rawCache.fetchedAt < CACHE_TTL_MS) {
    return rawCache.data;
  }
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`airport.ee API error: ${res.status}`);
  const data = (await res.json()) as ApiDestination[];
  rawCache = { data, fetchedAt: Date.now() };
  return data;
}

// YYYY-MM-DD substring comparison avoids timezone issues
function dateStr(iso: string): string {
  return iso.substring(0, 10);
}

export async function getRoutes(from?: string, to?: string): Promise<Route[]> {
  const raw = await getRawFlights();

  let departures = raw.filter((d) => d.direction === "D");

  if (from) departures = departures.filter((d) => dateStr(d.start_date) >= from);
  if (to)   departures = departures.filter((d) => dateStr(d.start_date) <= to);

  // Group by destination city, collect airlines
  const cityMap = new Map<string, { items: ApiDestination[]; airlines: Set<string> }>();

  for (const d of departures) {
    const city = d.destination?.trim();
    if (!city) continue;
    const existing = cityMap.get(city) ?? { items: [], airlines: new Set() };
    existing.items.push(d);
    if (d.service_provider) existing.airlines.add(d.service_provider.trim());
    cityMap.set(city, existing);
  }

  const routes: Route[] = [];

  for (const [city, { items, airlines }] of cityMap) {
    const sample = items[0];
    const info =
      (sample.iata ? lookupByIata(sample.iata) : undefined) ??
      (sample.country ? lookupByCityAndCountry(city, sample.country) : undefined) ??
      lookupByCity(city);

    if (!info) {
      console.warn(`[flights] No coordinates for: ${city}`);
      continue;
    }

    routes.push({
      city,
      airport: info.name,
      country: info.country,
      iata: info.iata,
      lat: info.lat,
      lon: info.lon,
      airlines: [...airlines].sort(),
    });
  }

  return routes.sort((a, b) => a.city.localeCompare(b.city));
}
