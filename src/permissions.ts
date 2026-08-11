import type { ReviewScope } from "./domain";
export function can(scopes: ReadonlySet<ReviewScope>, scope: ReviewScope): boolean { return scopes.has(scope); }
export function capabilities(scopes: Iterable<ReviewScope>) {
  const value = new Set(scopes);
  return { read: can(value, "review:read"), comment: can(value, "review:comment"), upload: can(value, "review:upload"), manage: can(value, "review:manage") };
}
