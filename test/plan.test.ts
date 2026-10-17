import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hourEnergyKwh, DEFAULT_ASSUMPTIONS, type HourSlot } from "../src/solar/model.js";
import { localHour, planAppliance } from "../src/solar/plan.js";
import { speakAppliance } from "../src/solar/speech.js";

function slot(startIso: string, gti: number): HourSlot {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    start,
    end,
    gtiWm2: gti,
    ambientC: 13,
    ambientAssumed: false,
    energyKwh: hourEnergyKwh(gti, 13, 5, DEFAULT_ASSUMPTIONS),
  };
}

const cloudyKyiv = [
  ["2026-10-18T07:00:00+03:00", 1.9],
  ["2026-10-18T08:00:00+03:00", 13],
  ["2026-10-18T09:00:00+03:00", 23.2],
  ["2026-10-18T10:00:00+03:00", 38.2],
  ["2026-10-18T11:00:00+03:00", 48.2],
  ["2026-10-18T12:00:00+03:00", 43.5],
  ["2026-10-18T13:00:00+03:00", 47.3],
  ["2026-10-18T14:00:00+03:00", 25],
  ["2026-10-18T15:00:00+03:00", 22.4],
  ["2026-10-18T16:00:00+03:00", 18.9],
  ["2026-10-18T17:00:00+03:00", 4.6],
  ["2026-10-19T08:00:00+03:00", 7.4],
  ["2026-10-19T09:00:00+03:00", 16.7],
  ["2026-10-19T10:00:00+03:00", 28.8],
  ["2026-10-19T11:00:00+03:00", 45.5],
  ["2026-10-19T12:00:00+03:00", 138.2],
  ["2026-10-19T13:00:00+03:00", 165.5],
  ["2026-10-19T14:00:00+03:00", 161],
  ["2026-10-19T15:00:00+03:00", 127.9],
  ["2026-10-19T16:00:00+03:00", 127.5],
  ["2026-10-19T17:00:00+03:00", 28.8],
].map(([start, gti]) => slot(String(start), Number(gti)));

describe("appliance window", () => {
  it("waits until tomorrow when today cannot cover a wash and tomorrow can", () => {
    const plan = planAppliance({
      slots: cloudyKyiv,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T06:00:00+03:00"),
      powerKw: 0.7,
      durationHours: 2,
      day: "auto",
      baselineHour: 19,
    });
    assert.equal(plan.decision, "wait-tomorrow");
    assert.ok(plan.window);
    assert.equal(localHour(plan.window.start, "Europe/Kyiv"), 13);
    assert.equal(localHour(plan.window.end, "Europe/Kyiv"), 15);
    assert.ok(plan.window.solarKwh >= plan.window.loadKwh * 0.95);
    assert.ok(plan.todayTotalKwh < plan.tomorrowTotalKwh);
    const spoken = speakAppliance({ applianceName: "washing machine", powerKw: 0.7, durationHours: 2, plan });
    assert.match(spoken, /^Wait until tomorrow\. Run the washing machine from 1 PM to 3 PM\./);
    assert.doesNotMatch(spoken, /NaN|undefined/);
    assert.match(spoken, /model estimate/);
  });

  it("keeps a covered load today even when tomorrow is sunnier", () => {
    const slots = [
      slot("2026-10-18T11:00:00+03:00", 800),
      slot("2026-10-18T12:00:00+03:00", 850),
      slot("2026-10-19T11:00:00+03:00", 1000),
      slot("2026-10-19T12:00:00+03:00", 1000),
    ];
    const plan = planAppliance({
      slots,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T08:00:00+03:00"),
      powerKw: 0.7,
      durationHours: 2,
      day: "auto",
      baselineHour: 19,
    });
    assert.equal(plan.decision, "run-today");
  });

  it("does not offer an hour that already started", () => {
    const plan = planAppliance({
      slots: cloudyKyiv,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-19T14:30:00+03:00"),
      powerKw: 0.7,
      durationHours: 2,
      day: "auto",
      baselineHour: 19,
    });
    assert.ok(plan.window);
    assert.ok(plan.window.start.getTime() >= new Date("2026-10-19T14:30:00+03:00").getTime());
  });

  it("caps usable solar at the appliance power", () => {
    const plan = planAppliance({
      slots: [slot("2026-10-18T12:00:00+03:00", 1000), slot("2026-10-18T13:00:00+03:00", 1000)],
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T08:00:00+03:00"),
      powerKw: 0.5,
      durationHours: 2,
      day: "today",
      baselineHour: 19,
    });
    assert.ok(plan.window);
    assert.ok(plan.window.solarKwh <= 1.01);
    assert.ok(plan.window.solarKwh >= 0.99);
  });
});
