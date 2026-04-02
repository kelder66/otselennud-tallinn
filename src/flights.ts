import {
  lookupByIata,
  lookupByCity,
  lookupByCityAndCountry,
  lookupByAirportHint,
} from "./airports.js";

const DEST_DATA_URL = "https://airport.ee/wp-json/airport/v1/destination-data";
const FLIGHTS_URL         = "https://airport.ee/wp-json/airport/v1/flights?direction=departure";
const ARRIVALS_URL        = "https://airport.ee/wp-json/airport/v1/flights?direction=arrival";

const CACHE_TTL_MS      = 6 * 60 * 60 * 1000; // 6 h — destination-data (JSON)
const HTML_CACHE_TTL_MS = 60 * 60 * 1000;      // 1 h — flights HTML (real-time)

export interface Route {
  city: string;
  airport: string;
  country: string;
  iata: string;
  lat: number;
  lon: number;
  airlines: string[];
  departures: string[]; // sorted "DD.MM HH:MM" within the requested date range
}

// ─── Source 1: destination-data JSON ─────────────────────────────────────────

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

let rawCache: { data: ApiDestination[]; fetchedAt: number } | null = null;

async function getRawFlights(): Promise<ApiDestination[]> {
  if (rawCache && Date.now() - rawCache.fetchedAt < CACHE_TTL_MS) {
    return rawCache.data;
  }
  const res = await fetch(DEST_DATA_URL);
  if (!res.ok) throw new Error(`destination-data API error: ${res.status}`);
  const data = (await res.json()) as ApiDestination[];
  rawCache = { data, fetchedAt: Date.now() };
  return data;
}

// ─── Source 2: flights HTML ───────────────────────────────────────────────────

interface HtmlDeparture {
  destRaw: string;   // e.g. "Stockholm (Arlanda)"
  city: string;      // e.g. "Stockholm"
  hint: string | null; // e.g. "Arlanda"
  airline: string;
  datetime: string;  // ISO-ish, e.g. "2026-03-04T15:30:00+02:00"
}

const htmlCaches: Record<"departure" | "arrival", { data: HtmlDeparture[]; fetchedAt: number } | null> = {
  departure: null,
  arrival: null,
};

async function getHtmlFlights(direction: "departure" | "arrival"): Promise<HtmlDeparture[]> {
  const url = direction === "departure" ? FLIGHTS_URL : ARRIVALS_URL;
  const cached = htmlCaches[direction];
  if (cached && Date.now() - cached.fetchedAt < HTML_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return htmlCaches[direction]?.data ?? [];
    // API now returns JSON wrapper { html: "..." } instead of raw HTML
    const json = await res.json() as { html?: string } | string;
    const html = typeof json === "object" && json.html ? json.html : String(json);
    const deps = parseFlightsHtml(html);
    htmlCaches[direction] = { data: deps, fetchedAt: Date.now() };
    return deps;
  } catch {
    return htmlCaches[direction]?.data ?? [];
  }
}

function parseFlightsHtml(html: string): HtmlDeparture[] {
  const results: HtmlDeparture[] = [];
  // API now returns time-only datetime (e.g. "15:26"), no date.
  // We prefix with today's date to make it sortable/filterable.
  const today = new Date().toISOString().substring(0, 10);
  const re =
    /datetime="([^"]+)"[\s\S]{1,600}?card-flight__title">([\s\S]{1,200}?)<\/h2>[\s\S]{1,1200}?card-flight__service-providers">([\s\S]{1,200}?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const timeRaw = m[1].trim();
    const destRaw = stripTags(m[2]);
    const airline = stripTags(m[3]);
    if (!destRaw || !timeRaw) continue;

    // Build a full ISO-ish datetime so date filtering and formatDep work
    const datetime = timeRaw.includes("T") ? timeRaw : `${today}T${timeRaw}:00`;

    const parenM = destRaw.match(/^(.*?)\s*\(([^)]+)\)$/);
    const city   = parenM ? parenM[1].trim() : destRaw;
    const hint   = parenM ? parenM[2].trim() : null;

    results.push({ destRaw, city, hint, airline, datetime });
  }
  return results;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

// ─── Coordinate lookup ────────────────────────────────────────────────────────

function resolveCoords(
  city: string,
  hint: string | null,
  iata?: string,
  country?: string
) {
  return (
    (iata ? lookupByIata(iata) : undefined) ??
    (hint ? lookupByAirportHint(hint) : undefined) ??
    (country ? lookupByCityAndCountry(city, country) : undefined) ??
    lookupByCity(city)
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateStr(iso: string): string {
  return iso.substring(0, 10);
}

function formatDep(iso: string): string {
  const day   = iso.substring(8, 10);
  const month = iso.substring(5, 7);
  const time  = iso.substring(11, 16);
  return `${day}.${month} ${time}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getRoutes(
  from?: string,
  to?: string,
  direction: "departure" | "arrival" = "departure"
): Promise<Route[]> {
  // Fetch both sources in parallel; HTML failure is non-fatal
  const [raw, htmlDeps] = await Promise.all([
    getRawFlights().catch(() => [] as ApiDestination[]),
    getHtmlFlights(direction),
  ]);

  // Key: normalised city name (lowercase). Value: accumulated route data.
  const cityMap = new Map<
    string,
    {
      city: string;
      hint: string | null;
      iata?: string;
      country?: string;
      airlines: Set<string>;
      departures: string[]; // ISO datetimes
    }
  >();

  // ── Source 1: destination-data JSON ──────────────────────────────────────
  const dirFilter = direction === "departure" ? "D" : "A";
  const departures1 = raw.filter((d) => d.direction === dirFilter);
  for (const d of departures1) {
    const destRaw = d.destination?.trim();
    if (!destRaw) continue;
    // Date filter
    if (from && dateStr(d.start_date) < from) continue;
    if (to   && dateStr(d.start_date) > to)   continue;

    // Parse "City (Airport)" format to extract airport hint for coord lookup
    const parenM = destRaw.match(/^(.*?)\s*\(([^)]+)\)$/);
    const city = parenM ? parenM[1].trim() : destRaw;
    const hint = parenM ? parenM[2].trim() : null;

    const key = city.toLowerCase();
    const entry = cityMap.get(key) ?? {
      city,
      hint,
      iata: d.iata,
      country: d.country,
      airlines: new Set<string>(),
      departures: [],
    };
    if (d.service_provider) entry.airlines.add(d.service_provider.trim());
    entry.departures.push(d.start_date);
    cityMap.set(key, entry);
  }

  // ── Source 2: flights HTML ────────────────────────────────────────────────
  for (const d of htmlDeps) {
    if (from && dateStr(d.datetime) < from) continue;
    if (to   && dateStr(d.datetime) > to)   continue;

    const key = d.city.toLowerCase();
    const entry = cityMap.get(key) ?? {
      city: d.city,
      hint: d.hint,
      airlines: new Set<string>(),
      departures: [],
    };
    // Prefer the richer destination name (with airport hint) as display name
    if (d.hint && !entry.hint) {
      entry.hint = d.hint;
    }
    if (d.airline) entry.airlines.add(d.airline);
    entry.departures.push(d.datetime);
    cityMap.set(key, entry);
  }

  // ── Build Route objects ───────────────────────────────────────────────────
  const routes: Route[] = [];

  for (const [, entry] of cityMap) {
    const info = resolveCoords(entry.city, entry.hint, entry.iata, entry.country);
    if (!info) {
      console.warn(`[flights] No coordinates for: ${entry.city}`);
      continue;
    }

    const departures = [...new Set(entry.departures)]
      .sort()
      .map(formatDep);

    routes.push({
      city: entry.city,
      airport: info.name,
      country: info.country,
      iata: info.iata,
      lat: info.lat,
      lon: info.lon,
      airlines: [...entry.airlines].sort(),
      departures,
    });
  }

  return routes.sort((a, b) => a.city.localeCompare(b.city));
}
