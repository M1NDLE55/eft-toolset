import { Group } from "@/app/item-groups/types";
import { Trash } from "lucide-react";

export default function GroupEditor({
  group,
  handleDelete,
}: {
  group: Group;
  handleDelete: any;
}) {
  return (
    <div
      key={group.name}
      className="text-white flex flex-row justify-between items-center gap-2"
    >
      <div className="rounded-md transition-all shadow-md bg-neutral-700 p-3 text-xl w-full flex flex-row justify-between items-center">
        {group.name}
      </div>
      <button
        className="p-3 rounded-md bg-red-500 h-full"
        onClick={() => handleDelete(group.name)}
      >
        <Trash />
      </button>
    </div>
  );
}
