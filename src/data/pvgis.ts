import { z } from "zod";
import type { Config } from "../config.js";
import { cachedJson, type KeyValueStore } from "../store.js";
import { getJson } from "./http.js";

const monthSchema = z.object({
  month: z.number(),
  E_d: z.number(),
  E_m: z.number(),
});

const pvgisSchema = z.object({
  inputs: z.object({
    meteo_data: z.object({
      radiation_db: z.string(),
      year_min: z.number(),
      year_max: z.number(),
    }),
    mounting_system: z.object({
      fixed: z.object({
        slope: z.object({ value: z.number() }).optional(),
        azimuth: z.object({ value: z.number() }).optional(),
      }).optional(),
    }).optional(),
  }),
  outputs: z.object({
    monthly: z.object({
      fixed: z.array(monthSchema),
    }),
    totals: z.object({
      fixed: z.object({
        E_d: z.number(),
        E_y: z.number(),
      }),
    }),
  }),
});

export interface PvgisResult {
  database: string;
  yearMin: number;
  yearMax: number;
  slope: number | null;
  azimuth: number | null;
  months: Array<{ month: number; dailyKwh: number; monthlyKwh: number }>;
  yearlyKwh: number;
}

export async function fetchPvgis(
  input: {
    latitude: number;
    longitude: number;
    systemKw: number;
    lossPercent: number;
    tilt?: number;
    azimuth?: number;
    optimalAngles?: boolean;
  },
  config: Config,
  store: KeyValueStore,
  fetchImpl: typeof fetch,
): Promise<PvgisResult> {
  const tiltKey = input.optimalAngles ? "opt" : (input.tilt ?? 0).toFixed(1);
  const azimuthKey = input.optimalAngles ? "opt" : (input.azimuth ?? 0).toFixed(1);
  const key = `pvgis:${input.latitude.toFixed(3)}:${input.longitude.toFixed(3)}:${input.systemKw.toFixed(2)}:${input.lossPercent}:${tiltKey}:${azimuthKey}`;
  return cachedJson(store, key, config.climatologyTtlSeconds, async () => {
    const url = new URL("https://re.jrc.ec.europa.eu/api/v5_3/PVcalc");
    url.searchParams.set("lat", String(input.latitude));
    url.searchParams.set("lon", String(input.longitude));
    url.searchParams.set("peakpower", String(input.systemKw));
    url.searchParams.set("loss", String(input.lossPercent));
    url.searchParams.set("outputformat", "json");
    url.searchParams.set("browser", "0");
    if (input.optimalAngles) {
      url.searchParams.set("optimalangles", "1");
    } else {
      url.searchParams.set("angle", String(input.tilt ?? 0));
      url.searchParams.set("aspect", String(input.azimuth ?? 0));
    }
    const body = pvgisSchema.parse(await getJson(fetchImpl, url.toString(), config.fetchTimeoutMs, "pvgis"));
    return {
      database: body.inputs.meteo_data.radiation_db,
      yearMin: body.inputs.meteo_data.year_min,
      yearMax: body.inputs.meteo_data.year_max,
      slope: body.inputs.mounting_system?.fixed?.slope?.value ?? null,
      azimuth: body.inputs.mounting_system?.fixed?.azimuth?.value ?? null,
      months: body.outputs.monthly.fixed.map((month) => ({
        month: month.month,
        dailyKwh: month.E_d,
        monthlyKwh: month.E_m,
      })),
      yearlyKwh: body.outputs.totals.fixed.E_y,
    };
  });
}
