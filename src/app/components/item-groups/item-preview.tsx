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
    <div className="flex flex-row gap-2 bg-secondary rounded-md shadow items-center p-3">
      <div className="flex flex-row gap-4 items-center flex-1 ">
        <Image src={src} alt={item} height={64} width={64} />
        <p>{item}</p>
      </div>
      {children}
    </div>
  );
}
