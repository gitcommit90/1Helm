import assert from "node:assert/strict";
import { ChannelComputer } from "../src/channel-computer.js";
import { Computer } from "../src/index.js";

const env = { ENV_NAME: "selfhost", BACKUP_MAINTENANCE: "1" };
let destroyed = 0;
const container = { running: true, destroy: async () => { destroyed++; container.running = false; } };
const state = new Map([["ready", "1"]]);
const fake = (Class) => {
  const object = Object.create(Class.prototype);
  object.env = env; object.ctx = { container };
  object.get = (key) => state.get(key);
  object.put = (key, value) => state.set(key, String(value));
  object.log = () => {};
  return object;
};
const channel = fake(ChannelComputer);
channel.save = async () => ({ ok: false, error: "storage full" });
channel.armAlarm = async () => {};
const outcome = await channel.stop("backup", { cancellable: false });
assert.equal(outcome.stopped, false);
assert.equal(destroyed, 0, "failed save must leave the computer running");
assert.equal(state.get("ready"), "1");
await assert.rejects(channel.snapshotPrepare(), /did not complete/);

// The file preparation Computer keeps no saved files: its snapshot step needs no save, and a running container makes the snapshot refuse as busy (installSnapshotRpc).
state.set("ready", "0");
const idleChannel = fake(ChannelComputer), idleComputer = fake(Computer);
idleChannel.ctx = {}; idleComputer.ctx = {};
assert.deepEqual(await idleChannel.snapshotPrepare(), { ready: true });
assert.deepEqual(await idleComputer.snapshotPrepare(), { ready: true });
state.set("dirty", "1");
await assert.rejects(idleChannel.snapshotPrepare(), /binding unavailable/);
assert.deepEqual(await idleComputer.snapshotPrepare(), { ready: true });
await assert.rejects(fake(Computer).snapshotPrepare.call({ env: { ENV_NAME: "selfhost" } }), /snapshot unavailable/);
console.log("ok - backup preparation preserves running channel computers on failed saves, refuses missing bindings for dirty channel computers, and the file preparation computer needs no save");
