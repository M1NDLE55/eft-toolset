import { setResponseHeader } from "@tanstack/react-start/server";
import { EDGE_TTL_HEADER } from "./edge-cache";

/** Marks the current server-function response as cacheable at the edge for that many seconds. */
export function cacheAtEdge(seconds: number) {
  setResponseHeader(EDGE_TTL_HEADER, String(seconds));
}
