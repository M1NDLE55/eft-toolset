import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[84px]" />
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4`}>
        <Skeleton className="flex-1 h-[84px]" />
        <Skeleton className="flex-1 h-[84px]" />
      </div>
      <Skeleton className="h-[84px]" />
    </div>
  );
}
