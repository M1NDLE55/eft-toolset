import { Group } from "./types";
import Link from "next/link";
import { ChevronRightCircle } from "lucide-react";

export default function GroupSelector({ group }: { group: Group }) {
  return (
    <div
      key={group.name}
      className="text-white flex flex-row justify-between items-center gap-2"
    >
      <Link
        href={{ pathname: `/item-groups/${group.name}` }}
        className="rounded-md hover:shadow-neutral-500 transition-all shadow-md bg-neutral-700 p-3 text-xl w-full flex flex-row justify-between items-center"
      >
        <p>{group.name}</p>
        <ChevronRightCircle />
      </Link>
    </div>
  );
}
