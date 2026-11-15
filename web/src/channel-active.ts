// A channel is active while any of its tasks shows the working checkbox (the light that travels around the square). The rule matches the task row's
// own: not checked off, and either the Primary works on it or, when it is not waiting on the person, a helper still runs. The channel list poll already
// carries every task's state, so the rail knows about channels that are not open. The cue never touches the unread dot.
import { helperRunning, type HelperTask } from "./helper-cue";
export type ActiveTask = HelperTask & { state?: string; status?: string };
export const taskActive = (x: ActiveTask) => !x.done && (x.state === "working" || (x.status !== "waiting" && helperRunning(x)));
export const channelActive = (tasks: ActiveTask[]) => tasks.some(taskActive);
