import type { Metadata } from "next";
import { HomeScreen } from "@/app/components/home/home-screen";
import { HomeDirectory } from "@/app/components/home/home-directory";
import { JsonLd } from "@/app/components/seo/json-ld";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME } from "@/app/lib/seo/site-copy";
import { SITE_ORIGIN } from "@/app/lib/site";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    images: [{ url: "/home-og-image.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION, images: ["/home-og-image.png"] },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      name: SITE_NAME,
      alternateName: ["EFT-Toolset", "eft-toolset.com"],
      url: `${SITE_ORIGIN}/`,
      description: HOME_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/black-logo.svg`,
      sameAs: ["https://github.com/M1NDLE55/eft-toolset"],
    },
  ],
};

export default function Home() {
  return (
    <>
      <JsonLd data={structuredData} />
      <HomeScreen>
        <HomeDirectory />
      </HomeScreen>
    </>
  );
}
