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

let cache: { routes: Route[]; fetchedAt: number } | null = null;

export async function getRoutes(): Promise<Route[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.routes;
  }

  const routes = await fetchAndBuild();
  cache = { routes, fetchedAt: Date.now() };
  return routes;
}

async function fetchAndBuild(): Promise<Route[]> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`airport.ee API error: ${res.status}`);

  const data: ApiDestination[] = await res.json() as ApiDestination[];

  // Filter departures only
  const departures = data.filter((d) => d.direction === "D");

  // Group by destination city name, collect airlines
  const cityMap = new Map<
    string,
    { items: ApiDestination[]; airlines: Set<string> }
  >();

  for (const d of departures) {
    const city = d.destination?.trim();
    if (!city) continue;
    const existing = cityMap.get(city) ?? { items: [], airlines: new Set() };
    existing.items.push(d);
    if (d.service_provider) {
      existing.airlines.add(d.service_provider.trim());
    }
    cityMap.set(city, existing);
  }

  const routes: Route[] = [];

  for (const [city, { items, airlines }] of cityMap) {
    const sample = items[0];

    // Try to resolve coordinates: by IATA first, then city+country, then city
    let info =
      (sample.iata ? lookupByIata(sample.iata) : undefined) ??
      (sample.country
        ? lookupByCityAndCountry(city, sample.country)
        : undefined) ??
      lookupByCity(city);

    if (!info) {
      console.warn(`[flights] No coordinates found for: ${city}`);
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
