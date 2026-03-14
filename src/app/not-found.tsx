import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 min-h-[calc(100vh-130px)]">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-[#000] text-[10px] font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          Error 404
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          NOT FOUND
        </h1>
        <p className="text-[11px] text-[#555] uppercase tracking-[0.3em] font-bold">
          The page you&apos;re looking for doesn&apos;t exist
        </p>
      </div>
      <Link
        href={{ pathname: "/" }}
        className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-[#000] transition-colors px-6 py-2 text-xs uppercase tracking-widest font-bold"
      >
        Return to Base
      </Link>
    </main>
  );
}
