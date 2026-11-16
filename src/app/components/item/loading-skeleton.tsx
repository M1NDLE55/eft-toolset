import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading item">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-[86px]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[78px]" />
        ))}
        <Skeleton className="col-span-2 h-40" />
        <Skeleton className="col-span-2 h-40 md:col-span-1" />
        <Skeleton className="col-span-2 h-40 md:col-span-1" />
      </div>
    </div>
  );
}
