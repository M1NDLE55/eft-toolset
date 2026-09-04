"use client";

import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, Share2 } from "lucide-react";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import {
  encodePlanSharePayload,
  slugifyPlanName,
} from "@/app/lib/raid-planner/share";
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
import { copyText } from "@/app/lib/browser/clipboard";

const LONG_URL_THRESHOLD = 8000;

interface SharePlanProps {
  plan: RaidPlan;
}

export function SharePlan({ plan }: SharePlanProps) {
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

    encodePlanSharePayload(plan)
      .then((payload) => {
        if (cancelled) return;
        const slug = slugifyPlanName(plan.name);
        setUrl(
          `${window.location.origin}/raid-planner/share/${slug}#p=${payload}`
        );
      })
      .catch(() => {
        if (!cancelled) setError("The share link could not be generated.");
      });

    return () => {
      cancelled = true;
    };
  }, [plan, open]);

  async function handleCopy() {
    if (!url) return;

    try {
      await copyText(url);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not copy the link.");
    }
  }

  async function handleNativeShare() {
    if (!url || !navigator.share) return;

    setSharing(true);
    try {
      await navigator.share({ title: plan.name, url });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "Could not share the link.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-[#888] transition-colors hover:text-[#9a8866]"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className="sr-only">Share plan</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share plan</DialogTitle>
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

        {url.length > LONG_URL_THRESHOLD && (
          <p className="text-xs text-[#888]">
            This link is very long — heavy freehand drawings inflate it. Some
            messengers truncate long URLs.
          </p>
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
