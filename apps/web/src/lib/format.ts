import type { ScoreSummary } from "@/lib/types";

export function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatCountPair(first: number, second: number): string {
  return `${first} / ${second}`;
}

export function formatScore(value: number | null | undefined): string {
  return value == null ? "N/A" : value.toFixed(1);
}

export function formatScoreSummary(summary: ScoreSummary): string {
  if (summary.average == null || summary.values.length === 0) {
    return "N/A";
  }

  const values = summary.values.map((value) => value.toFixed(1)).join(" / ");
  return `${summary.average.toFixed(1)} (${values})`;
}

export function formatLastSync(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) {
    return "Not synced yet";
  }

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.valueOf())) {
    return isoTimestamp;
  }

  return parsed.toLocaleString();
}

export function percent(part: number, whole: number): number {
  if (!whole) {
    return 0;
  }

  return Math.round((part / whole) * 100);
}
