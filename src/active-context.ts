import type { PremiereContext } from "./domain";

export const ACTIVE_CONTEXT_EVENT = "plane-freeframe:active-context";

export function activeContextKey(context: PremiereContext): string {
  if (context.status === "no-project") return "no-project";
  if (context.status === "no-sequence") return `project:${context.projectGuid}:no-sequence`;
  return `project:${context.sequence.projectGuid}:sequence:${context.sequence.id}`;
}
