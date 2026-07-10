import WebSocket from "ws";

const B = "localhost:8123";
const u = "term" + Date.now().toString(36);
const reg = await fetch(`http://${B}/api/auth/register`, { method: "POST", body: JSON.stringify({ username: u, password: "secret" }) }).then((r) => r.json());
const tok = reg.token;
const { sessionId } = await fetch(`http://${B}/api/term/open`, { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ computerId: 1, cols: 80, rows: 24 }) }).then((r) => r.json());

const ws = new WebSocket(`ws://${B}/ws/term/${sessionId}?token=${tok}`);
let out = "";
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
  setTimeout(() => ws.send(JSON.stringify({ type: "input", data: "echo MARKER_$((6*7))\r" })), 300);
});
ws.on("message", (d) => {
  out += d.toString();
  if (out.includes("MARKER_42")) { console.log("TERM_OK: got MARKER_42 through proxy"); process.exit(0); }
});
ws.on("error", (e) => { console.log("WS_ERR", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT. buffer:", JSON.stringify(out.slice(-200))); process.exit(1); }, 5000);
