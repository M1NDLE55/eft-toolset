import SearchItem from "../components/item/SearchItem";

export const metadata = {
  title: "Item Scanner | EFT Toolset",
  description: "View details of any item in Escape From Tarkov",
  openGraph: {
    title: "Item Scanner | EFT Toolset",
    description: "View details of any item in Escape From Tarkov",
    url: "https://tarkov.webdevewan.com/item",
    siteName: "Item Scanner | EFT Toolset",
    images: [
      {
        url: "https://tarkov.webdevewan.com/item-scanner-og.png",
        height: 1200,
        width: 630,
      },
    ],
    type: "website",
  },
};

export default function Page() {
  return (
    <h1 className="absolute -top-10 -left-10">
      Find information on any item in Escape From Tarkov
    </h1>
  );
}
