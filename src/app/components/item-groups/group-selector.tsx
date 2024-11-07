import { Group } from "@/app/lib/types/itemGroups";
import Link from "next/link";
import { ChevronRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GroupSelector({ group }: { group: Group }) {
  return (
    <Button
      key={group.name}
      variant={"secondary"}
      className="flex flex-row justify-between items-center gap-2"
      asChild
    >
      <Link
        href={{ pathname: `/item-groups/${group.name}` }}
        className="w-full flex flex-row justify-between items-center"
      >
        <p>{group.name}</p>
        <ChevronRightCircle />
      </Link>
    </Button>
  );
}
