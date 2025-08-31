"use client";

import UsedInTasks from "@/app/components/item/used-in-tasks";
import LoadingSkeleton from "@/app/components/item/loading-skeleton";
import { getParam } from "@/app/lib/params";
import GenericDetails from "@/app/components/item/generic-details";
import BartersUsing from "@/app/components/item/barters-using";
import CraftsUsing from "@/app/components/item/crafts-using";
import { useParams } from "next/navigation";
import { useQuery } from "@apollo/client";
import { GET_ITEM } from "@/app/lib/queries";
import QueryError from "@/app/components/global/error/query-error";
import SimpleError from "@/app/components/global/error/simple-error";
import { useGameMode } from "@/components/game-mode/context";
import { GameMode as GqlGameMode } from "@/__generated__/graphql";

export default function Page() {
  const { itemName } = getParam(useParams());
  const { gameMode } = useGameMode();
  const gqlGameMode = gameMode === "regular" ? GqlGameMode.Regular : GqlGameMode.Pve;
  const { data, loading, error } = useQuery(GET_ITEM, {
    variables: { name: itemName, gameMode: gqlGameMode },
  });

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error || !data) {
    return <QueryError error={error} />;
  }

  if (data.items.length === 0) {
    return (
      <SimpleError>
        The item &quot;{itemName}&quot; wasn&apos;t found
      </SimpleError>
    );
  }

  const item = data.items[0]!;

  return (
    <div className="flex flex-col gap-4">
      <GenericDetails item={item} />
      <UsedInTasks tasks={item.usedInTasks} />
      <BartersUsing barters={item.bartersUsing} />
      <CraftsUsing crafts={item.craftsUsing} />
    </div>
  );
}
