// General's front door (Memory Overhaul phase 4B, DESIGN.md 6.4, flag HS_WALLS).
// Each channel's memory is walled off. General is the one place that may read the others, and only when the person allows it:
//   front_door = 1 (account setting, Settings or the card's "Always"): General reads other channels without asking.
//   front_door = 0 (default): every cross-channel READ waits for the permission card "Inspect other channels?" and reads nothing before the
//   person answers. Allow once covers the rest of the turn (or the resumed turn, through a one-use grant), Always sets front_door to 1.
// Writes into another channel (remember with a channel) never ask (Captain decision 6). This file is the one gate every cross-channel
// read goes through: crossChannelRecall's caller, memory_explain and forget, list_tasks and read_task in another channel, and the nightly reflection.
// It uses the existing permission flow (perms.js askPerson, takeGrant, decidePerm), so the card, the text message and the resume work as for any permission.
import { hsWalls, frontDoorGet, GENERAL } from "./walls.js";
import { askPerson, takeGrant, notAllowed } from "./perms.js";

export const KIND_CHANNELS = "channels";
export const NO_CARD = "NEEDS PERMISSION: reading other channels needs the person's OK (\"Inspect other channels?\") and there is no one to ask right now, so nothing was read from them. Say so in one short line if it matters.";

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
  if (await frontDoorOpen(res, tc)) return null;
  if (tc?.permOk?.has(KIND_CHANNELS)) return null;
  if (tc?.permNo?.has(KIND_CHANNELS)) return notAllowed(KIND_CHANNELS);
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
      other_channels: { type: "boolean", description: "General only. Set true to also search the person's other channels. Use it only when the person asks about something that may live in another channel. Depending on their setting, they may be asked to allow it first." } } } } });
}
