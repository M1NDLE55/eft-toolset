"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importBuild } from "@/app/lib/builds/store";
import {
  decodeBuildSharePayload,
  type DecodedSharedBuild,
} from "@/app/lib/builds/share";

type ImportState =
  | { status: "reading" }
  | { status: "ready"; build: DecodedSharedBuild }
  | { status: "error"; message: string };

export default function SharedGunBuildPage() {
  const router = useRouter();
  const [state, setState] = useState<ImportState>({ status: "reading" });
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const payload = new URLSearchParams(hash).get("b");

    if (!payload) {
      setState({
        status: "error",
        message: "This shared build link is missing its payload.",
      });
      return;
    }

    decodeBuildSharePayload(payload)
      .then((build) => setState({ status: "ready", build }))
      .catch(() =>
        setState({
          status: "error",
          message: "This shared build link could not be read.",
        })
      );
  }, []);

  function handleImport() {
    if (state.status !== "ready") return;

    setImporting(true);
    const build = importBuild(
      state.build.name,
      state.build.weaponId,
      state.build.root
    );
    router.replace(`/gun-builder/${build.id}`);
  }

  if (state.status === "reading") {
    return (
      <div className="flex w-full justify-center p-8">
        <LoaderCircle className="h-6 w-6 animate-spin text-[#9a8866]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4 border border-[#2a2a2a] bg-[#090909] p-4">
        <div className="flex items-center gap-2 text-[#c9b88d]">
          <AlertTriangle className="h-5 w-5" />
          <h1 className="text-xl font-black uppercase tracking-widest">
            Shared build
          </h1>
        </div>
        <p className="text-sm text-[#aaa]">{state.message}</p>
        <Button variant="outline" onClick={() => router.replace("/gun-builder")}>
          Back to builds
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 border border-[#2a2a2a] bg-[#090909] p-4">
      <h1 className="text-xl font-black uppercase tracking-widest text-[#9a8866]">
        Shared build
      </h1>
      <div className="border border-[#222] bg-[#050505] p-3">
        <p className="truncate text-lg font-bold text-[#ddd]">
          {state.build.name}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleImport} disabled={importing}>
          {importing ? "Importing" : "Import"}
        </Button>
        <Button variant="outline" onClick={() => router.replace("/gun-builder")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
