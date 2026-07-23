import WebSocket from "ws";

const B = "localhost:8123";
const u = "ka" + Date.now().toString(36);
const tok = (await fetch(`http://${B}/api/auth/register`, { method: "POST", body: JSON.stringify({ username: u, password: "secret" }) }).then((r) => r.json())).token;
const { sessionId } = await fetch(`http://${B}/api/term/open`, { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ computerId: 1, cols: 80, rows: 24 }) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `ws://${B}/ws/term/${sessionId}?token=${tok}`;

// Session 1: set a shell variable, then disconnect.
const w1 = new WebSocket(url);
await new Promise((r) => w1.on("open", r));
await sleep(300);
w1.send(JSON.stringify({ type: "input", data: "KEEPVAR=alive_$((20+3))\r" }));
await sleep(500);
w1.close();
await sleep(300);

// Confirm the server still lists the session with zero attached clients.
const sessions = await fetch(`http://${B}/api/term/list`, { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.json());
const still = sessions.sessions.find((s) => s.id === sessionId);
console.log(still && still.clients === 0 ? "  ok  - session survived disconnect with 0 clients" : "  FAIL- session gone after disconnect");

// Session 2: reattach to the SAME session; the PTY (and its variable) should persist.
await sleep(1500); // idle period — must NOT die
const w2 = new WebSocket(url);
let out = "";
w2.on("message", (d) => (out += d.toString()));
await new Promise((r) => w2.on("open", r));
await sleep(400);
w2.send(JSON.stringify({ type: "input", data: "echo VAL=$KEEPVAR\r" }));
await sleep(800);
const persisted = /VAL=alive_23/.test(out);
console.log(persisted ? "  ok  - reattached shell kept its state through idle (keep-alive works)" : "  FAIL- state lost. tail: " + JSON.stringify(out.slice(-160)));
w2.close();
process.exit(persisted && still && still.clients === 0 ? 0 : 1);
