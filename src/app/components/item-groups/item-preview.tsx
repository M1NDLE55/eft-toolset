import Image from "next/image";
import { ReactNode } from "react";

export default function ItemPreview({
  item,
  src,
  children,
}: {
  item: string;
  src: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-row gap-2 text-white">
      <div className="p-3 bg-neutral-700 rounded-md flex flex-row gap-4 items-center shadow-md flex-1">
        <Image src={src} alt={item} height={64} width={64} />
        <p>{item}</p>
      </div>
      {children}
    </div>
  );
}
