// General's front door (Memory Overhaul phase 4B, DESIGN.md 6.4, flag HS_WALLS).
// Each channel's memory is walled off. General is the one place that may read the others, and only when the person allows it:
//   front_door = 1 (account setting, Settings or the card's "Always"): General reads other channels without asking.
//   front_door = 0 (default): every cross-channel READ waits for the permission card "Inspect other channels?" and reads nothing before the
//   person answers. Allow once covers the rest of the turn (or the resumed turn, through a one-use grant), Always sets front_door to 1.
// Writes into another channel (remember with a channel) never ask (Captain decision 6). This file is the one gate every cross-channel
// read goes through: crossChannelRecall's caller, memory_explain and forget, list_tasks and read_task in another channel, and the nightly reflection.
// It uses the existing permission flow (perms.js askPerson, takeGrant, decidePerm), so the card, the text message and the resume work as for any permission.
import { hsWalls, frontDoorGet, GENERAL } from "./walls.js";
import { askPerson, takeGrant, notAllowed, EXPIRED_TEXT } from "./perms.js";

export const KIND_CHANNELS = "channels";
export const NO_CARD = "NEEDS PERMISSION: reading other channels needs the person's OK (\"Inspect other channels?\") and there is no one to ask right now, so nothing was read from them. Say so in one short line if it matters.";

export const NO_OTHER_CHANNELS = "There are no other channels in this workspace; everything is in General. Nothing was read from other channels and no permission is needed. Answer from General's own memory.";
const LINE_CAP = 20, PURPOSE_CAP = 80, NAME_CAP = 40;

// The channels General may read or list: every channel except General itself and direct messages (what crossChannelRecall reads), minus any being deleted.
export const readableChannel = (c, generalSlug = GENERAL) => !!c && c.kind !== "dm" && !c.deleted && !c.deleted_at && !c.deleting && !c.deleting_at && (c.slug || c.name) !== generalSlug;
export async function otherChannelsOf(res) {
  try { return (await res.archive().channels()).filter((c) => readableChannel(c)); } catch { return null; }   // null: the list could not be read
}

// General's standing context: the other channels by name and purpose, or that there are none. Names and purposes only, never their content.
// "" for any channel but General (a helper in one channel never learns that another channel exists).
export async function channelsLine(res) {
  if (res.get("channel") !== GENERAL) return "";
  const list = await otherChannelsOf(res); if (!list) return "";
  if (!list.length) return "Other channels: none. Everything is in General, so there is nothing to look up in other channels.";
  const one = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "..." : t; };
  const shown = list.slice(0, LINE_CAP).map((c) => `#${one(c.name || c.slug, NAME_CAP)}${c.purpose || c.topic ? ` (${one(c.purpose || c.topic, PURPOSE_CAP)})` : ""}`);
  return `Other channels (names and purposes only; their contents are read with recall_memory other_channels, list_tasks or read_task): ${shown.join("; ")}${list.length > LINE_CAP ? `; and ${list.length - LINE_CAP} more (list_channels shows all)` : ""}.`;
}

// true when this Resident may read other channels without asking: the flag is off (today's behavior), or front_door is 1.
export async function frontDoorOpen(res, tc = null) {
  if (!hsWalls(res.env)) return true;
  if (tc?.frontDoor === 1) return true;
  if (await frontDoorGet(res.env, res.get("tenant"))) { if (tc) tc.frontDoor = 1; return true; }
  return false;
}

// → null (go ahead and read) or the text to return instead of reading. `what` completes "wants to …" on the card.
export async function frontDoorGate(res, tc, what = "look in your other channels") {
  if (!hsWalls(res.env)) return null;
  if (res.get("channel") !== GENERAL) return null;   // only General reads other channels at all
  if ((await otherChannelsOf(res))?.length === 0) return NO_OTHER_CHANNELS;   // nothing to read, so nothing to ask
  if (await frontDoorOpen(res, tc)) return null;
  if (tc?.permOk?.has(KIND_CHANNELS)) return null;
  if (tc?.permNo?.has(KIND_CHANNELS)) return notAllowed(KIND_CHANNELS);
  if (tc?.permExpired?.has(KIND_CHANNELS)) return EXPIRED_TEXT;
  if (!tc || !tc.turn) return NO_CARD;   // a background caller with no live turn has no one to ask
  if (takeGrant(res, tc, KIND_CHANNELS)) { (tc.permOk ||= new Set()).add(KIND_CHANNELS); return null; }   // a late "Allow once" left a grant for the resumed turn
  return await askPerson(res, tc, KIND_CHANNELS, what);
}

// General's recall_memory searches only General's own bank unless the call sets other_channels (and the person allows it).
export const OTHER_CHANNELS_NOTE = "searched General's own memory only. To look in the person's other channels, call recall_memory again with other_channels true; that may ask them first.";
export function wallsTools(env, channel, tools) {
  if (!hsWalls(env) || channel !== GENERAL) return tools;
  return tools.map((t) => t.function?.name !== "recall_memory" ? t : { ...t, function: { ...t.function,
    parameters: { ...t.function.parameters, properties: { ...t.function.parameters.properties,
      other_channels: { type: "boolean", description: "General only. Set true to also search the person's other channels. Use it only when the person asks about something that may live in one of the other channels listed in your context, and only after General's own memory did not answer. If your context says there are no other channels, don't use it. Depending on their setting, they may be asked to allow it first." } } } } });
}
