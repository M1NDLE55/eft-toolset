import { Group } from "@/app/item-groups/types";
import { Trash } from "lucide-react";
import { SetStateAction, useState } from "react";
import { Dispatch } from "react";

export default function GroupEditor({
  group,
  groups,
  setGroups,
}: {
  group: Group;
  groups: Group[];
  setGroups: Dispatch<SetStateAction<Group[]>>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleDelete() {
    const updatedGroups = groups.filter((g) => g.name !== group.name);
    localStorage.setItem("item-groups", JSON.stringify(updatedGroups));
    setGroups(updatedGroups);
  }

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
        onClick={() => setIsModalOpen(true)}
      >
        <Trash />
      </button>
      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          className="absolute top-0 left-0 flex justify-center items-center h-full w-full backdrop-blur"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="bg-neutral-700 rounded-md text-neutral-200 p-3 text-xl"
          >
            <p className="pb-4">Are you sure?</p>
            <button
              onClick={handleDelete}
              className="block w-full rounded-md bg-red-500 shadow-sm mb-2 py-1 px-2"
            >
              Yes
            </button>
            <button
              className="block w-full rounded-md border py-1 px-2"
              onClick={() => setIsModalOpen(false)}
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
