// A stand-in for a tenant portal, used by test/browser-effects-chrome.test.mjs: links and buttons that download, open windows, call an API,
// open dialogs, change only a frame, and a very long page. Everything is served from 127.0.0.1.
import http from "node:http";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + "x".repeat(2000));
export function startFixture(port) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); hits.push(`${req.method} ${u.pathname}`);
    const html = (b, h = {}) => { res.writeHead(200, { "content-type": "text/html", ...h }); res.end(`<!doctype html><title>Portal</title><body>${b}</body>`); };
    if (u.pathname === "/") return html(`<h1>Documents</h1>
      <a href="/files/attach.pdf">Download attach</a> <a href="/files/inline.pdf">Open inline</a> <a href="/files/slow.pdf">Download slow</a>
      <a href="/files/cookie.pdf">Download cookie</a> <a href="/files/blank.pdf" target="_blank">Open blank</a> <a href="/files/attr.pdf" download>Download attr</a>
      <a href="/files/sniff">Download sniffed</a> <a href="/long">Long page</a>
      <button onclick="location.href='/files/jsnav.pdf'">JS nav button</button>
      <button onclick="fetch('/files/blob.pdf').then(r=>r.blob()).then(b=>{const a=document.createElement('a');a.href=window.URL.createObjectURL(b);a.download='blob.pdf';a.click();})">Blob button</button>
      <button onclick="setTimeout(()=>window.open('/files/late.pdf'),6500)">Late popup</button>
      <button onclick="fetch('/api/ping',{method:'POST'})">Ping API</button>
      <button onclick="document.body.appendChild(document.createElement('p')).textContent='hello'">Add text</button>
      <button onclick="alert('Saved')">Alert button</button>
      <button onclick="document.getElementById('f').click()">Choose file</button><input id="f" type="file" style="display:none">
      <button id="noop">Do nothing</button>
      <iframe src="/frame" title="doc frame" width=300 height=100></iframe><iframe src="/frame2" title="text frame" width=300 height=100></iframe>`, { "set-cookie": "sid=ok; Path=/" });
    if (u.pathname === "/frame") return html(`<button onclick="document.body.style.background='#eee'">Frame tint</button>`);
    if (u.pathname === "/frame2") return html(`<p>Statement balance 12.00</p>`);
    if (u.pathname === "/long") return html(`<h1>Long</h1>` + Array.from({ length: 900 }, (_, i) => `<a href="/item/${i}">Item link number ${i} with a long enough label to fill the outline</a>`).join("\n") + `<button onclick="document.body.appendChild(document.createElement('p')).textContent='clicked last'">Last button</button>`);
    if (u.pathname === "/api/ping") { res.writeHead(204); return res.end(); }
    if (u.pathname === "/files/cookie.pdf") { if (!/sid=ok/.test(req.headers.cookie || "")) { res.writeHead(403); return res.end("no cookie"); } res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="lease cookie.pdf"' }); return res.end(PDF); }
    if (u.pathname === "/files/slow.pdf") { setTimeout(() => { res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="slow.pdf"' }); res.write(PDF.subarray(0, 500)); setTimeout(() => res.end(PDF.subarray(500)), 1500); }, 2500); return; }
    if (u.pathname === "/files/sniff") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(PDF); }
    if (u.pathname.startsWith("/files/")) { const n = u.pathname.split("/").pop(), inline = ["inline.pdf", "blob.pdf", "blank.pdf"].includes(n); res.writeHead(200, { "content-type": "application/pdf", ...(inline ? {} : { "content-disposition": `attachment; filename="${n}"` }) }); return res.end(PDF); }
    res.writeHead(404); res.end("nope");
  });
  return new Promise((z) => srv.listen(port, "127.0.0.1", () => z({ srv, hits })));
}
