import { z } from "zod";
import type { Config } from "../config.js";
import { cachedJson, type KeyValueStore } from "../store.js";
import { getJson, SolarError } from "./http.js";

const geoSchema = z.object({
  results: z.array(z.object({
    name: z.string(),
    country: z.string().optional(),
    admin1: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string().optional(),
    population: z.number().optional(),
    feature_code: z.string().optional(),
  })).optional(),
});

export interface GeoHit {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population: number;
  featureCode?: string;
}

export function placeLabel(hit: GeoHit): string {
  const admin = hit.admin1 && !hit.admin1.toLowerCase().includes(hit.name.toLowerCase()) ? hit.admin1 : undefined;
  return [hit.name, admin, hit.country].filter(Boolean).join(", ");
}

export function choosePlace(results: GeoHit[]): GeoHit | { ambiguous: GeoHit[] } {
  const first = results[0];
  if (!first) {
    throw new SolarError("I couldn't find that place. Try a city name, or give me a latitude and longitude.");
  }
  const second = results[1];
  if (!second) return first;
  const pop1 = first.population;
  const pop2 = second.population;
  if ((first.featureCode === "PPLC" && pop1 > pop2) || (pop1 >= pop2 * 5 && pop1 >= 10_000)) {
    return first;
  }
  return { ambiguous: results.slice(0, 3) };
}

export async function geocodePlace(
  place: string,
  config: Config,
  store: KeyValueStore,
  fetchImpl: typeof fetch,
): Promise<GeoHit[]> {
  const key = `geo:${place.trim().toLowerCase()}`;
  return cachedJson(store, key, config.geocodeTtlSeconds, async () => {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", place);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const body = geoSchema.parse(await getJson(fetchImpl, url.toString(), config.fetchTimeoutMs, "geocoder"));
    return (body.results ?? []).map((hit) => ({
      name: hit.name,
      country: hit.country,
      admin1: hit.admin1,
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone,
      population: hit.population ?? 0,
      featureCode: hit.feature_code,
    }));
  });
}
