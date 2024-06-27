import Link from "next/link";

export default async function Home() {
  return (
    <main className="h-screen">
      <div className="flex flex-col text-white">
        <Link href="/profit">Profit -&gt;</Link>
        <Link href="/scanner">Scanner -&gt;</Link>
      </div>
    </main>
  );
}
