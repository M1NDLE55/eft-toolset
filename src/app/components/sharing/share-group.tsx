"use client";

import { Share2 } from "lucide-react";
import { useAccountView } from "@/app/lib/account-sync/account-session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AccountItemLinks } from "./account-item-links";

/** Share an item group: view and copy links for groups in the account (signed-out groups have none). */
export function ShareGroup({ name }: { name: string }) {
  const account = useAccountView();
  const record = account?.itemGroups.find((group) => group.name.toLowerCase() === name.toLowerCase());
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" aria-label="Share group">
          <Share2 />
          <span className="max-sm:sr-only">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-black uppercase tracking-widest text-[#e6d9b8]">Share group</DialogTitle>
          <DialogDescription>
            {record ? "A link always shows the group as it is now. Revoke it any time." : "Sign in to share item groups with a link."}
          </DialogDescription>
        </DialogHeader>
        {record ? (
          <AccountItemLinks target={{ type: "item_group", id: record.id }} allowCopy={record.allowCopy} online={account!.status.online} />
        ) : (
          <Button asChild>
            <a href={`/auth/sign-in?return=${encodeURIComponent(`/item-groups/${encodeURIComponent(name)}`)}`}>Sign in</a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
