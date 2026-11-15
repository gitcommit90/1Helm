// Test accounts: the owner's email is @example.com (the same rule as isTestAccount in spendguard.js, which is not imported here because it pulls in modules that
// import this one). The memory code uses it so a test account's Hindsight banks have no scheduled refresh and no background repair spends on them.
// A lookup error means "not a test account".
export const isTestEmail = (email) => /^[^@\s]+@example\.com$/i.test(String(email || "").trim());
export async function isTestTenant(env, tenantId) {
  try {
    const row = await env.DB.prepare("SELECT u.email AS email FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?").bind(tenantId).first();
    return isTestEmail(row?.email);
  } catch { return false; }
}
