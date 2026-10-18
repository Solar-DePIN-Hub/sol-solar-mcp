import type { HourSlot } from "./model.js";

export class MissingSunError extends Error {
  constructor() {
    super("missing sunrise or sunset");
    this.name = "MissingSunError";
  }
}
import { addDays, localDate, localHour } from "./plan.js";

export interface NamedLoad {
  name: string;
  powerKw: number;
  durationHours: number;
}

export interface ScheduledRun {
  name: string;
  powerKw: number;
  durationHours: number;
  start: Date;
  end: Date;
  loadKwh: number;
  date: string;
}

export interface DaySchedule {
  day: "today" | "tomorrow";
  timeZone: string;
  todayDate: string;
  tomorrowDate: string;
  runs: ScheduledRun[];
  unscheduled: string[];
  shared: Array<{ names: [string, string]; start: Date; end: Date }>;
}

export interface BatteryNight {
  timeZone: string;
  storedKwh: number;
  capacityKwh: number;
  loadKw: number;
  nightStart: Date;
  nightEnd: Date;
  nightHours: number;
  nightNeedKwh: number;
  lasts: boolean;
  shortfallKwh: number;
  runsOutAt: Date | null;
  socAtSunriseKwh: number;
  refillAt: Date | null;
  refillDay: string;
  refillDaySolarKwh: number;
}

interface Take {
  index: number;
  take: number;
  need: number;
}

function hoursOn(slots: HourSlot[], date: string, timeZone: string): HourSlot[] {
  return slots
    .filter((slot) => localDate(slot.start, timeZone) === date)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function overlaps(start: Date, end: Date, runs: ScheduledRun[]): boolean {
  return runs.some((run) => start < run.end && end > run.start);
}

function findWindow(
  hours: HourSlot[],
  remaining: number[],
  placed: ScheduledRun[],
  load: NamedLoad,
  now: Date,
  timeZone: string,
  date: string,
  allowOverlap: boolean,
): { start: Date; end: Date; takes: Take[] } | null {
  for (let index = 0; index < hours.length; index += 1) {
    const first = hours[index];
    if (!first || first.start < now || localDate(first.start, timeZone) !== date) continue;
    let left = load.durationHours;
    let cursor = index;
    const takes: Take[] = [];
    let end = first.start;
    let ok = true;
    while (left > 1e-6) {
      const slot = hours[cursor];
      const previous = hours[cursor - 1];
      if (!slot || localDate(slot.start, timeZone) !== date) {
        ok = false;
        break;
      }
      if (previous && cursor > index && Math.abs(slot.start.getTime() - previous.end.getTime()) > 60_000) {
        ok = false;
        break;
      }
      const take = Math.min(1, left);
      const need = load.powerKw * take;
      if ((remaining[cursor] ?? 0) + 1e-6 < need) {
        ok = false;
        break;
      }
      takes.push({ index: cursor, take, need });
      end = new Date(slot.start.getTime() + take * 3_600_000);
      left -= take;
      cursor += 1;
    }
    if (!ok) continue;
    if (!allowOverlap && overlaps(first.start, end, placed)) continue;
    return { start: first.start, end, takes };
  }
  return null;
}

function placeOnDate(slots: HourSlot[], date: string, loads: NamedLoad[], now: Date, timeZone: string): { runs: ScheduledRun[]; unscheduled: string[] } {
  const hours = hoursOn(slots, date, timeZone);
  const remaining = hours.map((slot) => slot.energyKwh);
  const runs: ScheduledRun[] = [];
  const unscheduled: string[] = [];
  for (const load of loads) {
    const window = findWindow(hours, remaining, runs, load, now, timeZone, date, false)
      ?? findWindow(hours, remaining, runs, load, now, timeZone, date, true);
    if (!window) {
      unscheduled.push(load.name);
      continue;
    }
    for (const take of window.takes) {
      remaining[take.index] = (remaining[take.index] ?? 0) - take.need;
    }
    runs.push({
      name: load.name,
      powerKw: load.powerKw,
      durationHours: load.durationHours,
      start: window.start,
      end: window.end,
      loadKwh: load.powerKw * load.durationHours,
      date,
    });
  }
  return { runs, unscheduled };
}

function sharedHours(runs: ScheduledRun[]): DaySchedule["shared"] {
  const shared: DaySchedule["shared"] = [];
  for (let left = 0; left < runs.length; left += 1) {
    for (let right = left + 1; right < runs.length; right += 1) {
      const a = runs[left];
      const b = runs[right];
      if (!a || !b || a.start >= b.end || b.start >= a.end) continue;
      shared.push({
        names: [a.name, b.name],
        start: new Date(Math.max(a.start.getTime(), b.start.getTime())),
        end: new Date(Math.min(a.end.getTime(), b.end.getTime())),
      });
    }
  }
  return shared;
}

export function scheduleDay(input: {
  slots: HourSlot[];
  timeZone: string;
  now: Date;
  loads: NamedLoad[];
}): DaySchedule {
  const todayDate = localDate(input.now, input.timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const today = placeOnDate(input.slots, todayDate, input.loads, input.now, input.timeZone);
  const tomorrow = placeOnDate(input.slots, tomorrowDate, input.loads, input.now, input.timeZone);
  const todayFits = today.unscheduled.length === 0 && today.runs.length === input.loads.length;
  const tomorrowFits = tomorrow.unscheduled.length === 0 && tomorrow.runs.length === input.loads.length;
  const chosen = todayFits ? today : tomorrowFits ? tomorrow : tomorrow.runs.length > today.runs.length ? tomorrow : today;
  const day = chosen === today ? "today" : "tomorrow";
  return {
    day,
    timeZone: input.timeZone,
    todayDate,
    tomorrowDate,
    runs: chosen.runs,
    unscheduled: chosen.unscheduled,
    shared: sharedHours(chosen.runs),
  };
}

/** Combined appliance draw in one hour must not exceed that hour's solar energy. */
export function scheduleRespectsRoof(slots: HourSlot[], runs: ScheduledRun[]): boolean {
  for (const slot of slots) {
    let draw = 0;
    for (const run of runs) {
      const overlapStart = Math.max(slot.start.getTime(), run.start.getTime());
      const overlapEnd = Math.min(slot.end.getTime(), run.end.getTime());
      if (overlapEnd <= overlapStart) continue;
      draw += run.powerKw * ((overlapEnd - overlapStart) / 3_600_000);
    }
    if (draw > slot.energyKwh + 0.02) return false;
  }
  return true;
}

function rowTime(daily: Array<{ date: string; sunrise: string | null; sunset: string | null }>, date: string, which: "sunrise" | "sunset", offsetSeconds: number): Date | null {
  const row = daily.find((item) => item.date === date);
  const stamp = row?.[which];
  if (!stamp) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp)) return new Date(stamp);
  const sign = offsetSeconds >= 0 ? "+" : "-";
  const abs = Math.abs(offsetSeconds);
  const hours = String(Math.floor(abs / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return new Date(`${stamp}${sign}${hours}:${minutes}`);
}

export function batteryThroughNight(input: {
  slots: HourSlot[];
  timeZone: string;
  now: Date;
  capacityKwh: number;
  chargePercent: number;
  loadKw: number;
  daily: Array<{ date: string; sunrise: string | null; sunset: string | null }>;
  utcOffsetSeconds: number;
}): BatteryNight {
  const todayDate = localDate(input.now, input.timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const sunriseToday = rowTime(input.daily, todayDate, "sunrise", input.utcOffsetSeconds);
  const sunsetToday = rowTime(input.daily, todayDate, "sunset", input.utcOffsetSeconds);
  const sunriseTomorrow = rowTime(input.daily, tomorrowDate, "sunrise", input.utcOffsetSeconds);
  const storedKwh = input.capacityKwh * (input.chargePercent / 100);

  let nightStart = input.now;
  let nightEnd: Date | null = null;
  let refillFrom: Date | null = null;
  if (sunriseToday && input.now < sunriseToday) {
    nightEnd = sunriseToday;
    refillFrom = sunriseToday;
  } else if (sunsetToday && sunriseTomorrow && input.now < sunsetToday) {
    nightStart = sunsetToday;
    nightEnd = sunriseTomorrow;
    refillFrom = sunriseTomorrow;
  } else if (sunriseTomorrow && sunsetToday && input.now >= sunsetToday) {
    nightEnd = sunriseTomorrow;
    refillFrom = sunriseTomorrow;
  }
  if (!nightEnd || !refillFrom) {
    throw new MissingSunError();
  }

  const nightHours = Math.max(0, (nightEnd.getTime() - nightStart.getTime()) / 3_600_000);
  const nightNeedKwh = input.loadKw * nightHours;
  const lasts = storedKwh + 1e-6 >= nightNeedKwh;
  const shortfallKwh = Math.max(0, nightNeedKwh - storedKwh);
  const runsOutAt = lasts || input.loadKw <= 0
    ? null
    : new Date(nightStart.getTime() + (storedKwh / input.loadKw) * 3_600_000);
  let soc = lasts ? Math.max(0, storedKwh - nightNeedKwh) : 0;
  const refillLimit = refillFrom.getTime() + 18 * 3_600_000;
  let refillAt: Date | null = soc + 1e-6 >= input.capacityKwh ? refillFrom : null;
  for (const slot of input.slots) {
    if (refillAt) break;
    if (slot.start < refillFrom || slot.start.getTime() >= refillLimit) continue;
    const before = soc;
    const net = slot.energyKwh - input.loadKw;
    soc = Math.min(input.capacityKwh, Math.max(0, soc + net));
    if (before + 1e-6 < input.capacityKwh && soc + 1e-6 >= input.capacityKwh && net > 0) {
      const fraction = Math.min(1, Math.max(0, (input.capacityKwh - before) / net));
      refillAt = new Date(slot.start.getTime() + fraction * 3_600_000);
    }
  }
  const refillDay = localDate(refillFrom, input.timeZone);
  const refillDaySolarKwh = input.slots.reduce((sum, slot) => {
    return localDate(slot.start, input.timeZone) === refillDay ? sum + slot.energyKwh : sum;
  }, 0);
  return {
    timeZone: input.timeZone,
    storedKwh,
    capacityKwh: input.capacityKwh,
    loadKw: input.loadKw,
    nightStart,
    nightEnd,
    nightHours,
    nightNeedKwh,
    lasts,
    shortfallKwh,
    runsOutAt,
    socAtSunriseKwh: lasts ? Math.max(0, storedKwh - nightNeedKwh) : 0,
    refillAt,
    refillDay,
    refillDaySolarKwh,
  };
}

const CLOUDY = 70;

export interface MorningRead {
  timeZone: string;
  greeting: "morning" | "afternoon" | "evening";
  cloudyUntil: Date | null;
  skyKnown: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  windowKwh: number;
}

function blockEnergy(hours: HourSlot[], index: number, length: number): { start: Date; end: Date; energy: number } | null {
  let energy = 0;
  let end = hours[index]?.start;
  if (!end) return null;
  for (let step = 0; step < length; step += 1) {
    const slot = hours[index + step];
    const previous = hours[index + step - 1];
    if (!slot) return null;
    if (previous && Math.abs(slot.start.getTime() - previous.end.getTime()) > 60_000) return null;
    energy += slot.energyKwh;
    end = slot.end;
  }
  const start = hours[index]?.start;
  if (!start || !end) return null;
  return { start, end, energy };
}

export function readMorning(slots: HourSlot[], timeZone: string, now: Date): MorningRead {
  const hour = localHour(now, timeZone);
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const today = localDate(now, timeZone);
  const hours = hoursOn(slots, today, timeZone).filter((slot) => slot.start >= now || localHour(slot.start, timeZone) >= 5);
  const withCloud = hours.filter((slot) => typeof slot.cloudCover === "number");
  let cloudyUntil: Date | null = null;
  if (withCloud.length > 0) {
    let sawCloud = false;
    for (const slot of withCloud) {
      const hourOfDay = localHour(slot.start, timeZone);
      if (hourOfDay > 16) break;
      if ((slot.cloudCover ?? 0) >= CLOUDY) {
        sawCloud = true;
        continue;
      }
      if (sawCloud) {
        cloudyUntil = slot.start;
        break;
      }
    }
  }
  let best: { start: Date; end: Date; energy: number } | null = null;
  const future = hours.filter((slot) => slot.start >= now);
  for (const length of [3, 2, 1]) {
    let candidate: { start: Date; end: Date; energy: number } | null = null;
    for (let index = 0; index < future.length; index += 1) {
      const block = blockEnergy(future, index, length);
      if (!block || block.energy < 0.2) continue;
      if (!candidate || block.energy > candidate.energy + 1e-9) candidate = block;
    }
    if (candidate) {
      best = candidate;
      break;
    }
  }
  if (cloudyUntil && cloudyUntil < now) cloudyUntil = null;
  return {
    timeZone,
    greeting,
    cloudyUntil,
    skyKnown: withCloud.length > 0,
    windowStart: best?.start ?? null,
    windowEnd: best?.end ?? null,
    windowKwh: best?.energy ?? 0,
  };
}
