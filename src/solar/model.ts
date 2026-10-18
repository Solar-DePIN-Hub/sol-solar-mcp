export interface PvAssumptions {
  systemLossFraction: number;
  tempCoeffPerC: number;
  /** Cell-temperature rise above ambient at 800 W/m². NOCT is about 45°C in 20°C air, a 25°C rise. */
  noctRiseC: number;
  stcIrradianceWm2: number;
  stcCellTempC: number;
}

export const DEFAULT_ASSUMPTIONS: PvAssumptions = {
  systemLossFraction: 0.14,
  tempCoeffPerC: -0.004,
  noctRiseC: 25,
  stcIrradianceWm2: 1000,
  stcCellTempC: 25,
};

export interface HourSlot {
  start: Date;
  end: Date;
  gtiWm2: number;
  ambientC: number;
  ambientAssumed: boolean;
  energyKwh: number;
  /** Open-Meteo hourly cloud cover, 0–100. Absent when the forecast did not include it. */
  cloudCover?: number | null;
}

export function hourEnergyKwh(
  gtiWm2: number,
  ambientC: number,
  systemKw: number,
  assumptions: PvAssumptions,
): number {
  if (!(gtiWm2 > 0) || !(systemKw > 0)) return 0;
  const cellC = ambientC + (gtiWm2 / 800) * assumptions.noctRiseC;
  const rawFactor = 1 + assumptions.tempCoeffPerC * (cellC - assumptions.stcCellTempC);
  const tempFactor = Math.min(1.15, Math.max(0.5, rawFactor));
  const lossFactor = 1 - assumptions.systemLossFraction;
  const kwh = (gtiWm2 / assumptions.stcIrradianceWm2) * systemKw * tempFactor * lossFactor;
  return kwh > 0 ? kwh : 0;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function assumptionsFrom(loss: number, coeff: number): PvAssumptions {
  return { ...DEFAULT_ASSUMPTIONS, systemLossFraction: loss, tempCoeffPerC: coeff };
}
