"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, LoaderCircle, Share2 } from "lucide-react";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import { encodeBuildSharePayload, slugifyBuildName } from "@/app/lib/builds/share";
import { countParts } from "@/app/lib/builds/tree";
import { copyText } from "@/app/lib/browser/clipboard";
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

type LinkState =
  | { status: "idle" }
  | { status: "ready"; url: string; buildKey: string }
  | { status: "error"; message: string };

const noopSubscribe = () => () => undefined;

export function ShareBuild({ build }: { build: GunBuild }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<LinkState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const canNativeShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false
  );
  const buildKey = `${build.id}:${build.updatedAt}`;
  const url = link.status === "ready" && link.buildKey === buildKey ? link.url : "";

  function generate() {
    setCopied(false);
    setNotice("");
    encodeBuildSharePayload(build)
      .then((payload) =>
        setLink({
          status: "ready",
          buildKey,
          url: `${window.location.origin}/gun-builder/share/${slugifyBuildName(build.name)}#b=${payload}`,
        })
      )
      .catch((reason: unknown) =>
        setLink({
          status: "error",
          message: reason instanceof Error ? reason.message : "The share link could not be generated.",
        })
      );
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setNotice("Link copied to clipboard.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not copy the link.");
    }
  }

  async function handleNativeShare() {
    if (!url) return;
    try {
      await navigator.share({ title: build.name, url });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setNotice(reason instanceof Error ? reason.message : "Could not share the link.");
      }
    }
  }

  const parts = countParts(build.root);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) generate();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" aria-label="Share build">
          <Share2 />
          <span className="max-lg:sr-only">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">
            Share build
          </DialogTitle>
          <DialogDescription>
            The whole build is stored in the link, so anyone who opens it can save their own copy. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="border border-[#1a1a1a] bg-[#080808] px-3 py-2">
          <p className="truncate text-sm font-semibold text-[#ddd]">{build.name}</p>
          <p className="text-xs text-[#888]">
            {parts} part{parts === 1 ? "" : "s"}
          </p>
        </div>
        {link.status === "error" ? (
          <p role="alert" className="border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            {link.message}
          </p>
        ) : (
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              placeholder="Generating link…"
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button onClick={handleCopy} disabled={!url} className="w-28 shrink-0">
              {!url ? <LoaderCircle className="animate-spin" /> : copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        {canNativeShare && (
          <Button variant="outline" onClick={handleNativeShare} disabled={!url}>
            <Share2 /> Share via…
          </Button>
        )}
        <p aria-live="polite" className="min-h-4 text-xs text-[#888]">
          {notice}
        </p>
      </DialogContent>
    </Dialog>
  );
}
