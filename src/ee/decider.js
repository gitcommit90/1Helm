// The decider: the model that answers our yes-no and pick-one questions (the request sorter's task, category and "fell short" questions, and the browser
// agent's next action and "is it done?"). Its model is the saved setting of the job "decider" (model-jobs.js; change it on the Models page), and every call
// goes through the dispatcher (model-dispatch.js), which sends the saved model, its fallbacks and the account's privacy rules. Callers read the model with
// deciderModel(env), where env carries the saved settings (modelSettingsEnv).
import { jobSetting, settingsOf } from "./model-jobs.js";

export const DECIDER_IN_NANO = 20;       // $0.02 per million input tokens; used only to reserve and estimate when the answer carries no usage.cost
export const deciderModel = (env) => jobSetting(settingsOf(env), "decider").model;
