import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { speakUpstream, SolarError, UpstreamError } from "./data/http.js";
import {
  DATA_SOURCES,
  loadProduction,
  loadTypicalOnly,
  planFor,
  resolveSite,
  type Deps,
  type Production,
  type SiteRequest,
} from "./service.js";
import { batteryThroughNight, MissingSunError, readMorning, scheduleDay, type ScheduledRun } from "./solar/household.js";
import { round3, type PvAssumptions } from "./solar/model.js";
import { localDate, localHour, type AppliancePlan, type WindowChoice } from "./solar/plan.js";
import {
  ESTIMATE_CAVEAT,
  speakAppliance,
  speakBattery,
  speakBriefing,
  speakDayPlan,
  speakFacing,
  speakForecast,
  speakMorning,
  speakSavings,
  speakSite,
  speakTypicalOnly,
} from "./solar/speech.js";
import { findAppliance, mergeAppliances, MAX_SAVED_APPLIANCES, type SavedAppliance, type SolarSite } from "./sites.js";
import { SOLAR_CARD_HTML, SOLAR_CARD_MIME, SOLAR_CARD_URI } from "./ui/solarCard.js";

/** MCP Apps (SEP-1865): hosts that support it render this card next to the spoken answer. */
const cardMeta = { ui: { resourceUri: SOLAR_CARD_URI } };

const locationFields = {
  site_id: z.string().optional().describe("site_id from an earlier Sol Solar tool. Pass this on follow-up questions."),
  place: z.string().min(2).max(80).optional().describe("City or place name, for example Kyiv."),
  latitude: z.number().min(-90).max(90).optional().describe("Latitude in decimal degrees. South is negative."),
  longitude: z.number().min(-180).max(180).optional().describe("Longitude in decimal degrees. West is negative."),
  system_kw: z.number().gt(0).max(200).optional().describe("Array size in kilowatts of DC capacity."),
  tilt_degrees: z.number().min(0).max(90).optional().describe("Tilt from horizontal, 0 to 90. Omit to ask PVGIS for a fixed-tilt suggestion."),
  azimuth_degrees: z.number().min(-180).max(180).optional().describe("Azimuth: 0 south, -90 east, 90 west, 180 north."),
  price_per_kwh: z.number().min(0).max(10_000).optional().describe("Electricity price typed by the person. Never look this up."),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("ISO currency code that goes with price_per_kwh, such as EUR."),
};

const applianceFields = {
  appliance_name: z.string().min(2).max(40).describe("What they want to run, in plain words. Example: washing machine."),
  power_kw: z.number().gt(0).max(50).describe("Average power draw in kilowatts for the time it runs. This is an assumption the person provides, not a measurement."),
  duration_hours: z.number().min(0.25).max(12).describe("How many hours the appliance runs."),
  day: z.enum(["auto", "today", "tomorrow"]).optional().describe("auto picks today when the roof can cover the load, otherwise the better day. today or tomorrow forces that day."),
  baseline_hour: z.number().int().min(0).max(23).optional().describe("Local hour to compare with, on a 24-hour clock. Default 19, which is 7 PM."),
};

const assumptionsSchema = z.object({
  irradiance: z.string(),
  energy_formula: z.string(),
  system_loss_fraction: z.number(),
  temperature_coefficient_per_c: z.number(),
  gti_time: z.string(),
  caveat: z.string(),
});

const sourceSchema = z.object({ name: z.string(), url: z.string(), note: z.string() });

const hourSchema = z.object({
  start: z.string(),
  end: z.string(),
  energy_kwh: z.number(),
  in_window: z.boolean(),
});

const daySchema = z.object({
  date: z.string(),
  label: z.string(),
  total_kwh: z.number(),
  hours: z.array(hourSchema),
});

const typicalSchema = z.object({
  month: z.number(),
  daily_kwh: z.number(),
  monthly_kwh: z.number(),
  yearly_kwh: z.number(),
  database: z.string(),
  year_min: z.number(),
  year_max: z.number(),
}).nullable();

const windowSchema = z.object({
  start: z.string(),
  end: z.string(),
  day_label: z.string(),
  solar_kwh: z.number(),
  load_kwh: z.number(),
  grid_kwh: z.number(),
}).nullable();

function fail(spoken: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: spoken }] };
}

function ok(spoken: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: spoken }], structuredContent: { ...structured, spoken } };
}

function assumptionPayload(assumptions: PvAssumptions) {
  return {
    irradiance: "Open-Meteo global_tilted_irradiance, preceding-hour mean, fixed albedo 0.2, isotropic sky",
    energy_formula: "kilowatt-hours = (GTI / 1000) * system_kw * temperature_factor * (1 - system_loss)",
    system_loss_fraction: assumptions.systemLossFraction,
    temperature_coefficient_per_c: assumptions.tempCoeffPerC,
    gti_time: "The API timestamp is the end of the hour that the average covers",
    caveat: ESTIMATE_CAVEAT,
  };
}

function cleanName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}\s'-]/gu, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) {
    throw new SolarError("Tell me the appliance name in plain words, such as washing machine.");
  }
  return cleaned;
}

function formatKw(value: number): string {
  return `${Number(value.toFixed(2))} kilowatt${value === 1 ? "" : "s"}`;
}

function formatHours(value: number): string {
  return `${Number(value.toFixed(2))} hour${value === 1 ? "" : "s"}`;
}

/** Use what the person typed now, and fill any gap from an appliance they saved earlier. */
function applianceSpec(site: SolarSite, name: string, powerKw: number | undefined, durationHours: number | undefined): SavedAppliance & { remembered: boolean } {
  const saved = findAppliance(site, name);
  const power = powerKw ?? saved?.powerKw;
  const duration = durationHours ?? saved?.durationHours;
  if (power === undefined || duration === undefined) {
    throw new SolarError(`Tell me the ${name}'s power in kilowatts and how many hours it runs. I can remember it for next time.`);
  }
  return { name, powerKw: power, durationHours: duration, remembered: saved !== undefined && powerKw === undefined && durationHours === undefined };
}

function speakRemembered(site: SolarSite, added: SavedAppliance[]): string {
  const parts = added.map((item) => `the ${item.name} at ${formatKw(item.powerKw)} for ${formatHours(item.durationHours)}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const total = site.appliances?.length ?? 0;
  return `Saved for ${site.label}: ${list}. That is ${total} appliance${total === 1 ? "" : "s"} for this home. Next time, just ask when to run it, or ask me to plan the day. You typed these numbers. They are not read from a meter.`;
}

function pricePair(price: number | undefined, currency: string | undefined): { price: number | null; currency: string | null } {
  if (price === undefined && (currency === undefined || currency === "")) {
    return { price: null, currency: null };
  }
  if (price === undefined || currency === undefined) {
    throw new SolarError("Give me both a price per kilowatt-hour and a 3-letter currency code, or leave both out.");
  }
  return { price, currency: currency.toUpperCase() };
}

function siteRequest(args: {
  site_id?: string;
  place?: string;
  latitude?: number;
  longitude?: number;
  system_kw?: number;
  tilt_degrees?: number;
  azimuth_degrees?: number;
  price_per_kwh?: number;
  currency?: string;
}, sessionId: string | undefined): SiteRequest {
  const price = pricePair(args.price_per_kwh, args.currency);
  return {
    siteId: args.site_id,
    place: args.place,
    latitude: args.latitude,
    longitude: args.longitude,
    systemKw: args.system_kw,
    tiltDegrees: args.tilt_degrees,
    azimuthDegrees: args.azimuth_degrees,
    pricePerKwh: args.price_per_kwh === undefined && args.currency === undefined ? undefined : price.price,
    currency: args.price_per_kwh === undefined && args.currency === undefined ? undefined : price.currency,
    sessionId,
  };
}

function dayLabel(date: string, production: Production, now: Date): string {
  const today = localDate(now, production.timezone);
  if (date === today) return "today";
  const [year, month, day] = today.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10);
  if (date === next) return "tomorrow";
  return "later";
}

function windowPayload(window: WindowChoice | null, production: Production, now: Date) {
  if (!window) return null;
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    day_label: dayLabel(window.date, production, now),
    solar_kwh: round3(window.solarKwh),
    load_kwh: round3(window.loadKwh),
    grid_kwh: round3(window.gridKwh),
  };
}

function dayPayload(production: Production, plan: AppliancePlan | null, now: Date, extra: Array<{ start: Date; end: Date }> = []) {
  const chosen = plan?.window ?? null;
  const windows = chosen ? [chosen, ...extra] : extra;
  const groups = new Map<string, typeof production.slots>();
  for (const slot of production.slots) {
    const date = localDate(slot.start, production.timezone);
    const label = dayLabel(date, production, now);
    if (label !== "today" && label !== "tomorrow") continue;
    const hour = localHour(slot.start, production.timezone);
    if (hour < 5 || hour > 20) continue;
    const list = groups.get(date) ?? [];
    list.push(slot);
    groups.set(date, list);
  }
  return [...groups.entries()].map(([date, slots]) => ({
    date,
    label: dayLabel(date, production, now),
    total_kwh: round3(production.slots.reduce((sum, slot) => localDate(slot.start, production.timezone) === date ? sum + slot.energyKwh : sum, 0)),
    hours: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      energy_kwh: round3(slot.energyKwh),
      in_window: windows.some((window) => slot.start < window.end && slot.end > window.start),
    })),
  }));
}

function typicalPayload(production: Production) {
  if (!production.typical) return null;
  return {
    month: production.typical.month,
    daily_kwh: round3(production.typical.dailyKwh),
    monthly_kwh: round3(production.typical.monthlyKwh),
    yearly_kwh: round3(production.typical.yearlyKwh),
    database: production.typical.database,
    year_min: production.typical.yearMin,
    year_max: production.typical.yearMax,
  };
}

async function withErrors(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SolarError) return fail(error.spoken);
    if (error instanceof UpstreamError) return fail(speakUpstream(error));
    console.log(JSON.stringify({ level: "error", tool, message: error instanceof Error ? error.message : "unknown" }));
    return fail("Something went wrong while estimating. Nothing was invented in its place. Try again.");
  }
}

export function registerSolarTools(server: McpServer, deps: Deps): void {
  server.registerTool("remember_solar_site", {
    title: "Remember this roof",
    description: "Save the home or small array the person is asking about: place or coordinates, size in kilowatts, and optional tilt, azimuth, and a price they typed. Call this before other tools when no site_id is known yet. Say the returned text to the person.",
    inputSchema: locationFields,
    outputSchema: {
      site_id: z.string(),
      label: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      timezone: z.string(),
      system_kw: z.number(),
      tilt_degrees: z.number(),
      azimuth_degrees: z.number(),
      facing: z.string(),
      tilt_source: z.string(),
      price_per_kwh: z.number().nullable(),
      currency: z.string().nullable(),
      spoken: z.string(),
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("remember_solar_site", async () => {
    const started = Date.now();
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const spoken = speakSite(site);
    return ok(spoken, {
      site_id: site.id,
      label: site.label,
      latitude: round3(site.latitude),
      longitude: round3(site.longitude),
      timezone: site.timezone,
      system_kw: site.systemKw,
      tilt_degrees: site.tiltDegrees,
      azimuth_degrees: site.azimuthDegrees,
      facing: speakFacing(site.azimuthDegrees),
      tilt_source: site.tiltSource,
      price_per_kwh: site.pricePerKwh,
      currency: site.currency,
      sources: DATA_SOURCES,
      elapsed_ms: Date.now() - started,
    });
  }));

  server.registerTool("forecast_pv_production", {
    _meta: cardMeta,
    title: "Forecast production",
    description: "Estimate today's and tomorrow's photovoltaic production for the remembered array, and compare today with a PVGIS typical day for this month. Say the returned text. Do not invent a second number.",
    inputSchema: locationFields,
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      spoken: z.string(),
      days: z.array(daySchema),
      typical: typicalSchema,
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args, extra) => withErrors("forecast_pv_production", async () => {
    const started = Date.now();
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    try {
      const production = await loadProduction(deps, site);
      const now = deps.now();
      const spoken = speakForecast({
        label: production.site.label,
        systemKw: production.site.systemKw,
        plan: {
          todayTotalKwh: dayTotal(production, now, 0),
          tomorrowTotalKwh: dayTotal(production, now, 1),
          todayDate: localDate(now, production.timezone),
          tomorrowDate: "",
        },
        typicalDailyKwh: production.typical?.dailyKwh,
        typicalMonth: production.typical?.month,
        typicalDatabase: production.typical?.database,
        yearMin: production.typical?.yearMin,
        yearMax: production.typical?.yearMax,
        pvgisFailed: production.pvgisFailed,
      });
      return ok(spoken, forecastBody(production, null, now, started));
    } catch (error) {
      if (error instanceof UpstreamError && error.source === "forecast") {
        const typical = await loadTypicalOnly(deps, site);
        if (typical) {
          const spoken = speakTypicalOnly({ label: site.label, month: typical.month, dailyKwh: typical.dailyKwh, database: typical.database, yearMin: typical.yearMin, yearMax: typical.yearMax });
          return ok(spoken, {
            site_id: site.id,
            timezone: site.timezone,
            days: [],
            typical: {
              month: typical.month,
              daily_kwh: round3(typical.dailyKwh),
              monthly_kwh: round3(typical.monthlyKwh),
              yearly_kwh: round3(typical.yearlyKwh),
              database: typical.database,
              year_min: typical.yearMin,
              year_max: typical.yearMax,
            },
            assumptions: assumptionPayload(productionAssumptions(deps)),
            sources: DATA_SOURCES,
            elapsed_ms: Date.now() - started,
          });
        }
      }
      throw error;
    }
  }));

  server.registerTool("best_time_for_appliance", {
    _meta: cardMeta,
    title: "Best time to run an appliance",
    description: "Answer 'when should I run the washing machine?' and similar questions. Uses the forecast, caps usable solar at the appliance's power, and prefers today when the roof can cover the load. Say the returned text verbatim in substance. Do not pick a different hour.",
    inputSchema: {
      ...locationFields,
      ...applianceFields,
      power_kw: applianceFields.power_kw.optional().describe("Average power draw in kilowatts. Omit when this appliance was saved with remember_household_appliances."),
      duration_hours: applianceFields.duration_hours.optional().describe("How many hours it runs. Omit when this appliance was saved earlier."),
    },
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      decision: z.string(),
      used_saved_appliance: z.boolean(),
      spoken: z.string(),
      window: windowSchema,
      days: z.array(daySchema),
      typical: typicalSchema,
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("best_time_for_appliance", async () => {
    const started = Date.now();
    const name = cleanName(args.appliance_name);
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const spec = applianceSpec(site, name, args.power_kw, args.duration_hours);
    const production = await loadProduction(deps, site);
    const now = deps.now();
    const plan = planFor(production, {
      powerKw: spec.powerKw,
      durationHours: spec.durationHours,
      day: args.day ?? "auto",
      baselineHour: args.baseline_hour ?? 19,
      now,
    });
    const spoken = speakAppliance({
      applianceName: name,
      powerKw: spec.powerKw,
      durationHours: spec.durationHours,
      plan,
      typicalDailyKwh: production.typical?.dailyKwh,
      typicalMonth: production.typical?.month,
    });
    return ok(spec.remembered ? `${spoken} I used the power and duration you saved for the ${name}.` : spoken, {
      ...forecastBody(production, plan, now, started),
      decision: plan.decision,
      used_saved_appliance: spec.remembered,
      window: windowPayload(plan.window, production, now),
    });
  }));

  server.registerTool("estimate_savings", {
    title: "Estimate grid savings",
    description: "Compare running an appliance in the best solar window with a baseline hour, default 7 PM local. Money is calculated only from a price the person typed. Say the returned text. Do not claim the figure is their bill.",
    inputSchema: { ...locationFields, ...applianceFields },
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      spoken: z.string(),
      decision: z.string(),
      window: windowSchema,
      days: z.array(daySchema),
      grid_kwh_avoided: z.number(),
      price_per_kwh: z.number().nullable(),
      currency: z.string().nullable(),
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("estimate_savings", async () => {
    const started = Date.now();
    const name = cleanName(args.appliance_name);
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const production = await loadProduction(deps, site);
    const now = deps.now();
    const baselineHour = args.baseline_hour ?? 19;
    const plan = planFor(production, {
      powerKw: args.power_kw,
      durationHours: args.duration_hours,
      day: args.day ?? "auto",
      baselineHour,
      now,
    });
    const avoided = plan.window && plan.baseline
      ? Math.max(0, plan.baseline.gridKwh - plan.window.gridKwh)
      : plan.window?.solarKwh ?? 0;
    const spoken = speakSavings({
      applianceName: name,
      plan,
      pricePerKwh: production.site.pricePerKwh,
      currency: production.site.currency,
      baselineHour,
    });
    return ok(spoken, {
      ...forecastBody(production, plan, now, started),
      decision: plan.decision,
      window: windowPayload(plan.window, production, now),
      grid_kwh_avoided: round3(avoided),
      price_per_kwh: production.site.pricePerKwh,
      currency: production.site.currency,
    });
  }));

  server.registerTool("daily_solar_briefing", {
    _meta: cardMeta,
    title: "Daily solar briefing",
    description: "Morning routine briefing. Leads with the best solar window and, when the forecast includes cloud cover, whether clouds hang on. Then today's production, tomorrow's, a typical-year comparison, and optionally one appliance. Say the returned text.",
    inputSchema: {
      ...locationFields,
      appliance_name: applianceFields.appliance_name.optional(),
      power_kw: applianceFields.power_kw.optional(),
      duration_hours: applianceFields.duration_hours.optional(),
      day: applianceFields.day,
      baseline_hour: applianceFields.baseline_hour,
    },
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      spoken: z.string(),
      days: z.array(daySchema),
      typical: typicalSchema,
      decision: z.string().nullable(),
      window: windowSchema,
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("daily_solar_briefing", async () => {
    const started = Date.now();
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const production = await loadProduction(deps, site);
    const now = deps.now();
    const forecast = speakForecast({
      label: production.site.label,
      systemKw: production.site.systemKw,
      plan: {
        todayTotalKwh: dayTotal(production, now, 0),
        tomorrowTotalKwh: dayTotal(production, now, 1),
        todayDate: localDate(now, production.timezone),
        tomorrowDate: "",
      },
      typicalDailyKwh: production.typical?.dailyKwh,
      typicalMonth: production.typical?.month,
      typicalDatabase: production.typical?.database,
      yearMin: production.typical?.yearMin,
      yearMax: production.typical?.yearMax,
      pvgisFailed: production.pvgisFailed,
    });
    let plan: AppliancePlan | null = null;
    let applianceSpoken: string | undefined;
    if (args.appliance_name) {
      const name = cleanName(args.appliance_name);
      const spec = applianceSpec(site, name, args.power_kw, args.duration_hours);
      plan = planFor(production, {
        powerKw: spec.powerKw,
        durationHours: spec.durationHours,
        day: args.day ?? "auto",
        baselineHour: args.baseline_hour ?? 19,
        now,
      });
      applianceSpoken = speakAppliance({
        applianceName: name,
        powerKw: spec.powerKw,
        durationHours: spec.durationHours,
        plan,
        typicalDailyKwh: null,
      });
    }
    const morning = speakMorning({ ...readMorning(production.slots, production.timezone, now), timeZone: production.timezone });
    const spoken = `${morning} ${speakBriefing({ forecast, appliance: applianceSpoken })}`;
    return ok(spoken, {
      ...forecastBody(production, plan, now, started),
      decision: plan?.decision ?? null,
      window: windowPayload(plan?.window ?? null, production, now),
    });
  }));

  server.registerTool("plan_the_solar_day", {
    _meta: cardMeta,
    title: "Plan several appliances",
    description: "Schedule up to six appliances into today's or tomorrow's solar forecast. Appliances share an hour only when their combined power fits under that hour's expected output. Say the returned text. Do not move a task to a different hour.",
    inputSchema: {
      ...locationFields,
      appliances: z.array(z.object({
        name: z.string().min(2).max(40),
        power_kw: z.number().gt(0).max(50),
        duration_hours: z.number().min(0.25).max(12),
      })).min(1).max(6).optional().describe("Loads to place, in priority order. Each power and duration is an assumption the person provides. Omit to plan the appliances saved for this home."),
    },
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      spoken: z.string(),
      day: z.string(),
      runs: z.array(z.object({
        name: z.string(),
        start: z.string(),
        end: z.string(),
        load_kwh: z.number(),
      })),
      unscheduled: z.array(z.string()),
      days: z.array(daySchema),
      typical: typicalSchema,
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("plan_the_solar_day", async () => {
    const started = Date.now();
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const production = await loadProduction(deps, site);
    const now = deps.now();
    const typed = args.appliances?.map((item) => ({
      name: cleanName(item.name),
      powerKw: item.power_kw,
      durationHours: item.duration_hours,
    }));
    const loads = typed ?? (site.appliances ?? []).slice(0, 6);
    if (loads.length === 0) {
      throw new SolarError("Tell me which appliances to plan, with power and hours, or save them for this home first.");
    }
    const schedule = scheduleDay({ slots: production.slots, timeZone: production.timezone, now, loads });
    const spoken = speakDayPlan(schedule);
    const runs: ScheduledRun[] = schedule.runs;
    return ok(spoken, {
      ...forecastBody(production, null, now, started, runs),
      day: schedule.day,
      runs: runs.map((run) => ({
        name: run.name,
        start: run.start.toISOString(),
        end: run.end.toISOString(),
        load_kwh: round3(run.loadKwh),
      })),
      unscheduled: schedule.unscheduled,
    });
  }));

  server.registerTool("battery_through_the_night", {
    _meta: cardMeta,
    title: "Will the battery last the night",
    description: "Answer whether a home battery the person described will last until sunrise, and when the forecast sun can refill it. Capacity, charge, and household load must be typed by the person. Say the returned text. Do not invent a battery reading.",
    inputSchema: {
      ...locationFields,
      battery_kwh: z.number().gt(0).max(500).describe("Battery capacity in kilowatt-hours, typed by the person."),
      charge_percent: z.number().min(0).max(100).describe("Current state of charge, 0 to 100, typed by the person."),
      household_load_kw: z.number().gt(0).max(50).describe("Steady household load in kilowatts during the night and the recharge, typed by the person."),
    },
    outputSchema: {
      site_id: z.string(),
      timezone: z.string(),
      spoken: z.string(),
      lasts: z.boolean(),
      stored_kwh: z.number(),
      night_need_kwh: z.number(),
      shortfall_kwh: z.number(),
      runs_out_at: z.string().nullable(),
      refill_at: z.string().nullable(),
      days: z.array(daySchema),
      typical: typicalSchema,
      assumptions: assumptionsSchema,
      sources: z.array(sourceSchema),
      elapsed_ms: z.number(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  }, async (args, extra) => withErrors("battery_through_the_night", async () => {
    const started = Date.now();
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const production = await loadProduction(deps, site);
    const now = deps.now();
    let night;
    try {
      night = batteryThroughNight({
        slots: production.slots,
        timeZone: production.timezone,
        now,
        capacityKwh: args.battery_kwh,
        chargePercent: args.charge_percent,
        loadKw: args.household_load_kw,
        daily: production.daily,
        utcOffsetSeconds: production.utcOffsetSeconds,
      });
    } catch (error) {
      if (error instanceof MissingSunError) {
        throw new SolarError("I don't have sunrise and sunset for that place, so I can't say how long the night is.");
      }
      throw error;
    }
    const spoken = speakBattery({ ...night, chargePercent: args.charge_percent });
    const highlight = night.refillAt ? [{ start: night.nightEnd, end: night.refillAt }] : [];
    return ok(spoken, {
      ...forecastBody(production, null, now, started, highlight),
      lasts: night.lasts,
      stored_kwh: round3(night.storedKwh),
      night_need_kwh: round3(night.nightNeedKwh),
      shortfall_kwh: round3(night.shortfallKwh),
      runs_out_at: night.runsOutAt?.toISOString() ?? null,
      refill_at: night.refillAt?.toISOString() ?? null,
    });
  }));

  server.registerTool("remember_household_appliances", {
    title: "Remember my appliances",
    description: "Save appliances for this home, with the power and run time the person typed, so later questions can say 'the washer' without repeating numbers. Saved with the site, so a later session can use them through the site_id. Up to 8 per home. Say the returned text.",
    inputSchema: {
      ...locationFields,
      appliances: z.array(z.object({
        name: z.string().min(2).max(40),
        power_kw: z.number().gt(0).max(50),
        duration_hours: z.number().min(0.25).max(12),
      })).min(1).max(MAX_SAVED_APPLIANCES).describe("Appliances to remember. Power and duration are what the person typed."),
    },
    outputSchema: {
      site_id: z.string(),
      spoken: z.string(),
      appliances: z.array(z.object({ name: z.string(), power_kw: z.number(), duration_hours: z.number() })),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args, extra) => withErrors("remember_household_appliances", async () => {
    const site = await resolveSite(deps, siteRequest(args, extra.sessionId));
    const added = args.appliances.map((item) => ({ name: cleanName(item.name), powerKw: item.power_kw, durationHours: item.duration_hours }));
    const next = await deps.sites.persist(deps.sites.save({ ...site, appliances: mergeAppliances(site.appliances, added) }, extra.sessionId));
    return ok(speakRemembered(next, added), {
      site_id: next.id,
      appliances: (next.appliances ?? []).map((item) => ({ name: item.name, power_kw: item.powerKw, duration_hours: item.durationHours })),
    });
  }));

  server.registerResource("solar_day_card", SOLAR_CARD_URI, {
    title: "Solar day card",
    description: "MCP App view for Sol Solar tool results: hourly production bars, the chosen window, the day plan, and the battery check.",
    mimeType: SOLAR_CARD_MIME,
  }, async () => ({
    contents: [{
      uri: SOLAR_CARD_URI,
      mimeType: SOLAR_CARD_MIME,
      text: SOLAR_CARD_HTML,
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } },
    }],
  }));

  server.registerPrompt("answer_solar_question", {
    title: "Answer a home solar question",
    description: "Instructions for turning Sol Solar tool results into a short spoken answer.",
    argsSchema: { question: z.string().describe("What the person asked") },
  }, ({ question }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Speak as a calm home assistant. Use the Sol Solar tools for every number and every clock time. Say the tool text to the person. Do not invent kilowatt-hours, prices, or a time of day. If you do not yet know the city and the array size, ask. Question: ${question}`,
      },
    }],
  }));
}

function productionAssumptions(deps: Deps): PvAssumptions {
  return {
    systemLossFraction: deps.config.systemLossFraction,
    tempCoeffPerC: deps.config.tempCoeffPerC,
    noctRiseC: 25,
    stcIrradianceWm2: 1000,
    stcCellTempC: 25,
  };
}

function dayTotal(production: Production, now: Date, offset: number): number {
  const today = localDate(now, production.timezone);
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + offset)).toISOString().slice(0, 10);
  return production.slots.reduce((sum, slot) => localDate(slot.start, production.timezone) === date ? sum + slot.energyKwh : sum, 0);
}

function forecastBody(production: Production, plan: AppliancePlan | null, now: Date, started: number, extra: Array<{ start: Date; end: Date }> = []) {
  return {
    site_id: production.site.id,
    timezone: production.timezone,
    days: dayPayload(production, plan, now, extra),
    typical: typicalPayload(production),
    assumptions: assumptionPayload(production.assumptions),
    sources: DATA_SOURCES,
    elapsed_ms: Date.now() - started,
  };
}
