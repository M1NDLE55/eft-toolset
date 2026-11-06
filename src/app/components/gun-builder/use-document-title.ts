"use client";

import { useEffect } from "react";

const SUFFIX = " | EFT Toolset";

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const next = `${title}${SUFFIX}`;
    const previous = document.title;
    document.title = next;
    const head = document.head;
    const observer = new MutationObserver(() => {
      if (document.title !== next) document.title = next;
    });
    observer.observe(head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === next) document.title = previous;
    };
  }, [title]);
}
