import assert from "node:assert/strict";
import test from "node:test";
import {
  addHours,
  azimuthLabel,
  defaultAzimuthDegrees,
  defaultTiltDegrees,
  hourEnergy,
  localDateIso,
  rankWindows,
  valueProduction,
  type HourSlot,
} from "../src/solar/model.js";

test("hour energy at STC-like irradiance includes temperature and system loss", () => {
  const result = hourEnergy({
    gtiWm2: 1000,
    airTempC: 25,
    peakPowerKw: 5,
    systemLossFraction: 0.14,
  });
  assert.ok(Math.abs(result.cellTempC - 56.25) < 0.01);
  assert.ok(Math.abs(result.energyKwh - 3.7625) < 0.01);
});

test("night and negative irradiance produce zero energy", () => {
  const night = hourEnergy({
    gtiWm2: 0,
    airTempC: 10,
    peakPowerKw: 5,
    systemLossFraction: 0.14,
  });
  const negative = hourEnergy({
    gtiWm2: -20,
    airTempC: 10,
    peakPowerKw: 5,
    systemLossFraction: 0.14,
  });
  assert.equal(night.energyKwh, 0);
  assert.equal(negative.energyKwh, 0);
});

test("defaults face the equator and follow latitude", () => {
  assert.equal(defaultAzimuthDegrees(50.45), 0);
  assert.equal(defaultAzimuthDegrees(-33.8), 180);
  assert.equal(defaultTiltDegrees(50.45), 50.5);
  assert.equal(defaultTiltDegrees(2), 10);
  assert.equal(azimuthLabel(0), "south");
  assert.equal(azimuthLabel(180), "north");
});

test("savings use only the supplied prices", () => {
  const full = valueProduction({
    productionKwh: 10,
    gridPricePerKwh: 2,
    exportPricePerKwh: 0,
    selfConsumptionFraction: 1,
  });
  assert.equal(full.value, 20);
  const split = valueProduction({
    productionKwh: 10,
    gridPricePerKwh: 4,
    exportPricePerKwh: 1,
    selfConsumptionFraction: 0.5,
  });
  assert.equal(split.selfConsumedKwh, 5);
  assert.equal(split.exportedKwh, 5);
  assert.equal(split.value, 25);
});

test("best window prefers the sunnier contiguous hours", () => {
  const slots: HourSlot[] = [
    slot("2026-10-18T08:00", "2026-10-18T09:00", 0.2),
    slot("2026-10-18T09:00", "2026-10-18T10:00", 0.4),
    slot("2026-10-18T10:00", "2026-10-18T11:00", 1.5),
    slot("2026-10-18T11:00", "2026-10-18T12:00", 1.8),
    slot("2026-10-18T12:00", "2026-10-18T13:00", 0.3),
  ];
  const [best] = rankWindows(slots, 2, 3);
  assert.ok(best);
  assert.equal(best.startIso, "2026-10-18T10:00");
  assert.equal(best.endIso, "2026-10-18T12:00");
  assert.equal(best.productionKwh, 3.3);
});

test("a one-and-a-half-hour window prorates the last hour", () => {
  const slots: HourSlot[] = [
    slot("2026-10-18T11:00", "2026-10-18T12:00", 2),
    slot("2026-10-18T12:00", "2026-10-18T13:00", 1),
  ];
  const [best] = rankWindows(slots, 1.5, 1);
  assert.ok(best);
  assert.equal(best.productionKwh, 2.5);
  assert.equal(best.endIso, "2026-10-18T12:30");
});

test("local dates follow the site offset", () => {
  const utcEvening = Date.parse("2026-10-17T22:30:00Z");
  assert.equal(localDateIso(utcEvening, 3 * 3600), "2026-10-18");
  assert.equal(addHours("2026-10-18T00:30", -1), "2026-10-17T23:30");
});

function slot(startIso: string, endIso: string, energyKwh: number): HourSlot {
  return {
    startIso,
    endIso,
    date: startIso.slice(0, 10),
    energyKwh,
    gtiWm2: null,
    future: true,
  };
}
