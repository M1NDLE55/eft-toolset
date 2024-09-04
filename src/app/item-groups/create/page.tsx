"use client";

import { Save } from "lucide-react";
import HeadingButton from "@/app/components/item-groups/HeadingButton";

export default function Page() {
  return (
    <>
      <div className="w-full flex gap-4 text-xl text-neutral-200 justify-between items-center">
        <h1 className="text-3xl">Create group</h1>
        <HeadingButton onClick={() => {}}>
          <Save />
          Save
        </HeadingButton>
      </div>
    </>
  );
}
