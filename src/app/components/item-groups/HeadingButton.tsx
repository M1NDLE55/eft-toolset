import { ReactNode } from "react";

export default function HeadingButton({
  flag = false,
  onClick = null,
  children,
}: {
  flag?: boolean;
  onClick?: any;
  children: ReactNode;
}) {
  return (
    <button
      className={`flex flex-row items-center gap-1 hover:text-yellow-400 transition-colors ${
        flag && "text-green-400"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
