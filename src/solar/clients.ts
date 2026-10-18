import { runtime } from "../runtime.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";

export const OPEN_METEO_ATTRIBUTION =
  "Weather and geocoding data by Open-Meteo.com (https://open-meteo.com/), CC BY 4.0. Geocoding uses GeoNames.";

export const PVGIS_ATTRIBUTION =
  "PVGIS © European Union, Joint Research Centre, reused with no licence restriction stated by JRC. Not an official Commission forecast.";

export interface GeoMatch {
  name: string;
  country: string;
  countryCode: string;
  admin1: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  elevationM: number | null;
}

export async function geocodePlace(place: string, count: number): Promise<GeoMatch[]> {
  const params = new URLSearchParams({
    name: place,
    count: String(count),
    language: "en",
    format: "json",
  });
  const body = await runtime.fetchJson(`${GEOCODE_URL}?${params.toString()}`, {
    cacheTtlMs: 24 * 60 * 60 * 1000,
  });
  const results = asRecord(body).results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.map(parseGeoMatch);
}

export interface ForecastHour {
  /** Local timestamp from Open-Meteo. GTI at this time is the preceding-hour mean. */
  time: string;
  gtiWm2: number | null;
  airTempC: number | null;
}

export interface ForecastBundle {
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffsetSeconds: number;
  elevationM: number | null;
  hours: ForecastHour[];
  requestUrl: string;
}

export interface ForecastQuery {
  latitude: number;
  longitude: number;
  tiltDegrees: number;
  azimuthDegrees: number;
}

export async function fetchForecast(query: ForecastQuery): Promise<ForecastBundle> {
  const params = new URLSearchParams({
    latitude: String(query.latitude),
    longitude: String(query.longitude),
    hourly: "temperature_2m,global_tilted_irradiance",
    timezone: "auto",
    forecast_days: "3",
    tilt: String(query.tiltDegrees),
    azimuth: String(query.azimuthDegrees),
  });
  const requestUrl = `${FORECAST_URL}?${params.toString()}`;
  const body = asRecord(await runtime.fetchJson(requestUrl, { cacheTtlMs: 10 * 60 * 1000 }));
  if (body.error === true) {
    throw new Error(`Open-Meteo refused the forecast: ${String(body.reason ?? "unknown reason")}`);
  }
  const hourly = asRecord(body.hourly);
  const times = asStringArray(hourly.time, "hourly.time");
  const gti = asNumberOrNullArray(hourly.global_tilted_irradiance, "hourly.global_tilted_irradiance");
  const temps = asNumberOrNullArray(hourly.temperature_2m, "hourly.temperature_2m");
  if (times.length !== gti.length || times.length !== temps.length) {
    throw new Error("Open-Meteo returned hourly arrays of different lengths");
  }
  const hours = times.map((time, index) => ({
    time: time.slice(0, 16),
    gtiWm2: gti[index] ?? null,
    airTempC: temps[index] ?? null,
  }));
  return {
    latitude: asNumber(body.latitude, "latitude"),
    longitude: asNumber(body.longitude, "longitude"),
    timezone: asString(body.timezone, "timezone"),
    utcOffsetSeconds: asNumber(body.utc_offset_seconds, "utc_offset_seconds"),
    elevationM: typeof body.elevation === "number" ? body.elevation : null,
    hours,
    requestUrl,
  };
}

export interface PvgisMonth {
  month: number;
  energyPerDayKwh: number;
  energyPerMonthKwh: number;
  irradiationPerDayKwhM2: number;
  monthlyStdDevKwh: number;
}

export interface PvgisYield {
  radiationDatabase: string;
  meteoDatabase: string;
  yearMin: number;
  yearMax: number;
  elevationM: number | null;
  technology: string;
  mounting: string;
  peakPowerKw: number;
  systemLossPercent: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  months: PvgisMonth[];
  yearlyEnergyKwh: number;
  averageDailyEnergyKwh: number;
  averageMonthlyEnergyKwh: number;
  yearlyIrradiationKwhM2: number;
  yearlyStdDevKwh: number;
  requestUrl: string;
}

export interface PvgisQuery {
  latitude: number;
  longitude: number;
  peakPowerKw: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  systemLossPercent: number;
}

export async function fetchPvgisYield(query: PvgisQuery): Promise<PvgisYield> {
  const params = new URLSearchParams({
    lat: String(query.latitude),
    lon: String(query.longitude),
    peakpower: String(query.peakPowerKw),
    loss: String(query.systemLossPercent),
    angle: String(query.tiltDegrees),
    aspect: String(query.azimuthDegrees),
    pvtechchoice: "crystSi",
    mountingplace: "free",
    outputformat: "json",
    browser: "0",
  });
  const requestUrl = `${PVGIS_URL}?${params.toString()}`;
  const body = asRecord(
    await runtime.fetchJson(requestUrl, { timeoutMs: 20_000, cacheTtlMs: 24 * 60 * 60 * 1000 }),
  );
  if (typeof body.message === "string" && !body.outputs) {
    throw new Error(`PVGIS: ${body.message}`);
  }
  const inputs = asRecord(body.inputs);
  const location = asRecord(inputs.location);
  const meteo = asRecord(inputs.meteo_data);
  const mounting = asRecord(asRecord(inputs.mounting_system).fixed);
  const pvModule = asRecord(inputs.pv_module);
  const outputs = asRecord(body.outputs);
  const monthsRaw = asRecord(outputs.monthly).fixed;
  if (!Array.isArray(monthsRaw)) {
    throw new Error("PVGIS response did not include monthly fixed-system output");
  }
  const totals = asRecord(asRecord(outputs.totals).fixed);
  const months = monthsRaw.map((entry) => {
    const month = asRecord(entry);
    return {
      month: asNumber(month.month, "month"),
      energyPerDayKwh: asNumber(month.E_d, "E_d"),
      energyPerMonthKwh: asNumber(month.E_m, "E_m"),
      irradiationPerDayKwhM2: asNumber(month["H(i)_d"], "H(i)_d"),
      monthlyStdDevKwh: asNumber(month.SD_m, "SD_m"),
    };
  });
  return {
    radiationDatabase: asString(meteo.radiation_db, "radiation_db"),
    meteoDatabase: asString(meteo.meteo_db, "meteo_db"),
    yearMin: asNumber(meteo.year_min, "year_min"),
    yearMax: asNumber(meteo.year_max, "year_max"),
    elevationM: typeof location.elevation === "number" ? location.elevation : null,
    technology: asString(pvModule.technology, "technology"),
    mounting: asString(mounting.type, "mounting type"),
    peakPowerKw: asNumber(pvModule.peak_power, "peak_power"),
    systemLossPercent: asNumber(pvModule.system_loss, "system_loss"),
    tiltDegrees: asNumber(asRecord(mounting.slope).value, "slope"),
    azimuthDegrees: asNumber(asRecord(mounting.azimuth).value, "azimuth"),
    months,
    yearlyEnergyKwh: asNumber(totals.E_y, "E_y"),
    averageDailyEnergyKwh: asNumber(totals.E_d, "E_d"),
    averageMonthlyEnergyKwh: asNumber(totals.E_m, "E_m"),
    yearlyIrradiationKwhM2: asNumber(totals["H(i)_y"], "H(i)_y"),
    yearlyStdDevKwh: asNumber(totals.SD_y, "SD_y"),
    requestUrl,
  };
}

function parseGeoMatch(value: unknown): GeoMatch {
  const row = asRecord(value);
  return {
    name: asString(row.name, "name"),
    country: asString(row.country, "country"),
    countryCode: asString(row.country_code, "country_code"),
    admin1: typeof row.admin1 === "string" ? row.admin1 : null,
    latitude: asNumber(row.latitude, "latitude"),
    longitude: asNumber(row.longitude, "longitude"),
    timezone: asString(row.timezone, "timezone"),
    elevationM: typeof row.elevation === "number" ? row.elevation : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Upstream JSON was not an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Upstream field ${field} was missing`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Upstream field ${field} was not a number`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Upstream field ${field} was not a string array`);
  }
  return value as string[];
}

function asNumberOrNullArray(value: unknown, field: string): Array<number | null> {
  if (!Array.isArray(value)) {
    throw new Error(`Upstream field ${field} was not an array`);
  }
  return value.map((item) => {
    if (item === null) return null;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    throw new Error(`Upstream field ${field} contained a non-number`);
  });
}
