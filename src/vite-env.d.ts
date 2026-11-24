/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by vite.config.ts: names the build for the edge page cache. */
  readonly EFT_BUILD_ID?: string;
  /** Set by vite.config.ts: true only in bundles built with EFT_LOCAL_E2E=1 for local end-to-end runs. */
  readonly EFT_LOCAL_E2E?: boolean;
}
