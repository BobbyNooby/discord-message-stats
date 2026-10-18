/**
 * `Payload["meta"]` declares `schema_message`, but the browser can be handed a
 * payload cached or served before the field existed. Read it structurally and
 * treat anything that is not a non-empty string as "no warning" rather than
 * letting `undefined` reach the banner. The type describes the current server;
 * this guard covers every payload the dashboard may already hold.
 */
export function schemaWarning(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const message = (meta as { schema_message?: unknown }).schema_message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}
