import Link from "next/link";
import { Button } from "@/components/ui/button";

export function LocalMissing({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#9a8866]">Not found</p>
      <h1 className="text-3xl font-black uppercase tracking-widest">{title}</h1>
      <p className="text-sm text-muted-foreground">
        It may have been deleted, renamed, or stored in another browser.
      </p>
      <Button asChild variant="outline">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </div>
  );
}
