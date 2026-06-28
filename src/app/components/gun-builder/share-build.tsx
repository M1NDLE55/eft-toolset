"use client";

import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, Share2 } from "lucide-react";
import type { GunBuild } from "@/app/lib/types/gunBuilder";
import {
  encodeBuildSharePayload,
  slugifyBuildName,
} from "@/app/lib/builds/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ShareBuildProps {
  build: GunBuild;
}

export function ShareBuild({ build }: ShareBuildProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(Boolean(navigator.share));
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setUrl("");
    setError("");
    setCopied(false);

    encodeBuildSharePayload(build)
      .then((payload) => {
        if (cancelled) return;
        const slug = slugifyBuildName(build.name);
        setUrl(
          `${window.location.origin}/gun-builder/share/${slug}#b=${payload}`
        );
      })
      .catch(() => {
        if (!cancelled) setError("The share link could not be generated.");
      });

    return () => {
      cancelled = true;
    };
  }, [build, open]);

  async function handleCopy() {
    if (!url) return;

    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleNativeShare() {
    if (!url || !navigator.share) return;

    setSharing(true);
    try {
      await navigator.share({ title: build.name, url });
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Share2 className="h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share build</DialogTitle>
          <DialogDescription>
            Anyone with this link can import a local copy.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="border border-[#2a2a2a] bg-[#090909] p-3 text-sm text-[#c9b88d]">
            {error}
          </p>
        ) : (
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              placeholder="Generating link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              disabled={!url}
            >
              {url ? (
                copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )
              ) : (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              )}
              <span className="sr-only">Copy link</span>
            </Button>
          </div>
        )}

        {canNativeShare && (
          <DialogFooter>
            <Button onClick={handleNativeShare} disabled={!url || sharing}>
              <Share2 className="h-4 w-4" />
              {sharing ? "Sharing" : "Share"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
