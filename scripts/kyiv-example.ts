import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeForecast, describeLocation, describeTypicalYear } from "../src/solar/service.js";

const location = await describeLocation("Kyiv", 1);
const best = location.details.best as {
  latitude: number;
  longitude: number;
  name: string;
  timezone: string;
};
const system = {
  latitude: best.latitude,
  longitude: best.longitude,
  peakPowerKw: 5,
  tiltDegrees: 35,
  azimuthDegrees: 0,
  systemLossPercent: 14,
  placeName: "Kyiv",
};
const [forecast, typical] = await Promise.all([describeForecast(system), describeTypicalYear(system)]);
const sample = {
  captured_at: new Date().toISOString(),
  note: "Point-in-time responses from the public Open-Meteo and PVGIS APIs. Forecast numbers change. Re-run npm run example.",
  location: location.details,
  location_summary: location.summary,
  forecast_summary: forecast.summary,
  forecast: forecast.details,
  typical_year_summary: typical.summary,
  typical_year: typical.details,
};
const destination = path.resolve("docs/samples/kyiv-5kw.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(sample, null, 2)}\n`);
console.log(location.summary);
console.log(forecast.summary);
console.log(typical.summary);
console.log(`Wrote ${destination}`);
