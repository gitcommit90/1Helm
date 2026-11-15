// The continuous "Export my data" job (data-export.js, "the continuous job"). One of these Durable Objects exists per account. kick() arms its alarm, and every alarm runs one
// slice of the account's export and sets the next alarm for right after it, until nothing is left to run. The progress is saved by the job itself (checkpoints in R2 and D1),
// so a deploy that cuts a slice short loses nothing: the alarm runs again, and the 5-minute cron arms it if it ever stopped.
import { DurableObject } from "cloudflare:workers";
import { exportAlarm } from "./data-export.js";

export class ExportRunner extends DurableObject {
  // RPC: arm the alarm now (does nothing when one is already due).
  async kick(tid) {
    await this.ctx.storage.put("tid", String(tid));
    const a = await this.ctx.storage.getAlarm();
    if (a == null || a > Date.now() + 1000) await this.ctx.storage.setAlarm(Date.now());
    return { armed: true };
  }
  async alarm() {
    const tid = await this.ctx.storage.get("tid"); if (!tid) return;
    let again = 120e3;   // after a failure of the slice itself
    try { again = (await exportAlarm(this.env, tid)).again; } catch (e) { console.log("export runner", String(e?.message || e).slice(0, 200)); }
    if (again != null) await this.ctx.storage.setAlarm(Date.now() + Math.max(0, again));
  }
}
