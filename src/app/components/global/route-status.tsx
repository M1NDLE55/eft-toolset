import { useEffect } from "react";
import { useRouter as useTanStackRouter, type ErrorComponentProps } from "@tanstack/react-router";
import Link from "@/app/lib/navigation/link";

/** The page for an unknown URL or a missing item, quest, map or build (HTTP 404). */
export function NotFoundPage() {
  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 flex-1">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-black text-3xs font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          Error 404
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          NOT FOUND
        </h1>
        <p className="text-2xs text-[#888] uppercase tracking-[0.3em] font-bold">
          The page you&apos;re looking for doesn&apos;t exist
        </p>
      </div>
      <Link
        href="/"
        className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-black transition-colors px-6 py-2 text-xs uppercase tracking-widest font-bold"
      >
        Return to Base
      </Link>
    </main>
  );
}

/** A page whose render failed: offers to load it again. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useTanStackRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex justify-center flex-col gap-6 items-center p-4 flex-1">
      <div className="text-center space-y-3">
        <div className="bg-[#9a8866] text-black text-3xs font-bold px-2 py-0.5 inline-block uppercase tracking-[0.2em]">
          System Error
        </div>
        <h1 className="text-5xl font-black tracking-[0.3em] text-[#9a8866] uppercase">
          ERROR
        </h1>
        <p className="text-2xs text-[#888] uppercase tracking-[0.3em] font-bold">
          Something went wrong
        </p>
      </div>
      <button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
        className="border border-[#9a8866] text-[#9a8866] hover:bg-[#9a8866] hover:text-black transition-colors px-6 py-2 text-xs uppercase tracking-widest font-bold"
      >
        Try Again
      </button>
    </main>
  );
}
