import { ZodError } from "zod";
import type { Config } from "./config.js";
import { fetchForecast, slotsFromForecast, type RawForecast } from "./data/forecast.js";
import { SolarError, UpstreamError } from "./data/http.js";
import { choosePlace, geocodePlace, placeLabel } from "./data/openMeteo.js";
import { fetchPvgis, type PvgisResult } from "./data/pvgis.js";
import { SiteBook, type SolarSite } from "./sites.js";
import { assumptionsFrom, type HourSlot, type PvAssumptions } from "./solar/model.js";
import { localDate, planAppliance, type AppliancePlan, type DayChoice } from "./solar/plan.js";
import type { KeyValueStore } from "./store.js";

export interface Deps {
  config: Config;
  store: KeyValueStore;
  sites: SiteBook;
  fetch: typeof fetch;
  now: () => Date;
}

export interface SiteRequest {
  siteId?: string;
  place?: string;
  latitude?: number;
  longitude?: number;
  systemKw?: number;
  tiltDegrees?: number;
  azimuthDegrees?: number;
  pricePerKwh?: number | null;
  currency?: string | null;
  sessionId?: string;
}

export interface TypicalMonth {
  month: number;
  dailyKwh: number;
  monthlyKwh: number;
  yearlyKwh: number;
  database: string;
  yearMin: number;
  yearMax: number;
}

export interface Production {
  site: SolarSite;
  slots: HourSlot[];
  timezone: string;
  daily: RawForecast["daily"];
  typical: TypicalMonth | null;
  pvgisFailed: boolean;
  assumptions: PvAssumptions;
}

export const DATA_SOURCES = [
  {
    name: "Open-Meteo",
    url: "https://open-meteo.com/",
    note: "Forecast and geocoding. API data under CC BY 4.0. Weather data by Open-Meteo.com. The location index includes GeoNames.",
  },
  {
    name: "PVGIS",
    url: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en",
    note: "Typical-year photovoltaic yield, PVGIS 5.3. PVGIS © European Communities, 2001-2026. Free for public use when the source is acknowledged.",
  },
];

function rethrowKnown(error: unknown, source: string): never {
  if (error instanceof UpstreamError || error instanceof SolarError) throw error;
  if (error instanceof ZodError) throw new UpstreamError(source, 200, false);
  throw error;
}

function fallbackTilt(latitude: number): number {
  return Math.min(40, Math.max(15, Math.round(Math.abs(latitude) * 0.7)));
}

function fallbackAzimuth(latitude: number): number {
  return latitude >= 0 ? 0 : 180;
}

async function mountFor(
  deps: Deps,
  latitude: number,
  longitude: number,
  systemKw: number,
  tiltDegrees?: number,
  azimuthDegrees?: number,
): Promise<{ tilt: number; azimuth: number; source: SolarSite["tiltSource"]; preview: PvgisResult | null }> {
  if (tiltDegrees !== undefined && azimuthDegrees !== undefined) {
    return { tilt: tiltDegrees, azimuth: azimuthDegrees, source: "user", preview: null };
  }
  try {
    const optimal = await fetchPvgis({
      latitude,
      longitude,
      systemKw,
      lossPercent: Math.round(deps.config.systemLossFraction * 100),
      optimalAngles: true,
    }, deps.config, deps.store, deps.fetch);
    return {
      tilt: tiltDegrees ?? optimal.slope ?? fallbackTilt(latitude),
      azimuth: azimuthDegrees ?? optimal.azimuth ?? fallbackAzimuth(latitude),
      source: "pvgis-optimal",
      preview: optimal,
    };
  } catch (error) {
    if (error instanceof UpstreamError || error instanceof ZodError) {
      return {
        tilt: tiltDegrees ?? fallbackTilt(latitude),
        azimuth: azimuthDegrees ?? fallbackAzimuth(latitude),
        source: "latitude-fallback",
        preview: null,
      };
    }
    throw error;
  }
}

export async function resolveSite(deps: Deps, request: SiteRequest): Promise<SolarSite> {
  const existing = deps.sites.resolve(request.sessionId, request.siteId);
  const hasLocation = request.place !== undefined || (request.latitude !== undefined && request.longitude !== undefined);
  if (!hasLocation) {
    if (!existing && request.siteId) {
      throw new SolarError("I don't have that site anymore. Memory lives in this server process, so a restart clears it. Tell me the city and array size again.");
    }
    if (!existing) {
      throw new SolarError("I don't know which roof you mean yet. Tell me the city and the array size in kilowatts.");
    }
    const next: SolarSite = {
      ...existing,
      systemKw: request.systemKw ?? existing.systemKw,
      tiltDegrees: request.tiltDegrees ?? existing.tiltDegrees,
      azimuthDegrees: request.azimuthDegrees ?? existing.azimuthDegrees,
      pricePerKwh: request.pricePerKwh === undefined ? existing.pricePerKwh : request.pricePerKwh,
      currency: request.currency === undefined ? existing.currency : request.currency,
    };
    if (request.tiltDegrees !== undefined || request.azimuthDegrees !== undefined) {
      next.tiltSource = "user";
    }
    return deps.sites.save(next, request.sessionId);
  }

  let latitude = request.latitude;
  let longitude = request.longitude;
  let label = existing?.label ?? "the site";
  let timezone = existing?.timezone ?? "UTC";
  if (request.place) {
    let hits: Awaited<ReturnType<typeof geocodePlace>>;
    try {
      hits = await geocodePlace(request.place, deps.config, deps.store, deps.fetch);
    } catch (error) {
      rethrowKnown(error, "geocoder");
    }
    const chosen = choosePlace(hits);
    if ("ambiguous" in chosen) {
      const list = chosen.ambiguous.map(placeLabel).join("; ");
      throw new SolarError(`I found more than one match for ${request.place}: ${list}. Tell me which one, or pass a latitude and longitude.`);
    }
    latitude = chosen.latitude;
    longitude = chosen.longitude;
    label = placeLabel(chosen);
    timezone = chosen.timezone ?? timezone;
  }
  if (latitude === undefined || longitude === undefined) {
    throw new SolarError("Give me both a latitude and a longitude, or a place name.");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new SolarError("That latitude or longitude is out of range.");
  }
  const systemKw = request.systemKw ?? existing?.systemKw;
  if (systemKw === undefined) {
    throw new SolarError("Tell me the array size in kilowatts. A home array might be 5.");
  }
  const mount = await mountFor(deps, latitude, longitude, systemKw, request.tiltDegrees, request.azimuthDegrees);
  const site: SolarSite = {
    id: existing?.id ?? "",
    label,
    latitude,
    longitude,
    timezone,
    systemKw,
    tiltDegrees: mount.tilt,
    azimuthDegrees: mount.azimuth,
    tiltSource: request.tiltDegrees !== undefined && request.azimuthDegrees !== undefined ? "user" : mount.source,
    pricePerKwh: request.pricePerKwh === undefined ? existing?.pricePerKwh ?? null : request.pricePerKwh,
    currency: request.currency === undefined ? existing?.currency ?? null : request.currency,
  };
  if (existing) return deps.sites.save({ ...site, id: existing.id }, request.sessionId);
  return deps.sites.create(site, request.sessionId);
}

export async function loadProduction(deps: Deps, site: SolarSite): Promise<Production> {
  const assumptions = assumptionsFrom(deps.config.systemLossFraction, deps.config.tempCoeffPerC);
  const forecastPromise = fetchForecast({
    latitude: site.latitude,
    longitude: site.longitude,
    tilt: site.tiltDegrees,
    azimuth: site.azimuthDegrees,
  }, deps.config, deps.store, deps.fetch);
  const pvgisPromise = fetchPvgis({
    latitude: site.latitude,
    longitude: site.longitude,
    systemKw: site.systemKw,
    lossPercent: Math.round(assumptions.systemLossFraction * 100),
    tilt: site.tiltDegrees,
    azimuth: site.azimuthDegrees,
  }, deps.config, deps.store, deps.fetch);
  let raw: RawForecast;
  try {
    raw = await forecastPromise;
  } catch (error) {
    await pvgisPromise.catch(() => undefined);
    rethrowKnown(error, "forecast");
  }
  if (raw.timezone && raw.timezone !== site.timezone) {
    site = deps.sites.save({ ...site, timezone: raw.timezone });
  }
  const slots = slotsFromForecast(raw, site.systemKw, assumptions);
  const month = Number(localDate(deps.now(), raw.timezone).slice(5, 7));
  let typical: TypicalMonth | null = null;
  let pvgisFailed = false;
  try {
    const pvgis = await pvgisPromise;
    const row = pvgis.months.find((item) => item.month === month);
    if (row) {
      typical = {
        month,
        dailyKwh: row.dailyKwh,
        monthlyKwh: row.monthlyKwh,
        yearlyKwh: pvgis.yearlyKwh,
        database: pvgis.database,
        yearMin: pvgis.yearMin,
        yearMax: pvgis.yearMax,
      };
    }
  } catch (error) {
    if (error instanceof UpstreamError || error instanceof ZodError) pvgisFailed = true;
    else throw error;
  }
  return { site, slots, timezone: raw.timezone, daily: raw.daily, typical, pvgisFailed, assumptions };
}

export async function loadTypicalOnly(deps: Deps, site: SolarSite): Promise<TypicalMonth | null> {
  try {
    const pvgis = await fetchPvgis({
      latitude: site.latitude,
      longitude: site.longitude,
      systemKw: site.systemKw,
      lossPercent: Math.round(deps.config.systemLossFraction * 100),
      tilt: site.tiltDegrees,
      azimuth: site.azimuthDegrees,
    }, deps.config, deps.store, deps.fetch);
    const month = Number(localDate(deps.now(), site.timezone).slice(5, 7));
    const row = pvgis.months.find((item) => item.month === month);
    if (!row) return null;
    return {
      month,
      dailyKwh: row.dailyKwh,
      monthlyKwh: row.monthlyKwh,
      yearlyKwh: pvgis.yearlyKwh,
      database: pvgis.database,
      yearMin: pvgis.yearMin,
      yearMax: pvgis.yearMax,
    };
  } catch (error) {
    if (error instanceof UpstreamError || error instanceof ZodError) return null;
    throw error;
  }
}

export function planFor(production: Production, input: {
  powerKw: number;
  durationHours: number;
  day: DayChoice;
  baselineHour: number;
  now: Date;
}): AppliancePlan {
  return planAppliance({
    slots: production.slots,
    timeZone: production.timezone,
    now: input.now,
    powerKw: input.powerKw,
    durationHours: input.durationHours,
    day: input.day,
    baselineHour: input.baselineHour,
  });
}
