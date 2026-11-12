import assert from "node:assert/strict";
import { ChannelComputer } from "../src/channel-computer.js";
import { Resident } from "../src/resident.js";

const calls = [];
let exitCode = 23;
const computer = {
  ensureRunning: async () => {},
  put: (key, value) => calls.push(["put", key, value]),
  armAlarm: async () => calls.push(["alarm"]),
  ctx: { container: { exec: async (args) => {
    calls.push(["exec", args]);
    return { output: async () => ({ exitCode, stdout: new Uint8Array() }) };
  } } },
};
const failed = await ChannelComputer.prototype.rmFile.call(computer, "files/old.txt");
assert.equal(failed.ok, false, "a failed rm cannot report success");
assert.ok(calls.some(([kind]) => kind === "exec"));
assert.ok(!calls.some(([kind, key]) => kind === "put" && key === "dirty"), "a failed deletion must not schedule a save");
exitCode = 0;
assert.equal((await ChannelComputer.prototype.rmFile.call(computer, "files/old.txt")).ok, true);
assert.ok(calls.some(([kind, key]) => kind === "put" && key === "dirty"), "a successful deletion schedules a save");

let synced = -1;
const row = { id: "file-1", name: "old.txt", deleted: 1, synced: -1 };
const resident = {
  getRaw: () => null,
  sql: { exec: (statement) => {
    if (statement.startsWith("SELECT * FROM files")) return { toArray: () => [row] };
    if (statement.startsWith("UPDATE files SET synced=0")) { synced = 0; return {}; }
    throw new Error(`unexpected SQL: ${statement}`);
  } },
  computer: () => ({ rmFile: async () => ({ ok: false, error: "rm failed" }) }),
};
await Resident.prototype.syncFiles.call(resident);
assert.equal(synced, -1, "a failed computer removal must stay queued for retry");

resident.computer = () => ({ rmFile: async () => ({ ok: true }) });
await Resident.prototype.syncFiles.call(resident);
assert.equal(synced, 0, "a successful removal clears the retry flag");
console.log("ok - failed computer file removals stay queued");
