import {
  fetchForecast,
  fetchPvgisYield,
  geocodePlace,
  OPEN_METEO_ATTRIBUTION,
  PVGIS_ATTRIBUTION,
  type ForecastBundle,
  type GeoMatch,
  type PvgisYield,
} from "./clients.js";
import {
  addDays,
  azimuthLabel,
  clockLabel,
  defaultAzimuthDegrees,
  defaultTiltDegrees,
  formatFixed,
  hourEnergy,
  localDateIso,
  localWallIso,
  rankWindows,
  round,
  valueProduction,
  type HourSlot,
} from "./model.js";
import { runtime } from "../runtime.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface SystemSpec {
  latitude: number;
  longitude: number;
  peakPowerKw: number;
  tiltDegrees?: number;
  azimuthDegrees?: number;
  systemLossPercent?: number;
  placeName?: string;
}

interface ResolvedSystem extends SystemSpec {
  tiltDegrees: number;
  azimuthDegrees: number;
  systemLossPercent: number;
  tiltWasDefault: boolean;
  azimuthWasDefault: boolean;
}

export function resolveSystem(spec: SystemSpec): ResolvedSystem {
  const tiltWasDefault = spec.tiltDegrees === undefined;
  const azimuthWasDefault = spec.azimuthDegrees === undefined;
  return {
    ...spec,
    tiltDegrees: spec.tiltDegrees ?? defaultTiltDegrees(spec.latitude),
    azimuthDegrees: spec.azimuthDegrees ?? defaultAzimuthDegrees(spec.latitude),
    systemLossPercent: spec.systemLossPercent ?? 14,
    tiltWasDefault,
    azimuthWasDefault,
  };
}

export async function describeLocation(place: string, count: number): Promise<{
  summary: string;
  details: Record<string, unknown>;
}> {
  const matches = await geocodePlace(place, count);
  if (matches.length === 0) {
    return {
      summary: `No place matched "${place}". Try a city name in Latin or Cyrillic letters.`,
      details: { query: place, matches: [], attribution: OPEN_METEO_ATTRIBUTION },
    };
  }
  const best = matches[0] as GeoMatch;
  const others = matches.slice(1);
  const where = formatPlace(best);
  const extra =
    others.length > 0
      ? ` ${others.length} other match${others.length === 1 ? "" : "es"} came back; confirm this is the right place before forecasting.`
      : "";
  return {
    summary: `The best match for "${place}" is ${where} at ${formatFixed(best.latitude, 2)}°, ${formatFixed(best.longitude, 2)}° (${best.timezone}).${extra}`,
    details: {
      query: place,
      best: serializeMatch(best),
      alternatives: others.map(serializeMatch),
      attribution: OPEN_METEO_ATTRIBUTION,
    },
  };
}

export async function describeForecast(spec: SystemSpec): Promise<{
  summary: string;
  details: Record<string, unknown>;
}> {
  const system = resolveSystem(spec);
  const forecast = await fetchForecast({
    latitude: system.latitude,
    longitude: system.longitude,
    tiltDegrees: system.tiltDegrees,
    azimuthDegrees: system.azimuthDegrees,
  });
  const built = buildDays(forecast, system);
  const place = system.placeName ? ` near ${system.placeName}` : "";
  const facing = azimuthLabel(system.azimuthDegrees);
  const today = built.today;
  const tomorrow = built.tomorrow;
  let summary: string;
  if (today.remainingKwh <= 0.005) {
    summary = `A ${formatFixed(system.peakPowerKw, 2)} kW array${place} at ${formatFixed(system.latitude, 2)}°, ${formatFixed(system.longitude, 2)}° (tilt ${formatFixed(system.tiltDegrees, 1)}°, facing ${facing}) has no production left in today's forecast (${today.date}, ${forecast.timezone}). Tomorrow is estimated at ${formatFixed(tomorrow.fullDayKwh)} kWh. This is an Open-Meteo forecast through a simple model, not a meter reading.`;
  } else {
    const peak = today.brightestRemaining;
    const peakClause = peak
      ? ` The brightest remaining hour is ${clockLabel(peak.startIso)}–${clockLabel(peak.endIso)} at about ${formatFixed(peak.energyKwh)} kWh.`
      : "";
    summary = `A ${formatFixed(system.peakPowerKw, 2)} kW array${place} at ${formatFixed(system.latitude, 2)}°, ${formatFixed(system.longitude, 2)}° (tilt ${formatFixed(system.tiltDegrees, 1)}°, facing ${facing}) is estimated to produce ${formatFixed(today.remainingKwh)} kWh still today (${today.date}, ${forecast.timezone}) and ${formatFixed(tomorrow.fullDayKwh)} kWh tomorrow.${peakClause} This is an Open-Meteo forecast through a simple model, not a meter reading.`;
  }
  return {
    summary,
    details: {
      ...built.details,
      assumptions: assumptions(system),
      attribution: OPEN_METEO_ATTRIBUTION,
      request_url: forecast.requestUrl,
    },
  };
}

export async function describeApplianceWindow(input: {
  system: SystemSpec;
  applianceName?: string;
  powerWatts: number;
  durationHours: number;
  day: "auto" | "today" | "tomorrow";
}): Promise<{ summary: string; details: Record<string, unknown> }> {
  const system = resolveSystem(input.system);
  const forecast = await fetchForecast({
    latitude: system.latitude,
    longitude: system.longitude,
    tiltDegrees: system.tiltDegrees,
    azimuthDegrees: system.azimuthDegrees,
  });
  const built = buildDays(forecast, system);
  const loadKwh = round((input.powerWatts / 1000) * input.durationHours, 3);
  const name = input.applianceName?.trim() || "This load";
  const chosen =
    input.day === "tomorrow" || (input.day === "auto" && built.today.remainingSlots.length === 0)
      ? built.tomorrow
      : built.today;
  const slots = chosen.remainingSlots.length > 0 ? chosen.remainingSlots : chosen.slots;
  const usingRemaining = chosen.remainingSlots.length > 0;
  const windows = rankWindows(slots, input.durationHours, 3);
  const best = windows[0];
  let summary: string;
  if (!best) {
    summary = `${name} at ${formatFixed(input.powerWatts, 0)} W for ${formatFixed(input.durationHours, 1)} hours needs ${formatFixed(loadKwh)} kWh. The ${chosen.date} forecast does not contain a long enough block of hours to place that run. Estimate only.`;
  } else {
    const coverage = loadKwh > 0 ? Math.min(1, best.productionKwh / loadKwh) : 1;
    const coverSentence =
      coverage >= 0.999
        ? "On this estimate the array covers the load in that window."
        : "The rest would come from the grid or a battery.";
    summary = `${name} at ${formatFixed(input.powerWatts, 0)} W for ${formatFixed(input.durationHours, 1)} hours needs ${formatFixed(loadKwh)} kWh. The best ${usingRemaining ? "remaining " : ""}window on ${chosen.date} is ${clockLabel(best.startIso)}–${clockLabel(best.endIso)}, with about ${formatFixed(best.productionKwh)} kWh from the array (${formatFixed(coverage * 100, 0)}% of the load). ${coverSentence} Estimate only, not a guaranteed schedule.`;
  }
  return {
    summary,
    details: {
      appliance_name: name,
      power_watts: input.powerWatts,
      duration_hours: input.durationHours,
      load_kwh: loadKwh,
      day: chosen.date,
      used_remaining_hours_only: usingRemaining,
      windows: windows.map((window) => ({
        start: window.startIso,
        end: window.endIso,
        production_kwh: window.productionKwh,
        coverage: loadKwh > 0 ? round(Math.min(1, window.productionKwh / loadKwh), 3) : 1,
      })),
      today_remaining_kwh: built.today.remainingKwh,
      tomorrow_kwh: built.tomorrow.fullDayKwh,
      timezone: forecast.timezone,
      assumptions: assumptions(system),
      attribution: OPEN_METEO_ATTRIBUTION,
    },
  };
}

export async function describeSavings(input: {
  system?: SystemSpec;
  productionKwh?: number;
  gridPricePerKwh: number;
  currency: string;
  exportPricePerKwh: number;
  selfConsumptionFraction: number;
}): Promise<{ summary: string; details: Record<string, unknown> }> {
  const currency = input.currency.toUpperCase();
  let productionKwh = input.productionKwh;
  let source: Record<string, unknown> = { kind: "caller_supplied_kwh" };
  if (productionKwh === undefined) {
    if (!input.system) {
      throw new Error("Provide production_kwh or a location and peak power.");
    }
    const forecast = await describeForecast(input.system);
    const details = forecast.details;
    const today = asNumber(asRecord(details.today).remaining_kwh);
    const tomorrow = asNumber(asRecord(details.tomorrow).full_day_kwh);
    productionKwh = round(today + tomorrow, 3);
    source = {
      kind: "forecast_remaining_today_plus_tomorrow",
      remaining_today_kwh: today,
      tomorrow_kwh: tomorrow,
      forecast_summary: forecast.summary,
    };
  }
  const valued = valueProduction({
    productionKwh,
    gridPricePerKwh: input.gridPricePerKwh,
    exportPricePerKwh: input.exportPricePerKwh,
    selfConsumptionFraction: input.selfConsumptionFraction,
  });
  const percent = formatFixed(input.selfConsumptionFraction * 100, 0);
  let assumption = `${percent}% is assumed to offset a purchase`;
  if (input.selfConsumptionFraction < 1) {
    assumption +=
      input.exportPricePerKwh > 0
        ? `, and the rest is valued at ${formatFixed(input.exportPricePerKwh)} ${currency} per kWh`
        : ", and the rest is valued at zero";
  }
  const summary = `Valuing ${formatFixed(productionKwh)} kWh at ${formatFixed(input.gridPricePerKwh)} ${currency} per kWh (${assumption}) comes to about ${formatFixed(valued.value)} ${currency}. You supplied the price. This is not a bill and it ignores fixed charges, taxes, and local net-metering rules.`;
  return {
    summary,
    details: {
      currency,
      production_kwh: round(productionKwh, 3),
      grid_price_per_kwh: input.gridPricePerKwh,
      export_price_per_kwh: input.exportPricePerKwh,
      self_consumption_fraction: input.selfConsumptionFraction,
      self_consumed_kwh: valued.selfConsumedKwh,
      exported_kwh: valued.exportedKwh,
      estimated_value: valued.value,
      source,
      disclaimer:
        "Caller-supplied price. Not a tariff lookup, not an invoice, and not a promise of savings.",
    },
  };
}

export async function describeTypicalYear(spec: SystemSpec): Promise<{
  summary: string;
  details: Record<string, unknown>;
}> {
  const system = resolveSystem(spec);
  const yieldResult = await fetchPvgisYield({
    latitude: system.latitude,
    longitude: system.longitude,
    peakPowerKw: system.peakPowerKw,
    tiltDegrees: system.tiltDegrees,
    azimuthDegrees: system.azimuthDegrees,
    systemLossPercent: system.systemLossPercent,
  });
  const ranked = [...yieldResult.months].sort((a, b) => b.energyPerMonthKwh - a.energyPerMonthKwh);
  const high = ranked[0];
  const low = ranked[ranked.length - 1];
  const highName = high ? monthName(high.month) : "the peak month";
  const lowName = low ? monthName(low.month) : "the lowest month";
  const summary = `PVGIS 5.3 estimates about ${formatFixed(yieldResult.yearlyEnergyKwh, 0)} kWh per year (${formatFixed(yieldResult.averageDailyEnergyKwh)} kWh per day on average) for this ${formatFixed(system.peakPowerKw, 2)} kW array, using ${yieldResult.radiationDatabase} and ${yieldResult.meteoDatabase} for ${yieldResult.yearMin}–${yieldResult.yearMax}. The highest typical month is ${highName} at ${formatFixed(high?.energyPerMonthKwh ?? 0, 0)} kWh, and the lowest is ${lowName} at ${formatFixed(low?.energyPerMonthKwh ?? 0, 0)} kWh. This is a long-term climate figure, not a forecast for this year.`;
  return {
    summary,
    details: serializePvgis(yieldResult, system),
  };
}

function buildDays(forecast: ForecastBundle, system: ResolvedSystem) {
  const now = localWallIso(runtime.now(), forecast.utcOffsetSeconds);
  const todayDate = localDateIso(runtime.now(), forecast.utcOffsetSeconds);
  const tomorrowDate = addDays(todayDate, 1);
  let temperatureAssumed = false;
  const slots: HourSlot[] = forecast.hours.map((hour) => {
    const endIso = hour.time;
    const startIso = shiftHour(endIso);
    const airTemp = hour.airTempC;
    if (airTemp === null && hour.gtiWm2) {
      temperatureAssumed = true;
    }
    const energy =
      hour.gtiWm2 === null
        ? 0
        : hourEnergy({
            gtiWm2: hour.gtiWm2,
            airTempC: airTemp ?? 15,
            peakPowerKw: system.peakPowerKw,
            systemLossFraction: system.systemLossPercent / 100,
          }).energyKwh;
    return {
      startIso,
      endIso,
      date: startIso.slice(0, 10),
      energyKwh: energy,
      gtiWm2: hour.gtiWm2,
      future: endIso > now,
    };
  });
  const today = summarizeDay(slots, todayDate);
  const tomorrow = summarizeDay(slots, tomorrowDate);
  return {
    today,
    tomorrow,
    details: {
      timezone: forecast.timezone,
      utc_offset_seconds: forecast.utcOffsetSeconds,
      local_time: now,
      elevation_m: forecast.elevationM,
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      place_name: system.placeName ?? null,
      temperature_assumed_for_missing_hours: temperatureAssumed,
      partial_hour_note:
        "The current clock hour is counted in full, so a mid-hour request slightly overstates energy still to come.",
      today: dayPayload(today),
      tomorrow: dayPayload(tomorrow),
    },
  };
}

function summarizeDay(slots: HourSlot[], date: string) {
  const daySlots = slots.filter((slot) => slot.date === date);
  const remaining = daySlots.filter((slot) => slot.future);
  const fullDayKwh = round(sum(daySlots.map((slot) => slot.energyKwh)), 3);
  const remainingKwh = round(sum(remaining.map((slot) => slot.energyKwh)), 3);
  return {
    date,
    slots: daySlots,
    remainingSlots: remaining,
    fullDayKwh,
    remainingKwh,
    brightestRemaining: brightest(remaining),
    brightestFullDay: brightest(daySlots),
  };
}

function brightest(slots: HourSlot[]): HourSlot | null {
  let best: HourSlot | null = null;
  for (const slot of slots) {
    if (!best || slot.energyKwh > best.energyKwh) {
      best = slot;
    }
  }
  return best && best.energyKwh > 0 ? best : null;
}

function dayPayload(day: ReturnType<typeof summarizeDay>) {
  return {
    date: day.date,
    full_day_kwh: day.fullDayKwh,
    remaining_kwh: day.remainingKwh,
    brightest_remaining_hour: day.brightestRemaining ? hourPayload(day.brightestRemaining) : null,
    brightest_hour: day.brightestFullDay ? hourPayload(day.brightestFullDay) : null,
    hours: day.slots.map(hourPayload),
  };
}

function hourPayload(slot: HourSlot) {
  return {
    start: slot.startIso,
    end: slot.endIso,
    energy_kwh: round(slot.energyKwh, 3),
    gti_w_m2: slot.gtiWm2,
    future: slot.future,
  };
}

function assumptions(system: ResolvedSystem) {
  return {
    peak_power_kw: system.peakPowerKw,
    meaning: "peak_power_kw is nameplate DC kilowatts (kWp), the same quantity PVGIS calls peak power.",
    tilt_degrees: system.tiltDegrees,
    tilt_defaulted: system.tiltWasDefault,
    azimuth_degrees: system.azimuthDegrees,
    azimuth_defaulted: system.azimuthWasDefault,
    azimuth_convention: "0° south, -90° east, 90° west, ±180° north. Shared by Open-Meteo and PVGIS.",
    system_loss_percent: system.systemLossPercent,
    system_loss_meaning:
      "Inverter, cables, and soiling. Temperature is applied separately and is not inside this percentage.",
    temperature_coefficient_per_c: -0.004,
    cell_temperature:
      "Tcell = Tair + 0.03125 * GTI, from a 45°C NOCT linear approximation. Not a measured module temperature.",
    irradiance:
      "Open-Meteo global_tilted_irradiance is the preceding-hour mean in W/m², fixed albedo 0.2, isotropic sky.",
    energy_identity: "Hourly kWh equals the estimated average kW during that one-hour interval.",
    model_boundary:
      "The short-term forecast uses this local model. typical_monthly_yield returns PVGIS's own model and will not match these hourly numbers.",
  };
}

function serializePvgis(result: PvgisYield, system: ResolvedSystem) {
  return {
    source: "PVGIS 5.3 PVcalc",
    radiation_database: result.radiationDatabase,
    meteo_database: result.meteoDatabase,
    year_min: result.yearMin,
    year_max: result.yearMax,
    elevation_m: result.elevationM,
    technology: result.technology,
    mounting: result.mounting,
    peak_power_kw: result.peakPowerKw,
    system_loss_percent: result.systemLossPercent,
    tilt_degrees: result.tiltDegrees,
    azimuth_degrees: result.azimuthDegrees,
    tilt_defaulted: system.tiltWasDefault,
    azimuth_defaulted: system.azimuthWasDefault,
    yearly_energy_kwh: result.yearlyEnergyKwh,
    average_daily_energy_kwh: result.averageDailyEnergyKwh,
    average_monthly_energy_kwh: result.averageMonthlyEnergyKwh,
    yearly_plane_irradiation_kwh_m2: result.yearlyIrradiationKwhM2,
    yearly_std_dev_kwh: result.yearlyStdDevKwh,
    months: result.months.map((month) => ({
      month: month.month,
      name: monthName(month.month),
      energy_per_day_kwh: month.energyPerDayKwh,
      energy_per_month_kwh: month.energyPerMonthKwh,
      plane_irradiation_per_day_kwh_m2: month.irradiationPerDayKwhM2,
      std_dev_kwh: month.monthlyStdDevKwh,
    })),
    disclaimer:
      "Climatology for a typical year in the stated database period. Not a forecast for the current month and not a meter reading.",
    attribution: PVGIS_ATTRIBUTION,
    request_url: result.requestUrl,
  };
}

function serializeMatch(match: GeoMatch) {
  return {
    name: match.name,
    admin1: match.admin1,
    country: match.country,
    country_code: match.countryCode,
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone,
    elevation_m: match.elevationM,
  };
}

function formatPlace(match: GeoMatch): string {
  return [match.name, match.admin1, match.country].filter((part) => part && part.length > 0).join(", ");
}

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `month ${month}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function shiftHour(endIso: string): string {
  const [datePart, timePart] = endIso.split("T");
  if (!datePart || !timePart) {
    return endIso;
  }
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return endIso;
  }
  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute) - 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected a number in the forecast details");
  }
  return value;
}
