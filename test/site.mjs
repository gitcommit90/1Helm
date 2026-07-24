import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { accessSync, constants, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const waitFor = async (url) => { const deadline = Date.now() + 10_000; while (Date.now() < deadline) { try { const result = await fetch(url); if (result.ok) return result; } catch {} await new Promise((resolve) => setTimeout(resolve, 80)); } throw new Error(`Timed out: ${url}`); };

test("standalone 1helm.com website serves independent product and documentation surface", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["site/server.mjs"], { cwd: root, env: { ...process.env, SITE_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = `http://127.0.0.1:${port}`;
    const health = await (await waitFor(`${base}/health`)).json();
    assert.equal(health.surface, "website");
    const home = await (await fetch(base)).text();
    assert.match(home, /Your AI should finish the work/);
    assert.match(home, /demo\.1helm\.com.*separate public sandbox/is);
    assert.doesNotMatch(home, /signed-source metadata/);
    for (const path of ["/product", "/manifesto", "/security", "/faq", "/docs", "/docs/install/macos", "/docs/install/linux", "/docs/install/windows-wsl", "/docs/skills", "/docs/verification", "/docs/connections"]) {
      const response = await fetch(base + path); assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
    }
    assert.equal((await fetch(`${base}/assets/site.css`)).status, 200);
    const benchmarkSchema = await (await fetch(`${base}/schemas/autonomy-benchmark-v1.json`)).json();
    assert.equal(benchmarkSchema.$id, "https://1helm.com/schemas/autonomy-benchmark-v1.json");
    assert.deepEqual(benchmarkSchema.required, ["schema", "product", "kind", "started_at", "finished_at", "deterministic", "scope", "summary", "checks"]);
    assert.equal((await fetch(`${base}/install.sh`)).status, 200);
    assert.equal((await fetch(`${base}/../../package.json`)).status, 404);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /https:\/\/1helm\.com\/docs\/connections/);
    const download = await fetch(`${base}/download/macos`, { redirect: "manual" });
    assert.equal(download.status, 302);
    assert.match(download.headers.get("location") || "", /1Helm-[\d.]+-arm64\.dmg$/);
  } finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
});

test("installer assets are explicit and syntax-valid", () => {
  accessSync(`${root}/site/public/install.sh`, constants.R_OK);
  const installer = readFileSync(`${root}/site/public/install.sh`, "utf8");
  assert.match(installer, /HELM_CHANNEL_COMPUTER_BACKEND=native/);
  assert.match(installer, /NODE_VERSION="22\.23\.1"/);
  assert.match(installer, /need=\([^\n]*flock[^\n]*make[^\n]*c\+\+[^\n]*python3[^\n]*\)/, "the host updater and native dependency toolchain are probed even when download prerequisites already exist");
  assert.doesNotMatch(installer, /npm[^\n]*ci[^\n]*--omit=optional/, "platform-specific optional build packages are retained");
  assert.match(installer, /EXISTING_SHA="\$\(runuser -u "\$SERVICE_USER" -- git -C "\$RELEASE_ROOT" rev-parse HEAD/, "repeat installs inspect the service-owned release as the service user");
  assert.match(installer, /RELEASES_ROOT=.*releases/);
  assert.match(installer, /mv -Tf .*current/);
  assert.match(installer, /previous release was restored/i);
  assert.match(installer, /HELM_INSTALL_KIND=linux-systemd/, "standard Linux installs identify their host-owned update mechanism");
  assert.match(installer, /1helm-update\.path/, "standard Linux installs watch the private host update request file");
  const updater = readFileSync(`${root}/site/public/update-host.sh`, "utf8");
  assert.match(updater, /browser_download_url/);
  assert.match(updater, /\^sha256:\[a-f0-9\]\{64\}\$/, "the Linux updater requires GitHub's exact SHA-256 asset digest");
  assert.match(updater, /sha256sum -c -/);
  assert.match(updater, /mv -Tf .*current/);
  assert.match(updater, /previous release was restored/i);
  assert.doesNotMatch(updater, /eval|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the root updater never evaluates remote shell content");
  assert.match(readFileSync(`${root}/site/public/install-wsl.ps1`, "utf8"), /systemd=true/);
});

test("standalone deployment runs the website and tunnel without root process authority", () => {
  const siteUnit = readFileSync(`${root}/deploy/1helm-site.service`, "utf8");
  const tunnelUnit = readFileSync(`${root}/deploy/1helm-site-cloudflared.service`, "utf8");
  const tunnelConfig = readFileSync(`${root}/deploy/config-1helm-site.yml.example`, "utf8");
  assert.match(siteUnit, /DynamicUser=yes/);
  assert.match(siteUnit, /ProtectHome=yes/);
  assert.match(tunnelUnit, /DynamicUser=yes/);
  assert.match(tunnelUnit, /LoadCredential=1helm-site-tunnel\.json:\/etc\/cloudflared\/1helm-site-tunnel\.json/);
  assert.match(tunnelUnit, /tunnel run --credentials-file \$\{CREDENTIALS_DIRECTORY\}\/1helm-site-tunnel\.json/);
  assert.doesNotMatch(tunnelConfig, /^credentials-file:/m);
  assert.match(tunnelConfig, /127\.0\.0\.1:8130/);
});

test("autonomy report names its deterministic scope and live-system limits", () => {
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/autonomy-benchmark.mjs"], { cwd: root, encoding: "utf8" }));
  assert.equal(report.schema, "https://1helm.com/schemas/autonomy-benchmark-v1.json");
  assert.equal(report.kind, "deterministic_runtime_contract");
  assert.equal(report.deterministic, true);
  assert.equal(report.summary.failed, 0);
  assert.match(report.scope.validates.join(" "), /wakeable recurring-work persistence/);
  assert.match(report.scope.does_not_validate.join(" "), /live model or provider/);
});
