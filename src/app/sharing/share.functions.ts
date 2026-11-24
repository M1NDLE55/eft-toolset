import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { sharePreview } from "./share.server";

/** The /s/ page's data, read on the server so link unfurls get the name and summary. Never cached. */
export const fetchSharePreview = createServerFn({ method: "GET" })
  .validator((input: { code: string }) => ({ code: String(input.code).slice(0, 32) }))
  .handler(async ({ data }) => sharePreview(getRequest(), data.code));
