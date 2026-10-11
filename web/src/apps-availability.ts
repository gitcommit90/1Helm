// Match the Apps card's Soon state without hiding built-ins or existing connections.
export const appIsSoon = (app: { x?: number; b?: number }, live: boolean, connected: boolean) =>
  live && !!app.x && !app.b && !connected;

// Catalog visibility only: existing saved accounts remain manageable.
export const catalogAppVisible = (slug: string) => {
  const value = String(slug || "").trim().toLowerCase();
  return !value.startsWith("cloudflare") || value === "cloudflare_mcp";
};
