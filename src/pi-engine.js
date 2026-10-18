// Resident turn on pi-mono's agent loop (@earendil-works/pi-agent-core, MIT; the loop MiniMax Code ships on).
// pi owns the loop: tool-call validation, sequential tool execution, steering/follow-up queue, per-turn hooks.
// 1Helm owns everything around it: Workers AI + billing (Resident.callModel), channel computer tools, bounded
// context (checkpoint via prepareNextTurn), hand-off notes, persistence, step limits, streaming to the UI.
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { egressLabel, DAY_LIMIT_REPLY } from "./resident.js";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { withStepTitles, splitStepTitle, stepBegin, stepEnd, stepSkipped } from "./tracker.js";
import { SKIP_REASON, LIMIT_REPORT_ASK } from "./steer.js";
import { untilStopped, STOPPED_TOOL_TEXT, STEP_LIMIT_CHAT_ASK } from "./stop.js";
import { guardModel, guardTools, reportAsk, OUT_OF_TIME_REPLY } from "./spendguard.js";
import { stallCheck } from "./stall-guard.js";
import { isByokError, BYOK_CREDITS_REPLY } from "./byok.js";
import { COMPUTER_BUSY_MSG, isComputerBusy } from "./computer-capacity.js";
import { ackNudge } from "./ack-stall.js";
import { liveNudge, noteRan } from "./live-check.js";
import { personWords } from "./person-asked.js";
import { isResetErr } from "./do-stub.js";
import { claimOutputRecovery } from "./model-limits.js";
import { answerText, splitProgress } from "./progress-dedupe.js";
import {spendPausesOn,pausesApply,stepAllowance} from './spend-preferences.js';
import {trimTurnState} from './spend-retention.js';

// A description the agent library needs. It does not choose the model: every call goes through the resident, which uses the saved setting of the
// job that matches the request (model-jobs.js).
const MODEL = { id: "routed", name: "routed", api: "openai-completions", provider: "cloudflare-workers-ai", baseUrl: "binding:AI",
  reasoning: false, input: ["text"], cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 4096 };
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const textOf = (c) => typeof c === "string" ? c : (c || []).filter((b) => b.type === "text").map((b) => b.text).join("");

// pi messages ⇄ the OpenAI-style messages Workers AI (and our msgs table) use.
export function toOpenAI(systemPrompt, messages) {
  const out = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: textOf(m.content) });
    else if (m.role === "assistant") {
      const calls = m.content.filter((b) => b.type === "toolCall").map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.arguments ?? {}) } }));
      out.push({ role: "assistant", content: textOf(m.content), ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m.role === "toolResult") out.push({ role: "tool", tool_call_id: m.toolCallId, content: textOf(m.content) });
  }
  return out;
}
const piUser = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const piAssistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: zeroUsage(), stopReason: "stop", timestamp: Date.now() });
function fromOpenAI(msgs) { return msgs.map((m) => m.role === "user" ? piUser(m.content) : piAssistant(m.content || "")); }
// A resumed turn's own saved steps (resume.js), with their tool calls and results, back in pi's shape.
export function fromOpenAIFull(msgs) {
  const names = new Map(), out = [];
  for (const m of msgs) {
    if (m.role === "user") out.push(piUser(typeof m.content === "string" ? m.content : textOf(m.content)));
    else if (m.role === "assistant") {
      const msg = piAssistant(m.content || ""); if (!m.content) msg.content = [];
      for (const c of m.tool_calls || []) { let args = {}; try { args = JSON.parse(c.function?.arguments || "{}"); } catch {} names.set(c.id, c.function?.name); msg.content.push({ type: "toolCall", id: c.id, name: c.function?.name, arguments: args }); }
      if (m.tool_calls?.length) msg.stopReason = "toolUse";
      out.push(msg);
    } else if (m.role === "tool") out.push({ role: "toolResult", toolCallId: m.tool_call_id, toolName: names.get(m.tool_call_id) || "", content: [{ type: "text", text: String(m.content ?? "") }], isError: false, timestamp: Date.now() });
  }
  return out;
}

// Borrowed from MiniMax's pi patch (2026-09-23): keep the command's facts (exit code, timeout/kill) and a head+tail
// preview instead of only the tail, and say exactly how much was dropped.
export function formatExec(r, limit) {
  const facts = r.code === 0 ? "exit 0" : r.code === 124 || r.code === 137 ? `exit ${r.code} (killed: timeout)` : `exit ${r.code}`;
  let out = String(r.out ?? "");
  if (out.length > limit) {
    const head = Math.floor(limit * 0.3), tail = limit - head;
    out = `${out.slice(0, head)}\n…[${out.length - limit} of ${out.length} chars omitted from the middle]…\n${out.slice(-tail)}`;
  }
  return `${facts}\n${out}`;
}

export async function runTurnPi(res, { tc, sys, hist, userText, kind, maxSteps, turn, opts, send, stats, trace, stepIn, TOOLS, COMPUTER_TOOLS, consts, resume = null }) {
  const { CHECKPOINT_TOKENS } = consts;
  let lastAssistant = null, finalMsgs = null, outputRecovery = null;
  // resume.js: a turn a reset cut off carries on from its saved steps (step count, what it said and its checkpoints carried over).
  let stepCapped = false, warm = null, checkpoints = resume?.checkpoints || 0, steps = resume ? resume.step + (resume.phase === "tools" ? 1 : 0) : 0, nudged = !!resume, toolCalls = resume ? stats.tool_calls : 0, error = null, limitAsked = false;
  const said = [...(resume?.said || [])], saidMeta = resume?.saidMeta || said.map(() => null), steerPis = [];
  const limit = () => stepAllowance(tc, maxSteps);
  const journal = (phase) => res.journalStep?.(tc, { step: steps, phase, stats, said, saidMeta, checkpoints });
  const sql = res.sql;
  const histPi = fromOpenAI(hist), userPi = piUser(userText);
  const outLimit = opts.workflow_id ? 8000 : 20000;
  const limitPrompts = new Set(); let reportInFlight = false;
  const limitPrompt = text => { const p = piUser(text); limitPrompts.add(p); return p; };
  const liftLimit = ctx => {
    if (!limitAsked || pausesApply(tc) || opts.hard_charge || tc.stall || tc.abort === 'hard') return false;
    limitAsked = false; stepCapped = false; delete stats.hit_limit;
    ctx.tools = tools; ctx.messages = ctx.messages.filter(m => !limitPrompts.has(m));
    finalMsgs = ctx.messages; return true;
  };

  // Stream function: one billed Workers AI call through Resident.callModel (reserve/settle, retries, JSON repair,
  // early computer warm-up when a computer tool name streams), returned to pi as an AssistantMessage event stream.
  const streamFn = (model, context) => {
    const s = createAssistantMessageEventStream();
    (async () => {
      await res.spendRefresh?.(tc, opts);
      liftLimit(context);
      const noTools = !context.tools || context.tools.length === 0;
      reportInFlight = limitAsked && noTools;
      const msg = { role: "assistant", content: [], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: zeroUsage(), stopReason: "stop", timestamp: Date.now() };
      s.push({ type: "start", partial: msg });
      // a reset under the last step (resume.js): no further model call here; runTurnPi ends and runTurn parks the turn
      if (tc.objectReset) { msg.stopReason = "error"; msg.errorMessage = error = "Durable Object reset because its code was updated."; s.push({ type: "error", reason: "error", error: msg }); return; }
      try {
        let spoke = false;
        const r = await res.callModel(toOpenAI(context.systemPrompt, context.messages), () => {
          if (!warm) { const w0 = Date.now(); warm = res.computer().warm().then((x) => ({ ...x, ms: Date.now() - w0 })); }
        }, send ? (t) => { if (!spoke && said.length) send({ t: "text", s: "\n\n" }); spoke = true; send({ t: "text", s: t }); } : null, noTools, tc);
        stepIn.push(r.inTok); queueMicrotask(() => journal("tools")); stats.in += r.inTok; stats.cached += r.cached; stats.cache_write += r.cacheWrite || 0; stats.out += r.outTok; stats.charge += r.charge; if (r.model) stats.models.push(r.routing ? `${r.model} [${r.routing.reason}/${r.routing.floor}]` : r.model);
        if ((opts.hard_charge || spendPausesOn(tc)) && opts.max_charge && stats.charge >= opts.max_charge && !tc.abort) { tc.limitWhy = "cost"; tc.abort = "soft"; }
        if (spendPausesOn(tc) && opts.soft_steps && steps + 1 >= opts.soft_steps && !tc.abort) { tc.limitWhy = "steps"; tc.abort = "soft"; }
        guardModel(tc, stats, r.content, r.calls.length > 0 || r.finish === "length", r.calls.map((c) => c.function?.name));
        // pi can consume steering before getFollowUpMessages; count the capped
        // result here so a new message cannot bypass the persisted allowance.
        outputRecovery = !r.calls.length && r.finish === "length" ? claimOutputRecovery(res, tc) : null;
        const names = r.calls.map((c) => c.function?.name).filter(Boolean);
        if (r.content) { msg.content.push({ type: "text", text: r.content }); said.push(r.content); saidMeta.push({ text: r.content, calls: names, later: [] }); }
        else if (said.length && saidMeta[said.length - 1]) saidMeta[said.length - 1].later.push(...names);
        for (const c of r.calls) {
          let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
          if (c.bad_args != null) args = { __invalid_json: c.bad_args.slice(0, 300) };
          msg.content.push({ type: "toolCall", id: c.id, name: c.function.name, arguments: args });
        }
        msg.usage = { ...zeroUsage(), input: r.inTok, output: r.outTok, cacheRead: r.cached, cacheWrite: r.cacheWrite || 0, totalTokens: r.inTok + r.outTok };
        msg.stopReason = r.calls.length ? "toolUse" : r.finish === "length" ? "length" : "stop";
        s.push({ type: "done", reason: msg.stopReason, message: msg });
      } catch (e) {
        msg.stopReason = "error"; msg.errorMessage = e.message; error = e.message;
        s.push({ type: "error", reason: "error", error: msg });
      }
    })();
    return s;
  };

  // Tools: same definitions as the classic engine; execution goes to the channel computer or the always-on resident.
  // pi's validator gets step_title as an optional property (a call without one is never rejected); the model is offered it as
  // required (Resident.modelTools). execute strips it: tools, the trace and the shadow judge never see it.
  const exclude = new Set([...(opts.exclude_tools || []), ...(tc.exclude || [])]);
  const tools = withStepTitles(TOOLS.filter((t) => !exclude.has(t.function.name)), { required: false }).map((t) => ({
    name: t.function.name, label: t.function.name, description: t.function.description, parameters: t.function.parameters,
    executionMode: "sequential",
    execute: async (id, params0) => {
      const { title, args: params } = splitStepTitle(params0);
      toolCalls++; stats.tool_calls++; tc.callId = id; tc.callNo = toolCalls;   // appfirst.js: "from step N" in a repeat's nudge
      noteRan(tc, t.function.name);   // live-check.js: a lookup in this turn
      const x0 = Date.now(); let text; tc.lastCmd = null;
      const sv = stepBegin(sql, tc, { tool: t.function.name, args: params, title, call_id: id });
      res.effectStart?.(tc, id, t.function.name, params);   // resume.js: written BEFORE it runs
      if (COMPUTER_TOOLS.has(t.function.name)) {
        stats.computer_used = 1;
        if (warm) { const w0 = Date.now(); const w = await warm; stats.computer_wait_ms += Date.now() - w0; warm = Promise.resolve({ ok: true }); if (!w.ok) text = res.creditsPaused?.(w.error, tc) || `error: computer unavailable: ${w.error}`; }
        if (!text) { try { const r = await res.execComputerTool(t.function.name, params, tc); text = egressLabel(r) + formatExec(r, outLimit); } catch (e) { if (isResetErr(e)) tc.objectReset = true; text = res.creditsPaused?.(e, tc) || `error: ${e.message}`; } }
      } else text = await untilStopped(tc, res.localTool(t.function.name, params, tc), STOPPED_TOOL_TEXT).catch((e) => { if (isResetErr(e)) { tc.objectReset = true; return ""; } throw e; });
      // A reset under this call (resume.js): nothing of it is recorded (no step result, no journal "done", no saved result), so the
      // resume closes it by its type (re-run a read, re-attach a command, "check first" for a send). The turn is parked right after.
      if (tc.objectReset) return { content: [{ type: "text", text: "(interrupted by an update)" }], details: {} };
      trace.push({ tool: t.function.name, args: JSON.stringify(params).slice(0, 300), ms: Date.now() - x0, out: String(text).slice(0, 300) });
      guardTools(tc, [[t.function.name, params]]);   // spendguard.js: runaway signs → pause
      stallCheck(tc, t.function.name, params, String(text), tc.limits || res.lim?.());   // stall-guard.js: the same call and result again and again → soft stop
      stepEnd(sql, tc, sv?.seq, { out: String(text), ms: Date.now() - x0, ...(tc.lastCmd ? { cmd: tc.lastCmd } : {}) });
      res.effectDone?.(tc, id, String(text));
      return { content: [{ type: "text", text: String(text) }], details: {} };
    },
  }));
  // Steering: what the person added since the last model call, as one user message (text only on pi).
  const steerPi = async (late) => {
    tc.stepNo = steps;
    const st = res.takeSteers(tc); if (!st.length) return [];
    if (late) send?.({ t: "work" });   // the draft just written stays as a progress note; the helper answers again
    const sm = await res.steerMessage(tc, st, { late, pics: false });
    const m = piUser(sm.full ?? sm.text); steerPis.push(m); return [m];
  };
  const lastWasFinal = () => !!lastAssistant && lastAssistant.role === "assistant" && !lastAssistant.content.some((b) => b.type === "toolCall");

  const resumeNote = resume ? resume.prior.at(-1) : null, priorPi = resume ? fromOpenAIFull(resume.prior.slice(0, -1)) : [];
  const context = { systemPrompt: sys, messages: resume ? [...histPi, userPi, ...priorPi] : [...histPi], tools };
  if (!resume) res.save(turn, { role: "user", content: (opts?.eventNote ? userText.replace(opts.eventNote, "") : userText).replace(tc?.placeNote || "\u0000", "").replace(tc?.hintNote || "\u0000", "").replace(tc?.fileBody || "\u0000", "") });   // nor the attached files' text (sidecar.js; file_text reads it again)   // nor the integration hint (integration-hint.js)   // where they are (resident placeNote) isn't saved either   // an app event is the run's input only, never saved (app-events.js)
  send && (send.work = () => send({ t: "work" }));

  const config = {
    model: MODEL,
    convertToLlm: (m) => m,
    toolExecution: "sequential",
    // Truncated/invalid tool JSON never reaches a tool; the model gets one precise error and retries.
    // A new message from the person: calls not started yet are skipped (recorded on the card) so it's read first.
    beforeToolCall: async ({ args, toolCall }) => {
      if (tc.abort === "hard") return { block: true, reason: STOPPED_TOOL_TEXT };   // stopped by the person: nothing more runs
      if (args && args.__invalid_json != null) return { block: true, reason: `Your tool arguments were not valid JSON (likely cut off at the output limit). Retry with shorter arguments. Received: ${args.__invalid_json}` };
      if (res.hasSteers(tc) || res.helperQueued?.(tc)) { const sp = splitStepTitle(args || {}); stepSkipped(sql, tc, { tool: toolCall?.name, args: sp.args, title: sp.title, call_id: toolCall?.id }); return { block: true, reason: SKIP_REASON }; }
      return undefined;
    },
    getSteeringMessages: async () => steerPi(lastWasFinal()),
    prepareNextTurn: async ({ message, context: ctx }) => {
      await res.spendRefresh?.(tc, opts);
      liftLimit(ctx);
      trimTurnState(tc, {said, saidMeta, stats, trace, stepIn});
      steps++; finalMsgs = ctx.messages; journal("model");
      // A limit (cost cap or deadline) stopped this run: tools off, final report.
      if (tc.abort === "soft" && !limitAsked) {
        limitAsked = true; stats.hit_limit = 1;
        return { context: { ...ctx, tools: [], messages: finalMsgs = [...ctx.messages, limitPrompt(reportAsk(tc, LIMIT_REPORT_ASK))] } };
      }
      // Unattended run nearly out of steps: take the tools away and ask for the final report.
      if (steps >= limit() - 1 && !limitAsked) {
        limitAsked = true; stats.hit_limit = 1;
        if (kind === "chat") stepCapped = true;
        return { context: { ...ctx, tools: [], messages: finalMsgs = [...ctx.messages, limitPrompt(kind === "chat" ? STEP_LIMIT_CHAT_ASK : "(Step limit reached. No more tools. Write your final report now: what you checked, what you found, whether you texted, and what the next run should reuse or do differently.)")] } };
      }
      // Mid-turn checkpoint (1Helm bounded context): fold the work so far into working notes, restart from them.
      if (message.usage?.input > Math.max(CHECKPOINT_TOKENS, (stepIn[0] || 0) + 20000) && steps < limit() - 2) {
        const ask = { role: "user", content: "(Context checkpoint. Don't call tools. Write your working notes so you can continue without the raw steps above: the goal, what you've done, key findings with exact values/paths/commands, what's left and your next step. Be complete but compact.)" };
        const fin = await res.callModel([...toOpenAI(ctx.systemPrompt, ctx.messages), ask], () => {}, null, true, tc);
        stats.in += fin.inTok; stats.cached += fin.cached; stats.cache_write += fin.cacheWrite || 0; stats.out += fin.outTok; stats.charge += fin.charge; if (fin.model) stats.models.push(fin.routing ? `${fin.model} [${fin.routing.reason}/${fin.routing.floor}]` : fin.model); checkpoints++;
        const lastTool = [...ctx.messages].reverse().find((m) => m.role === "toolResult");
        res.save(turn, ask); res.save(turn, { role: "assistant", content: fin.content });
        return { context: { ...ctx, messages: finalMsgs = [...histPi, userPi, ...steerPis, piUser(`[Checkpoint ${checkpoints}: your own working notes so far on this request]\n${fin.content}\n\n[Most recent tool result]\n${textOf(lastTool?.content).slice(0, 4000)}${tc.session && res.todoContext ? res.todoContext(tc.session) : ""}\n\nContinue the task from here. Earlier raw steps are searchable with recall_history.`)] } };
      }
      return undefined;
    },
    shouldStopAfterTurn: async () => { await res.spendRefresh?.(tc, opts); return steps >= limit() || tc.abort === "hard"; },
    getFollowUpMessages: async () => {
      await res.spendRefresh?.(tc, opts);
      if ((limitAsked || reportInFlight) && !pausesApply(tc) && !opts.hard_charge && !tc.stall && tc.abort !== 'hard') { reportInFlight=false; return [piUser('(The person turned off spending check-ins. Continue their task; the discretionary pause no longer applies.)')]; }
      const last = lastAssistant;
      const late = await steerPi(true); if (late.length) return late;   // landed while the answer was being written
      if (kind === "helper" && res.helperQueued?.(tc) && steps < limit() - 1) return [piUser("(A new follow-up instruction arrived from the main helper. Read it before you finish your report.)")];
      if (last?.role === "assistant" && last.stopReason === "length" && steps < limit() - 1)
        return [piUser(outputRecovery)];
      if (kind !== "chat" && toolCalls === 0 && !nudged && !limitAsked) { nudged = true; said.length = 0; saidMeta.length = 0;
        return [piUser("(Unattended run: nobody will reply. Don't describe a plan; do the work now by calling tools, then end with a short final report of what you found and did.)")]; }
      // ack-stall.js: the whole reply is a promise ("reading it now") and nothing ran → do it, once. The line stays as progress (it was streamed).
      const an = !limitAsked && steps < limit() - 1 && last?.role === "assistant" ? ackNudge(tc, stats, said) : null;
      if (an) { if (saidMeta[said.length - 1]) saidMeta[said.length - 1].ack = true; send?.({ t: "work" }); stats.ack_nudge = 1; return [piUser(an)]; }
      // live-check.js: the answer states live status with no lookup in this turn → look first, once (the draft stays a progress note).
      const ln = !limitAsked && steps < limit() - 1 && last?.role === "assistant" ? liveNudge(tc, personWords(tc), last.content.filter((b) => b.type === "text").map((b) => b.text).join("\n")) : null;
      if (ln) { said.pop(); saidMeta.pop(); send?.({ t: "work" }); stats.live_nudge = 1; return [piUser(ln)]; }
      // The reply closes the card (sync: no await between the check and the commit; a steer after this opens a new card).
      if (res.hasSteers(tc)) return steerPi(true);
      res.commitTurn(tc);
      return [];
    },
  };

  // Persist every message in the OpenAI shape the rest of the resident (recall_history, hand-off) reads.
  const emit = async (ev) => {
    if (ev.type === "message_end" && ev.message.role === "assistant") lastAssistant = ev.message;
    if (ev.type === "message_end" && tc.objectReset) return;   // a reset step: nothing more is saved (resume.js carries the turn on)
    if (ev.type === "message_end") { const [m] = toOpenAI(null, [ev.message]); if (m && !(m.role === "user" && (m.content === userText || m.content === resumeNote?.content))) res.save(turn, m.role === "user" && tc?.fileBodies?.length ? { ...m, content: tc.fileBodies.reduce((c, b) => c.replace(b, ""), m.content) } : m); }   // a steer's file text isn't saved (sidecar.js)
    if (ev.type === "tool_execution_start") send?.({ t: "work" });
  };
  const m0 = Date.now();
  if (!resume) journal("model");
  await runAgentLoop(resume ? [piUser(resumeNote.content)] : [userPi], context, config, emit, undefined, streamFn).catch((e) => { error = error || e.message; });
  stats.model_ms += Date.now() - m0; stats.steps = steps || 1;
  // a reset under a step (this object's or a callee's): not the turn's error; runTurn parks it for the resume (resume.js)
  if (tc.objectReset || (error && isResetErr(error))) { tc.objectReset = true; throw Object.assign(new Error("Durable Object reset because its code was updated."), { objectReset: true }); }
  if (stepCapped && !steerPis.length) tc.limitWhy ||= "steps";   // out of steps (not just answering what they added): a paused card
  let reply = error ? said.join("\n\n") : answerText(splitProgress(said, saidMeta));
  if (!reply && error) reply = isByokError(error) ? error : isComputerBusy(error) ? COMPUTER_BUSY_MSG : /out_of_credits/.test(error) ? (res.env.BYOK ? BYOK_CREDITS_REPLY : OUT_OF_TIME_REPLY) : /daily safety limit/.test(error) ? DAY_LIMIT_REPLY : `Something went wrong: ${error}`;
  if (kind === "chat" && steps >= limit() && !error) reply = reply || "I stopped after several steps; tell me if you want me to keep going.";
  return { reply, error, said, saidMeta, checkpoints, messagesForNotes: toOpenAI(sys, finalMsgs || [...histPi, userPi]) };
}
