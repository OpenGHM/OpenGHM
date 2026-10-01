/**
 * The unit a spatial resolution is shown in. The filter itself is always in
 * degrees (`spatial_res_min` / `spatial_res_max`); the unit only changes how a
 * value is displayed.
 */
export type ResolutionUnit = "deg" | "arcmin" | "arcsec";

export const RESOLUTION_UNITS: {
  value: ResolutionUnit;
  label: string;
  symbol: string;
  /** Degrees to this unit: 1 degree = 60 arc-minutes = 3600 arc-seconds. */
  multiplier: number;
}[] = [
  { value: "deg", label: "Degrees", symbol: "°", multiplier: 1 },
  { value: "arcmin", label: "Arc-minutes", symbol: "′", multiplier: 60 },
  { value: "arcsec", label: "Arc-seconds", symbol: "″", multiplier: 3600 },
];

/**
 * A resolution in degrees, written in a unit: degrees to four decimals below
 * 0.1 and two above, arc-minutes to one decimal, arc-seconds as a whole number.
 */
export function formatResolution(degrees: number, unit: ResolutionUnit): string {
  const u = RESOLUTION_UNITS.find((o) => o.value === unit) ?? RESOLUTION_UNITS[0];
  const converted = degrees * u.multiplier;
  if (u.value === "deg") return `${converted.toFixed(converted < 0.1 ? 4 : 2)}${u.symbol}`;
  if (u.value === "arcmin") return `${converted.toFixed(1)}${u.symbol}`;
  return `${Math.round(converted)}${u.symbol}`;
}
