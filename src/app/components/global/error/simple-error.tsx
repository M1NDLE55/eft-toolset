import { ReactNode } from "react";
import ErrorWrapper from "./error";

export default function SimpleError({ children }: { children: ReactNode }) {
  return (
    <ErrorWrapper>
      <div className="flex flex-col items-start gap-3 text-red-700">{children}</div>
    </ErrorWrapper>
  );
}
