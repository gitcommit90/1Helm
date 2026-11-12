// The name a person gave their helper, as people and the model see it. Takes a tenants row (or the name itself).
// DEFAULT_HELPER is the one fallback: onboarding always saves a name, so a real account only sees it if none was ever picked.
export const DEFAULT_HELPER = "Skipper";
export const helperName = (t) => String((t && typeof t === "object" ? t.helper_name : t) || "").trim() || DEFAULT_HELPER;
