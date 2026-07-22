import type { MouseEventHandler, ReactNode } from "react";

export default function HeadingButton({
  flag = false,
  onClick,
  children,
}: {
  flag?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex flex-row items-center gap-1 hover:text-yellow-400 transition-colors ${
        flag ? "text-green-400" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
