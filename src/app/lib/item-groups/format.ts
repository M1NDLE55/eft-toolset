import { Rubles } from "@/app/lib/currency";
import { escapeDiscordText } from "@/app/lib/text-safety";

export interface PriceListRow {
  name: string;
  price: number | null;
  vendor: string | null;
}

export function formatGroupPriceList(name: string, rows: readonly PriceListRow[], total: number) {
  const lines = rows.map((row) =>
    row.price !== null
      ? `• ${escapeDiscordText(row.name)} — ${Rubles.format(row.price)} (${escapeDiscordText(row.vendor ?? "")})`
      : `• ${escapeDiscordText(row.name)} — no buyer`
  );
  return [`**${escapeDiscordText(name)}**`, ...lines, total > 0 ? `Total: ${Rubles.format(total)}` : ""]
    .filter(Boolean)
    .join("\n");
}
