import { SITE_ORIGIN } from "@/app/lib/site";

/**
 * Sent with every server request to tarkov.dev and the wiki, so their operators can see who
 * is calling and how to reach us.
 */
export const USER_AGENT = `EFT-Toolset/1.0 (+${SITE_ORIGIN}; https://github.com/M1NDLE55/eft-toolset/issues)`;
