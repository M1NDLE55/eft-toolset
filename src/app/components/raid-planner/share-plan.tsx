"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, LoaderCircle, Share2 } from "lucide-react";
import type { RaidPlan } from "@/app/lib/raid-planner/types";
import { encodePlanSharePayload, slugifyPlanName } from "@/app/lib/raid-planner/share";
import { copyText } from "@/app/lib/browser/clipboard";
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
import { iconButton } from "./ui";

const LONG_URL_THRESHOLD = 8000;

interface ShareLink {
  plan: RaidPlan;
  url?: string;
  error?: string;
}

const subscribeNothing = () => () => undefined;

export function SharePlan({ plan }: { plan: RaidPlan }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canNativeShare = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator.share === "function",
    () => false
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    encodePlanSharePayload(plan).then(
      (payload) => {
        if (cancelled) return;
        const slug = slugifyPlanName(plan.name);
        setLink({ plan, url: `${window.location.origin}/raid-planner/share/${slug}#p=${payload}` });
      },
      (reason: unknown) => {
        if (cancelled) return;
        setLink({
          plan,
          error: reason instanceof Error ? reason.message : "The share link could not be generated.",
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [plan, open]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const current = link?.plan === plan ? link : null;
  const url = current?.url ?? "";
  const error = current?.error ?? actionError;

  async function handleCopy() {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setActionError("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not copy the link.");
    }
  }

  async function handleNativeShare() {
    if (!url) return;
    setSharing(true);
    try {
      await navigator.share({ title: plan.name, url });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setActionError(reason instanceof Error ? reason.message : "Could not share the link.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActionError("");
        setCopied(false);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={iconButton} title="Share plan">
          <Share2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Share plan</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share plan</DialogTitle>
          <DialogDescription>
            The whole plan is packed into the link. Anyone who opens it can preview and save their own copy.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            readOnly
            value={url}
            aria-label="Share link"
            placeholder={current?.error ? "Link unavailable" : "Generating link…"}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 font-mono text-xs max-sm:text-base"
          />
          <Button onClick={handleCopy} disabled={!url} className="shrink-0" aria-live="polite">
            {!url && !current?.error ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : copied ? (
              <Check aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        {url.length > LONG_URL_THRESHOLD && (
          <p className="text-xs text-[#888]">
            This link is long because of detailed freehand drawings. Some messengers cut off long links.
          </p>
        )}

        {canNativeShare && (
          <DialogFooter>
            <Button variant="outline" onClick={handleNativeShare} disabled={!url || sharing}>
              <Share2 aria-hidden />
              {sharing ? "Sharing…" : "Share via…"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
