import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const releaseFixture = {
  tag_name: "v0.0.31",
  draft: false,
  prerelease: false,
  assets: [
    ["1Helm-0.0.31-arm64.dmg", "a"],
    ["1Helm-0.0.31-mac-arm64.zip", "b"],
    ["1Helm-0.0.31-linux-node.tgz", "c"],
    ["1Helm-0.0.31-windows-x64-setup.exe", "d"],
    ["1Helm-0.0.31-full.nupkg", "e"],
    ["RELEASES", "f"],
  ].map(([name, digit]) => ({
    name,
    digest: `sha256:${digit.repeat(64)}`,
    browser_download_url: `https://github.com/gitcommit90/1Helm/releases/download/v0.0.31/${name}`,
  })),
};
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const waitFor = async (url) => { const deadline = Date.now() + 10_000; while (Date.now() < deadline) { try { const result = await fetch(url); if (result.ok) return result; } catch {} await new Promise((resolve) => setTimeout(resolve, 80)); } throw new Error(`Timed out: ${url}`); };
const requestWithHost = (port, path, host) => new Promise((resolve, reject) => {
  const req = request({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => {
    res.resume();
    res.once("end", () => resolve(res));
  });
  req.once("error", reject);
  req.end();
});

test("standalone 1helm.com website serves independent product and documentation surface", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["site/server.mjs"], { cwd: root, env: { ...process.env, SITE_PORT: String(port), SITE_RELEASE_METADATA_JSON: JSON.stringify(releaseFixture) }, stdio: ["ignore", "pipe", "pipe"] });
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
    assert.match(manual, /retired pre-OCI sandbox is no longer running/i);
    assert.doesNotMatch(manual, /it's a public sandbox/i);
    const retiredDemo = await requestWithHost(port, "/manual?from=demo", "demo.1helm.com");
    assert.equal(retiredDemo.statusCode, 301);
    assert.equal(retiredDemo.headers.location, "https://1helm.com/manual?from=demo");
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
    assert.match(gettingStarted, /On Windows 11 x64, download the Setup executable/i);
    assert.match(gettingStarted, /v0\.0\.31 is <code>NotSigned<\/code>/i);
    assert.match(gettingStarted, /connect to an existing HTTPS 1Helm host/i);
    assert.doesNotMatch(gettingStarted, /signed Setup executable/i);
    assert.doesNotMatch(gettingStarted, /withheld/i);
    assert.equal((await fetch(`${base}/assets/site.css`)).status, 200);
    const windowsIcon = await fetch(`${base}/icons/icon-sailboat.ico`);
    assert.equal(windowsIcon.status, 200);
    assert.equal(windowsIcon.headers.get("content-type"), "image/x-icon");
    const benchmarkSchema = await (await fetch(`${base}/schemas/autonomy-benchmark-v1.json`)).json();
    assert.equal(benchmarkSchema.$id, "https://1helm.com/schemas/autonomy-benchmark-v1.json");
    assert.deepEqual(benchmarkSchema.required, ["schema", "product", "kind", "started_at", "finished_at", "deterministic", "scope", "summary", "checks"]);
    assert.equal((await fetch(`${base}/install.sh`)).status, 200);
    const linuxRelease = await (await fetch(`${base}/api/releases/linux/latest`)).json();
    assert.deepEqual(linuxRelease, {
      version: "0.0.31",
      url: "https://github.com/gitcommit90/1Helm/releases/download/v0.0.31/1Helm-0.0.31-linux-node.tgz",
      sha256: "c".repeat(64),
    });
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
  assert.match(installer, /install-oci-runtime\.sh/, "the host installer provisions the root-owned OCI boundary");
  assert.match(installer, /install-linux-units\.sh/, "fresh installs use the shared Linux service contract");
  assert.match(installer, /snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*TRANSACTION_ACTIVE/, "fresh and repeat installs restore runtime files and unit state after any transactional failure");
  assert.match(installer, /rollback_host_contract[\s\S]*1helm\.service\.active[\s\S]*api\/setup\/status[\s\S]*restored_healthy/, "installer rollback verifies the restored service before claiming recovery");
  assert.match(installer, /NODE_VERSION="22\.23\.1"/);
  assert.match(installer, /RELEASE_METADATA_URL="https:\/\/1helm\.com\/api\/releases\/linux\/latest"/, "fresh installs resolve the complete current release from the product site");
  assert.match(installer, /expectedUrl = `https:\/\/github\.com\/gitcommit90\/1Helm\/releases\/download\/v\$\{version\}\/\$\{name\}`/, "fresh installs accept only the canonical artifact URL for the resolved version");
  assert.match(installer, /RELEASE_SHA256[\s\S]*sha256sum -c -[\s\S]*tar -xzf/, "fresh installs verify the Linux release digest before extraction");
  assert.match(installer, /install-oci-runtime\.sh[\s\S]*channel-machine\.oci\.tar[\s\S]*npm[^\n]*ci/, "fresh installs reject an artifact without the complete OCI runtime before running release code");
  assert.match(installer, /NETWORK_BACKEND_FILE[\s\S]*cat "\$NETWORK_BACKEND_FILE"[\s\S]*printf '%s' netavark[\s\S]*install-oci-runtime\.sh/, "the web bootstrap repairs v0.0.30's newline-terminated Podman backend before invoking release code");
  assert.doesNotMatch(installer, /git clone|git checkout/, "fresh installs never combine the current installer with an older source-only tag");
  assert.doesNotMatch(installer, /api\.github\.com/, "fresh installs do not depend on unauthenticated GitHub API quota");
  assert.match(installer, /need=\([^\n]*flock[^\n]*make[^\n]*c\+\+[^\n]*python3[^\n]*\)/, "the host updater and native dependency toolchain are probed even when download prerequisites already exist");
  assert.match(installer, /import ensurepip[\s\S]*python3-venv/, "the Linux host installs Python's venv support required by durable memory instead of accepting a python3 executable alone");
  assert.doesNotMatch(installer, /npm[^\n]*ci[^\n]*--omit=optional/, "platform-specific optional build packages are retained");
  assert.match(installer, /EXISTING_VERSION=.*package\.json[\s\S]*EXISTING_VERSION.*VERSION/, "repeat installs verify the retained release version");
  assert.doesNotMatch(installer, /chown -R[^\n]*\$STATE_ROOT/, "repeat installs never recursively rewrite root-owned OCI channel storage");
  assert.match(installer, /chown -R "\$SERVICE_USER:\$SERVICE_USER" "\$RELEASE_ROOT"/, "the extracted application release remains service-owned");
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
  assert.match(updater, /\$RELEASE_ROOT\/site\/public\/install-oci-runtime\.sh/, "the updater installs OCI runtime files from the retained release after staging moves");
  assert.match(updater, /install-linux-units\.sh/, "updates retain one coherent host service contract");
  assert.match(updater, /snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*cleanup_transaction/, "updates transactionally restore runtime files, symlink, and unit state");
  assert.doesNotMatch(updater, /eval|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the root updater never evaluates remote shell content");
  const ociInstaller = readFileSync(`${root}/site/public/install-oci-runtime.sh`, "utf8");
  const ociHelper = readFileSync(`${root}/scripts/1helm-oci-runtime`, "utf8");
  const ociManifest = readFileSync(`${root}/deploy/1helm-oci-runtime-v1.conf`, "utf8");
  const ociRecipe = readFileSync(`${root}/container/Containerfile.oci`, "utf8");
  const uninstaller = readFileSync(`${root}/site/public/uninstall-host.sh`, "utf8");
  assert.match(ociManifest, /ONEHELM_OCI_STATE_ROOT="\/var\/lib\/1helm-oci-v1\/runtime\/oci"/, "the clean-slate OCI state has its own fixed data root");
  assert.match(ociInstaller, /acl[\s\S]*crun[\s\S]*fuse-overlayfs[\s\S]*podman/, "the installer supplies the complete OCI and direct-access prerequisites");
  assert.match(ociInstaller, /visudo -cf/, "the minimal helper-only sudo policy is validated before installation");
  assert.match(ociInstaller, /cgroup2fs/, "live CPU and memory controls require cgroup v2");
  assert.match(ociHelper, /com\.1helm\.managed[\s\S]*com\.1helm\.owner[\s\S]*com\.1helm\.machine/, "every container has exact ownership labels");
  assert.match(ociHelper, /actual != expected[\s\S]*container storage mounts do not match/, "runtime adoption verifies the complete authoritative mount set");
  assert.match(ociHelper, /ONEHELM_OCI_SERVICE_USER/, "the installed service identity participates in the direct storage contract");
  assert.match(ociHelper, /setfacl[\s\S]*d:u:\$AGENT_UID:rwx/, "Files and Cowork receive inherited narrow direct access to runtime-owned storage");
  assert.match(ociHelper, /podman[\s\S]*update --cpus[\s\S]*--memory/, "live resource controls use the native OCI engine");
  assert.match(ociHelper, /exec\)[\s\S]*\(\(\$# >= 6\)\)[\s\S]*missing exec separator/, "the helper accepts the six required argv values for one direct command");
  assert.match(ociHelper, /exec --user 0:0[\s\S]*numeric_user="0:0"[\s\S]*numeric_user="\$AGENT_UID:\$AGENT_GID"[\s\S]*--user "\$AGENT_UID:\$AGENT_GID"/, "host-reboot recovery uses pinned numeric container identities instead of race-prone passwd-name lookup");
  assert.match(ociHelper, /network\.json[\s\S]*--ip "\$ip" --mac-address "\$mac"/, "each channel receives a persistent static IP and locally administered MAC");
  assert.match(ociHelper, /container static network creation contract does not match[\s\S]*container network ID does not match[\s\S]*running container network identity does not match/, "runtime adoption verifies create-time and live network identity");
  assert.match(ociHelper, /network_ids_compatible/, "network ID checks tolerate short/full ids and pre-start NetworkID gaps");
  assert.match(ociHelper, /backup_container[\s\S]*sha256sum[\s\S]*restore_container[\s\S]*backup digest does not match/, "backup and recovery are digest-qualified and ownership-gated");
  assert.match(ociHelper, /source\.extractall\(destination, filter="data"\)/, "backup extraction rejects unsafe archive paths");
  assert.match(ociRecipe, /docker\.io\/library\/ubuntu:24\.04@sha256:[a-f0-9]{64}/, "the OCI guest base is fully qualified and digest-pinned without mutable short-name state");
  assert.match(ociHelper, /--network-config-dir "\$NETWORKS_ROOT" --tmpdir "\$LIBPOD_TMP"/, "Podman persistent network configuration and libpod scratch stay inside 1Helm-owned roots");
  assert.match(ociHelper, /podman_image\(\)[^\n]*localhost/, "the helper maps 1Helm's portable local image identity to Podman's explicit localhost transport");
  assert.match(ociHelper, /defaultNetworkBackend[\s\S]*cat "\$STORAGE_ROOT\/defaultNetworkBackend"[\s\S]*printf '%s' netavark/, "Podman's backend selector is repaired to the exact netavark token without a trailing newline");
  assert.doesNotMatch(ociHelper, /printf 'netavark\\n'/, "fresh Ubuntu Podman must never receive a newline-terminated backend selector");
  assert.doesNotMatch([installer, updater, releaseApply, ociInstaller, ociHelper, ociManifest, ociRecipe].join("\n"), /\blxc\b|per-channel WSL|migration-backups/i, "the clean-slate Linux contract has no legacy runtime bridge");
  assert.match(linuxUnits, /ReadWritePaths=[^\n]*\/usr\/libexec(?:\s|$)[^\n]*\/etc\/default(?:\s|$)[^\n]*\/etc\/systemd\/system(?:\s|$)[^\n]*\/etc\/sudoers\.d(?:\s|$)/, "future updater transactions can atomically replace and roll back only the required host-contract parent trees");
  assert.match(updater, /systemd-run[\s\S]*apply-linux-release\.sh[\s\S]*exit 0/, "all post-verification Linux release mutations run in one transient root transaction outside the updater namespace");
  assert.match(releaseApply, /RELEASE_ROOT.*RELEASES_ROOT[\s\S]*snapshot_host_contract[\s\S]*install-oci-runtime\.sh[\s\S]*mv -Tf[\s\S]*install-linux-units\.sh[\s\S]*api\/setup\/status/, "the delegated release transaction owns runtime, source switch, units, and health together");
  assert.match(releaseApply, /rollback_host_contract[\s\S]*rollback-current[\s\S]*SERVICE_NAME\.active[\s\S]*api\/setup\/status/, "a failed delegated release restores the exact prior source and proves its service healthy");
  assert.doesNotMatch(releaseApply, /https?:\/\/(?!127\.0\.0\.1)|\beval\b|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the privileged release transaction never fetches or evaluates remote code");
  assert.match(uninstaller, /installation_id/);
  assert.match(uninstaller, /ctrl-pane\.db/, "Linux removal reads the real durable 1Helm database");
  assert.match(linuxUnits, /HELM_CHANNEL_COMPUTER_BACKEND=oci/);
  assert.match(linuxUnits, /HELM_INSTALL_KIND=linux-systemd/, "standard Linux installs identify their host-owned update mechanism");
  assert.match(readFileSync(`${root}/src/server/channel-computers.ts`, "utf8"), /HELM_INSTALL_KIND === "linux-systemd"[\s\S]*source-tree fallback is disabled/, "installed Linux services cannot silently execute a helper from a mutable source checkout");
  assert.match(linuxUnits, /Delegate=yes/, "systemd delegates the service cgroup required for nested channel containers");
  assert.match(linuxUnits, /\/etc\/tmpfiles\.d\/1helm-oci\.conf[\s\S]*systemd-tmpfiles --create/, "fresh installs and boot recreate Podman's ephemeral runtime roots before the hardened service namespace is assembled");
  for (const path of ["/run/1helm-oci", "/run/containers", "/run/crun", "/run/libpod", "/run/netns"]) {
    assert.match(linuxUnits, new RegExp(`^d ${path.replaceAll("/", "\\/")} [0-7]{4} root root -$`, "m"), `tmpfiles owns the ephemeral ${path} runtime tree across reboot`);
  }
  for (const path of ["/run/containers", "/run/crun", "/run/libpod", "/run/lock", "/run/netns"]) {
    assert.match(linuxUnits, new RegExp(`ReadWritePaths=[^\\n]*${path.replaceAll("/", "\\/")}(?:\\s|$)`), `the sandbox permits Podman's ephemeral ${path} runtime tree`);
  }
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
