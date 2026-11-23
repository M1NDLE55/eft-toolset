"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "@/app/lib/navigation/hooks";
import { QuestsPage, type QuestsInitial } from "./quests-page";

const NO_SEARCH: Record<string, string | string[]> = {};

function FromUrl({ initial }: { initial: QuestsInitial | null }) {
  const params = useSearchParams();
  const query = params.toString();
  const search = useMemo(() => {
    const record: Record<string, string | string[]> = {};
    const read = new URLSearchParams(query);
    for (const key of new Set(read.keys())) {
      const values = read.getAll(key);
      record[key] = values.length === 1 ? values[0] : values;
    }
    return record;
  }, [query]);
  return <QuestsPage initial={initial} search={search} />;
}

/**
 * The quest list with its filters from the URL. The page is cached for everyone, so the server
 * renders the unfiltered list and the browser applies the URL's filters once it hydrates.
 */
export function QuestsPageFromUrl({ initial }: { initial: QuestsInitial | null }) {
  return (
    <Suspense fallback={<QuestsPage initial={initial} search={NO_SEARCH} />}>
      <FromUrl initial={initial} />
    </Suspense>
  );
}
