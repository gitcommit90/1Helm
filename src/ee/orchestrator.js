// The Worker owns routing and session state. Tool arguments never choose a model or a category.
import { scrubSecrets } from "../secrets-scrub.js";
import { NATIVE_POLL_TOOL } from "./native-polls.js";
export const ORCHESTRATOR_NOTE = "Call start_helper and relay the person's request as a clear job. The system has already selected the worker. You must delegate this request. You may start the worker, send corrections after it returns, read its finished evidence and files, ask the person for missing information with ask_user or interview, and approve its output. Questions may use existing GenUI cards, choices, forms or plain text. A question leaves the worker open and unapproved. Workers can request_input from you; only you speak to the person. After approval, present the reviewed result using the existing GenUI, drawing and other presentation instructions when useful. Starting or messaging ends your access until the worker calls done or request_input. Review the response, every produced file and the system step log before approving. You answer for the result you approve.";
const tool = (name, description, properties, required = []) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
export const DONE_TOOL = tool("done", "Finish this round and return your complete response. The system attaches files from your assigned work folder, changed Library copies used in the task, and an uneditable step log. Move outputs from other paths into your assigned folder before calling done. Call done to finish; a plain answer does not end your run.", { response: { type: "string" } }, ["response"]);
export const REQUEST_INPUT_TOOL = tool("request_input", "Pause your work and ask Primary for missing information. Only Primary talks to the person. Keep files in your assigned folder. This is not completion or approval; your same worker session and history remain open until Primary sends clarified instructions.", { question: { type: "string" } }, ["question"]);
export const ASK_USER_TOOL = tool("ask_user", "Ask the person for clarification and wait. Available before dispatch and during worker review. The same worker stays open and unapproved, including its files and model choices. question is plain text; optional presentation is existing OpenUI card code for choices, forms or a survey. Use interview for an existing multi-question interview card. Only Primary can ask the person.", { question: { type: "string" }, presentation: { type: "string" }, id: { type: "integer", description: "Optional open worker id; defaults to the worker currently being reviewed." } }, ["question"]);
export const APPROVE_TOOL = tool("approve_subagent", "Approve a returned worker response after reviewing its response, files and system log. Attach only the files the person should receive. The session closes, and unused held files are deleted.", { id: { type: "integer" }, files: { type: "array", items: { type: "string" } } }, ["id"]);
export const MESSAGE_TOOL = tool("message_subagent", "Send a correction to the same open worker session. Available after done, or once when the system routes a steering message. The worker keeps its selected models and history. Sending ends your access until the next done.", { id: { type: "integer" }, message: { type: "string" } }, ["id", "message"]);
export const LOG_TOOL = tool("read_log", "Read a line range from a finished system log or an agent conversation document. Running work cannot be read.", { id: { type: "string" }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 }, offset: { type: "integer", minimum: 0 }, count: { type: "integer", minimum: 1, maximum: 30000 } }, ["id"]);
export const REVIEW_READS = new Set(["read_log", "search_agent_bank", "file_text", "read_lines", "read_pages", "read_sheet", "search_file"]);
export const ORCHESTRATOR_TOOLS = [APPROVE_TOOL, MESSAGE_TOOL, LOG_TOOL, ASK_USER_TOOL, NATIVE_POLL_TOOL];
// Only app-owned dispatch state belongs here. Person-provided questions and
// answers remain labeled user data, outside this developer instruction.
export function orchestrationPolicy(tc) {
  const flow = tc?.orchestration;
  if (!flow || tc?.helper?.dynamic_routing) return "";
  let instruction = "";
  if (flow.sent || flow.waitingInput) instruction = "This delegation turn has ended. Do not call more tools.";
  else if (flow.clarifying) instruction = "Ask which saved question the person is answering. Do not send their answer to a worker until its question identity is resolved.";
  else if (flow.approved) instruction = "The worker's result has been approved. Present the reviewed result using the existing reply and GenUI instructions.";
  else if (flow.review) instruction = `Review open sub-agent #${Number(flow.review)}. Read its returned response, files and system log, then call approve_subagent or message_subagent with id ${Number(flow.review)}. For missing information, use ask_user or interview and leave the worker open and unapproved. Do not start another worker. After approval, present the reviewed result using the existing GenUI, drawing and other presentation instructions when useful.`;
  else if (flow.steer) instruction = `Rewrite the person's update as a clear correction for open sub-agent #${Number(flow.steer)}. Call message_subagent exactly once with id ${Number(flow.steer)} and message containing the correction. Do not inspect its work or start another worker. Do not report the update as sent until the tool succeeds.`;
  else if (flow.requiredDelegation) instruction = ORCHESTRATOR_NOTE;
  else instruction = "Handle the person's current request as Primary using the current available tools. Delegation is optional. Earlier steering or review instructions do not apply to this turn.";
  return instruction ? `Current turn delegation policy. This supersedes earlier delegation state and tool choices for this turn.\n${instruction}` : "";
}
export function routingToolsAllowed(tc, name) {
  if (tc?.helper?.dynamic_routing) return name === "done" || name === "request_input" || !["interview","start_helper", "send_helper", "list_helpers", "stop_helper", ...ORCHESTRATOR_TOOLS.map(t => t.function.name)].includes(name);
  const flow = tc?.orchestration;
  if (!flow) return name !== "done" && name !== "request_input";
  if (flow.sent || flow.waitingInput) return false;
  if (name === "ask_user" || name === "interview" || name === "send_poll") return true;
  if (flow.clarifying) return false;
  if (flow.steer && !flow.review) return name === "message_subagent";
  if (flow.requiredDelegation || flow.review) return name === "start_helper" && !flow.review && !flow.started || name === "message_subagent" && !!flow.review || name === "approve_subagent" && !!flow.review || REVIEW_READS.has(name) && !!flow.review;
  return name !== "done" && name !== "request_input";
}
export function storedMessages(sql, card) {
  return sql.exec("SELECT role,content,tool_calls,tool_call_id FROM msgs WHERE turn=? ORDER BY rowid", card).toArray().map(r => ({ role: r.role,
    content: (() => { try { const p = JSON.parse(r.content); return Array.isArray(p) ? p : r.content; } catch { return r.content; } })(),
    ...(r.tool_calls ? { tool_calls: JSON.parse(r.tool_calls) } : {}), ...(r.tool_call_id ? { tool_call_id: r.tool_call_id } : {}) }));
}
export function stepLog(sql, card, { limit = null, files = [] } = {}) {
  const rows = sql.exec("SELECT tool,COALESCE(full_args,input) args,cmd,status,exit code,ms,out_bytes bytes FROM card_events WHERE card=? AND type='step' ORDER BY seq", card).toArray();
  const lines = rows.map((r, i) => `${i + 1} ${r.tool} ${r.cmd || r.args || ""} | ${r.status}${r.code != null ? ` exit ${r.code}` : ""} | ${r.ms || 0} ms | ${r.bytes || 0} B`);
  if (limit) lines.unshift(`Stopped at limit: ${limit}`);
  for (const file of files) lines.push(`file ${file.path || file.name} | ${file.bytes} B`);
  return scrubSecrets(lines.join("\n"));
}
export function lineRange(text, from = 1, to = null, instruction = "read_log", { offset = 0, count = 30000 } = {}) {
  const lines = String(text || "").split("\n"), start = Math.min(lines.length, Math.max(1, Number(from) || 1)), end = Math.min(lines.length, Math.max(start, Number(to) || Math.min(start + 199, lines.length)));
  const selected = lines.slice(start - 1, end).join("\n"), begin = Math.min(selected.length, Math.max(0, Number(offset) || 0)), size = Math.min(30000, Math.max(1, Number(count) || 30000)), finish = Math.min(selected.length, begin + size);
  const id = typeof instruction === "object" ? instruction.id : String(instruction).match(/with id\s+("[^"\n]+"|[0-9]+)/)?.[1]?.replace(/^"|"$/g, "") || "";
  const next = finish < selected.length ? { id, from: start, to: end, offset: finish, count: size } : end < lines.length ? { id, from: end + 1, to: lines.length, offset: 0, count: size } : null;
  return `${selected.slice(begin, finish)}\nLines ${start} to ${end} of ${lines.length} requested. Characters ${begin + 1} to ${finish} of ${selected.length} in that range are shown.${next ? ` Only part is shown. Use read_log(${JSON.stringify(next)}) to read the rest.` : " The complete requested range is shown."}`;
}
