// node --import ./test/stubs/register.mjs test/byok-opencode.test.mjs
// OpenCode inference transport (src/byok-opencode.js) against a mocked fetch: no real calls, no key. Checks:
//   1. the model list: free models left out, the family and efforts kept, no key sent to the public list
//   2. each family's request (system, tools, tool calls and results, images, effort, stream) and the streamed answer translated back, usage with cost and opencode kept
//   3. non-streamed calls, errors in plain words, the key never in an error
import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { opencodeModelsJson, opencodeChat, capTools, toolLimitOf, ocRecord, ocDetail, messagesBody, geminiBody, _resetOpencode, OC_BASE, OC_SOURCE } from "../src/ee/byok-opencode.js";

let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const KEY = "oc-SECRET-KEY-0123456789abcdef";
const cfg = { key: KEY, host: "OpenCode", provider: OC_SOURCE, plan: "payg" };
const M = (id, api, extra = {}) => ({ id, name: id.toUpperCase(), type: "chat", capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["low", "medium", "high"] }, temperature: true }, limit: { context: 200000, output: 64000 },
  modalities: { input: ["text", "image"], output: ["text"] }, cost: { text: { input: { price: 1 }, output: { price: 5 } } }, api: { [api]: { base_url: `${OC_BASE}/${{ "chat-completions": "openai/v1", responses: "openai/v1", messages: "anthropic/v1", "generate-content": "google/v1beta" }[api]}`, ...(api === "chat-completions" ? { compatibility: { reasoning_field: "reasoning_content" } } : {}) } }, ...extra });
const LIST = { object: "list", data: [
  M("kimi-k3", "chat-completions"), M("gpt-6", "responses"), M("claude-x", "messages", { limit: { context: 1e6, output: 128000 } }), M("gemini-3.5-flash", "generate-content"),
  M("beam-free", "chat-completions"), M("big-pickle", "chat-completions"), M("zero", "chat-completions", { cost: { text: { input: { price: 0 }, output: { price: 0 } } } }), M("weird", "carrier-pigeon"),
  M("old-claude", "messages", { capabilities: { tools: { supported: true }, reasoning: { supported: true, budget: { min: 1024 } }, temperature: true }, limit: { context: 200000, output: 8000 } }),
] };
const calls = []; let handler = null;
const sseBody = (evs) => evs.map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`).join("");
const sse = (evs) => new Response(sseBody(evs), { status: 200, headers: { "content-type": "text/event-stream" } });
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const fetchImpl = async (u, init = {}) => {
  u = String(u); const call = { url: u, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
  if (u === `${OC_BASE}/v1/models`) return jres(LIST);
  return handler(call);
};
const last = () => calls[calls.length - 1];
const read = async (res) => { const t = await res.text(); const out = []; for (const l of t.split("\n\n")) if (l.startsWith("data:") && !l.includes("[DONE]")) out.push(JSON.parse(l.slice(5))); return { out, t }; };
const gather = (out) => { let content = "", reasoning = "", finish = null, usage = null; const tools = []; for (const c of out) { const ch = c.choices?.[0], d = ch?.delta || {}; if (d.content) content += d.content; if (d.reasoning) reasoning += d.reasoning;
  for (const t of d.tool_calls || []) { const x = (tools[t.index] ||= { id: t.id, name: "", args: "" }); if (t.id) x.id = t.id; if (t.function?.name) x.name = t.function.name; if (t.function?.arguments) x.args += t.function.arguments; }
  if (ch?.finish_reason) finish = ch.finish_reason; if (c.usage) usage = c.usage; } return { content, reasoning, finish, usage, tools }; };
const chat = { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Weather in Oslo?" },
  { role: "assistant", content: "Checking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "weather", arguments: "{\"city\":\"Oslo\"}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "{\"temp\":3}" }, { role: "user", content: [{ type: "text", text: "and this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
  tools: [{ type: "function", function: { name: "weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, additionalProperties: false } } }], stream: true };
const OPENCODE = { billing_source: "balance", list_cost: 0.004, tokens: { input: 10, output: 5, reasoning: 2 } };

// 1. the model list
{
  _resetOpencode();
  const j = await opencodeModelsJson(cfg, { fetchImpl });
  assert.deepEqual(j.data.map((m) => m.id), ["kimi-k3", "gpt-6", "claude-x", "gemini-3.5-flash", "old-claude"], "free (-free, big-pickle, zero price) and unknown families are left out");
  assert.deepEqual(j.data.map((m) => m.family), ["chat-completions", "responses", "messages", "generate-content", "messages"]);
  assert.deepEqual(j.data[0].supported_reasoning_efforts, ["low", "medium", "high"]); assert.equal(j.data[0].context_length, 200000); assert.equal(j.data[0].name, "KIMI-K3"); assert.equal(j.data[0].reasoning_field, "reasoning_content");
  assert.equal(calls[0].headers.authorization, undefined, "the public list gets no key"); assert.equal(ocRecord({ id: "x-free", api: { messages: {} } }), null); assert.equal(ocRecord({ ...M("m", "messages"), free: true }), null);
  assert.equal(ocRecord({ id: "s", api: "responses", base_url: `${OC_BASE}/openai/v1`, capabilities: {}, limit: {} }).family, "responses", "api given as a plain family name");
  ok("model list: free models excluded, family and efforts kept");
}

// 2a. chat-completions passthrough
{
  calls.length = 0;
  handler = (c) => { assert.equal(c.headers.authorization, `Bearer ${KEY}`); return sse([{ data: { choices: [{ delta: { reasoning_content: "hm" } }] } }, { data: { choices: [{ delta: { content: "Hi" } }] } }, { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "weather", arguments: "{}" } }] } }] } },
    { data: { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.004, opencode: OPENCODE } } }, { data: "[DONE]" }]); };
  const r = await opencodeChat(cfg, chat, { fetchImpl, model: "kimi-k3", effort: "high", session: "s-1" });
  assert.equal(r.headers.get("content-type"), "text/event-stream");
  const c = last(); assert.equal(c.url, `${OC_BASE}/openai/v1/chat/completions`); assert.equal(c.body.model, "kimi-k3"); assert.equal(c.body.reasoning_effort, "high"); assert.equal(c.body.stream, true); assert.deepEqual(c.body.stream_options, { include_usage: true });
  assert.equal(c.headers["x-opencode-session"], "s-1"); assert.equal(c.body.messages[0].role, "system"); assert.equal(c.body.tools.length, 1);
  const g = gather((await read(r)).out); assert.equal(g.reasoning, "hm", "reasoning_content becomes reasoning"); assert.equal(g.content, "Hi"); assert.equal(g.finish, "tool_calls"); assert.equal(g.usage.cost, 0.004); assert.deepEqual(g.usage.opencode, OPENCODE);
  await opencodeChat(cfg, chat, { fetchImpl, model: "kimi-k3", effort: "max" }); assert.equal(last().body.reasoning_effort, undefined, "an effort the model didn't list is not sent");
  handler = () => jres({ choices: [{ message: { role: "assistant", content: "ok", reasoning_content: "why" }, finish_reason: "stop" }], usage: { cost: 0.01, opencode: { billing_source: "go" } } });
  const j = await (await opencodeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fetchImpl, model: "kimi-k3" })).json();
  assert.equal(j.choices[0].message.reasoning, "why"); assert.equal(j.choices[0].message.reasoning_content, undefined); assert.equal(j.usage.cost, 0.01); assert.equal(j.usage.opencode.billing_source, "go"); assert.equal(last().body.stream, undefined);
  ok("chat-completions: passthrough, reasoning mapped, effort only when listed, usage kept");
}

// 2b. responses
{
  calls.length = 0;
  const ev = (type, o = {}) => ({ event: type, data: { type, ...o } });
  handler = () => sse([ev("response.output_text.delta", { delta: "Hel" }), ev("response.output_text.delta", { delta: "lo" }), ev("response.output_item.added", { output_index: 1, item: { type: "function_call", id: "fc1", call_id: "call_9", name: "weather" } }),
    ev("response.function_call_arguments.delta", { item_id: "fc1", output_index: 1, delta: "{\"city\":" }), ev("response.function_call_arguments.delta", { item_id: "fc1", output_index: 1, delta: "\"Oslo\"}" }),
    ev("response.completed", { response: { usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 3 }, cost: 0.02, opencode: OPENCODE } } })]);
  const r = await opencodeChat(cfg, chat, { fetchImpl, model: "gpt-6", effort: "medium" });
  const c = last(); assert.equal(c.url, `${OC_BASE}/openai/v1/responses`); assert.equal(c.body.instructions, "Be brief."); assert.deepEqual(c.body.reasoning, { effort: "medium" });
  assert.ok(c.body.input.some((i) => i.type === "function_call" && i.name === "weather")); assert.ok(c.body.input.some((i) => i.type === "function_call_output" && i.call_id === "call_1")); assert.equal(c.body.tools[0].name, "weather");
  assert.ok(c.body.input.at(-1).content.some((p) => p.type === "input_image"));
  const g = gather((await read(r)).out); assert.equal(g.content, "Hello"); assert.equal(g.tools[0].name, "weather"); assert.equal(g.tools[0].args, "{\"city\":\"Oslo\"}"); assert.equal(g.finish, "tool_calls");
  assert.equal(g.usage.prompt_tokens, 20); assert.equal(g.usage.prompt_tokens_details.cached_tokens, 4); assert.equal(g.usage.cost, 0.02); assert.deepEqual(g.usage.opencode, OPENCODE);
  const j = await (await opencodeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fetchImpl, model: "gpt-6", effort: "none" })).json();
  assert.equal(j.choices[0].message.tool_calls[0].function.name, "weather"); assert.equal(j.usage.cost, 0.02); assert.equal(last().body.reasoning, undefined, "unlisted effort not sent");
  handler = () => sse([ev("response.failed", { response: { error: { code: "x", message: `usage limit reached for ${KEY}` } } })]);
  await assert.rejects(() => opencodeChat(cfg, chat, { fetchImpl, model: "gpt-6" }), (e) => e.byok && /OpenCode Go usage limit/.test(e.message) && !e.message.includes(KEY));
  ok("responses: shared translation, effort, usage and cost kept, failure mapped");
}

// 2c. messages
{
  calls.length = 0;
  handler = () => sse([{ event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 1 } } } },
    { data: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } }, { data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } } },
    { data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } }, { data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me look." } } },
    { data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "weather", input: {} } } }, { data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"city\":\"Oslo\"}" } } },
    { data: { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "toolu_2", name: "noargs", input: {} } } }, { data: { type: "content_block_stop", index: 3 } },
    { data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42, cost: 0.5, opencode: OPENCODE } } }, { data: { type: "message_stop" } }]);
  const r = await opencodeChat(cfg, chat, { fetchImpl, model: "claude-x", effort: "high" });
  const c = last(); assert.equal(c.url, `${OC_BASE}/anthropic/v1/messages`); assert.deepEqual(c.body.system, [{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }], "the system text carries a cache mark (the same one OpenRouter gets)"); assert.equal(c.body.max_tokens, 32000, "sane cap below the model's 128000 output limit");
  assert.deepEqual(c.body.thinking, { type: "adaptive" }); assert.deepEqual(c.body.output_config, { effort: "high" }); assert.equal(c.body.stream, true);
  assert.deepEqual(c.body.tools[0], { name: "weather", description: "Get weather", input_schema: chat.tools[0].function.parameters, cache_control: { type: "ephemeral" } }, "the last tool carries a cache mark");
  const m = c.body.messages; assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"], "tool results join the next user turn");
  assert.deepEqual(m[1].content, [{ type: "text", text: "Checking." }, { type: "tool_use", id: "call_1", name: "weather", input: { city: "Oslo" } }]);
  assert.deepEqual(m[2].content[0], { type: "tool_result", tool_use_id: "call_1", content: "{\"temp\":3}" }); assert.equal(m[2].content[1].text, "and this?"); assert.deepEqual(m[2].content[2], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  const g = gather((await read(r)).out); assert.equal(g.reasoning, "plan"); assert.equal(g.content, "Let me look."); assert.equal(g.tools[0].args, "{\"city\":\"Oslo\"}"); assert.equal(g.tools[1].args, "{}"); assert.equal(g.finish, "tool_calls");
  assert.equal(g.usage.prompt_tokens, 160); assert.equal(g.usage.completion_tokens, 42); assert.equal(g.usage.prompt_tokens_details.cached_tokens, 50); assert.equal(g.usage.prompt_tokens_details.cache_write_tokens, 10, "cache writes reach the turn stats (resident reads prompt_tokens_details.cache_write_tokens)"); assert.equal(g.usage.cost, 0.5); assert.deepEqual(g.usage.opencode, OPENCODE);
  const b = messagesBody({ messages: [{ role: "user", content: "x" }], max_tokens: 99999, tool_choice: "required", tools: chat.tools, temperature: 0.2 }, ocRecord(LIST.data[2]), "claude-x");
  assert.equal(b.max_tokens, 99999); assert.deepEqual(b.tool_choice, { type: "any" }); assert.equal(b.temperature, 0.2);
  const o = messagesBody({ messages: [{ role: "user", content: "x" }] }, ocRecord(LIST.data[8]), "old-claude", { effort: "medium" });
  assert.deepEqual(o.thinking, { type: "enabled", budget_tokens: 4000 }, "budget models get a budget kept under half of max_tokens"); assert.equal(o.max_tokens, 8000); assert.ok(o.thinking.budget_tokens < o.max_tokens);
  handler = () => sse([{ event: "error", data: { type: "error", error: { type: "authentication_error", message: "bad" } } }]);
  await assert.rejects(() => opencodeChat(cfg, chat, { fetchImpl, model: "claude-x" }), (e) => /refused your key/.test(e.message));
  handler = () => sse([{ data: { type: "message_start", message: { usage: {} } } }]);
  await assert.rejects(() => opencodeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fetchImpl, model: "claude-x" }), (e) => /stopped sending/.test(e.message));
  ok("messages: system, tool_use and tool_result, images, max_tokens, effort, streamed answer, usage and cost");
}

// 2d. generate-content
{
  calls.length = 0;
  handler = () => sse([{ data: { candidates: [{ content: { role: "model", parts: [{ text: "thinking", thought: true }] } }] } }, { data: { candidates: [{ content: { role: "model", parts: [{ text: "Sure. " }] } }] } },
    { data: { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "weather", args: { city: "Oslo" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8, thoughtsTokenCount: 5, cachedContentTokenCount: 10, cost: 0.003, opencode: OPENCODE } } }]);
  const r = await opencodeChat(cfg, chat, { fetchImpl, model: "gemini-3.5-flash", effort: "low" });
  const c = last(); assert.equal(c.url, `${OC_BASE}/google/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse`); assert.deepEqual(c.body.systemInstruction, { parts: [{ text: "Be brief." }] });
  assert.deepEqual(c.body.generationConfig.thinkingConfig, { thinkingLevel: "low", includeThoughts: true });
  assert.deepEqual(c.body.tools[0].functionDeclarations[0], { name: "weather", description: "Get weather", parametersJsonSchema: chat.tools[0].function.parameters });
  assert.deepEqual(c.body.contents.map((x) => x.role), ["user", "model", "user"]); assert.equal(c.body.contents[1].parts[0].text, "Checking."); assert.deepEqual(c.body.contents[1].parts[1].functionCall, { name: "weather", args: { city: "Oslo" } });
  assert.deepEqual(c.body.contents[2].parts[0].functionResponse, { name: "weather", response: { temp: 3 } }); assert.deepEqual(c.body.contents[2].parts[2], { inlineData: { mimeType: "image/png", data: "AAAA" } });
  const g = gather((await read(r)).out); assert.equal(g.reasoning, "thinking"); assert.equal(g.content, "Sure. "); assert.equal(g.tools[0].name, "weather"); assert.equal(g.tools[0].args, "{\"city\":\"Oslo\"}"); assert.equal(g.finish, "tool_calls");
  assert.equal(g.usage.prompt_tokens, 30); assert.equal(g.usage.completion_tokens, 13); assert.equal(g.usage.completion_tokens_details.reasoning_tokens, 5); assert.equal(g.usage.prompt_tokens_details.cached_tokens, 10); assert.equal(g.usage.cost, 0.003); assert.deepEqual(g.usage.opencode, OPENCODE);
  const b = geminiBody({ messages: [{ role: "user", content: "x" }], tool_choice: { type: "function", function: { name: "weather" } }, tools: chat.tools, response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } } }, ocRecord(LIST.data[3]), "gemini-3.5-flash");
  assert.deepEqual(b.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["weather"] } }); assert.equal(b.generationConfig.responseMimeType, "application/json"); assert.deepEqual(b.generationConfig.responseJsonSchema, { type: "object" });
  const j = await (await opencodeChat(cfg, { messages: [{ role: "user", content: "x" }] }, { fetchImpl, model: "gemini-3.5-flash" })).json();
  assert.equal(j.choices[0].message.content, "Sure. "); assert.equal(j.usage.cost, 0.003); assert.equal(j.choices[0].finish_reason, "tool_calls");
  handler = () => sse([{ data: { error: { code: 429, message: "slow down" } } }]);
  await assert.rejects(() => opencodeChat(cfg, chat, { fetchImpl, model: "gemini-3.5-flash" }), (e) => /limiting requests/.test(e.message));
  ok("generate-content: contents, functionDeclarations, systemInstruction, streamed answer, usage and cost");
}

// 3. errors
{
  const err = (status, body) => { handler = () => jres(body, status); return opencodeChat(cfg, chat, { fetchImpl, model: "kimi-k3" }).then(() => assert.fail("should throw"), (e) => e); };
  let e = await err(401, { error: { message: `bad key ${KEY}` } }); assert.ok(e.byok); assert.equal(e.http, 401); assert.match(e.message, /OpenCode refused your key/); assert.ok(!e.message.includes(KEY) && !String(e.detail).includes(KEY));
  e = await err(402, { error: { message: "Insufficient balance" } }); assert.match(e.message, /OpenCode balance is too low/);
  e = await err(429, { error: { message: "Go monthly limit reached" } }); assert.match(e.message, /OpenCode Go usage limit/);
  e = await err(429, { error: { message: "slow" } }); assert.match(e.message, /limiting requests/);
  e = await err(403, { error: { message: "forbidden" } }); assert.match(e.message, /free models only work inside OpenCode/);
  e = await err(500, { error: { message: "boom" } }); assert.match(e.message, /error 500: boom/); assert.equal(e.http, 500); assert.match(e.message, /^Your AI service/);
  handler = () => { throw new Error(`socket closed ${KEY}`); };
  e = await opencodeChat(cfg, chat, { fetchImpl, model: "kimi-k3" }).catch((x) => x); assert.match(e.message, /couldn't connect/); assert.ok(!e.message.includes(KEY));
  e = await opencodeChat(cfg, chat, { fetchImpl, model: "beam-free" }).catch((x) => x); assert.match(e.message, /free models only work inside OpenCode/);
  e = await opencodeChat({ ...cfg, key: "" }, chat, { fetchImpl, model: "kimi-k3" }).catch((x) => x); assert.ok(e.byok); assert.match(e.message, /OpenCode API key/);
  handler = () => new Response("", { status: 302, headers: { location: "https://evil.example" } });
  e = await opencodeChat(cfg, chat, { fetchImpl, model: "kimi-k3" }).catch((x) => x); assert.match(e.message, /redirected/);
  assert.match(ocDetail(401), /refused/); assert.match(ocDetail(402), /balance/);
  assert.ok(!calls.some((c) => !c.url.startsWith(OC_BASE)), "every call stays on opencode.ai");
  ok("errors: 401, 402, Go limit, 429, 403, 500, network, free model, missing key, redirect; the key never appears");
}
{
  // Go plan: its own base, its own list (free Go models kept), every model through chat/completions, a session header on every request, 402 told as a Go plan problem.
  _resetOpencode(); calls.length = 0;
  const GO = "https://opencode.ai/inference/go", gcfg = { key: KEY, host: "OpenCode", provider: OC_SOURCE, plan: "go", tenantId: "t9" };
  const GOLIST = { object: "list", data: [M("glm-5.3", "chat-completions"), M("gpt-6", "responses"), M("claude-x", "messages"), M("beam-free", "chat-completions")] };
  const gfetch = async (u, init = {}) => { u = String(u); const call = { url: u, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
    if (u === `${GO}/v1/models`) return jres(GOLIST); if (!call.headers["x-opencode-session"]) return jres({ type: "error", error: { type: "MissingSessionID" } }, 400); return handler(call); };
  assert.deepEqual((await opencodeModelsJson(gcfg, { fetchImpl: gfetch })).data.map((r) => r.id), ["glm-5.3", "gpt-6", "claude-x", "beam-free"], "Go keeps its own free models");
  assert.equal(calls[0].url, `${GO}/v1/models`); assert.ok(!calls[0].headers.authorization, "the list is public");
  handler = () => jres({ model: "x", choices: [{ message: { role: "assistant", content: "hi" } }] });
  for (const id of ["glm-5.3", "gpt-6", "claude-x"]) { calls.length = 0; await opencodeChat(gcfg, { messages: [{ role: "user", content: "hi" }] }, { fetchImpl: gfetch, model: id, session: "task-1" }); const c = last(); assert.equal(c.url, `${GO}/openai/v1/chat/completions`, id); assert.equal(c.headers["x-opencode-session"], "task-1"); assert.equal(c.headers["user-agent"], "1Helm/1.0"); }
  calls.length = 0; await opencodeChat(gcfg, { messages: [{ role: "user", content: "hi" }] }, { fetchImpl: gfetch, model: "glm-5.3", purpose: "titles" }); assert.equal(last().headers["x-opencode-session"], "1helm-t9-titles");
  await opencodeChat({ ...gcfg, tenantId: "" }, { messages: [{ role: "user", content: "hi" }] }, { fetchImpl: gfetch, model: "glm-5.3" }); assert.equal(last().headers["x-opencode-session"], "1helm-account-chat");
  assert.ok(calls.filter((c) => c.method === "POST").every((c) => c.headers["x-opencode-session"]), "no request to OpenCode lacks the session header");
  handler = () => jres({ error: { message: "Insufficient account funds" } }, 402);
  let e = await opencodeChat(gcfg, { messages: [] }, { fetchImpl: gfetch, model: "glm-5.3", session: "s" }).catch((x) => x); assert.equal(e.limit, true); assert.match(e.message, /has reached the usage limit of your OpenCode Go plan, so I couldn't finish this\. \[Manage usage\]\(https:\/\/opencode\.ai\/console\), switch this connection to pay as you go/); assert.ok(!/balance/.test(e.message));
  handler = () => jres({ error: { message: "Insufficient account funds" } }, 402); _resetOpencode();
  e = await opencodeChat({ ...gcfg, plan: "payg" }, { messages: [] }, { fetchImpl: async (u, i) => (String(u).endsWith("/v1/models") ? jres(LIST) : handler()), model: "kimi-k3", session: "s" }).catch((x) => x); assert.match(e.message, /OpenCode balance is too low/);
  assert.match(ocDetail(402, "", "go"), /Go plan/); assert.match(ocDetail(402, "monthly limit reached", "go"), /monthly limit reached/);
  ok("Go: base and path, its own list, session header on every request, 402 told per plan");
}
// 5. prompt caching marks (same breakpoints as the OpenRouter path): only the Anthropic format carries them
{
  const marks = (v) => JSON.stringify(v).split('"cache_control"').length - 1;
  const loop = { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "first" }, { role: "assistant", content: "ok", tool_calls: [{ id: "c1", type: "function", function: { name: "weather", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{\"t\":3}" }, { role: "user", content: "and now?" }], tools: chat.tools, stream: true };
  const reply = () => sse([{ data: { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } } }, { data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } } }, { data: { type: "message_stop" } }]);
  handler = reply; calls.length = 0;
  await opencodeChat(cfg, loop, { fetchImpl, model: "claude-x", session: "task-9" });
  let b = last().body; assert.ok(marks(b) >= 3 && marks(b) <= 4, `a session tool loop carries three or four marks (got ${marks(b)})`);
  assert.ok(b.tools.at(-1).cache_control && b.system[0].cache_control, "last tool and system are marked"); assert.equal(b.session_id, undefined, "no session id goes upstream in the body");
  assert.ok(!("prompt_cache_key" in b)); assert.ok(b.messages.at(-1).content.at(-1).cache_control, "the last message is marked (the moving mark)");
  assert.equal(last().headers["x-opencode-session"], "task-9");
  calls.length = 0; await opencodeChat(cfg, { ...loop, tools: undefined }, { fetchImpl, model: "claude-x" }); b = last().body; assert.ok(marks(b) <= 2, "a chore (no tools, no session) carries one or two marks"); assert.equal(marks(b.messages), 0);
  calls.length = 0; await opencodeChat(cfg, loop, { fetchImpl, model: "claude-x" }); assert.ok(marks(last().body) <= 2, "tools without a session is not a tool loop: one or two marks");
  // the other formats build their request from plain text: nothing carries a mark, nothing is rejected for one
  for (const model of ["kimi-k3", "gpt-6", "gemini-3.5-flash"]) {
    handler = () => (model === "gemini-3.5-flash" ? sse([{ data: { candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "STOP" }], usageMetadata: {} } }]) : model === "gpt-6" ? sse([{ data: { type: "response.completed", response: { usage: {} } } }]) : sse([{ data: { choices: [{ delta: { content: "x" }, finish_reason: "stop" }] } }]));
    calls.length = 0; await opencodeChat(cfg, loop, { fetchImpl, model, session: "task-9" }).then((r) => r.text()).catch(() => {});
    assert.equal(marks(last().body), 0, `${model}: no cache_control in the request`);
  }
  ok("OpenCode: Anthropic format carries the cache marks (tool loop up to 4, chore 1 or 2, no session id in the body); the other formats carry none");
}

// 6. a provider that allows at most 128 tools: one retry with the first 128 (core first), the limit remembered
{
  _resetOpencode();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ type: "function", function: { name: `t${i}`, description: "d", parameters: { type: "object", properties: {} } } }));
  const big = { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "t150", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: "ok" }], tools: mk(154), stream: false };
  const capped = capTools(big, 128); assert.equal(capped.tools.length, 128); assert.ok(capped.tools.some((t) => t.function.name === "t150"), "a tool used earlier stays"); assert.ok(capped.tools.slice(0, 5).every((t, i) => t.function.name === `t${i}`), "core tools keep their order, first");
  assert.equal(capTools(big, 200), big); assert.equal(toolLimitOf({ message: "Your AI service (OpenCode) didn't work (error 400: Upstream request failed: [invalid_value] Invalid value for 'tools': maximum number of items is 128.)" }), 128); assert.equal(toolLimitOf({ message: "rate limited" }), 0);
  calls.length = 0; handler = (c) => (c.body.tools.length > 128 ? jres({ error: { message: "Upstream request failed: [invalid_value] Invalid value for 'tools': maximum number of items is 128.", code: "invalid_value" } }, 400) : jres({ model: "x", choices: [{ message: { role: "assistant", content: "ok" } }] }));
  const r = await opencodeChat(cfg, big, { fetchImpl, model: "kimi-k3", session: "s" }); assert.equal((await r.json()).choices[0].message.content, "ok");
  const posts = calls.filter((c) => c.method === "POST"); assert.deepEqual(posts.map((c) => c.body.tools.length), [154, 128]);
  calls.length = 0; await opencodeChat(cfg, big, { fetchImpl, model: "kimi-k3", session: "s" }); assert.deepEqual(calls.filter((c) => c.method === "POST").map((c) => c.body.tools.length), [128], "the limit is remembered for the model");
  calls.length = 0; handler = () => jres({ error: { message: "bad" } }, 400); const e = await opencodeChat(cfg, big, { fetchImpl, model: "gpt-6", session: "s" }).catch((x) => x); assert.ok(e.byok); assert.equal(calls.filter((c) => c.method === "POST").length, 1, "other 400s are not retried");
  ok("tool limit: retry with the first N tools, remembered, other errors untouched");
}
console.log(`${n} passed`);

// Multi-turn histories marked by withCacheBreakpoints (string content becomes text parts, on assistant and tool messages too) go through the Anthropic builder and the other builders.
{
  const { withCacheBreakpoints } = await import("../src/model.js");
  const tools = [{ type: "function", function: { name: "weather", parameters: { type: "object", properties: {} } } }];
  for (const turns of [1, 2, 5]) for (const session_id of ["s1", null]) {
    const messages = [{ role: "system", content: "Be brief." }];
    for (let t = 1; t <= turns; t++) { messages.push({ role: "user", content: `q${t}` }); if (t < turns) { messages.push({ role: "assistant", content: `a${t}`, tool_calls: [{ id: `c${t}`, type: "function", function: { name: "weather", arguments: "{}" } }] }, { role: "tool", tool_call_id: `c${t}`, content: `r${t}` }, { role: "assistant", content: `done${t}` }); } }
    const { session_id: _s, ...marked } = withCacheBreakpoints({ tools, messages, ...(session_id ? { session_id } : {}) });
    for (const build of [() => messagesBody(marked, ocRecord(LIST.data[2]), "claude-x"), () => geminiBody(marked, ocRecord(LIST.data[2]), "g")]) {
      const out = build(), s = JSON.stringify(out);
      for (let t = 1; t <= turns; t++) assert.ok(s.includes(`q${t}`), `q${t} in the body`);
      if (turns > 1) assert.ok(s.includes("a1") && s.includes("r1") && s.includes("done1"));
      if (out.messages) { assert.ok((s.split("cache_control").length - 1) <= 4, "marks <= 4"); for (const m of out.messages) assert.ok(Array.isArray(m.content) && m.content.length, "each message has blocks"); assert.equal(typeof out.messages.at(-1).content.at(-1).text === "string" || out.messages.at(-1).content.at(-1).type === "tool_result", true); }
    }
  }
}
