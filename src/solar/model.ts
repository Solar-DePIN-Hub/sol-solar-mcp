/**
 * Simple PV yield model used only for the short-term forecast tool.
 * PVGIS monthly results come from PVGIS itself and do not use this model.
 *
 * Cell temperature uses the common linear NOCT approximation:
 *   Tcell = Tair + (NOCT - 20) / 800 * GTI
 * with NOCT = 45°C, so the coefficient is 0.03125 °C per (W/m²).
 * Crystalline-silicon power falls about 0.4% per °C above 25°C cell temperature.
 * Neither figure is a measurement of the caller's modules.
 */

export const NOCT_CELL_RISE_PER_WM2 = (45 - 20) / 800;
export const CRYSTALLINE_TEMP_COEFF_PER_C = -0.004;
export const DEFAULT_SYSTEM_LOSS_FRACTION = 0.14;

export interface HourEnergyInput {
  gtiWm2: number;
  airTempC: number;
  peakPowerKw: number;
  systemLossFraction: number;
}

export interface HourEnergy {
  cellTempC: number;
  temperatureFactor: number;
  powerKw: number;
  energyKwh: number;
}

export function hourEnergy(input: HourEnergyInput): HourEnergy {
  const gti = Number.isFinite(input.gtiWm2) ? Math.max(0, input.gtiWm2) : 0;
  const cellTempC = input.airTempC + NOCT_CELL_RISE_PER_WM2 * gti;
  const temperatureFactor = Math.max(0, 1 + CRYSTALLINE_TEMP_COEFF_PER_C * (cellTempC - 25));
  const loss = clamp(input.systemLossFraction, 0, 0.9);
  const powerKw = input.peakPowerKw * (gti / 1000) * temperatureFactor * (1 - loss);
  return {
    cellTempC: round(cellTempC, 2),
    temperatureFactor: round(temperatureFactor, 4),
    powerKw: round(Math.max(0, powerKw), 4),
    energyKwh: round(Math.max(0, powerKw), 4),
  };
}

/** Rule of thumb: tilt roughly matches latitude, kept inside a practical rooftop range. */
export function defaultTiltDegrees(latitude: number): number {
  const abs = Math.min(Math.max(Math.abs(latitude), 10), 60);
  return round(abs, 1);
}

/** Open-Meteo and PVGIS: 0° is south, 180° is north. */
export function defaultAzimuthDegrees(latitude: number): number {
  return latitude >= 0 ? 0 : 180;
}

export function azimuthLabel(azimuth: number): string {
  if (Math.abs(azimuth) <= 15) return "south";
  if (Math.abs(Math.abs(azimuth) - 180) <= 15) return "north";
  if (azimuth <= -75 && azimuth >= -105) return "east";
  if (azimuth >= 75 && azimuth <= 105) return "west";
  return `${round(azimuth, 1)}° from south`;
}

export interface HourSlot {
  startIso: string;
  endIso: string;
  date: string;
  energyKwh: number;
  gtiWm2: number | null;
  future: boolean;
}

export interface RankedWindow {
  startIso: string;
  endIso: string;
  productionKwh: number;
  durationHours: number;
}

/**
 * Rank contiguous windows. `slots` must be hourly and in order.
 * A slot's `endIso` is the Open-Meteo timestamp (end of the preceding-hour average).
 */
export function rankWindows(slots: HourSlot[], durationHours: number, topN = 3): RankedWindow[] {
  if (!(durationHours > 0) || durationHours > 24) {
    return [];
  }
  const ranked: RankedWindow[] = [];
  for (let start = 0; start < slots.length; start += 1) {
    const window = coverWindow(slots, start, durationHours);
    if (window) {
      ranked.push(window);
    }
  }
  ranked.sort((a, b) => b.productionKwh - a.productionKwh || a.startIso.localeCompare(b.startIso));
  return ranked.slice(0, topN);
}

function coverWindow(slots: HourSlot[], start: number, durationHours: number): RankedWindow | undefined {
  let remaining = durationHours;
  let production = 0;
  let endIso = slots[start]?.startIso;
  if (!endIso) {
    return undefined;
  }
  for (let index = start; index < slots.length && remaining > 1e-9; index += 1) {
    const slot = slots[index];
    const previous = index > start ? slots[index - 1] : undefined;
    if (!slot || (previous && slot.startIso !== previous.endIso)) {
      return undefined;
    }
    const take = Math.min(1, remaining);
    production += slot.energyKwh * take;
    remaining -= take;
    endIso = take === 1 ? slot.endIso : addHours(slot.startIso, take);
  }
  if (remaining > 1e-6 || !endIso || !slots[start]) {
    return undefined;
  }
  return {
    startIso: slots[start].startIso,
    endIso,
    productionKwh: round(production, 3),
    durationHours,
  };
}

export interface SavingsInput {
  productionKwh: number;
  gridPricePerKwh: number;
  exportPricePerKwh: number;
  selfConsumptionFraction: number;
}

export interface SavingsValue {
  selfConsumedKwh: number;
  exportedKwh: number;
  value: number;
}

export function valueProduction(input: SavingsInput): SavingsValue {
  const fraction = clamp(input.selfConsumptionFraction, 0, 1);
  const selfConsumedKwh = input.productionKwh * fraction;
  const exportedKwh = input.productionKwh - selfConsumedKwh;
  const value = selfConsumedKwh * input.gridPricePerKwh + exportedKwh * input.exportPricePerKwh;
  return {
    selfConsumedKwh: round(selfConsumedKwh, 3),
    exportedKwh: round(exportedKwh, 3),
    value: round(value, 2),
  };
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Treat a local wall-clock timestamp as numbers and shift it. DST folds can be ambiguous. */
export function addHours(localIso: string, hours: number): string {
  const [datePart, timePart] = splitLocal(localIso);
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(`Bad local timestamp: ${localIso}`);
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const shifted = new Date(utc + hours * 3_600_000);
  return formatUtcAsWall(shifted);
}

export function addDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Bad date: ${dateIso}`);
  }
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function localWallIso(nowMs: number, utcOffsetSeconds: number): string {
  return formatUtcAsWall(new Date(nowMs + utcOffsetSeconds * 1000));
}

export function localDateIso(nowMs: number, utcOffsetSeconds: number): string {
  return localWallIso(nowMs, utcOffsetSeconds).slice(0, 10);
}

function splitLocal(localIso: string): [string, string] {
  const [datePart, timePart] = localIso.split("T");
  if (!datePart || !timePart) {
    throw new Error(`Bad local timestamp: ${localIso}`);
  }
  return [datePart, timePart.slice(0, 5)];
}

function formatUtcAsWall(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function formatFixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function clockLabel(localIso: string): string {
  return localIso.slice(11, 16);
}
