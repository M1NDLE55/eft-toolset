"use client";

import { useEffect } from "react";

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex justify-center flex-col gap-4 items-center p-4 min-h-[calc(100vh-128px)] text-neutral-200">
      <h2 className="text-center text-4xl">Something went wrong!</h2>
      <button
        className="bg-neutral-700 text-white rounded-md p-3 text-xl shadow-md hover:shadow-neutral-500 transition-all"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
