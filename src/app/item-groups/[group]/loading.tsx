import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}
