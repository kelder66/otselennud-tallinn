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

    const cityKey = city.toLowerCase();
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
  const candidates = airportsByCity!.get(city.toLowerCase());
  if (!candidates || candidates.length === 0) return undefined;
  // Prefer the one whose name doesn't contain "International" to avoid
  // ambiguity, but fallback to first
  return candidates[0];
}

export function lookupByCityAndCountry(
  city: string,
  country: string
): AirportInfo | undefined {
  if (!airportsByCity) loadAirports();
  const candidates = airportsByCity!.get(city.toLowerCase());
  if (!candidates || candidates.length === 0) return undefined;
  const countryMatch = candidates.find(
    (a) => a.country.toLowerCase() === country.toLowerCase()
  );
  return countryMatch ?? candidates[0];
}
