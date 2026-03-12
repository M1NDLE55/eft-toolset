import { AlertTriangle } from "lucide-react";
import { ReactNode } from "react";

export default function ErrorWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#1a0000] border-[#7f1d1d] border p-3 flex flex-row gap-2">
      <AlertTriangle className="text-destructive-foreground" />
      {children}
    </div>
  );
}
