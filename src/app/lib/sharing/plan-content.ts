import type { Drawing, NotePin, Waypoint } from "@/app/lib/raid-planner/types";

/** A raid plan's content: what a copy, an export or a content hash covers (no ids of its own, no dates). */
export interface PlanContent {
  name: string;
  mapKey: string;
  enabledLayers: string[];
  route: Waypoint[];
  drawings: Drawing[];
  notes: NotePin[];
}
