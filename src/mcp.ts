import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  describeApplianceWindow,
  describeForecast,
  describeLocation,
  describeSavings,
  describeTypicalYear,
  type SystemSpec,
} from "./solar/service.js";

const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = [
  "Sol Solar estimates photovoltaic production for one home array or a small solar node.",
  "Speak the SUMMARY line to the user. Use the JSON that follows for follow-up questions. Do not read the JSON aloud.",
  "Every energy figure is an estimate, never a meter reading, a bill, or a guaranteed schedule.",
  "Do not invent an electricity price. Call estimate_savings only with a price the user stated.",
  "resolve_location before forecasting when the user names a place. If several matches come back, ask which one they mean.",
  "forecast_pv_production and best_appliance_hours use the Open-Meteo forecast plus a local temperature model.",
  "typical_monthly_yield uses PVGIS climatology and is not a forecast for this week.",
  "Attribute Open-Meteo and, when used, PVGIS.",
].join(" ");

const latitude = z
  .number()
  .min(-90)
  .max(90)
  .describe("Latitude in decimal degrees. South is negative.");
const longitude = z
  .number()
  .min(-180)
  .max(180)
  .describe("Longitude in decimal degrees. West is negative.");
const peakPowerKw = z
  .number()
  .gt(0)
  .max(1000)
  .describe("Nameplate DC power of the array in kilowatts (kWp). A small home system is often 3 to 10.");
const tiltDegrees = z
  .number()
  .min(0)
  .max(90)
  .optional()
  .describe("Panel tilt from horizontal, 0 to 90. Omit to use a latitude rule of thumb, clamped between 10 and 60.");
const azimuthDegrees = z
  .number()
  .min(-180)
  .max(180)
  .optional()
  .describe("Panel azimuth. 0 is south, -90 east, 90 west, 180 north. Omit to face the equator.");
const systemLossPercent = z
  .number()
  .min(0)
  .max(40)
  .optional()
  .describe("Inverter, cable, and soiling losses in percent. Defaults to 14, the PVGIS default. Temperature loss is separate.");
const placeName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional()
  .describe("Place label to mention in the spoken summary. Does not change the coordinates.");

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function createSolarServer(): McpServer {
  const server = new McpServer(
    {
      name: "sol-solar",
      title: "Sol Solar",
      version: SERVER_VERSION,
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "resolve_location",
    {
      title: "Resolve a place name",
      description:
        "Turn a city or town name into coordinates using the Open-Meteo geocoder (GeoNames). Use this before the forecast tools when the user names a place instead of giving latitude and longitude. If more than one match is returned, ask the user which one they mean.",
      inputSchema: {
        place: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .describe("City or town name. Latin or Cyrillic letters are fine. Example: Kyiv."),
        count: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("How many matches to return. Defaults to 3."),
      },
      annotations: readOnly,
    },
    async ({ place, count }) =>
      run("resolve_location", () => describeLocation(place, count ?? 3)),
  );

  server.registerTool(
    "forecast_pv_production",
    {
      title: "Forecast today's and tomorrow's PV production",
      description:
        "Estimate hourly and daily PV energy for the rest of today and for tomorrow at a fixed array. Uses the Open-Meteo global tilted irradiance forecast and a documented local temperature model. Say that the result is an estimate, not a meter reading. Irradiance at each timestamp is the average of the preceding hour.",
      inputSchema: {
        latitude,
        longitude,
        peak_power_kw: peakPowerKw,
        tilt_degrees: tiltDegrees,
        azimuth_degrees: azimuthDegrees,
        system_loss_percent: systemLossPercent,
        place_name: placeName,
      },
      annotations: readOnly,
    },
    async (args) => run("forecast_pv_production", () => describeForecast(systemFrom(args))),
  );

  server.registerTool(
    "best_appliance_hours",
    {
      title: "Find the best hours to run a heavy appliance",
      description:
        "Given an appliance power and run time, rank the contiguous hours when the forecast array output is highest. Compare that output with the energy the appliance needs and say whether the grid or a battery would still have to cover part of the load. Only remaining hours are recommended when any remain. This is not a control command and it does not switch anything on.",
      inputSchema: {
        latitude,
        longitude,
        peak_power_kw: peakPowerKw,
        tilt_degrees: tiltDegrees,
        azimuth_degrees: azimuthDegrees,
        system_loss_percent: systemLossPercent,
        place_name: placeName,
        appliance_name: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe("What the person wants to run, for the spoken answer. Example: washing machine."),
        power_watts: z
          .number()
          .gt(0)
          .max(50_000)
          .describe("Average power draw of the appliance in watts."),
        duration_hours: z
          .number()
          .gt(0)
          .max(12)
          .describe("How many hours the appliance needs to run. Fractional hours are allowed."),
        day: z
          .enum(["auto", "today", "tomorrow"])
          .optional()
          .describe("Which day to search. auto uses today if any sun remains, otherwise tomorrow."),
      },
      annotations: readOnly,
    },
    async (args) =>
      run("best_appliance_hours", () =>
        describeApplianceWindow({
          system: systemFrom(args),
          applianceName: args.appliance_name,
          powerWatts: args.power_watts,
          durationHours: args.duration_hours,
          day: args.day ?? "auto",
        }),
      ),
  );

  server.registerTool(
    "estimate_savings",
    {
      title: "Value estimated production at a caller-supplied price",
      description:
        "Multiply kilowatt-hours by an electricity price the user explicitly provides. Never look up or invent a tariff. If production_kwh is omitted, the tool forecasts remaining today plus tomorrow and values that sum. The result assumes the stated share of production offsets purchases and values the rest at the export price, which defaults to zero. It is not a bill.",
      inputSchema: {
        latitude: latitude.optional(),
        longitude: longitude.optional(),
        peak_power_kw: peakPowerKw.optional(),
        tilt_degrees: tiltDegrees,
        azimuth_degrees: azimuthDegrees,
        system_loss_percent: systemLossPercent,
        place_name: placeName,
        production_kwh: z
          .number()
          .min(0)
          .max(100_000)
          .optional()
          .describe("Kilowatt-hours to value. Omit to use the forecast for remaining today plus tomorrow."),
        grid_price_per_kwh: z
          .number()
          .min(0)
          .max(1000)
          .describe("Price the user pays per purchased kWh, in currency. Do not invent this."),
        currency: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/)
          .describe("ISO 4217 currency code for the price the user stated, such as UAH, EUR, or USD."),
        export_price_per_kwh: z
          .number()
          .min(0)
          .max(1000)
          .optional()
          .describe("Price paid for exported kWh. Defaults to 0."),
        self_consumption_fraction: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Share of production assumed to offset purchases, from 0 to 1. Defaults to 1."),
      },
      annotations: readOnly,
    },
    async (args) =>
      run("estimate_savings", async () => {
        const system =
          args.latitude !== undefined && args.longitude !== undefined && args.peak_power_kw !== undefined
            ? systemFrom({
                latitude: args.latitude,
                longitude: args.longitude,
                peak_power_kw: args.peak_power_kw,
                tilt_degrees: args.tilt_degrees,
                azimuth_degrees: args.azimuth_degrees,
                system_loss_percent: args.system_loss_percent,
                place_name: args.place_name,
              })
            : undefined;
        if (args.production_kwh === undefined && !system) {
          throw new Error(
            "Provide production_kwh, or provide latitude, longitude, and peak_power_kw so the forecast can be valued.",
          );
        }
        return describeSavings({
          ...(system ? { system } : {}),
          ...(args.production_kwh !== undefined ? { productionKwh: args.production_kwh } : {}),
          gridPricePerKwh: args.grid_price_per_kwh,
          currency: args.currency,
          exportPricePerKwh: args.export_price_per_kwh ?? 0,
          selfConsumptionFraction: args.self_consumption_fraction ?? 1,
        });
      }),
  );

  server.registerTool(
    "typical_monthly_yield",
    {
      title: "Typical monthly and yearly yield from PVGIS",
      description:
        "Ask PVGIS 5.3 PVcalc for the typical-year monthly and yearly energy of a fixed free-standing crystalline-silicon array. This is climatology from the radiation database PVGIS selects, not a weather forecast and not this month's expected output. Use forecast_pv_production for today and tomorrow.",
      inputSchema: {
        latitude,
        longitude,
        peak_power_kw: peakPowerKw,
        tilt_degrees: tiltDegrees,
        azimuth_degrees: azimuthDegrees,
        system_loss_percent: systemLossPercent,
        place_name: placeName,
      },
      annotations: readOnly,
    },
    async (args) => run("typical_monthly_yield", () => describeTypicalYear(systemFrom(args))),
  );

  return server;
}

function systemFrom(args: {
  latitude: number;
  longitude: number;
  peak_power_kw: number;
  tilt_degrees?: number;
  azimuth_degrees?: number;
  system_loss_percent?: number;
  place_name?: string;
}): SystemSpec {
  return {
    latitude: args.latitude,
    longitude: args.longitude,
    peakPowerKw: args.peak_power_kw,
    ...(args.tilt_degrees !== undefined ? { tiltDegrees: args.tilt_degrees } : {}),
    ...(args.azimuth_degrees !== undefined ? { azimuthDegrees: args.azimuth_degrees } : {}),
    ...(args.system_loss_percent !== undefined ? { systemLossPercent: args.system_loss_percent } : {}),
    ...(args.place_name !== undefined ? { placeName: args.place_name } : {}),
  };
}

async function run(
  name: string,
  fn: () => Promise<{ summary: string; details: Record<string, unknown> }>,
) {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`${new Date().toISOString()} tool ${name} ${Date.now() - started}ms`);
    return {
      content: [
        {
          type: "text" as const,
          text: `SUMMARY: ${result.summary}\n\n${JSON.stringify(result.details, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    console.log(`${new Date().toISOString()} tool ${name} failed ${Date.now() - started}ms`);
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
    };
  }
}
