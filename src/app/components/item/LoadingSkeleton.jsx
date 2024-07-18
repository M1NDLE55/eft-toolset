export default function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4`}>
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
        <div className="flex-1 bg-neutral-700 h-[84px] rounded-md"></div>
      </div>
      <div className="rounded-md bg-neutral-700 h-[84px]"></div>
    </div>
  );
}
