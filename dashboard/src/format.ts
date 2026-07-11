import { ethers } from "ethers";

export const shortAddr = (a: string): string =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

export const bpsToPct = (bps: bigint | number): string =>
  `${(Number(bps) / 100).toFixed(2)}%`;

/** Format a token amount with a small, readable number of decimals. */
export function fmt(amount: bigint, decimals: number, maxFrac = 4): string {
  const s = ethers.formatUnits(amount, decimals);
  const [whole, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  const withGroups = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${withGroups}.${trimmed}` : withGroups;
}

/** Signed P&L string, e.g. "+12.50" / "-3.00". */
export function fmtSigned(amount: bigint, decimals: number, maxFrac = 4): string {
  const sign = amount < 0n ? "-" : "+";
  const abs = amount < 0n ? -amount : amount;
  return `${sign}${fmt(abs, decimals, maxFrac)}`;
}
