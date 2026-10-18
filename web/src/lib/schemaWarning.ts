/**
 * The API started sending `meta.schema_message` with the repo-split seam, but an
 * older payload — cached, or from a server that has not been upgraded — has no
 * such key. The dashboard must keep rendering in both cases, so read the field
 * structurally and treat anything that is not a non-empty string as "no
 * warning" rather than letting `undefined` reach the banner.
 */
export function schemaWarning(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const message = (meta as { schema_message?: unknown }).schema_message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}
