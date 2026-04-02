import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

// Normalize city name for lookup: lowercase + strip diacritics.
// Handles mismatches like "Kraków" → "krakow", "Gdańsk" → "gdansk".
function normalizeCity(city: string): string {
  return city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Override map for cities where airports.dat first-match is the wrong airport.
// Key: normalized city name. Value: correct IATA code.
const CITY_IATA_OVERRIDE: Record<string, string> = {
  helsinki: "HEL", // airports.dat lists Malmi (HEM) before Vantaa (HEL)
};

// Parse airports.dat once at startup
// Format: id,name,city,country,iata,icao,lat,lon,alt,tz,dst,tz_db,type,source
let airportsByCity: Map<string, AirportInfo[]> | null = null;
let airportsByIata: Map<string, AirportInfo> | null = null;

function loadAirports(): void {
  const filePath = join(__dirname, "../data/airports.dat");
  const raw = readFileSync(filePath, "utf-8");
  const byCity = new Map<string, AirportInfo[]>();
  const byIata = new Map<string, AirportInfo>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // CSV with quoted fields
    const fields = parseCSVLine(line);
    if (fields.length < 8) continue;

    const name = fields[1].replace(/^"|"$/g, "");
    const city = fields[2].replace(/^"|"$/g, "");
    const country = fields[3].replace(/^"|"$/g, "");
    const iata = fields[4].replace(/^"|"$/g, "");
    const lat = parseFloat(fields[6]);
    const lon = parseFloat(fields[7]);

    if (!iata || iata === "\\N" || iata.length !== 3) continue;
    if (isNaN(lat) || isNaN(lon)) continue;

    const info: AirportInfo = { iata, name, city, country, lat, lon };
    byIata.set(iata, info);

    const cityKey = normalizeCity(city);
    const existing = byCity.get(cityKey) ?? [];
    existing.push(info);
    byCity.set(cityKey, existing);
  }

  airportsByCity = byCity;
  airportsByIata = byIata;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function lookupByIata(iata: string): AirportInfo | undefined {
  if (!airportsByIata) loadAirports();
  return airportsByIata!.get(iata.toUpperCase());
}

export function lookupByCity(city: string): AirportInfo | undefined {
  if (!airportsByCity) loadAirports();
  const key = normalizeCity(city);
  const override = CITY_IATA_OVERRIDE[key];
  if (override) return lookupByIata(override);
  const candidates = airportsByCity!.get(key);
  if (!candidates || candidates.length === 0) return undefined;
  return candidates[0];
}

export function lookupByCityAndCountry(
  city: string,
  country: string
): AirportInfo | undefined {
  if (!airportsByCity) loadAirports();
  const candidates = airportsByCity!.get(normalizeCity(city));
  if (!candidates || candidates.length === 0) return undefined;
  const countryMatch = candidates.find(
    (a) => a.country.toLowerCase() === country.toLowerCase()
  );
  return countryMatch ?? candidates[0];
}

// Look up by airport name substring — used when the API gives hints like
// "Stockholm (Arlanda)" or "Paris (Charles De Gaulle)".
// Prefers the shortest matching name to avoid overly generic matches.
export function lookupByAirportHint(hint: string): AirportInfo | undefined {
  if (!airportsByIata) loadAirports();
  const lower = hint.toLowerCase();
  let best: AirportInfo | undefined;
  for (const airport of airportsByIata!.values()) {
    if (airport.name.toLowerCase().includes(lower)) {
      if (!best || airport.name.length < best.name.length) best = airport;
    }
  }
  return best;
}
