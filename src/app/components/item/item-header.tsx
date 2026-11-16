import Image from "next/image";
import { ExternalLink } from "lucide-react";
import Share from "./share";
import type { ComposedItem } from "@/app/lib/cache/types";

/** The item's name, picture, and size: always shown, whatever the view. */
export function ItemHeader({ item }: { item: ComposedItem }) {
  const buildSize =
    item.weapon?.defaultWidth && item.weapon.defaultHeight
      ? `${item.weapon.defaultWidth}×${item.weapon.defaultHeight}`
      : null;
  return (
    <div className="flex items-center gap-3 border border-[#1a1a1a] bg-[#0c0c0c] p-3">
      {item.gridImageLink && (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-[#111] sm:h-16 sm:w-16">
          <Image
            src={item.gridImageLink}
            alt=""
            width={64 * item.width}
            height={64 * item.height}
            priority
            className="h-auto max-h-14 w-auto max-w-14 object-contain sm:max-h-16 sm:max-w-16"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="text-lg font-semibold leading-tight text-[#eee] sm:text-xl">{item.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#999]">
          {item.shortName && item.shortName !== item.name && (
            <span className="border border-[#2a2a2a] px-1.5 py-0.5 uppercase tracking-wider">{item.shortName}</span>
          )}
          <span className="border border-[#2a2a2a] px-1.5 py-0.5 tabular-nums">
            {item.width}×{item.height}
            {item.weapon && " stripped"}
          </span>
          {buildSize && <span className="border border-[#2a2a2a] px-1.5 py-0.5 tabular-nums">{buildSize} default build</span>}
          {item.wikiLink && (
            <a
              href={item.wikiLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#d4b86a] underline-offset-2 hover:underline"
            >
              Wiki <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <div className="shrink-0 self-start">
        <Share title={item.name} />
      </div>
    </div>
  );
}
