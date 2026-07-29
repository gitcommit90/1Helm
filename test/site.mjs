import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    assert.match(home, /Welcome to/);
    assert.match(home, /Intelligence should not be/);
    assert.match(home, /skip to the end/);
    assert.doesNotMatch(home, /signed-source metadata/);
    assert.doesNotMatch(home, /style="/);
    const manual = await (await fetch(`${base}/manual`)).text();
    assert.match(manual, /The Ship's/);
    assert.match(manual, /Do I really need a dedicated computer/);
    const privacy = await (await fetch(`${base}/privacy`)).text();
    assert.match(privacy, /build@1helm\.com/);
    assert.match(privacy, /device tokens are encrypted at rest/i);
    assert.match(privacy, /notification title and body[\s\S]*Cloudflare relay and Apple APNs/i);
    assert.match(privacy, /does not retain the password/i);
    assert.match(privacy, /privacy-bounded diagnostics[\s\S]*exclude chats, prompts, terminal output/i);
    assert.match(privacy, /do not sell it[\s\S]*track you across/i);
    assert.match(home, /build@1helm\.com/);
    assert.match(home, /og:image/);
    assert.match(home, /assets\/story\/og-card\.png/);
    for (const path of ["/manual", "/terms", "/privacy", "/manual/getting-started", "/manual/architecture", "/manual/outcome-ownership", "/manual/skills", "/manual/verification", "/manual/providers", "/manual/channel-computers", "/manual/connections", "/manual/install-macos", "/manual/install-linux", "/manual/install-windows", "/manual/self-hosting", "/manual/security-model"]) {
      const response = await fetch(base + path); assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
      assert.equal(response.headers.get("cache-control"), "no-cache", `${path} must never be browser-cached`);
    }
    const gettingStarted = await (await fetch(`${base}/manual/getting-started`)).text();
    assert.match(gettingStarted, /On Windows 11 x64, download the signed Setup executable/i);
    assert.doesNotMatch(gettingStarted, /withheld/i);
    assert.equal((await fetch(`${base}/assets/site.css`)).status, 200);
    const windowsIcon = await fetch(`${base}/icons/icon-sailboat.ico`);
    assert.equal(windowsIcon.status, 200);
    assert.equal(windowsIcon.headers.get("content-type"), "image/x-icon");
    const benchmarkSchema = await (await fetch(`${base}/schemas/autonomy-benchmark-v1.json`)).json();
    assert.equal(benchmarkSchema.$id, "https://1helm.com/schemas/autonomy-benchmark-v1.json");
    assert.deepEqual(benchmarkSchema.required, ["schema", "product", "kind", "started_at", "finished_at", "deterministic", "scope", "summary", "checks"]);
    assert.equal((await fetch(`${base}/install.sh`)).status, 200);
    assert.equal((await fetch(`${base}/../../package.json`)).status, 404);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /https:\/\/1helm\.com\/manual\/connections/);
    assert.doesNotMatch(sitemap, /1helm\.com\/docs/);
    for (const [oldPath, newPath] of [["/docs", "/manual"], ["/docs/install/linux", "/manual/install-linux"], ["/faq", "/manual#faq"], ["/security", "/manual/security-model"], ["/product", "/"]]) {
      const moved = await fetch(`${base}${oldPath}`, { redirect: "manual" });
      assert.equal(moved.status, 301, oldPath);
      assert.equal(moved.headers.get("location"), newPath, oldPath);
    }
    const download = await fetch(`${base}/download/macos`, { redirect: "manual" });
    assert.equal(download.status, 302);
    assert.match(download.headers.get("location") || "", /1Helm-[\d.]+-arm64\.dmg$|\/releases\/latest$/);
    const windowsDownload = await fetch(`${base}/download/windows`, { redirect: "manual" });
    assert.equal(windowsDownload.status, 302);
    assert.match(windowsDownload.headers.get("location") || "", /-windows-x64-setup\.exe$|\/releases\/latest$/);
  } finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
});

test("public feedback intake validates, deduplicates, and persists to the website state database", async () => {
  const state = mkdtempSync(join(tmpdir(), "1helm-site-feedback-"));
  const token = "feedback-test-admin-token";
  const publicId = `fb_${"a".repeat(24)}`;
  let child;
  const start = async () => {
    const port = await freePort();
    child = spawn(process.execPath, ["site/server.mjs"], {
      cwd: root,
      env: { ...process.env, SITE_PORT: String(port), SITE_DATA_DIR: state, SITE_FEEDBACK_ADMIN_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/health`);
    return base;
  };
  const stop = async () => {
    if (!child || child.exitCode != null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  };
  try {
    let base = await start();
    const invalid = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /source could not be verified/i);
    const report = {
      public_id: publicId,
      installation_id: "b".repeat(16),
      workspace_name: "Feedback contract",
      comment: "first durable report",
      diagnostics: { version: "test" },
      attachments: [{ name: "proof.txt", mime: "text/plain", size: 3, data: "YWJj" }],
    };
    const saved = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    assert.equal(saved.status, 202);
    assert.equal((await saved.json()).id, publicId);
    const duplicate = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...report, comment: "must not overwrite" }) });
    assert.equal(duplicate.status, 202);
    assert.equal((await fetch(`${base}/api/feedback`)).status, 404, "the central inbox remains hidden without its server-side bearer token");
    await stop();

    base = await start();
    const inboxResponse = await fetch(`${base}/api/feedback`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(inboxResponse.status, 200);
    const inbox = await inboxResponse.json();
    assert.equal(inbox.reports.length, 1);
    assert.equal(inbox.reports[0].public_id, publicId);
    assert.equal(inbox.reports[0].comment, "first durable report");
    assert.equal(inbox.reports[0].attachment_count, 1);
    const database = new DatabaseSync(join(state, "feedback.db"));
    assert.equal(database.prepare("SELECT COUNT(*) count FROM feedback_reports").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM feedback_attachments").get().count, 1);
    assert.equal(Buffer.from(database.prepare("SELECT data FROM feedback_attachments").get().data).toString(), "abc");
    database.close();
  } finally {
    await stop();
    rmSync(state, { recursive: true, force: true });
  }
});

test("installer assets are explicit and syntax-valid", () => {
  accessSync(`${root}/site/public/install.sh`, constants.R_OK);
  const installer = readFileSync(`${root}/site/public/install.sh`, "utf8");
  assert.match(installer, /install-lxc-runtime\.sh/, "the host installer provisions the root-owned runtime boundary");
  assert.match(installer, /install-linux-units\.sh/, "fresh installs use the shared Linux service contract");
  assert.match(installer, /snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*TRANSACTION_ACTIVE/, "fresh and repeat installs restore runtime files and unit state after any transactional failure");
  assert.match(installer, /rollback_host_contract[\s\S]*1helm\.service\.active[\s\S]*api\/setup\/status[\s\S]*restored_healthy/, "installer rollback verifies the restored service before claiming recovery");
  assert.match(installer, /NODE_VERSION="22\.23\.1"/);
  assert.match(installer, /need=\([^\n]*flock[^\n]*make[^\n]*c\+\+[^\n]*python3[^\n]*\)/, "the host updater and native dependency toolchain are probed even when download prerequisites already exist");
  assert.match(installer, /import ensurepip[\s\S]*python3-venv/, "the Linux host installs Python's venv support required by durable memory instead of accepting a python3 executable alone");
  assert.doesNotMatch(installer, /npm[^\n]*ci[^\n]*--omit=optional/, "platform-specific optional build packages are retained");
  assert.match(installer, /EXISTING_SHA="\$\(runuser -u "\$SERVICE_USER" -- git -C "\$RELEASE_ROOT" rev-parse HEAD/, "repeat installs inspect the service-owned release as the service user");
  assert.match(installer, /RELEASES_ROOT=.*releases/);
  assert.match(installer, /mv -Tf .*current/);
  assert.match(installer, /previous release was restored/i);
  assert.match(installer, /PREVIOUS_RELEASE[\s\S]*== "\$RELEASES_ROOT\/"\*[\s\S]*\{1\.\.300\}/, "fresh installs reject unsafe rollback links and allow a full minute for first-run runtime initialization");
  assert.match(installer, /1helm-update\.path/, "standard Linux installs watch the private host update request file");
  const updater = readFileSync(`${root}/site/public/update-host.sh`, "utf8");
  const linuxUnits = readFileSync(`${root}/site/public/install-linux-units.sh`, "utf8");
  const releaseApply = readFileSync(`${root}/site/public/apply-linux-release.sh`, "utf8");
  assert.match(updater, /browser_download_url/);
  assert.match(updater, /\^sha256:\[a-f0-9\]\{64\}\$/, "the Linux updater requires GitHub's exact SHA-256 asset digest");
  assert.match(updater, /sha256sum -c -/);
  assert.match(updater, /mv -Tf .*current/);
  assert.match(updater, /atomic host transaction[\s\S]*rollback was proven healthy/i, "the updater defers rollback reporting to the transaction that can prove restored HTTP health");
  assert.match(updater, /VERSION_ORDER[\s\S]*Never downgrade[\s\S]*TARGET_VERSION="\$CURRENT_VERSION"/, "the root updater never replaces a newer installed host with an older latest-release response");
  assert.match(releaseApply, /PREVIOUS_RELEASE[\s\S]*== "\$RELEASES_ROOT\/"\*[\s\S]*\{1\.\.300\}/, "the atomic update transaction rejects unsafe rollback links and uses the same bounded startup allowance");
  assert.match(updater, /\$RELEASE_ROOT\/site\/public\/install-lxc-runtime\.sh/, "the updater installs runtime files from the retained release after staging moves");
  assert.match(updater, /install-linux-units\.sh/, "updates migrate the host service contract instead of retaining an obsolete unit");
  assert.match(updater, /CURRENT_VERSION[\s\S]*HELM_CHANNEL_COMPUTER_BACKEND=lxc[\s\S]*application is current; the host is migrating its verified runtime contract/i, "an older updater can hand off same-version host-contract migration to the newly installed release");
  assert.match(updater, /\/etc\/subuid[\s\S]*snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*cleanup_transaction/, "updates transactionally restore identity maps, runtime files, symlink, and unit state");
  assert.doesNotMatch(updater, /eval|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the root updater never evaluates remote shell content");
  const lxcInstaller = readFileSync(`${root}/site/public/install-lxc-runtime.sh`, "utf8");
  const hostMigration = readFileSync(`${root}/site/public/migrate-linux-host-contract.sh`, "utf8");
  const lxcHelper = readFileSync(`${root}/scripts/1helm-lxc-runtime`, "utf8");
  const lxcNetwork = readFileSync(`${root}/scripts/1helm-lxc-net`, "utf8");
  const lxcConfig = readFileSync(`${root}/deploy/1helm-lxc-unprivileged.conf`, "utf8");
  const uninstaller = readFileSync(`${root}/site/public/uninstall-host.sh`, "utf8");
  assert.match(lxcInstaller, /20260723_07:42/);
  assert.match(lxcInstaller, /cbc98489455ce54b5fa8c9abf276f1cb39130376ef70b3b7151d18362cd6354f/);
  assert.match(lxcInstaller, /f4752ea7e776f329f9f50aca59c1919f3dc841dc3ddf22beef2b1696c4b4e29e/);
  assert.match(lxcInstaller, /visudo -cf/, "the minimal helper-only sudo policy is validated before installation");
  assert.match(lxcInstaller, /apt-get install[\s\S]*python3-venv[\s\S]*lxc/, "0.0.5 upgrades can install the LXC and durable-memory prerequisites the older host did not have");
  assert.match(lxcInstaller, /namespace_covers_range[\s\S]*65536 65535/, "the installer negotiates a full bare-metal or safe nested-host subordinate ID range");
  assert.match(lxcInstaller, /1helm-update\\\.service[\s\S]*systemd-run[\s\S]*apply-linux-release\.sh/, "a v0.0.11 updater hands the complete verified release transaction outside its obsolete read-only mount namespace");
  assert.match(lxcInstaller, /MainPID[\s\S]*\/proc\/\$pid\/cgroup[\s\S]*\/opt\/1helm\/update-host\.sh[\s\S]*kill -KILL/, "a failed handoff stops only the exact legacy updater main process before its obsolete EXIT rollback can run");
  assert.match(lxcInstaller, /install -d[^\n]*"\$LXC_ROOT" "\$LXC_PATH"[\s\S]*install -d[^\n]*"\$CACHE_BASE"[\s\S]*install -d[^\n]*"\$NETWORK_STATE" "\$NETWORK_STATE\/misc"/, "the host creates every service ReadWritePaths root and the private DHCP lease directory before starting 1Helm");
  assert.match(linuxUnits, /1helm-update\\\.service[\s\S]*systemd-run[\s\S]*HELM_HOST_APPLY_DELEGATED/, "a v0.0.11 updater delegates the verified unit migration outside its obsolete mount namespace");
  assert.match(linuxUnits, /ReadWritePaths=[^\n]*\/usr\/libexec(?:\s|$)[^\n]*\/etc\/default(?:\s|$)[^\n]*\/etc\/systemd\/system(?:\s|$)[^\n]*\/etc\/sudoers\.d(?:\s|$)/, "future updater transactions can atomically replace and roll back only the required host-contract parent trees");
  assert.doesNotMatch(linuxUnits, /ReadWritePaths=[^\n]*\/usr\/libexec\/1helm-lxc-runtime/, "the updater no longer mistakes a writable destination file for atomic parent-directory authority");
  assert.match(updater, /systemd-run[\s\S]*apply-linux-release\.sh[\s\S]*exit 0/, "all post-verification Linux release mutations run in one transient root transaction outside the updater namespace");
  assert.match(releaseApply, /RELEASE_ROOT.*RELEASES_ROOT[\s\S]*snapshot_host_contract[\s\S]*install-lxc-runtime\.sh[\s\S]*mv -Tf[\s\S]*install-linux-units\.sh[\s\S]*api\/setup\/status/, "the delegated release transaction owns runtime, source switch, units, and health together");
  assert.match(releaseApply, /rollback_host_contract[\s\S]*rollback-current[\s\S]*SERVICE_NAME\.active[\s\S]*api\/setup\/status/, "a failed delegated release restores the exact prior source and proves its service healthy");
  assert.doesNotMatch(releaseApply, /https?:\/\/(?!127\.0\.0\.1)|\beval\b|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the privileged release transaction never fetches or evaluates remote code");
  assert.match(updater, /systemd-run[\s\S]*migrate-linux-host-contract\.sh/, "a verified transient root transaction migrates host files outside the older updater's read-only namespace");
  assert.match(hostMigration, /RELEASE_ROOT.*RELEASES_ROOT[\s\S]*snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*\{1\.\.300\}/, "the fixed host migration accepts only retained releases and rolls back the complete contract after a bounded health failure");
  assert.match(hostMigration, /rollback_host_contract[\s\S]*SERVICE_NAME\.active[\s\S]*api\/setup\/status[\s\S]*restored_healthy/, "rollback is not reported as complete until the restored service is HTTP-healthy");
  assert.doesNotMatch(hostMigration, /https?:\/\/(?!127\.0\.0\.1)|\beval\b|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the privileged host migration never fetches or evaluates remote code");
  assert.match(lxcHelper, /ownership marker does not match/);
  assert.match(lxcHelper, /cleanup_incomplete_create[\s\S]*rm -rf -- "\$LXC_PATH\/\$name"[\s\S]*created=1[\s\S]*lxc-create/, "a failed create removes only its validated partial container directory");
  assert.match(lxcHelper, /cpuset\.cpus\.effective/, "LXC CPU limits are selected from the service's actually delegated host CPUs");
  assert.match(lxcHelper, /cpu_count/, "LXC inspection counts noncontiguous delegated CPU lists correctly");
  assert.match(lxcNetwork, /1helm-lxc-net-owned/, "the bridge wrapper stops only a bridge it started");
  assert.match(lxcNetwork, /1helm-lxc-net-rules-owned[\s\S]*table ip onehelm_lxc[\s\S]*masquerade/, "an adopted bridge receives a separately owned, removable outbound NAT contract");
  assert.match(lxcNetwork, /DNSMASQ_LEASE="\$DNSMASQ_STATE\/misc\/dnsmasq\.lxcbr0\.leases"[\s\S]*lease_state_writable[\s\S]*mktemp[\s\S]*bridge_dns_healthy/, "runtime health proves the exact private dnsmasq lease tree is writable from its current mount namespace");
  assert.match(lxcNetwork, /start_bridge_dns[\s\S]*dnsmasq[\s\S]*--dhcp-leasefile="\$DNSMASQ_LEASE"/, "1Helm starts its private DHCP server directly instead of inheriting the distro helper's system-wide lease path");
  assert.match(lxcNetwork, /--dhcp-range[\s\S]*10\.0\.3\.2,10\.0\.3\.254[\s\S]*--dhcp-lease-max=253[\s\S]*--dhcp-authoritative[\s\S]*--dhcp-leasefile=\$DNSMASQ_LEASE/, "runtime health verifies the exact DHCP and private lease-file process contract");
  assert.match(lxcNetwork, /rules_healthy[\s\S]*nft list chain inet onehelm_lxc input[\s\S]*nft list chain inet onehelm_lxc forward[\s\S]*nft list chain ip onehelm_lxc postrouting[\s\S]*10\\\.0\\\.3\\\.0\/24[\s\S]*masquerade/, "runtime health verifies the exact DNS, DHCP, forwarding, and outbound NAT rules instead of accepting table names alone");
  assert.match(lxcNetwork, /BRIDGE_CIDR="10\.0\.3\.1\/24"[\s\S]*bridge_dns_healthy[\s\S]*state UP[\s\S]*DNSMASQ_PID[\s\S]*--interface=lxcbr0[\s\S]*network_healthy/, "runtime health requires an up/addressed bridge and its exact dnsmasq process");
  assert.match(lxcNetwork, /bridge_dns_healthy[\s\S]*ensure_rules[\s\S]*network_healthy/, "a healthy bridge can restore only its owned firewall rules without disrupting containers");
  assert.match(lxcNetwork, /"\$LXC_NET" stop force[\s\S]*start_bridge_dns[\s\S]*network_healthy/, "a dead private bridge/DNS stack is rebuilt with 1Helm-owned DHCP state and reverified instead of adopted by interface name");
  assert.match(lxcHelper, /ready\)[\s\S]*"\$NETWORK_HELPER" start[\s\S]*"\$NETWORK_HELPER" check/, "runtime readiness repairs and then verifies the full network contract");
  assert.match(lxcHelper, /inspect\)[\s\S]*current_owner[\s\S]*printf 'null/, "inspection exposes only marker-less interrupted creates as safely rebuildable partial machines");
  assert.match(lxcHelper, /remove_incomplete[\s\S]*marker[\s\S]*lxc-destroy[\s\S]*rm -rf -- "\$LXC_PATH\/\$name"/, "create recovers only the exact validated marker-less partial container");
  assert.match(lxcHelper, /remove_incomplete\(\)[\s\S]*\]\] \|\| return 0/, "a missing partial container is a successful no-op under the runtime's fail-closed shell mode");
  assert.match(lxcInstaller, /systemctl enable --now 1helm-lxc-net\.service[\s\S]*"\$NETWORK_HELPER_PATH" start[\s\S]*"\$HELPER_PATH" ready/, "host installs and updates actively repair then verify the bridge contract without disrupting a healthy network");
  assert.match(lxcHelper, /nameserver 10\.0\.3\.1[\s\S]*apt-get update/, "new guests have bridge DNS before package bootstrap");
  assert.match(lxcConfig, /lxc\.apparmor\.profile = generated/);
  assert.match(lxcConfig, /lxc\.apparmor\.allow_nesting = 0/);
  assert.doesNotMatch(lxcConfig, /lxc\.mount\.entry|lxc\.mount\.auto[^\n]*home/, "the container config never maps a host home or application state");
  assert.match(uninstaller, /installation_id/);
  assert.match(uninstaller, /ctrl-pane\.db/, "Linux removal reads the real durable 1Helm database");
  assert.match(linuxUnits, /HELM_CHANNEL_COMPUTER_BACKEND=lxc/);
  assert.match(linuxUnits, /HELM_INSTALL_KIND=linux-systemd/, "standard Linux installs identify their host-owned update mechanism");
  assert.match(linuxUnits, /Delegate=yes/, "systemd delegates the service cgroup required for nested channel containers");
  assert.match(uninstaller, /"\$HELPER" delete "\$name" "\$INSTALLATION_ID:\$channel_id"/, "uninstall deletes only exact installation-owned containers");
  assert.match(uninstaller, /Preserved %s/, "uninstall preserves durable workspace state");
});

test("standalone deployment runs the website and tunnel without root process authority", () => {
  const siteUnit = readFileSync(`${root}/deploy/1helm-site.service`, "utf8");
  const tunnelUnit = readFileSync(`${root}/deploy/1helm-site-cloudflared.service`, "utf8");
  const tunnelConfig = readFileSync(`${root}/deploy/config-1helm-site.yml.example`, "utf8");
  assert.match(siteUnit, /DynamicUser=yes/);
  assert.match(siteUnit, /StateDirectory=1helm-site/);
  assert.match(siteUnit, /SITE_DATA_DIR=\/var\/lib\/1helm-site/);
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
