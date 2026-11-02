// Everything that waits for the person while they are reachable only by text (a turn that started from a text message).
// The rule is that nothing waits only in the app. This file holds the three shared pieces:
//   1. recordTextReply: every reply the app sends to the phone leaves a row in the outbox (what was sent, or why it was held),
//      so a missing text can be explained afterward.
//   2. textWaitingNotices: after a texted turn ends, anything that still needs a tap and has no text of its own (a connect offer,
//      a share offer, a browser or purchase handoff) gets a short text with its link.
//   3. recordTextCard and resolveTextCard: an approval, a permission, a confirm card or a plan that went out by text lists its
//      replies ("Reply 1 to allow once, 2 to deny"), and a text that is exactly one of them resolves the card like a tap.
import { deliverText, appLink } from "./ee/index.js";
import { notifyTask, appUrl } from "./notify.js";

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const CARD_WINDOW_MS = 60 * 60e3;   // how long a texted card can be answered by text (the approval card's own limits still apply)

// ---- 1. the reply record ----
export function recordTextReply(R, r, out) {
  try {
    if (!out || out.via === "quiet") return;
    const msg = one(r?.reply).slice(0, 1600) || (out.via ? `(${out.via})` : "(no text)");
    R.sql.exec("INSERT INTO outbox (at,turn,workflow_id,message,delivery) VALUES (?,?,?,?,?)", Date.now(), r?.turn || null, null, msg, out.ok ? `sent:${out.id || ""}` : `held:${out.reason || "unknown"}`);
  } catch (e) { console.log("text reply record", String(e.message || e).slice(0, 120)); }
}

// ---- 2. things that wait with no text of their own ----
const sessionOfTurn = (R, turn) => turn ? R.sql.exec("SELECT session FROM cards WHERE id=?", String(turn)).toArray()[0]?.session || null : null;
const noticed = (R, key) => { if (R.get(key)) return true; R.put(key, "1"); return false; };
export async function textWaitingNotices(R, tenant, r) {
  const turn = r?.turn, session = sessionOfTurn(R, turn);
  if (!turn || !session || r?.error) return [];
  const sent = [], t = await R.env.DB.prepare("SELECT slug, helper_name FROM tenants WHERE id=?").bind(tenant).first().catch(() => null);
  if (!t?.slug) return sent;
  const channel = R.get("channel"), here = appUrl(R.env, t.slug, channel, session), reply = String(r?.reply || "");
  // A connect offer made in this turn: the model is told to put its link in the reply, and here the link goes out if it did not.
  let offers = []; try { offers = R.sql.exec("SELECT * FROM connect_offers WHERE turn=? AND via='text' AND status='pending' ORDER BY id", String(turn)).toArray(); } catch {}
  for (const o of offers) {
    if (reply.includes(`offer=${encodeURIComponent(`${channel}.${o.id}`)}`) || noticed(R, `text-notice:connect:${o.id}`)) continue;
    const link = `${appLink(R.env, t.slug)}?appinfo=${encodeURIComponent(o.app)}&offer=${encodeURIComponent(`${channel}.${o.id}`)}`;
    const d = await deliverText(R.env, tenant, `${o.why ? `${one(o.why)} ` : ""}Connect ${o.name} here: ${link}`).catch(() => null);
    sent.push({ kind: "connect_offer", id: o.id, ok: !!d?.ok });
  }
  // A share offer (publish a page, make a file link): its card is in the app, and the person taps to publish.
  let shares = []; try { shares = (await R.env.DB.prepare("SELECT id, kind, name, title FROM share_offers WHERE tenant_id=? AND turn=? AND status='pending'").bind(tenant, String(turn)).all()).results || []; } catch {}
  for (const o of shares) {
    if (noticed(R, `text-notice:share:${o.id}`)) continue;
    const what = o.kind === "page" ? `publish ${o.name || o.title || "the page"}` : `create the link for ${o.name || o.title || "the file"}`;
    const d = await deliverText(R.env, tenant, `Nothing is shared until you tap. Open the task to ${what}: ${here}`).catch(() => null);
    sent.push({ kind: "share_offer", id: o.id, ok: !!d?.ok });
  }
  // The task ended waiting on the person for something only the app can do (the browser, a purchase in Link, a signature).
  try {
    const v = R.sessionView(R.session(session));
    if (v?.state === "waiting" && ["browser", "link", "sign"].includes(v.waiting)) {
      const n = await notifyTask(R, session, "needs", { why: v.waiting, force: true });
      sent.push({ kind: `waiting_${v.waiting}`, texted: !!n?.texted });
    }
  } catch (e) { console.log("text waiting state", String(e.message || e).slice(0, 120)); }
  return sent;
}

// ---- 3. texted cards answered by text ----
function init(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS text_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, session TEXT, options TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open')");
  sql.exec("CREATE INDEX IF NOT EXISTS text_cards_open ON text_cards(state, at)");
}
// The replies a text can use for one card. An approval or a permission also takes 1 and 2, a plan only its two words.
export const APPROVAL_OPTIONS = [{ n: 1, words: ["allow", "confirm"], decision: "once", done: "Allowed once." }, { n: 2, words: ["deny", "cancel"], decision: "deny", done: "Not allowed." }];
export const PLAN_OPTIONS = [{ words: ["approve"], decision: "approve", done: "Approved. I'm starting these." }, { words: ["deny"], decision: "deny", done: "Denied. I won't start them." }];
export const approvalReplyLine = (confirm) => confirm ? "Reply 1 to confirm or 2 to cancel." : "Reply 1 to allow once or 2 to deny.";
export const planReplyLine = "Reply APPROVE to start all of them or DENY to skip them.";
export function recordTextCard(R, { kind, ref, session = null, options }) {
  try { init(R.sql); R.sql.exec("UPDATE text_cards SET state='replaced' WHERE kind=? AND ref=? AND state='open'", kind, String(ref)); R.sql.exec("INSERT INTO text_cards (at,kind,ref,session,options) VALUES (?,?,?,?,?)", Date.now(), kind, String(ref), session, JSON.stringify(options)); }
  catch (e) { console.log("text card record", String(e.message || e).slice(0, 120)); }
}
const stillOpen = (R, c) => {
  if (c.kind === "approval") return R.sql.exec("SELECT status FROM approvals WHERE id=?", Number(c.ref)).toArray()[0]?.status === "pending";
  if (c.kind === "plan") return R.sql.exec("SELECT status FROM plans WHERE id=?", Number(c.ref)).toArray()[0]?.status === "pending";
  return false;
};
// Checked first and synchronously, so an ordinary text does not wait on anything.
export function hasOpenTextCard(R) { try { return R.sql.exec("SELECT 1 FROM text_cards WHERE state='open' LIMIT 1").toArray().length > 0; } catch { return false; } }
// text: the person's message. Returns null when it is not an answer to the one open card, otherwise what was done.
export async function resolveTextCard(R, text) {
  const said = one(text).toLowerCase().replace(/[.!)]+$/, "");
  if (!said || said.length > 20) return null;
  init(R.sql);
  const open = [];
  for (const c of R.sql.exec("SELECT * FROM text_cards WHERE state='open' ORDER BY id").toArray()) {
    if (Date.now() - Number(c.at) > CARD_WINDOW_MS || !stillOpen(R, c)) R.sql.exec("UPDATE text_cards SET state='closed' WHERE id=?", c.id); else open.push(c);
  }
  if (open.length !== 1) return null;   // with several open cards a bare reply is ambiguous, so it goes to the helper as a normal message
  const c = open[0], opts = JSON.parse(c.options || "[]");
  const opt = opts.find((o) => (o.n != null && said === String(o.n)) || o.words?.includes(said));
  if (!opt) return null;
  let res;
  if (c.kind === "approval") res = await R.decideApproval(Number(c.ref), opt.decision);
  else res = await R.planDecide(Number(c.ref), opt.decision, null, null);
  R.sql.exec("UPDATE text_cards SET state=? WHERE id=?", res?.error ? "closed" : "answered", c.id);
  const line = res?.error ? "That request isn't open any more." : opt.done;
  const d = await deliverText(R.env, R.get("tenant"), line).catch(() => null);
  return { ok: true, card_answer: c.kind, decision: opt.decision, error: res?.error || null, texted: !!d?.ok, session: c.session };
}
