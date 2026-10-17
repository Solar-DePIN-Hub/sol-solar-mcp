import { z } from "zod";
import type { Config } from "../config.js";
import type { HourSlot, PvAssumptions } from "../solar/model.js";
import { hourEnergyKwh } from "../solar/model.js";
import { cachedJson, type KeyValueStore } from "../store.js";
import { getJson } from "./http.js";

const forecastSchema = z.object({
  timezone: z.string(),
  utc_offset_seconds: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    global_tilted_irradiance: z.array(z.number().nullable()),
    temperature_2m: z.array(z.number().nullable()),
  }),
  daily: z.object({
    time: z.array(z.string()),
    sunrise: z.array(z.string().nullable()),
    sunset: z.array(z.string().nullable()),
  }).optional(),
});

export interface RawForecast {
  timezone: string;
  utcOffsetSeconds: number;
  hours: Array<{ end: string; gtiWm2: number; ambientC: number | null }>;
  daily: Array<{ date: string; sunrise: string | null; sunset: string | null }>;
}

export function parseOpenMeteoTime(stamp: string, offsetSeconds: number): Date {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp)) return new Date(stamp);
  const sign = offsetSeconds >= 0 ? "+" : "-";
  const abs = Math.abs(offsetSeconds);
  const hours = String(Math.floor(abs / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return new Date(`${stamp}${sign}${hours}:${minutes}`);
}

export async function fetchForecast(
  input: { latitude: number; longitude: number; tilt: number; azimuth: number },
  config: Config,
  store: KeyValueStore,
  fetchImpl: typeof fetch,
): Promise<RawForecast> {
  const key = `forecast:${input.latitude.toFixed(3)}:${input.longitude.toFixed(3)}:${input.tilt.toFixed(1)}:${input.azimuth.toFixed(1)}`;
  return cachedJson(store, key, config.forecastTtlSeconds, async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(input.latitude));
    url.searchParams.set("longitude", String(input.longitude));
    url.searchParams.set("hourly", "global_tilted_irradiance,temperature_2m");
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("tilt", String(input.tilt));
    url.searchParams.set("azimuth", String(input.azimuth));
    const body = forecastSchema.parse(await getJson(fetchImpl, url.toString(), config.fetchTimeoutMs, "forecast"));
    return {
      timezone: body.timezone,
      utcOffsetSeconds: body.utc_offset_seconds,
      hours: body.hourly.time.map((end, index) => ({
        end,
        gtiWm2: body.hourly.global_tilted_irradiance[index] ?? 0,
        ambientC: body.hourly.temperature_2m[index] ?? null,
      })),
      daily: (body.daily?.time ?? []).map((date, index) => ({
        date,
        sunrise: body.daily?.sunrise[index] ?? null,
        sunset: body.daily?.sunset[index] ?? null,
      })),
    };
  });
}

export function slotsFromForecast(raw: RawForecast, systemKw: number, assumptions: PvAssumptions): HourSlot[] {
  return raw.hours.map((hour) => {
    const end = parseOpenMeteoTime(hour.end, raw.utcOffsetSeconds);
    const start = new Date(end.getTime() - 3_600_000);
    const ambientAssumed = hour.ambientC === null;
    const ambientC = hour.ambientC ?? 15;
    return {
      start,
      end,
      gtiWm2: hour.gtiWm2,
      ambientC,
      ambientAssumed,
      energyKwh: hourEnergyKwh(hour.gtiWm2, ambientC, systemKw, assumptions),
    };
  }).sort((a, b) => a.start.getTime() - b.start.getTime());
}
