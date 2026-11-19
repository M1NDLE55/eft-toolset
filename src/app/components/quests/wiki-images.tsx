"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useHydrated } from "@/app/lib/storage/use-store";
import {
  imageCreditParts,
  imagesCreditParts,
  wikiImageUrl,
  wikiThumbSrcSet,
  wikiThumbUrl,
  WIKI_THUMB_WIDTHS,
  type CreditPart,
  type QuestWikiImage,
} from "@/app/lib/wiki/wiki-images";
import { cn } from "@/lib/utils";

const link = "text-[#b9a473] underline-offset-2 hover:underline";

/** How long to wait before each new try of an image that failed to load; then it gives up. */
export const IMAGE_RETRY_DELAYS_MS = [800, 2_000];

/**
 * The grid's columns: two on a phone, three from `sm` in a page at most 48rem wide. The browser picks the
 * srcset width from this and the screen's density.
 */
const THUMB_SIZES = "(min-width: 640px) 256px, 50vw";

function fileName(image: QuestWikiImage) {
  return image.file.replace(/_/g, " ");
}

function Credit({ parts, className }: { parts: CreditPart[]; className?: string }) {
  return (
    <span className={cn("text-2xs text-[#777] [overflow-wrap:anywhere]", className)}>
      {parts.map((part, index) =>
        part.href ? (
          <a key={index} href={part.href} target="_blank" rel={part.license ? "license noopener noreferrer" : "noopener noreferrer"} className={link}>
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  );
}

/** The image's credit line, linking its file page and the licence. */
export function WikiImageCredit({ image, className }: { image: QuestWikiImage; className?: string }) {
  return <Credit parts={imageCreditParts(image)} className={className} />;
}

function WikiLinkInstead({ image, className }: { image: QuestWikiImage; className?: string }) {
  return (
    <a
      href={image.filePage}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center justify-center gap-1 border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-3 text-center text-xs text-[#c8b384] underline-offset-2 hover:underline",
        className
      )}
    >
      View on the EFT Wiki <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

/**
 * An image load that tries again, after a short wait, when it fails: a first visit can see the CDN turn away
 * several images at once that load fine moments later. Each try mounts a new <img> with the same URL (the CDN
 * takes no query string to tell tries apart); after the last, `failed` is set.
 */
function useRetryingLoad() {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onError = () => {
    // A second error while waiting (a srcset candidate swapped, say) is the same failure.
    if (waiting) return;
    if (attempt >= IMAGE_RETRY_DELAYS_MS.length) {
      setFailed(true);
      return;
    }
    setWaiting(true);
    timer.current = setTimeout(() => {
      setWaiting(false);
      setAttempt(attempt + 1);
    }, IMAGE_RETRY_DELAYS_MS[attempt]);
  };
  return { attempt, waiting, failed, onError };
}

function EnlargedImage({ image, alt }: { image: QuestWikiImage; alt: string }) {
  const load = useRetryingLoad();
  if (load.failed) return <WikiLinkInstead image={image} className="min-h-40 w-full max-w-md" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- loaded by the visitor's browser from the wiki, never through our server
    <img
      key={load.attempt}
      src={wikiImageUrl(image)}
      alt={alt}
      decoding="async"
      referrerPolicy="strict-origin-when-cross-origin"
      onError={load.onError}
      className={cn("block h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full object-contain", load.waiting && "invisible")}
    />
  );
}

function WikiFigure({ image }: { image: QuestWikiImage }) {
  const load = useRetryingLoad();
  const [open, setOpen] = useState(false);
  const title = image.caption ?? fileName(image);
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      {/* An open dialog stays: it loads the original on its own, and swapping it out would drop the reader's focus. */}
      {load.failed && !open ? (
        <WikiLinkInstead image={image} className="aspect-[4/3] w-full" />
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Enlarge image: ${title}`}
              className="group relative flex aspect-[4/3] w-full cursor-zoom-in items-center justify-center overflow-hidden border border-[#1f1f1f] bg-[#0c0c0c] focus-visible:outline-2 focus-visible:outline-[#c8b384]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- loaded by the visitor's browser from the wiki, never through our server */}
              <img
                key={load.attempt}
                src={wikiThumbUrl(image, WIKI_THUMB_WIDTHS[0])}
                srcSet={wikiThumbSrcSet(image)}
                sizes={THUMB_SIZES}
                alt={title}
                loading="lazy"
                decoding="async"
                referrerPolicy="strict-origin-when-cross-origin"
                onError={load.onError}
                className={cn("block h-full w-full object-contain", load.waiting && "invisible")}
              />
              <Maximize2
                aria-hidden
                className="absolute right-1 bottom-1 h-5 w-5 bg-black/60 p-0.5 text-[#ddd] opacity-70 group-hover:opacity-100"
              />
            </button>
          </DialogTrigger>
          <DialogContent
            className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-2 border-[#2a2a2a] bg-[#080808] p-2 pt-12 sm:w-[calc(100vw-2rem)] sm:p-3 sm:pt-12"
            closeClassName="right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-[#555] bg-[#1a1a1a] text-[#eee] opacity-100 hover:border-[#c8b384] hover:bg-[#2a2a2a] focus:ring-[#c8b384] focus:ring-offset-[#080808] data-[state=open]:bg-[#1a1a1a] data-[state=open]:text-[#eee] [&_svg]:h-5 [&_svg]:w-5"
          >
            <DialogTitle className="absolute top-4 right-14 left-3 truncate text-sm font-semibold text-[#ddd]">{title}</DialogTitle>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              <EnlargedImage image={image} alt={title} />
            </div>
            <DialogDescription asChild>
              <p className="flex flex-col gap-0.5">
                {image.caption && <span className="text-xs text-[#bbb]">{image.caption}</span>}
                <WikiImageCredit image={image} />
              </p>
            </DialogDescription>
          </DialogContent>
        </Dialog>
      )}
      {image.caption && <figcaption className="line-clamp-2 text-xs text-[#bbb] [overflow-wrap:anywhere]">{image.caption}</figcaption>}
    </figure>
  );
}

/**
 * Images from a quest's EFT Wiki page as a compact grid of thumbnails, each opening the full image, with one
 * credit line for them all. They render only after mount, so the server's HTML holds no image URL: the visitor's
 * browser builds it and loads the image straight from the wiki.
 */
export function WikiImages({
  images,
  title,
  titleAs: Title = "h3",
  className,
}: {
  images: QuestWikiImage[];
  title?: string;
  titleAs?: "h3" | "h4";
  className?: string;
}) {
  const hydrated = useHydrated();
  if (!hydrated || images.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {title && <Title className="text-3xs font-bold uppercase tracking-widest text-[#777]">{title}</Title>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image, index) => (
          <WikiFigure key={`${image.file}-${index}`} image={image} />
        ))}
      </div>
      <Credit parts={imagesCreditParts(images)} />
    </div>
  );
}

/** The images no objective clearly shows, in a strip right under the objectives, grouped by where the wiki has them. */
export function WikiImageStrip({ groups }: { groups: { label: string | null; images: QuestWikiImage[] }[] }) {
  const hydrated = useHydrated();
  const headingId = useId();
  if (!hydrated || groups.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-1 flex flex-col gap-3">
      <h3 id={headingId} className="text-3xs font-bold uppercase tracking-widest text-[#777]">
        From the EFT Wiki
      </h3>
      {groups.map((group, index) => (
        <WikiImages key={`${group.label ?? ""}-${index}`} images={group.images} title={group.label ?? undefined} titleAs="h4" />
      ))}
    </section>
  );
}
