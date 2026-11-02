import { classifyOpportunityEmail } from "./classify.ts";
import type {
  ClassifyEmailInput,
  OpportunityClassification,
} from "./types.ts";

export function applyThreadContext(
  input: ClassifyEmailInput,
  current: OpportunityClassification,
  threadSubjects: string[],
): OpportunityClassification {
  if (current.label !== "unknown" || threadSubjects.length === 0) {
    return current;
  }

  return classifyOpportunityEmail({
    ...input,
    threadSubjects,
  });
}
