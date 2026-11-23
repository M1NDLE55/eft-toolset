/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by vite.config.ts: names the build for the edge page cache. */
  readonly EFT_BUILD_ID?: string;
}
