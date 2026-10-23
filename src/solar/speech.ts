import type { BatteryNight, DaySchedule, MorningRead, ScheduledRun } from "./household.js";
import type { AppliancePlan, WindowChoice } from "./plan.js";

const CURRENCY: Record<string, [string, string]> = {
  USD: ["dollar", "dollars"],
  EUR: ["euro", "euros"],
  GBP: ["pound", "pounds"],
  UAH: ["hryvnia", "hryvnia"],
  PLN: ["zloty", "zloty"],
};

export const ESTIMATE_CAVEAT = "This is a model estimate, not a measurement from your inverter.";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "that month";
}

export function speakKw(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kilowatt`;
}

export function speakKwh(n: number): string {
  if (n < 0.05) return "almost no energy";
  const digits = n < 20 ? 1 : 0;
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  const unit = rounded === 1 ? "kilowatt-hour" : "kilowatt-hours";
  return `${rounded} ${unit}`;
}

export function speakHours(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return rounded === 1 ? "1 hour" : `${text} hours`;
}

export function speakFacing(azimuth: number): string {
  const named: Array<[number, string]> = [
    [0, "south"],
    [-45, "southeast"],
    [45, "southwest"],
    [-90, "east"],
    [90, "west"],
    [180, "north"],
    [-180, "north"],
    [-135, "northeast"],
    [135, "northwest"],
  ];
  const match = named.find(([degrees]) => degrees === azimuth);
  if (match) return match[1];
  if (azimuth > 0) return `${Math.abs(azimuth)} degrees west of south`;
  return `${Math.abs(azimuth)} degrees east of south`;
}

export function speakClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  if (minute === "00") return `${hour} ${period}`;
  return `${hour}:${minute} ${period}`;
}

export function speakMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  const names = CURRENCY[currency.toUpperCase()];
  if (!names) return `${text} ${currency.toUpperCase()}`;
  return `${text} ${rounded === 1 ? names[0] : names[1]}`;
}

export function speakSite(input: {
  label: string;
  systemKw: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  tiltSource: "user" | "pvgis-optimal" | "latitude-fallback";
}): string {
  const facing = speakFacing(input.azimuthDegrees);
  const tilt = Number.isInteger(input.tiltDegrees) ? String(input.tiltDegrees) : input.tiltDegrees.toFixed(1);
  let tiltClause = `tilted ${tilt} degrees`;
  if (input.tiltSource === "pvgis-optimal") {
    tiltClause = `tilted ${tilt} degrees, which is PVGIS's suggested fixed tilt for this spot`;
  } else if (input.tiltSource === "latitude-fallback") {
    tiltClause = `tilted ${tilt} degrees, a fallback I used because PVGIS did not answer`;
  }
  return `I'll remember a ${speakKw(input.systemKw)} array in ${input.label}, ${tiltClause} and facing ${facing}. Ask when to run an appliance, or ask what the roof should make today.`;
}

function dayPhrase(date: string, plan: AppliancePlan): string {
  if (date === plan.todayDate) return "today";
  if (date === plan.tomorrowDate) return "tomorrow";
  return date;
}

function coverageSentence(name: string, window: WindowChoice, durationHours: number, powerKw: number): string {
  const fraction = window.loadKwh > 0 ? window.solarKwh / window.loadKwh : 0;
  const load = `That ${name}, running for ${speakHours(durationHours)} at ${speakNumber(powerKw)} kilowatts, is about ${speakKwh(window.loadKwh)}.`;
  if (fraction >= 0.95) {
    return `${load} The roof should cover it in that window.`;
  }
  if (fraction <= 0.05) {
    return `${load} The roof barely contributes then, so it would come from the grid.`;
  }
  return `${load} The roof covers about ${speakKwh(window.solarKwh)} of that in the window. The rest comes from the grid.`;
}

function speakNumber(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function speakAppliance(input: {
  applianceName: string;
  powerKw: number;
  durationHours: number;
  plan: AppliancePlan;
  typicalDailyKwh?: number | null;
  typicalMonth?: number | null;
}): string {
  const name = input.applianceName;
  const plan = input.plan;
  const chosen = plan.window;
  let lead: string;
  if (!chosen || plan.decision === "no-window") {
    lead = `There isn't a strong solar window left for the ${name}.`;
  } else {
    const when = dayPhrase(chosen.date, plan);
    const from = speakClock(chosen.start, plan.timeZone);
    const to = speakClock(chosen.end, plan.timeZone);
    const span = when === "today" ? `from ${from} to ${to}` : `from ${from} to ${to} tomorrow`;
    if (plan.decision === "run-today") lead = `Run the ${name} ${span}.`;
    else if (plan.decision === "wait-tomorrow") lead = `Wait until tomorrow. Run the ${name} ${span.replace(" tomorrow", "")}.`;
    else if (plan.decision === "partial-today") lead = `The best time today for the ${name} is ${span}. The roof only covers part of it.`;
    else lead = `Tomorrow is the better day for the ${name}, ${span.replace(" tomorrow", "")}. The roof still will not cover all of it.`;
  }

  const sentences = [lead];
  if (chosen && plan.decision !== "no-window") {
    sentences.push(coverageSentence(name, chosen, input.durationHours, input.powerKw));
  }
  if (plan.decision === "wait-tomorrow" || plan.decision === "partial-tomorrow") {
    sentences.push(`Today the array is expected to make about ${speakKwh(plan.todayTotalKwh)}, so waiting is the better solar plan.`);
  } else if (plan.decision === "run-today") {
    sentences.push(`Today's expected total is about ${speakKwh(plan.todayTotalKwh)}, and tomorrow's is about ${speakKwh(plan.tomorrowTotalKwh)}.`);
  } else if (plan.decision === "partial-today") {
    sentences.push(`Today's expected total is about ${speakKwh(plan.todayTotalKwh)}. Tomorrow is expected to make about ${speakKwh(plan.tomorrowTotalKwh)}.`);
  } else {
    sentences.push(`Today's expected total is about ${speakKwh(plan.todayTotalKwh)}, and tomorrow's is about ${speakKwh(plan.tomorrowTotalKwh)}.`);
  }
  if (input.typicalDailyKwh && input.typicalMonth && plan.todayTotalKwh < input.typicalDailyKwh * 0.6) {
    sentences.push(`A typical ${monthName(input.typicalMonth)} day for this array is about ${speakKwh(input.typicalDailyKwh)} in the PVGIS record, so the forecast days are dim.`);
  }
  sentences.push("This assumes the sunlight in that window is free for this appliance.");
  sentences.push(ESTIMATE_CAVEAT);
  return sentences.join(" ");
}

export function speakForecast(input: {
  label: string;
  systemKw: number;
  plan: Pick<AppliancePlan, "todayTotalKwh" | "tomorrowTotalKwh" | "todayDate" | "tomorrowDate">;
  typicalDailyKwh?: number | null;
  typicalMonth?: number | null;
  typicalDatabase?: string | null;
  yearMin?: number | null;
  yearMax?: number | null;
  pvgisFailed: boolean;
}): string {
  const today = `Today in ${input.label}, the ${speakKw(input.systemKw)} array is expected to make about ${speakKwh(input.plan.todayTotalKwh)}.`;
  const tomorrow = `Tomorrow it is expected to make about ${speakKwh(input.plan.tomorrowTotalKwh)}.`;
  let typical = "";
  if (input.typicalDailyKwh && input.typicalMonth) {
    const relation = input.plan.todayTotalKwh < input.typicalDailyKwh * 0.6
      ? "well below"
      : input.plan.todayTotalKwh > input.typicalDailyKwh * 1.4
        ? "well above"
        : "near";
    const years = input.yearMin && input.yearMax ? ` from ${input.yearMin} to ${input.yearMax}` : "";
    const db = input.typicalDatabase ? ` (${input.typicalDatabase}${years})` : "";
    typical = ` That is ${relation} a typical ${monthName(input.typicalMonth)} day of about ${speakKwh(input.typicalDailyKwh)}${db}.`;
  } else if (input.pvgisFailed) {
    typical = " I couldn't reach PVGIS for a typical-year comparison.";
  }
  return `${today} ${tomorrow}${typical} ${ESTIMATE_CAVEAT}`;
}

export function speakSavings(input: {
  applianceName: string;
  plan: AppliancePlan;
  pricePerKwh: number | null;
  currency: string | null;
  baselineHour: number;
}): string {
  const plan = input.plan;
  const chosen = plan.window;
  if (!chosen || plan.decision === "no-window") {
    return `There isn't a useful solar window to shift the ${input.applianceName} into. ${ESTIMATE_CAVEAT}`;
  }
  const baseline = plan.baseline;
  const avoided = baseline ? Math.max(0, baseline.gridKwh - chosen.gridKwh) : chosen.solarKwh;
  const hourLabel = speakClock(new Date(Date.UTC(2026, 0, 1, input.baselineHour, 0, 0)), "UTC");
  let money = `Tell me your price per kilowatt-hour and I can turn the difference into money.`;
  if (input.pricePerKwh !== null && input.currency) {
    const amount = avoided * input.pricePerKwh;
    money = `At ${speakMoney(input.pricePerKwh, input.currency)} per kilowatt-hour, that is about ${speakMoney(amount, input.currency)}. That uses the price you typed. It is not a tariff lookup.`;
  }
  return `Shifting the ${input.applianceName} into the solar window avoids about ${speakKwh(avoided)} of grid electricity compared with a ${hourLabel} start. ${money} This assumes the sunlight in that window is free for this appliance. ${ESTIMATE_CAVEAT}`;
}

export function speakBriefing(input: {
  forecast: string;
  appliance?: string;
}): string {
  if (!input.appliance) return input.forecast;
  const forecast = input.forecast.replace(` ${ESTIMATE_CAVEAT}`, "");
  const appliance = input.appliance.replace(` ${ESTIMATE_CAVEAT}`, "").replace(" This assumes the sunlight in that window is free for this appliance.", "");
  return `${forecast} ${appliance} ${ESTIMATE_CAVEAT}`;
}

function listRuns(runs: ScheduledRun[], timeZone: string): string {
  const parts = [...runs].sort((a, b) => a.start.getTime() - b.start.getTime()).map((run) => `the ${run.name} from ${speakClock(run.start, timeZone)} to ${speakClock(run.end, timeZone)}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function oneRun(schedule: DaySchedule, run: ScheduledRun): string {
  const from = speakClock(run.start, schedule.timeZone);
  const to = speakClock(run.end, schedule.timeZone);
  if (schedule.day === "today") return `Today, run the ${run.name} from ${from} to ${to}.`;
  return `Wait until tomorrow. Run the ${run.name} from ${from} to ${to}.`;
}

export function speakDayPlan(schedule: DaySchedule): string {
  const lead = schedule.runs.length === 1 && schedule.runs[0]
    ? oneRun(schedule, schedule.runs[0])
    : schedule.day === "today"
      ? `Today, run ${listRuns(schedule.runs, schedule.timeZone)}.`
      : `Wait until tomorrow. Run ${listRuns(schedule.runs, schedule.timeZone)}.`;
  const sentences: string[] = [];
  if (schedule.runs.length === 0) {
    sentences.push("I can't fit those appliances into the solar forecast for today or tomorrow.");
  } else {
    sentences.push(lead.charAt(0).toUpperCase() + lead.slice(1));
  }
  if (schedule.shared.length > 0) {
    const share = schedule.shared[0];
    if (share) {
      sentences.push(`The ${share.names[0]} and the ${share.names[1]} share ${speakClock(share.start, schedule.timeZone)} to ${speakClock(share.end, schedule.timeZone)}. Their combined draw stays within the roof's output then.`);
    }
  }
  if (schedule.unscheduled.length === 1) {
    sentences.push(`I can't cover the ${schedule.unscheduled[0]} from the roof without asking an hour for more than it is forecast to make.`);
  } else if (schedule.unscheduled.length > 1) {
    const names = schedule.unscheduled.slice(0, -1).map((name) => `the ${name}`).join(", ");
    const last = schedule.unscheduled[schedule.unscheduled.length - 1];
    sentences.push(`I can't cover ${names} or the ${last} from the roof without asking an hour for more than it is forecast to make.`);
  }
  sentences.push("Each hour only gives an appliance the power it draws, and two appliances share an hour only when the roof can cover both.");
  sentences.push(ESTIMATE_CAVEAT);
  return sentences.join(" ");
}

export function speakBattery(input: BatteryNight & { chargePercent: number }): string {
  const capacity = speakKwh(input.capacityKwh).replace("kilowatt-hours", "kilowatt-hour");
  const held = `At ${Math.round(input.chargePercent)} percent, a ${capacity} battery holds about ${speakKwh(input.storedKwh)}.`;
  const nightSpan = `from ${speakClock(input.nightStart, input.timeZone)} to ${speakClock(input.nightEnd, input.timeZone)}`;
  const load = `A ${speakNumber(input.loadKw)} kilowatt load ${nightSpan} needs about ${speakKwh(input.nightNeedKwh)}.`;
  const typed = "You typed the battery size, the charge, and the household load. They are not read from a battery.";
  let verdict: string;
  if (input.nightHours < 0.15) {
    verdict = "The sun is up, or about to be. There isn't a night left to bridge.";
  } else if (input.lasts) {
    verdict = "Yes. The battery should last through that night.";
  } else {
    const when = input.runsOutAt ? `around ${speakClock(input.runsOutAt, input.timeZone)}` : "before sunrise";
    verdict = `No. The battery runs out ${when}. It is about ${speakKwh(input.shortfallKwh)} short of sunrise.`;
  }
  let refill: string;
  if (input.refillAt && input.socAtSunriseKwh + 1e-6 >= input.capacityKwh) {
    refill = "It is still full at sunrise, so the roof does not have to refill it.";
  } else if (input.refillAt) {
    refill = `The roof should refill it by about ${speakClock(input.refillAt, input.timeZone)}, if the house keeps drawing ${speakNumber(input.loadKw)} kilowatts.`;
  } else {
    refill = `The forecast sun is not enough to refill it. That day's roof is expected to make about ${speakKwh(input.refillDaySolarKwh)}.`;
  }
  return `${verdict} ${held} ${load} ${refill} ${typed} ${ESTIMATE_CAVEAT}`;
}

export function speakMorning(input: MorningRead & { timeZone: string }): string {
  const hello = input.greeting === "morning" ? "Good morning." : input.greeting === "afternoon" ? "Good afternoon." : "Good evening.";
  let windowSentence = "There isn't a strong solar window left today.";
  if (input.windowStart && input.windowEnd) {
    windowSentence = `Run heavy loads from ${speakClock(input.windowStart, input.timeZone)} to ${speakClock(input.windowEnd, input.timeZone)} today.`;
  }
  if (input.windowStart && input.windowEnd && input.windowKwh < 1.5) {
    windowSentence = `The strongest stretch today is from ${speakClock(input.windowStart, input.timeZone)} to ${speakClock(input.windowEnd, input.timeZone)}, about ${speakKwh(input.windowKwh)}. That is a thin window for heavy loads.`;
  }
  const sky = input.cloudyUntil
    ? `Clouds hang on until about ${speakClock(input.cloudyUntil, input.timeZone)}.`
    : "";
  return [windowSentence, hello, sky].filter(Boolean).join(" ");
}

export function speakTypicalOnly(input: {
  label: string;
  month: number;
  dailyKwh: number;
  database: string;
  yearMin: number;
  yearMax: number;
}): string {
  return `I couldn't get today's weather forecast. A typical ${monthName(input.month)} day for the array in ${input.label} is about ${speakKwh(input.dailyKwh)}, from ${input.database} (${input.yearMin}–${input.yearMax}). That is a multi-year average, not today's weather. ${ESTIMATE_CAVEAT}`;
}
