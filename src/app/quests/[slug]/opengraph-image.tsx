import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { getQuestDetail, releaseOperationSlot, runTarkovRead, tryAcquireOperationSlot } from "@/app/lib/api/tarkov-server";
import { isItemSlug } from "@/app/lib/item-links";
import { findQuestDetail } from "@/app/lib/quests/detail-lookup";
import type { QuestDetail } from "@/app/lib/quests/types";
import { loadOgIcon, OG_CACHE_CONTROL, questOgContent, type QuestOgContent } from "@/app/lib/seo/quest-og";

export const alt = "Escape from Tarkov quest: trader, maps, level and the keys or items it needs, on EFT Toolset";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Crawlers fetch the image soon after the page, so the quest is usually in the server's cache by then.
const DATA_TIMEOUT_MS = 6_000;

const GOLD = "#c8b384";
const HEADING = "#e6d9b8";
const MUTED = "#888";
const BORDER = "#2a2a2a";

// The site's font (Inter, as next/font serves it from Google Fonts), kept in the repo as TTF: the image renderer
// can't read WOFF2, and the image shouldn't depend on Google at request time. Latin subset, three weights.
const fonts = Promise.all(
  (
    [
      ["Inter-Regular.ttf", 400],
      ["Inter-Bold.ttf", 700],
      ["Inter-Black.ttf", 900],
    ] as const
  ).map(async ([file, weight]) => ({
    name: "Inter",
    data: await readFile(join(process.cwd(), "assets/fonts", file)),
    weight,
    style: "normal" as const,
  }))
).catch((error) => {
  // Without them the image still renders, in the renderer's own font.
  console.warn("Share image fonts unavailable:", error instanceof Error ? error.message : error);
  return [];
});

/**
 * The quest in PVP, or in PVE for a quest only it has. Crawlers have no game mode cookie, and one
 * image per quest keeps it cacheable. undefined: couldn't be read in time; null: no such quest.
 */
async function loadQuest(slug: string): Promise<QuestDetail | null | undefined> {
  if (!tryAcquireOperationSlot()) return undefined;
  try {
    return await runTarkovRead(() => findQuestDetail("regular", slug, getQuestDetail), { signal: AbortSignal.timeout(DATA_TIMEOUT_MS) });
  } catch (error) {
    console.warn(`Share image for quest ${slug} rendered without its data:`, error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    releaseOperationSlot();
  }
}

function Frame({ children, footer, footerRight }: { children: ReactNode; footer: string; footerRight: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: size.width,
        height: size.height,
        backgroundColor: "#070707",
        borderTop: "6px solid #9a8866",
        padding: "40px 64px 40px",
        fontFamily: "Inter",
        color: "#ccc",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 20, fontWeight: 700, letterSpacing: 5, textTransform: "uppercase" }}>
        <span style={{ color: GOLD }}>EFT Toolset</span>
        <span style={{ color: "#444", margin: "0 16px" }}>/</span>
        <span style={{ color: MUTED }}>Quest guide</span>
      </div>
      {children}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 20, color: MUTED }}>
        <span>{footer}</span>
        <span>{footerRight}</span>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${BORDER}`, backgroundColor: "#0c0c0c", padding: "10px 16px" }}>
      <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: MUTED, marginRight: 12 }}>{label}</span>
      <span style={{ fontSize: 24, color: "#ddd" }}>{value}</span>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid #3a3326",
        backgroundColor: "#1a1610",
        color: GOLD,
        padding: "10px 14px",
        fontSize: 17,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

const sectionHeading = { fontSize: 16, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#9a8866", marginBottom: 14 } as const;

// Fewer items get wider tiles and bigger icons; four share the row.
const TILE = { 1: [720, 104], 2: [528, 104], 3: [346, 96], 4: [256, 88] } as const;

function Items({ items, icons }: { items: NonNullable<QuestOgContent["items"]>; icons: (string | null)[] }) {
  const [width, box] = TILE[Math.min(Math.max(items.entries.length, 1), 4) as keyof typeof TILE];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", ...sectionHeading }}>
        {items.title}
        {items.more > 0 && <span style={{ color: MUTED, marginLeft: 14 }}>+{items.more} more</span>}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {items.entries.map((entry, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", width, gap: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                width: box,
                height: box,
                border: `1px solid ${BORDER}`,
                backgroundColor: "#0c0c0c",
              }}
            >
              {icons[index] && <img src={icons[index]} alt="" width={box - 8} height={box - 8} style={{ objectFit: "contain" }} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", width: width - box - 16, gap: 6 }}>
              <span style={{ fontSize: width > 400 ? 24 : 19, lineHeight: 1.25, color: "#ddd" }}>{entry.name}</span>
              {(entry.count !== null || entry.foundInRaid) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {entry.count !== null && <span style={{ fontSize: 20, fontWeight: 700, color: HEADING }}>×{entry.count.toLocaleString("en-US")}</span>}
                  {entry.foundInRaid && (
                    <span style={{ border: "1px solid #3a3326", backgroundColor: "#1a1610", color: GOLD, fontSize: 13, fontWeight: 700, letterSpacing: 2, padding: "2px 6px" }}>FIR</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rewards({ rewards }: { rewards: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", ...sectionHeading }}>Rewards</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {rewards.map((reward) => (
          <span key={reward} style={{ border: `1px solid ${BORDER}`, backgroundColor: "#0c0c0c", padding: "8px 14px", fontSize: 20, color: "#ccc" }}>
            {reward}
          </span>
        ))}
      </div>
    </div>
  );
}

function QuestImage({ content, icons }: { content: QuestOgContent; icons: (string | null)[] }) {
  return (
    <Frame footer={content.facts.join("  ·  ")} footerRight="eft-toolset.com">
      <div
        style={{
          display: "flex",
          marginTop: 26,
          fontSize: content.nameSize,
          fontWeight: 900,
          lineHeight: 1.06,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: HEADING,
        }}
      >
        {content.name}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 26 }}>
        {content.trader && <Chip label="Trader" value={content.trader} />}
        {content.maps.length > 0 && <Chip label={content.maps.length > 1 ? "Maps" : "Map"} value={content.maps.join(", ")} />}
        {content.level !== null && <Chip label="Min level" value={String(content.level)} />}
        {content.badges.map((badge) => (
          <Badge key={badge}>{badge}</Badge>
        ))}
      </div>
      <div style={{ display: "flex", flexGrow: 1 }} />
      {content.items ? <Items items={content.items} icons={icons} /> : content.rewards.length > 0 && <Rewards rewards={content.rewards} />}
      <div style={{ display: "flex", height: 28 }} />
    </Frame>
  );
}

/** A branded stand-in for when the quest is unknown or its data couldn't be read in time. */
function FallbackImage() {
  return (
    <Frame footer="" footerRight="eft-toolset.com/quests">
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: HEADING }}>Tarkov quests</div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 30, color: MUTED, maxWidth: 900, lineHeight: 1.35 }}>
          Every Escape from Tarkov quest: objectives, keys, items to hand over, rewards and chains.
        </div>
      </div>
    </Frame>
  );
}

async function render(element: ReactElement, cacheControl: string, status = 200) {
  return new ImageResponse(element, { ...size, fonts: await fonts, status, headers: { "Cache-Control": cacheControl } });
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // A 404 for unknown quests, so nothing caches or shows it as theirs; still an image, for whatever asked.
  if (!isItemSlug(slug)) return render(<FallbackImage />, OG_CACHE_CONTROL.notFound, 404);
  const detail = await loadQuest(slug);
  if (detail === null) return render(<FallbackImage />, OG_CACHE_CONTROL.notFound, 404);
  if (detail === undefined) return render(<FallbackImage />, OG_CACHE_CONTROL.unavailable);
  const content = questOgContent(detail);
  const icons = await Promise.all((content.items?.entries ?? []).map((entry) => loadOgIcon(entry.image)));
  return render(<QuestImage content={content} icons={icons} />, OG_CACHE_CONTROL.quest);
}
