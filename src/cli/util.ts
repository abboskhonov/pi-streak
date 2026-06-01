import { homedir } from "node:os";

export const reset = "\u001b[0m";

export function color(code: string, value: string): string {
  return `\u001b[${code}m${value}${reset}`;
}

export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPath(path: string): string {
  return path.startsWith(`${homedir()}/`) ? path.replace(homedir(), "~") : path;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(1) + "K";
  return String(value);
}

export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[\d+(?:;\d+)*m/g, "");
}

export function padVisual(str: string, length: number, end = true): string {
  const visible = stripAnsi(str);
  const padding = Math.max(0, length - visible.length);
  if (end) return str + " ".repeat(padding);
  return " ".repeat(padding) + str;
}

export function truncateModel(model: string, maxLen: number): string {
  if (model.length <= maxLen) return model;
  const keep = Math.floor((maxLen - 3) / 2);
  return model.slice(0, keep) + "..." + model.slice(-keep);
}
