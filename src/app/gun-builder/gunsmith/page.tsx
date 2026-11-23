import { RenderDataUnavailableError } from "@/app/lib/api/server-render";
import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, breadcrumbList } from "@/app/components/seo/json-ld";
import { GUNSMITH_HUB_DESCRIPTION, GUNSMITH_HUB_NAME, GUNSMITH_HUB_TITLE } from "@/app/lib/seo/gunsmith";
import { SITE_ORIGIN } from "@/app/lib/site";
import type { GunsmithTaskSummary } from "@/app/lib/builds/gunsmith-pages";
import { loadGunsmithTasks } from "./load";

export const revalidate = 21600;
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: GUNSMITH_HUB_TITLE,
  description: GUNSMITH_HUB_DESCRIPTION,
  alternates: { canonical: "/gun-builder/gunsmith" },
  openGraph: {
    title: `${GUNSMITH_HUB_TITLE} | EFT Toolset`,
    description: GUNSMITH_HUB_DESCRIPTION,
    url: "/gun-builder/gunsmith",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
};

const GROUPS: { key: GunsmithTaskSummary["group"]; title: string }[] = [
  { key: "master", title: "Gunsmith Master" },
  { key: "weapon", title: "Gunsmith weapon tasks" },
  { key: "other", title: "Other weapon build tasks" },
];

export default async function Page() {
  const tasks = await loadGunsmithTasks();
  // Fail the render rather than cache an empty list.
  if (!tasks) throw new RenderDataUnavailableError("Gunsmith list");
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <JsonLd
        data={breadcrumbList([
          { name: "EFT Toolset", path: "/" },
          { name: "Gun builder", path: "/gun-builder" },
          { name: GUNSMITH_HUB_NAME, path: "/gun-builder/gunsmith" },
        ])}
      />
      {tasks.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: GUNSMITH_HUB_NAME,
            itemListElement: tasks.map((task, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: `${task.name} build`,
              url: `${SITE_ORIGIN}/gun-builder/gunsmith/${task.slug}`,
            })),
          }}
        />
      )}
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">Tarkov Gunsmith builds</h1>
        <p className="max-w-3xl text-sm text-[#999]">
          A ready build for every Gunsmith task, worked out by the{" "}
          <Link href="/gun-builder" className="text-[#c8b384] underline underline-offset-2">
            gun builder
          </Link>{" "}
          and checked against the task&apos;s requirements: ergonomics, recoil, weight, magazine, sighting range and
          required parts. Each part has a live price, and every build opens in the gun builder.
        </p>
      </header>
      {tasks.length === 0 && (
        <p className="border border-dashed border-[#2a2a2a] p-6 text-center text-sm text-[#888]">
          The task list is temporarily unavailable. Try again in a moment.
        </p>
      )}
      {GROUPS.map((group) => {
        const list = tasks.filter((task) => task.group === group.key);
        if (list.length === 0) return null;
        return (
          <section key={group.key} aria-labelledby={`group-${group.key}`} className="flex flex-col gap-3">
            <h2 id={`group-${group.key}`} className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
              {group.title}
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((task) => (
                <li key={task.slug}>
                  <Link
                    href={`/gun-builder/gunsmith/${task.slug}`}
                    className="group flex flex-col gap-0.5 border border-[#1a1a1a] bg-[#0c0c0c] p-3 transition-colors hover:border-[#9a8866]"
                  >
                    <span className="text-sm font-semibold text-[#ddd] group-hover:text-[#e6d9b8]">{task.name}</span>
                    <span className="text-xs text-[#777]">
                      {task.weapons.join(", ")}
                      {task.trader && ` · ${task.trader}`}
                      {task.minPlayerLevel > 0 && ` · level ${task.minPlayerLevel}`}
                      {task.faction && ` · ${task.faction} only`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
