import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { searchUrlFor, blockedNote, SEARCH_POLICY, COMPUTER_SEARCH } from "../src/computer-search.js";
import { browserSetupCmd } from "../src/channel-computer.js";

test("a Google web search address becomes the same search on Bing", () => {
  assert.equal(searchUrlFor("https://www.google.com/search?q=canva+pricing&hl=en"), "https://www.bing.com/search?q=canva+pricing");
  assert.equal(searchUrlFor("https://google.co.uk/search?q=a%26b"), "https://www.bing.com/search?q=a%26b");
});
test("other Google pages and other sites are left alone", () => {
  for (const u of ["https://www.google.com/", "https://www.google.com/maps/search/?api=1&query=x", "https://www.google.com/search?tbm=isch&q=cat", "https://www.google.com/search", "https://example.com/search?q=a", "not a url", "https://notgoogle.com/search?q=a"])
    assert.equal(searchUrlFor(u), u);
});
test("a tab on google.com/sorry gets a factual note naming Bing and web_search", () => {
  const n = blockedNote("https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3DCANVA%26hl%3Den&q=EgQ");
  assert.match(n, /Google blocked this computer's address/); assert.match(n, /https:\/\/www\.bing\.com\/search\?q=CANVA/); assert.match(n, /web_search/);
  assert.equal(blockedNote("https://www.google.com/"), ""); assert.equal(blockedNote("https://www.bing.com/search?q=a"), "");
});
test("the computer's Chrome policy sets Bing as the default search provider and start page", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cs-")), pol = path.join(d, "pol");
  execFileSync("bash", ["-c", browserSetupCmd({ policyDir: pol, profile: path.join(d, "prof"), downloads: path.join(d, "dl") })]);
  const j = JSON.parse(fs.readFileSync(path.join(pol, "1hc.json"), "utf8"));
  assert.equal(j.DefaultSearchProviderEnabled, true); assert.equal(j.DefaultSearchProviderName, "Bing");
  assert.equal(j.DefaultSearchProviderSearchURL, COMPUTER_SEARCH.url); assert.match(j.DefaultSearchProviderSearchURL, /\{searchTerms\}/);
  assert.equal(j.NewTabPageLocation, COMPUTER_SEARCH.start); assert.equal(j.DownloadDirectory, path.join(d, "dl"));
  fs.rmSync(d, { recursive: true, force: true });
  assert.ok(!Object.values(SEARCH_POLICY).some((v) => typeof v === "string" && v.includes("'")));
});
test("ChannelComputer.browser redirects a Google search and adds the note", () => {
  const src = fs.readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8");
  assert.match(src, /op === "navigate"[^\n]*searchUrlFor\(body\.url\)/); assert.match(src, /blockedNote\(out\.url\)/);
});
