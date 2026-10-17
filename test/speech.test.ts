import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choosePlace, placeLabel, type GeoHit } from "../src/data/openMeteo.js";
import { s256Challenge } from "../src/auth.js";
import { speakKwh, speakMoney, speakSavings } from "../src/solar/speech.js";
import type { AppliancePlan } from "../src/solar/plan.js";

describe("place choice", () => {
  it("prefers the capital when a smaller place shares the name", () => {
    const kyiv: GeoHit = { name: "Kyiv", country: "Ukraine", admin1: "Kyiv City", latitude: 50.45, longitude: 30.52, population: 2_952_301, featureCode: "PPLC" };
    const village: GeoHit = { name: "Kyiv", country: "Ukraine", admin1: "Mykolaiv Oblast", latitude: 47.86, longitude: 31.02, population: 108, featureCode: "PPL" };
    const chosen = choosePlace([kyiv, village]);
    assert.ok(!("ambiguous" in chosen));
    if (!("ambiguous" in chosen)) assert.equal(placeLabel(chosen), "Kyiv, Ukraine");
  });

  it("asks when two matches are similarly sized", () => {
    const a: GeoHit = { name: "Springfield", country: "United States", admin1: "Illinois", latitude: 39.8, longitude: -89.6, population: 114_000 };
    const b: GeoHit = { name: "Springfield", country: "United States", admin1: "Missouri", latitude: 37.2, longitude: -93.3, population: 169_000 };
    const chosen = choosePlace([a, b]);
    assert.ok("ambiguous" in chosen);
  });
});

describe("speech", () => {
  it("uses the PKCE S256 test vector", () => {
    assert.equal(s256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("does not invent money without a price", () => {
    const plan = {
      decision: "wait-tomorrow",
      timeZone: "Europe/Kyiv",
      todayDate: "2026-10-18",
      tomorrowDate: "2026-10-19",
      window: {
        start: new Date("2026-10-19T13:00:00+03:00"),
        end: new Date("2026-10-19T15:00:00+03:00"),
        solarKwh: 1.4,
        loadKwh: 1.4,
        gridKwh: 0,
        date: "2026-10-19",
      },
      todayBest: null,
      tomorrowBest: null,
      baseline: {
        start: new Date("2026-10-18T19:00:00+03:00"),
        end: new Date("2026-10-18T21:00:00+03:00"),
        solarKwh: 0,
        loadKwh: 1.4,
        gridKwh: 1.4,
        date: "2026-10-18",
      },
      todayTotalKwh: 1.3,
      tomorrowTotalKwh: 3.8,
      todayAheadKwh: 1.3,
      tomorrowAheadKwh: 3.8,
    } satisfies AppliancePlan;
    const spoken = speakSavings({ applianceName: "washing machine", plan, pricePerKwh: null, currency: null, baselineHour: 19 });
    assert.match(spoken, /Tell me your price/);
    assert.doesNotMatch(spoken, /hryvnia|euro|dollar/);
    const priced = speakSavings({ applianceName: "washing machine", plan, pricePerKwh: 6, currency: "UAH", baselineHour: 19 });
    assert.match(priced, /hryvnia/);
    assert.match(priced, /not a tariff lookup/);
    assert.match(speakKwh(1), /1 kilowatt-hour/);
    assert.match(speakMoney(8.4, "UAH"), /8\.40 hryvnia/);
  });
});
