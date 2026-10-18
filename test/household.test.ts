import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batteryThroughNight, readMorning, scheduleDay, scheduleRespectsRoof } from "../src/solar/household.js";
import type { HourSlot } from "../src/solar/model.js";
import { localHour } from "../src/solar/plan.js";
import { speakBattery, speakDayPlan, speakMorning } from "../src/solar/speech.js";

function hour(startIso: string, energyKwh: number, cloudCover: number | null = null): HourSlot {
  const start = new Date(startIso);
  return {
    start,
    end: new Date(start.getTime() + 3_600_000),
    gtiWm2: 0,
    ambientC: 12,
    ambientAssumed: false,
    energyKwh,
    cloudCover,
  };
}

const sunny = [
  hour("2026-10-18T10:00:00+03:00", 3),
  hour("2026-10-18T11:00:00+03:00", 4),
  hour("2026-10-18T12:00:00+03:00", 4),
  hour("2026-10-18T13:00:00+03:00", 4),
  hour("2026-10-18T14:00:00+03:00", 3),
  hour("2026-10-18T15:00:00+03:00", 2),
];

describe("day plan", () => {
  it("places three appliances without asking an hour for more than it has", () => {
    const schedule = scheduleDay({
      slots: sunny,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T08:00:00+03:00"),
      loads: [
        { name: "dishwasher", powerKw: 1.2, durationHours: 1 },
        { name: "washing machine", powerKw: 0.7, durationHours: 2 },
        { name: "car charging", powerKw: 1.4, durationHours: 3 },
      ],
    });
    assert.equal(schedule.day, "today");
    assert.deepEqual(schedule.unscheduled, []);
    assert.equal(schedule.runs.length, 3);
    assert.equal(localHour(schedule.runs[0]!.start, "Europe/Kyiv"), 10);
    assert.equal(localHour(schedule.runs[1]!.start, "Europe/Kyiv"), 11);
    assert.equal(localHour(schedule.runs[2]!.start, "Europe/Kyiv"), 13);
    assert.equal(scheduleRespectsRoof(sunny, schedule.runs), true);
    const spoken = speakDayPlan(schedule);
    assert.match(spoken, /^Today: dishwasher from 10 AM to 11 AM, washing machine from 11 AM to 1 PM, and car charging from 1 PM to 4 PM\./);
    assert.match(spoken, /model estimate/);
    assert.doesNotMatch(spoken, /NaN|undefined/);
  });

  it("lets two loads share an hour only when the roof still covers both", () => {
    const tight = [hour("2026-10-18T12:00:00+03:00", 2), hour("2026-10-18T13:00:00+03:00", 2)];
    const schedule = scheduleDay({
      slots: tight,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T08:00:00+03:00"),
      loads: [
        { name: "dishwasher", powerKw: 1.5, durationHours: 1 },
        { name: "washing machine", powerKw: 1, durationHours: 1 },
        { name: "boiler", powerKw: 1, durationHours: 1 },
      ],
    });
    assert.equal(schedule.runs.length, 3);
    assert.equal(schedule.shared.length > 0, true);
    assert.equal(scheduleRespectsRoof(tight, schedule.runs), true);
    const spoken = speakDayPlan(schedule);
    assert.match(spoken, /share/);
    assert.match(spoken, /within the roof's output/);
  });
});

describe("battery night", () => {
  const daily = [
    { date: "2026-10-18", sunrise: "2026-10-18T07:00:00+03:00", sunset: "2026-10-18T18:00:00+03:00" },
    { date: "2026-10-19", sunrise: "2026-10-19T07:00:00+03:00", sunset: "2026-10-19T17:58:00+03:00" },
  ];
  const morning = ["07", "08", "09", "10", "11", "12", "13"].map((hh) => hour(`2026-10-19T${hh}:00:00+03:00`, 1));

  it("says the battery runs out when the night is longer than the charge", () => {
    const night = batteryThroughNight({
      slots: morning,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T17:00:00+03:00"),
      capacityKwh: 5,
      chargePercent: 40,
      loadKw: 0.2,
      daily,
      utcOffsetSeconds: 10800,
    });
    assert.equal(night.lasts, false);
    assert.equal(localHour(night.runsOutAt!, "Europe/Kyiv"), 4);
    assert.ok(night.refillAt);
    assert.equal(localHour(night.refillAt, "Europe/Kyiv"), 13);
    const spoken = speakBattery({ ...night, chargePercent: 40 });
    assert.match(spoken, /^No\. The battery runs out around 4 AM\./);
    assert.match(spoken, /not read from a battery/);
    assert.match(spoken, /refill it by about 1:15 PM/);
    assert.doesNotMatch(spoken, /NaN|undefined/);
  });

  it("says yes when the stored energy covers the night", () => {
    const night = batteryThroughNight({
      slots: morning,
      timeZone: "Europe/Kyiv",
      now: new Date("2026-10-18T17:00:00+03:00"),
      capacityKwh: 5,
      chargePercent: 80,
      loadKw: 0.2,
      daily,
      utcOffsetSeconds: 10800,
    });
    assert.equal(night.lasts, true);
    assert.equal(night.runsOutAt, null);
    const spoken = speakBattery({ ...night, chargePercent: 80 });
    assert.match(spoken, /^Yes\. The battery should last through that night\./);
  });
});

describe("morning briefing", () => {
  it("names the cloudy stretch and the strongest three-hour window", () => {
    const slots = [
      hour("2026-10-18T08:00:00+03:00", 0.2, 90),
      hour("2026-10-18T09:00:00+03:00", 0.3, 88),
      hour("2026-10-18T10:00:00+03:00", 0.4, 80),
      hour("2026-10-18T11:00:00+03:00", 0.5, 75),
      hour("2026-10-18T12:00:00+03:00", 1.2, 30),
      hour("2026-10-18T13:00:00+03:00", 1.6, 20),
      hour("2026-10-18T14:00:00+03:00", 1.5, 15),
      hour("2026-10-18T15:00:00+03:00", 0.4, 20),
    ];
    const read = readMorning(slots, "Europe/Kyiv", new Date("2026-10-18T07:00:00+03:00"));
    assert.equal(read.greeting, "morning");
    assert.equal(localHour(read.cloudyUntil!, "Europe/Kyiv"), 12);
    assert.equal(localHour(read.windowStart!, "Europe/Kyiv"), 12);
    assert.equal(localHour(read.windowEnd!, "Europe/Kyiv"), 15);
    const spoken = speakMorning({ ...read, timeZone: "Europe/Kyiv" });
    assert.match(spoken, /^Run heavy loads from 12 PM to 3 PM today\./);
    assert.match(spoken, /Good morning\./);
    assert.match(spoken, /Clouds hang on until about 12 PM\./);
  });
});
