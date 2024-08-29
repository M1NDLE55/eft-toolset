import SearchItem from "../components/item/search/SearchItem";
import { getParam } from "../components/item/functions";

export async function generateMetadata({ params }) {
  const { paramItemName } = getParam(params);

  return {
    title: "Item Scanner | EFT Toolset",
    description: "View details of any item in Escape From Tarkov",
    openGraph: {
      title: "Item Scanner | EFT Toolset",
      description: "View details of any item in Escape From Tarkov",
      url: `https://www.eft-toolset.com/item${
        paramItemName ? `/${paramItemName}` : ""
      }`,
      siteName: "Item Scanner | EFT Toolset",
      images: [
        {
          url: "https://www.eft-toolset.com/item-scanner-og.png",
          height: 1200,
          width: 630,
        },
      ],
      type: "website",
    },
  };
}

export default function Layout({ children }) {
  return (
    <main className="flex justify-center p-4 sm:min-h-[calc(100vh-128px)] min-h-[calc(100vh-64px)]">
      <div className="max-w-xl w-full flex flex-col gap-4">
        <SearchItem />
        {children}
      </div>
    </main>
  );
}
