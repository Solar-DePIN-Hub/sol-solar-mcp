import type { HourSlot } from "./model.js";

export type DayChoice = "auto" | "today" | "tomorrow";
export type PlanDecision = "run-today" | "wait-tomorrow" | "partial-today" | "partial-tomorrow" | "no-window";

export interface WindowChoice {
  start: Date;
  end: Date;
  solarKwh: number;
  loadKwh: number;
  gridKwh: number;
  date: string;
}

export interface AppliancePlan {
  decision: PlanDecision;
  timeZone: string;
  todayDate: string;
  tomorrowDate: string;
  window: WindowChoice | null;
  todayBest: WindowChoice | null;
  tomorrowBest: WindowChoice | null;
  baseline: WindowChoice | null;
  todayTotalKwh: number;
  tomorrowTotalKwh: number;
  todayAheadKwh: number;
  tomorrowAheadKwh: number;
}

export interface PlanRequest {
  slots: HourSlot[];
  timeZone: string;
  now: Date;
  powerKw: number;
  durationHours: number;
  day: DayChoice;
  baselineHour: number;
}

interface Candidate {
  start: Date;
  end: Date;
  solarKwh: number;
  date: string;
}

export function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function localHour(date: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value ?? "0";
  const hour = Number(value);
  return hour === 24 ? 0 : hour;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function sumEnergy(slots: HourSlot[], date: string, timeZone: string, futureOnly: boolean, now: Date): number {
  return slots.reduce((total, slot) => {
    if (localDate(slot.start, timeZone) !== date) return total;
    if (futureOnly && slot.start < now) return total;
    return total + slot.energyKwh;
  }, 0);
}

function slide(slots: HourSlot[], startIndex: number, durationHours: number, powerKw: number, timeZone: string): Candidate | null {
  let left = durationHours;
  let solar = 0;
  let end = slots[startIndex]?.start;
  if (!end) return null;
  let index = startIndex;
  while (left > 1e-6) {
    const slot = slots[index];
    const previous = slots[index - 1];
    if (!slot) return null;
    if (previous && index > startIndex) {
      const gap = Math.abs(slot.start.getTime() - previous.end.getTime());
      if (gap > 60_000) return null;
    }
    const take = Math.min(1, left);
    const solarSlice = slot.energyKwh * take;
    const loadSlice = powerKw * take;
    solar += Math.min(solarSlice, loadSlice);
    end = new Date(slot.start.getTime() + take * 3_600_000);
    left -= take;
    index += 1;
  }
  return { start: slots[startIndex]!.start, end, solarKwh: solar, date: localDate(slots[startIndex]!.start, timeZone) };
}

function bestOnDate(slots: HourSlot[], date: string, timeZone: string, durationHours: number, powerKw: number, now: Date | null): WindowChoice | null {
  let best: Candidate | null = null;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot) continue;
    if (localDate(slot.start, timeZone) !== date) continue;
    if (now && slot.start < now) continue;
    const candidate = slide(slots, index, durationHours, powerKw, timeZone);
    if (!candidate || candidate.date !== date) continue;
    if (!best || candidate.solarKwh > best.solarKwh + 1e-9 || (Math.abs(candidate.solarKwh - best.solarKwh) <= 1e-9 && candidate.start < best.start)) {
      best = candidate;
    }
  }
  if (!best) return null;
  const loadKwh = powerKw * durationHours;
  return {
    start: best.start,
    end: best.end,
    solarKwh: best.solarKwh,
    loadKwh,
    gridKwh: Math.max(0, loadKwh - best.solarKwh),
    date,
  };
}

function covers(window: WindowChoice | null): boolean {
  if (!window || window.loadKwh <= 0) return false;
  return window.solarKwh >= window.loadKwh * 0.95;
}

export function planAppliance(request: PlanRequest): AppliancePlan {
  const todayDate = localDate(request.now, request.timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const loadKwh = request.powerKw * request.durationHours;
  const todayBest = bestOnDate(request.slots, todayDate, request.timeZone, request.durationHours, request.powerKw, request.now);
  const tomorrowBest = bestOnDate(request.slots, tomorrowDate, request.timeZone, request.durationHours, request.powerKw, request.now);
  const baselineStart = request.slots.find((slot) => localDate(slot.start, request.timeZone) === todayDate && localHour(slot.start, request.timeZone) === request.baselineHour)
    ?? request.slots.find((slot) => localDate(slot.start, request.timeZone) === tomorrowDate && localHour(slot.start, request.timeZone) === request.baselineHour);
  let baseline: WindowChoice | null = null;
  if (baselineStart) {
    const index = request.slots.indexOf(baselineStart);
    const candidate = slide(request.slots, index, request.durationHours, request.powerKw, request.timeZone);
    if (candidate) {
      baseline = {
        start: candidate.start,
        end: candidate.end,
        solarKwh: candidate.solarKwh,
        loadKwh,
        gridKwh: Math.max(0, loadKwh - candidate.solarKwh),
        date: candidate.date,
      };
    }
  }

  const useful = (window: WindowChoice | null) => Boolean(window && window.solarKwh >= 0.05);
  let decision: PlanDecision = "no-window";
  let window: WindowChoice | null = null;

  if (request.day === "today") {
    window = todayBest;
    decision = !useful(todayBest) ? "no-window" : covers(todayBest) ? "run-today" : "partial-today";
  } else if (request.day === "tomorrow") {
    window = tomorrowBest;
    decision = !useful(tomorrowBest) ? "no-window" : covers(tomorrowBest) ? "wait-tomorrow" : "partial-tomorrow";
  } else if (covers(todayBest)) {
    window = todayBest;
    decision = "run-today";
  } else if (covers(tomorrowBest)) {
    window = tomorrowBest;
    decision = "wait-tomorrow";
  } else if ((tomorrowBest?.solarKwh ?? 0) > (todayBest?.solarKwh ?? 0) + 0.05 && useful(tomorrowBest)) {
    window = tomorrowBest;
    decision = "partial-tomorrow";
  } else if (useful(todayBest)) {
    window = todayBest;
    decision = "partial-today";
  } else if (useful(tomorrowBest)) {
    window = tomorrowBest;
    decision = "partial-tomorrow";
  }

  return {
    decision,
    timeZone: request.timeZone,
    todayDate,
    tomorrowDate,
    window,
    todayBest,
    tomorrowBest,
    baseline,
    todayTotalKwh: sumEnergy(request.slots, todayDate, request.timeZone, false, request.now),
    tomorrowTotalKwh: sumEnergy(request.slots, tomorrowDate, request.timeZone, false, request.now),
    todayAheadKwh: sumEnergy(request.slots, todayDate, request.timeZone, true, request.now),
    tomorrowAheadKwh: sumEnergy(request.slots, tomorrowDate, request.timeZone, true, request.now),
  };
}
