"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Link2, LoaderCircle } from "lucide-react";
import type { DecodedSharedBuild } from "@/app/lib/builds/share";
import { parseSharedBuildInput } from "@/app/lib/builds/share-import";
import { createBuild } from "@/app/lib/builds/store";
import { countParts } from "@/app/lib/builds/tree";
import { MAX_BUILD_NAME_LENGTH } from "@/app/lib/builds/limits";
import { useGunList } from "@/app/lib/cache/gunBuilderHooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Parsed =
  | { status: "empty" }
  | { status: "checking" }
  | { status: "ready"; build: DecodedSharedBuild }
  | { status: "error"; message: string };

export function ImportBuildDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 /> Import link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
            Import a build
          </DialogTitle>
          <DialogDescription>Paste a gun builder share link to save a copy in this browser.</DialogDescription>
        </DialogHeader>
        {open && <ImportForm />}
      </DialogContent>
    </Dialog>
  );
}

function ImportForm() {
  const router = useRouter();
  const { byId, guns, loading: gunsLoading } = useGunList();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [parsed, setParsed] = useState<Parsed>({ status: "empty" });
  const [saveError, setSaveError] = useState("");
  const request = useRef(0);

  function check(value: string) {
    setText(value);
    setSaveError("");
    const id = request.current + 1;
    request.current = id;
    if (!value.trim()) {
      setParsed({ status: "empty" });
      return;
    }
    setParsed({ status: "checking" });
    parseSharedBuildInput(value)
      .then((build) => {
        if (request.current !== id) return;
        setParsed({ status: "ready", build });
        setName(build.name);
      })
      .catch((reason: unknown) => {
        if (request.current !== id) return;
        setParsed({ status: "error", message: reason instanceof Error ? reason.message : "This link could not be read." });
      });
  }

  const build = parsed.status === "ready" ? parsed.build : null;
  const gun = build ? byId.get(build.weaponId) : undefined;
  const unknownWeapon = Boolean(build && !gun && !gunsLoading && guns.length > 0);
  const parts = build ? countParts(build.root) : 0;

  function save() {
    if (!build || unknownWeapon) return;
    try {
      const fallback = gun?.name.slice(0, MAX_BUILD_NAME_LENGTH) ?? "Imported build";
      const created = createBuild(name.trim() || fallback, build.weaponId, build.root);
      router.push(`/gun-builder/${created.id}`);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save this build.");
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Input
        value={text}
        onChange={(event) => check(event.target.value)}
        placeholder="https://…/gun-builder/share/…#b=…"
        aria-label="Share link"
        aria-invalid={parsed.status === "error"}
        autoComplete="off"
        spellCheck={false}
        maxLength={402_048}
        className="font-mono text-xs"
        autoFocus
      />
      {parsed.status === "checking" && (
        <p aria-live="polite" className="flex items-center gap-2 text-xs text-[#888]">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#9a8866]" /> Checking link
        </p>
      )}
      {parsed.status === "error" && (
        <p role="alert" className="flex items-center gap-2 border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {parsed.message}
        </p>
      )}
      {build && (
        <div className="flex flex-col gap-3 border border-[#1a1a1a] bg-[#080808] p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-20 shrink-0 items-center justify-center bg-[#050505]">
              {gun?.gridImageLink ? (
                <Image src={gun.gridImageLink} alt="" width={80} height={48} className="h-full w-full object-contain p-0.5" />
              ) : gunsLoading ? (
                <span className="h-8 w-14 animate-shimmer" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#ddd]">
                {gun?.name ?? (gunsLoading ? "Loading weapon…" : "Unknown weapon")}
              </span>
              <span className="block text-xs text-[#888]">
                {parts} part{parts === 1 ? "" : "s"}
              </span>
            </span>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#888]">Build name</span>
            <Input
              value={name}
              maxLength={MAX_BUILD_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder={gun?.name ?? "Imported build"}
            />
          </label>
          {unknownWeapon && (
            <p role="alert" className="text-xs text-red-300">
              This weapon isn&apos;t in the current weapon list, so the build can&apos;t be imported.
            </p>
          )}
        </div>
      )}
      {saveError && (
        <p role="alert" className="border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {saveError}
        </p>
      )}
      <Button type="submit" disabled={!build || unknownWeapon}>
        <Download /> Save to my builds
      </Button>
    </form>
  );
}
