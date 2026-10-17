// The plan ladder (Captain 09-29): every plan is its usage + a flat $10; each step up doubles the usage.
// A leaf module so the Durable Objects (spendguard.js) can read a plan's settings without importing index.js.
// Optional per-plan field: slots = tasks that may work at once in one channel (default SLOT_MAX in spendguard.js, 6).
// The key "byok" is BYOK_PLAN in byok.js (test/plans-def.test.mjs checks they match).
export const PLANS = {
  personal: { name: "Personal", price: 30, usage: 20, fit: "Everyday help" },
  plus: { name: "Plus", price: 50, usage: 40, fit: "For a busy household" },
  power: { name: "Power", price: 90, usage: 80, fit: "For a small business" },
  max: { name: "Max", price: 170, usage: 160, fit: "For heavy, all-day use" },
  // Captain 10-06: "if you want to do a BYOK plan, its $10 and comes with 100gb of storage. Full stop." AI calls go to the person's own
  // OpenAI-compatible endpoint (src/byok.js); no included usage: everything else we run is paid from credits they top up, at cost + 15%.
  byok: { name: "Bring your own key", price: 10, usage: 0, fit: "Use your own AI service", byok: true },
};
