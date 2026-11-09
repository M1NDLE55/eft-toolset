import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EFT Toolset",
    short_name: "EFT Toolset",
    description: "Fast tools for Escape from Tarkov: item prices, watchlists, gun builds, and raid plans.",
    start_url: "/",
    display: "standalone",
    background_color: "#070707",
    theme_color: "#070707",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
