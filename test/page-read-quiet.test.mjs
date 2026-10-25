// node --import ./test/stubs/register.mjs test/page-read-quiet.test.mjs
// A read the browser page makes itself, with no saved key, never asks because of a key word in its path (X's credentials-*.js bundle).
import assert from "node:assert";
import { egressRule } from "../src/egress-policy.js";
const H = (o = {}) => new Headers(o);
const PG = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script", origin: "https://x.com", referer: "https://x.com/i/flow/login" };
const r = (o) => egressRule({ env: {}, ...o });
const t = r({ headers: H(PG), host: "abs.twimg.com", method: "GET", path: "/x-web/x-web/assets/credentials-CgfyCJTK.js" });
assert.equal(t.verdict, "allow");
const s = r({ headers: H(PG), host: "x.com", method: "GET", path: "/assets/credentials-abc.js" });
assert.equal(s.verdict, "allow"); assert.equal(s.rule, "read");
assert.equal(r({ headers: H(), host: "api.example.com", method: "GET", path: "/v1/api_keys" }).verdict, "ask");
assert.equal(r({ headers: H(PG), host: "x.com", method: "GET", path: "/assets/credentials-abc.js", keys: ["K"] }).verdict, "ask");
assert.equal(r({ headers: H({ ...PG, "sec-fetch-mode": "cors" }), host: "x.com", method: "POST", path: "/i/api_keys" }).verdict, "ask");
assert.equal(r({ headers: H(), host: "x.com", method: "POST", path: "/i/api_keys" }).verdict, "ask");
assert.equal(r({ headers: H({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" }), host: "dashboard.example.com", method: "GET", path: "/settings/api_keys" }).verdict, "ask");
console.log("PASS page-read-quiet");
