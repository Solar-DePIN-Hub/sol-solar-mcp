import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hourEnergyKwh, DEFAULT_ASSUMPTIONS } from "../src/solar/model.js";

describe("photovoltaic model", () => {
  it("returns the array size at STC when losses and the temperature coefficient are zero", () => {
    const energy = hourEnergyKwh(1000, 25, 5, { ...DEFAULT_ASSUMPTIONS, systemLossFraction: 0, tempCoeffPerC: 0 });
    assert.equal(energy, 5);
  });

  it("returns zero at night", () => {
    assert.equal(hourEnergyKwh(0, 10, 5, DEFAULT_ASSUMPTIONS), 0);
    assert.equal(hourEnergyKwh(-10, 10, 5, DEFAULT_ASSUMPTIONS), 0);
  });

  it("reduces a hot hour below the nameplate", () => {
    const energy = hourEnergyKwh(1000, 25, 5, DEFAULT_ASSUMPTIONS);
    assert.ok(energy < 5);
    assert.ok(energy > 3);
  });
});
