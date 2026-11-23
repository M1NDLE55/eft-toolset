import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MapStageSkeleton } from "@/app/components/raid-planner/map-chrome";
import type { Metadata } from "@/app/lib/seo/metadata";

/** The frame of the reference pages: ammo, keys and quests. */
export function ReferenceFrame({ children }: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-1 justify-center p-4 pb-10">{children}</main>;
}

/** The frame of the PVE flea market page. */
export function FleaMarketFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 justify-center px-4 pb-10 pt-4">
      <div className="flex w-full max-w-2xl flex-col gap-5">{children}</div>
    </main>
  );
}

/** Shown while an item group opens. */
export function ItemGroupSkeleton() {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Shown while a raid plan or map opens. */
export function MapLoading() {
  return <MapStageSkeleton>Loading map</MapStageSkeleton>;
}

/** Pages about one saved thing (a build, plan, group or share link): never indexed. */
export const PRIVATE_PAGE_METADATA: Metadata = { robots: { index: false, follow: false } };
