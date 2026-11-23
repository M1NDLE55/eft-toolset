import { useRouter } from "@tanstack/react-router";
import { navigateTo, preloadPath } from "./hooks";
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";

type UrlObject = { pathname?: string; query?: Record<string, string>; hash?: string };

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | UrlObject;
  /** Replace the current history entry instead of adding one. */
  replace?: boolean;
  /** Load the target's data on hover and focus (the default) or not at all. */
  prefetch?: boolean | null;
  /** Keep the scroll position instead of scrolling to the top. */
  scroll?: boolean;
  ref?: Ref<HTMLAnchorElement>;
};

export function hrefString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const query = href.query ? new URLSearchParams(href.query).toString() : "";
  return `${href.pathname ?? ""}${query ? `?${query}` : ""}${href.hash ? `#${href.hash.replace(/^#/, "")}` : ""}`;
}

function isInternal(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

function opensElsewhere(event: MouseEvent<HTMLAnchorElement>) {
  const target = event.currentTarget.getAttribute("target");
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== null && target !== "_self") ||
    event.currentTarget.hasAttribute("download")
  );
}

/**
 * An anchor that navigates inside the app without a page load. Internal links load their route's
 * data on hover or focus unless `prefetch` is false; anything else is a plain anchor.
 */
export default function Link({ href, replace, prefetch, scroll = true, onClick, onMouseEnter, onFocus, onTouchStart, ref, ...rest }: LinkProps) {
  const router = useRouter();
  const url = hrefString(href);
  const internal = isInternal(url);
  const preload = () => {
    if (internal && prefetch !== false) void preloadPath(router, url).catch(() => undefined);
  };
  return (
    <a
      {...rest}
      ref={ref}
      href={url}
      onClick={(event) => {
        onClick?.(event);
        if (!internal || opensElsewhere(event)) return;
        event.preventDefault();
        void navigateTo(router, url, { replace, resetScroll: scroll });
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        preload();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        preload();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        preload();
      }}
    />
  );
}
