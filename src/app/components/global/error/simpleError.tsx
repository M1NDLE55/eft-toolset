import { ReactNode } from "react";
import ErrorWrapper from "./error";

export default function SimpleError({ children }: { children: ReactNode }) {
  return (
    <ErrorWrapper>
      <p className="text-red-700">{children}</p>
    </ErrorWrapper>
  );
}
