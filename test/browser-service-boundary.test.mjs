import assert from "node:assert/strict";
import { controllerRequest } from "../image/opt/1hc-browser/request-guard.mjs";

const internal = { "x-1helm-controller": "1", host: "browser" };
assert.equal(controllerRequest(internal), true);
for (const headers of [
  { host: "127.0.0.1:6080" },
  { ...internal, origin: "https://untrusted.example" },
  { ...internal, origin: "null" },
  { ...internal, origin: "" },
  { ...internal, "sec-fetch-mode": "cors" },
  { ...internal, "sec-fetch-site": "same-origin" },
  { ...internal, "sec-fetch-mode": "websocket" },
]) assert.equal(controllerRequest(headers), false, JSON.stringify(headers));
console.log("ok - only controller requests reach the browser control service");
