import { SITE_ORIGIN } from "@/app/lib/site";
import { HOME_DESCRIPTION, SITE_NAME } from "./site-copy";

/**
 * Page metadata: the fields the site's pages set, turned into head tags by `pageHead`. A page's
 * metadata replaces its layouts' field by field (an openGraph object replaces the whole openGraph),
 * relative URLs resolve against the canonical site, and a plain title gets " | EFT Toolset".
 */
export interface Metadata {
  title?: string | { absolute: string } | { default: string; template: string } | null;
  description?: string | null;
  applicationName?: string;
  alternates?: { canonical?: string } | null;
  robots?: { index?: boolean; follow?: boolean } | null;
  openGraph?: OpenGraph | null;
  twitter?: Twitter | null;
}

export interface MetadataImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  type?: string;
}

interface OpenGraph {
  title?: string;
  description?: string;
  url?: string;
  siteName?: string;
  images?: MetadataImage[];
  type?: "website" | "article";
}

interface Twitter {
  card?: "summary" | "summary_large_image";
  title?: string;
  description?: string;
  images?: (string | MetadataImage)[];
}

export interface HeadTags {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
}

const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** The site-wide defaults every page starts from (the root layout's metadata). */
export const ROOT_METADATA: Metadata = {
  title: SITE_NAME,
  description: HOME_DESCRIPTION,
  applicationName: "EFT Toolset",
  openGraph: {
    title: "EFT Toolset",
    description: HOME_DESCRIPTION,
    url: `${SITE_ORIGIN}/`,
    siteName: "EFT Toolset",
    images: [{ url: `${SITE_ORIGIN}/home-og-image.png`, width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EFT Toolset",
    description: HOME_DESCRIPTION,
    images: ["/home-og-image.png"],
  },
};

/** An absolute URL on the canonical site; the site's root resolves without a trailing slash, as Next wrote it. */
export function absoluteUrl(url: string): string {
  const resolved = new URL(url, SITE_ORIGIN).href;
  return resolved === `${SITE_ORIGIN}/` ? SITE_ORIGIN : resolved;
}

/** Where a page's metadata comes from: its ancestors' layouts (outermost first), its own segment's layout, and itself. */
export interface MetadataSources {
  layouts?: (Metadata | null | undefined)[];
  own?: Metadata | null;
  page?: Metadata | null;
}

type Title = NonNullable<Metadata["title"]>;

function applyTemplate(title: Title, template: string | null): string {
  if (typeof title === "string") return template ? template.replace("%s", title) : title;
  return "absolute" in title ? title.absolute : title.default;
}

/** The template a segment hands its children: a plain or absolute title ends the inherited one. */
function templateOf(title: Title): string | null {
  return typeof title === "object" && "template" in title ? title.template : null;
}

/**
 * The title as Next resolved it: each title takes the template of the nearest ancestor segment that
 * set a title, and a page shares its parent's template with its own segment's layout.
 */
function resolveTitle({ layouts = [], own, page }: MetadataSources): string {
  let template: string | null = TITLE_TEMPLATE;
  let title: string = SITE_NAME;
  for (const layout of layouts) {
    if (!layout?.title) continue;
    title = applyTemplate(layout.title, template);
    template = templateOf(layout.title);
  }
  if (own?.title) title = applyTemplate(own.title, template);
  if (page?.title) title = applyTemplate(page.title, template);
  return title;
}

/**
 * Fills the Twitter card from Open Graph where the page left it out (title, description, images,
 * and a card type to suit), then gives both the page's own title and description where they have
 * none: the rules the site's metadata was written against.
 */
function inheritSocial(metadata: Metadata, title: string): Metadata {
  const og = metadata.openGraph ? { ...metadata.openGraph } : null;
  let twitter = metadata.twitter ? { ...metadata.twitter } : null;
  if (og) {
    const fill: Twitter = {};
    if (!twitter?.title) fill.title = og.title || title;
    if (!twitter?.description) fill.description = og.description || metadata.description || undefined;
    if (!twitter?.images) fill.images = og.images;
    if (Object.keys(fill).length) {
      twitter = twitter ? { ...twitter, ...fill } : { ...fill, card: fill.images?.length ? "summary_large_image" : "summary" };
    }
  }
  for (const target of [og, twitter]) {
    if (!target) continue;
    if (!target.title) target.title = title;
    if (!target.description && metadata.description) target.description = metadata.description;
  }
  return { ...metadata, openGraph: og, twitter };
}

/** Head tags for a page. Fields replace those of the layers before them (layouts, then the page). */
export function pageHead(sources: MetadataSources = {}): HeadTags {
  const title = resolveTitle(sources);
  const metadata = inheritSocial(Object.assign({}, ROOT_METADATA, ...[...(sources.layouts ?? []), sources.own, sources.page].filter(Boolean)), title);
  const meta: HeadTags["meta"] = [];
  const links: HeadTags["links"] = [];

  meta.push({ title });
  if (metadata.description) meta.push({ name: "description", content: metadata.description });
  if (metadata.applicationName) meta.push({ name: "application-name", content: metadata.applicationName });
  links.push({ rel: "manifest", href: "/manifest.webmanifest" });
  if (metadata.robots) {
    const parts = [];
    if (metadata.robots.index !== undefined) parts.push(metadata.robots.index ? "index" : "noindex");
    if (metadata.robots.follow !== undefined) parts.push(metadata.robots.follow ? "follow" : "nofollow");
    if (parts.length) meta.push({ name: "robots", content: parts.join(", ") });
  }
  if (metadata.alternates?.canonical) links.push({ rel: "canonical", href: absoluteUrl(metadata.alternates.canonical) });

  const og = metadata.openGraph;
  if (og) {
    if (og.title) meta.push({ property: "og:title", content: og.title });
    if (og.description) meta.push({ property: "og:description", content: og.description });
    if (og.url) meta.push({ property: "og:url", content: absoluteUrl(og.url) });
    if (og.siteName) meta.push({ property: "og:site_name", content: og.siteName });
    for (const image of og.images ?? []) {
      meta.push({ property: "og:image", content: absoluteUrl(image.url) });
      if (image.type) meta.push({ property: "og:image:type", content: image.type });
      if (image.width) meta.push({ property: "og:image:width", content: String(image.width) });
      if (image.height) meta.push({ property: "og:image:height", content: String(image.height) });
      if (image.alt) meta.push({ property: "og:image:alt", content: image.alt });
    }
    if (og.type) meta.push({ property: "og:type", content: og.type });
  }

  const twitter = metadata.twitter;
  if (twitter) {
    if (twitter.card) meta.push({ name: "twitter:card", content: twitter.card });
    if (twitter.title) meta.push({ name: "twitter:title", content: twitter.title });
    if (twitter.description) meta.push({ name: "twitter:description", content: twitter.description });
    for (const entry of twitter.images ?? []) {
      const image = typeof entry === "string" ? { url: entry } : entry;
      meta.push({ name: "twitter:image", content: absoluteUrl(image.url) });
      if (image.alt) meta.push({ name: "twitter:image:alt", content: image.alt });
      if (image.type) meta.push({ name: "twitter:image:type", content: image.type });
      if (image.width) meta.push({ name: "twitter:image:width", content: String(image.width) });
      if (image.height) meta.push({ name: "twitter:image:height", content: String(image.height) });
    }
  }
  return { meta, links };
}
