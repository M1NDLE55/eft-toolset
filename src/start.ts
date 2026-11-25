import { createStart } from "@tanstack/react-start";
import { renderDataUnavailableAdapter } from "@/app/lib/render-errors";

export const startInstance = createStart(() => ({
  serializationAdapters: [renderDataUnavailableAdapter],
}));
