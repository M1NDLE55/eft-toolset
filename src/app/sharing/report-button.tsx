"use client";

import { useState } from "react";
import { Flag, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const REASONS = [
  { value: "offensive", label: "Offensive" },
  { value: "spam", label: "Spam or scam" },
  { value: "personal_info", label: "Personal information" },
  { value: "other", label: "Something else" },
] as const;

export type ReportTarget = { link: string } | { plan: string } | { invite: string };

/**
 * "Report" (§16.6): a reason and, optionally, up to 500 characters of detail. Reporters are never
 * named to the owner; the owner hears nothing unless a link is paused or the item removed.
 */
export function ReportButton({ subject, compact = true }: { subject: ReportTarget; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("offensive");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function send() {
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...subject, reason, detail: detail.trim() || undefined }),
      });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The report couldn't be sent.");
      setState("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report couldn't be sent.");
      setState("idle");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setState("idle");
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        {compact ? (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-[#777] underline-offset-2 hover:text-[#ccc] hover:underline">
            <Flag className="h-3 w-3" aria-hidden /> Report
          </button>
        ) : (
          <Button size="sm" variant="outline">
            <Flag /> Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report this</DialogTitle>
          <DialogDescription>Tell us what&apos;s wrong. The owner won&apos;t see who reported it.</DialogDescription>
        </DialogHeader>
        {state === "done" ? (
          <p role="status" className="text-sm text-[#ccc]">
            Thanks, we&apos;ll take a look.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-[#ccc]">
                  <input type="radio" name="report-reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs text-[#888]">
              Details (optional)
              <textarea
                value={detail}
                maxLength={500}
                rows={3}
                onChange={(event) => setDetail(event.target.value)}
                className="border border-[#2a2a2a] bg-[#0c0c0c] p-2 text-sm text-[#ddd]"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {state === "done" ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <Button onClick={() => void send()} disabled={state === "sending"}>
              {state === "sending" ? <LoaderCircle className="animate-spin" /> : <Flag />} Send report
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
