// A self-hosted deployment has one owner. Claiming the singleton and creating
// the user happen in one D1 transaction, so competing first sign-ins cannot
// create a second account or leave a claimed owner without a user.
const TABLE = "CREATE TABLE IF NOT EXISTS single_owner (id INTEGER PRIMARY KEY CHECK (id=1), user_id TEXT NOT NULL UNIQUE)";

export async function ownerAccount(env, email) {
  await env.DB.prepare(TABLE).run();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO single_owner (id,user_id) VALUES (1,?)").bind(id),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM single_owner WHERE id=1 AND user_id=?)")
      .bind(id, email, Date.now(), id),
  ]);
  const owner = await env.DB.prepare("SELECT user_id FROM single_owner WHERE id=1").first();
  const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  return user?.id === owner?.user_id ? user : null;
}

export async function ownerAllowsEmail(env, email) {
  await env.DB.prepare(TABLE).run();
  const owner = await env.DB.prepare("SELECT u.email FROM single_owner o JOIN users u ON u.id=o.user_id WHERE o.id=1").first();
  return !owner || owner.email === email;
}
