"use client";

import Link from "@/app/lib/navigation/link";
import { usePublicPathname } from "@/components/game-mode/use-public-pathname";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { isItemSlug, itemHref } from "@/app/lib/item-links";
import type { QuestIdentity } from "@/app/lib/item-needs";
import { isPlainClick } from "./plain-click";
import { ItemRundownPopup, type RundownTarget } from "./rundown-popup";

export { isPlainClick };

type OpenRundown = (target: RundownTarget) => void;

const OpenContext = createContext<OpenRundown | null>(null);
const QuestContext = createContext<QuestIdentity | null>(null);

/** Shows one item rundown at a time, for the item links inside it. */
export function ItemRundownProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<RundownTarget | null>(null);
  const pathname = usePublicPathname();
  const [shownOn, setShownOn] = useState(pathname);
  // Leaving the page closes it.
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setTarget(null);
  }
  return (
    <OpenContext.Provider value={setTarget}>
      {children}
      {target && <ItemRundownPopup key={target.id} target={target} onClose={() => setTarget(null)} />}
    </OpenContext.Provider>
  );
}

/** Tells the item links inside it which quest the page is about, so the rundown shows that quest's need first. */
export function ItemRundownQuest({ quest, children }: { quest: QuestIdentity; children: ReactNode }) {
  return <QuestContext.Provider value={quest}>{children}</QuestContext.Provider>;
}

let nextId = 0;

type ItemRundownLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  item: { name: string; normalizedName?: string | null };
};

/**
 * A link to an item's page. A plain click shows the item's rundown in place; modified and middle clicks,
 * and pages without JavaScript, follow the link as usual.
 */
export function ItemRundownLink({ item, onClick, children, ...props }: ItemRundownLinkProps) {
  const open = useContext(OpenContext);
  const quest = useContext(QuestContext);
  const pathname = usePublicPathname();
  const href = itemHref(item);
  return (
    <Link
      // A plain click shows the rundown, so loading the page ahead would mostly be wasted.
      prefetch={false}
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        // On the item's own page, the link does what it always did.
        if (!open || !isPlainClick(event) || (props.target && props.target !== "_self") || href === pathname) return;
        event.preventDefault();
        const slug = item.normalizedName && isItemSlug(item.normalizedName) ? item.normalizedName : null;
        nextId += 1;
        open({
          id: nextId,
          reference: slug ? { slug } : { name: item.name },
          name: item.name,
          href,
          anchor: event.currentTarget,
          quest,
        });
      }}
    >
      {children}
    </Link>
  );
}
