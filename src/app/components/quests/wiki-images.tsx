"use client";

import { useState } from "react";
import { ExternalLink, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useHydrated } from "@/app/lib/storage/use-store";
import { imageCreditParts, wikiImageUrl, type QuestWikiImage } from "@/app/lib/wiki/wiki-images";
import { cn } from "@/lib/utils";

const link = "text-[#b9a473] underline-offset-2 hover:underline";

function fileName(image: QuestWikiImage) {
  return image.file.replace(/_/g, " ");
}

/** The image's credit line, linking its file page and the licence. */
export function WikiImageCredit({ image, className }: { image: QuestWikiImage; className?: string }) {
  return (
    <span className={cn("text-[11px] text-[#777] [overflow-wrap:anywhere]", className)}>
      {imageCreditParts(image).map((part, index) =>
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

function WikiLinkInstead({ image, className }: { image: QuestWikiImage; className?: string }) {
  return (
    <a
      href={image.filePage}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex min-h-20 items-center justify-center gap-1 border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-4 text-sm text-[#c8b384] underline-offset-2 hover:underline",
        className
      )}
    >
      View on the EFT Wiki <ExternalLink aria-hidden className="h-3.5 w-3.5" />
    </a>
  );
}

function WikiFigure({ image }: { image: QuestWikiImage }) {
  const [failed, setFailed] = useState(false);
  const src = wikiImageUrl(image);
  const alt = image.caption ?? fileName(image);
  const title = image.caption ?? fileName(image);
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      {failed ? (
        <WikiLinkInstead image={image} />
      ) : (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Enlarge image: ${title}`}
              className="group relative flex cursor-zoom-in items-center justify-center overflow-hidden border border-[#1f1f1f] bg-[#0c0c0c] focus-visible:outline-2 focus-visible:outline-[#c8b384]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- loaded by the visitor's browser from the wiki, never through our server */}
              <img
                src={src}
                alt={alt}
                loading="lazy"
                decoding="async"
                referrerPolicy="strict-origin-when-cross-origin"
                onError={() => setFailed(true)}
                className="block h-auto max-h-80 w-auto max-w-full object-contain"
              />
              <Maximize2
                aria-hidden
                className="absolute right-1.5 bottom-1.5 h-5 w-5 bg-black/60 p-0.5 text-[#ddd] opacity-70 group-hover:opacity-100"
              />
            </button>
          </DialogTrigger>
          <DialogContent
            className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-2 border-[#2a2a2a] bg-[#080808] p-2 pt-12 sm:w-[calc(100vw-2rem)] sm:p-3 sm:pt-12"
            closeClassName="right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-[#555] bg-[#1a1a1a] text-[#eee] opacity-100 hover:border-[#c8b384] hover:bg-[#2a2a2a] focus:ring-[#c8b384] focus:ring-offset-[#080808] data-[state=open]:bg-[#1a1a1a] data-[state=open]:text-[#eee] [&_svg]:h-5 [&_svg]:w-5"
          >
            <DialogTitle className="absolute top-4 right-14 left-3 truncate text-sm font-semibold text-[#ddd]">{title}</DialogTitle>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element -- loaded by the visitor's browser from the wiki, never through our server */}
              <img
                src={src}
                alt={alt}
                decoding="async"
                referrerPolicy="strict-origin-when-cross-origin"
                onError={() => setFailed(true)}
                className="block h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full object-contain"
              />
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
      <figcaption className="flex flex-col gap-0.5">
        {image.caption && <span className="text-xs text-[#bbb] [overflow-wrap:anywhere]">{image.caption}</span>}
        <WikiImageCredit image={image} />
      </figcaption>
    </figure>
  );
}

/**
 * Images from a quest's EFT Wiki page. They render only after mount, so the server's HTML holds no image
 * URL: the visitor's browser builds it and loads the image straight from the wiki.
 */
export function WikiImages({ images, title, className }: { images: QuestWikiImage[]; title?: string; className?: string }) {
  const hydrated = useHydrated();
  if (!hydrated || images.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {title && <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#777]">{title}</h3>}
      <div className={cn("grid grid-cols-1 gap-3", images.length > 1 && "sm:grid-cols-2")}>
        {images.map((image, index) => (
          <WikiFigure key={`${image.file}-${index}`} image={image} />
        ))}
      </div>
    </div>
  );
}
