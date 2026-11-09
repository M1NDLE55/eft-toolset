"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { copyText } from "@/app/lib/browser/clipboard";
import { MCP_PATH } from "@/app/lib/mcp/catalog";
import { SITE_ORIGIN } from "@/app/lib/site";

const ENDPOINT_TOKEN = "{endpoint}";

function subscribe() {
  return () => undefined;
}

function useEndpoint() {
  return useSyncExternalStore(
    subscribe,
    () => `${window.location.origin}${MCP_PATH}`,
    () => `${SITE_ORIGIN}${MCP_PATH}`
  );
}

export function CopySnippet({ template, label }: { template: string; label: string }) {
  const endpoint = useEndpoint();
  const text = template.replaceAll(ENDPOINT_TOKEN, endpoint);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <div className="flex items-stretch border border-[#1a1a1a] bg-[#0c0c0c]">
      <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-[#ddd]">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={() =>
          void copyText(text).then(
            () => setStatus("copied"),
            () => setStatus("failed")
          )
        }
        aria-label={`Copy ${label}`}
        title={status === "failed" ? "Copy failed. Select the text instead." : `Copy ${label}`}
        className="flex w-11 shrink-0 items-center justify-center border-l border-[#1a1a1a] text-[#9a8866] hover:bg-[#111] hover:text-[#e6d9b8] focus-visible:outline-2 focus-visible:outline-[#9a8866]"
      >
        {status === "copied" ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
      </button>
      <span role="status" className="sr-only">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}
      </span>
    </div>
  );
}
