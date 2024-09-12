"use client";

import { useParams } from "next/navigation";

export default function Page() {
  const group = useParams<{ group: string }>().group;

  return <div>{group}</div>;
}
