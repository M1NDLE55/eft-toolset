import SearchItem from "../components/item/SearchItem";

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
