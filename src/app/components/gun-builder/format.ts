import { Rubles } from "@/app/lib/currency";

export function formatErgo(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function formatRecoilModifier(value: number) {
  const percent = Math.round(value * 1000) / 10;
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export function formatRub(value: number | null) {
  return value === null ? "—" : Rubles.format(Math.round(value));
}

export function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export function modeLabel(gameMode: string) {
  return gameMode === "pve" ? "PVE" : "PVP";
}
