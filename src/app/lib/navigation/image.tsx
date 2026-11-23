import type { CSSProperties, ImgHTMLAttributes, Ref } from "react";

export type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  /** Fill the positioned parent instead of taking width and height. */
  fill?: boolean;
  /** Load early (above the fold). */
  priority?: boolean;
  /** Accepted for compatibility: images are served as they are. */
  unoptimized?: boolean;
  quality?: number;
  ref?: Ref<HTMLImageElement>;
};

const FILL_STYLE: CSSProperties = { position: "absolute", height: "100%", width: "100%", inset: 0, color: "transparent" };

/**
 * An image served unchanged from its source (tarkov.dev's CDN or this site), lazy unless
 * `priority`. Same attributes as before the port, so layout and styles carry over.
 */
export default function Image({ src, alt, width, height, fill, priority, unoptimized: _unoptimized, quality: _quality, style, loading, decoding, ref, ...rest }: ImageProps) {
  return (
    <img
      {...rest}
      ref={ref}
      alt={alt}
      src={src}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? undefined : (loading ?? "lazy")}
      fetchPriority={priority ? "high" : rest.fetchPriority}
      decoding={decoding ?? "async"}
      style={fill ? { ...FILL_STYLE, ...style } : { color: "transparent", ...style }}
    />
  );
}
