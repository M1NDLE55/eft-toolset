import { AlertTriangle } from "lucide-react";
import { ReactNode } from "react";

export default function ErrorWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="bg-red-200 border-red-700 border rounded-md p-3 flex flex-row gap-2">
      <AlertTriangle className="text-red-700" />
      {children}
    </div>
  );
}
