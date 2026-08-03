import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
    assert.doesNotMatch(manual, /public sandbox|retired pre-OCI sandbox/i);
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
    // Windows ships no application and no artifact, so the one thing a Windows
    // reader needs from this page is the exact install command. The retired
    // Setup-executable story must not come back either: SmartScreen and
    // Authenticode cannot apply to a product that ships no .exe, so repeating
    // them here would warn people about a file that does not exist and tell them
    // to click through a dialog they will never see.
    assert.match(gettingStarted, /irm https:\/\/1helm\.com\/install\.ps1 \| iex/);
    assert.doesNotMatch(gettingStarted, /Setup executable|SmartScreen|Authenticode|NotSigned|Squirrel/i);
    assert.match(gettingStarted, /connect to an existing HTTPS 1Helm host/i);
    assert.doesNotMatch(gettingStarted, /withheld/i);
    // The Windows guide is the only install instructions Windows has. Each of
    // these is something the user sees on screen and would otherwise read as a
    // failure: the deliberate stop for a restart, Microsoft's own WSL window,
    // the runtime's post-install prepare, and the ExecutionPolicy wall that only
    // appears when the script is downloaded rather than piped.
    const installWindows = await (await fetch(`${base}/manual/install-windows`)).text();
    assert.match(installWindows, /irm https:\/\/1helm\.com\/install\.ps1 \| iex/);
    assert.match(installWindows, /irm https:\/\/1helm\.com\/uninstall\.ps1 \| iex/);
    assert.match(installWindows, /Restart required/);
    assert.match(installWindows, /Welcome to WSL/);
    assert.match(installWindows, /40 seconds/);
    assert.match(installWindows, /ExecutionPolicy Bypass -File/);
    assert.match(installWindows, /localhost:8123/);
    // SmartScreen may only be mentioned to say it does not happen. Telling a
    // Windows user to click through "More info -> Run anyway", or naming an
    // artifact or an %APPDATA% data root that no longer exists, would send them
    // looking for a file this product does not ship.
    assert.match(installWindows, /SmartScreen never appears/);
    assert.doesNotMatch(installWindows, /Setup executable|Squirrel|NotSigned|Run anyway|%APPDATA%/i);
    assert.equal((await fetch(`${base}/assets/site.css`)).status, 200);
    const windowsIcon = await fetch(`${base}/icons/icon-sailboat.ico`);
    assert.equal(windowsIcon.status, 200);
    assert.equal(windowsIcon.headers.get("content-type"), "image/x-icon");
    const benchmarkSchema = await (await fetch(`${base}/schemas/autonomy-benchmark-v1.json`)).json();
    assert.equal(benchmarkSchema.$id, "https://1helm.com/schemas/autonomy-benchmark-v1.json");
    assert.deepEqual(benchmarkSchema.required, ["schema", "product", "kind", "started_at", "finished_at", "deterministic", "scope", "summary", "checks"]);
    assert.equal((await fetch(`${base}/install.sh`)).status, 200);
    // Windows installs via `irm https://1helm.com/install.ps1 | iex`, and that
    // script downloads its keepalive payload from this same origin. If either
    // route 404s the install fails partway, so both are contract surface.
    assert.equal((await fetch(`${base}/install.ps1`)).status, 200);
    // Removal is `irm https://1helm.com/uninstall.ps1 | iex` and there is no
    // Add/Remove Programs entry to fall back on, so a 404 here strands every
    // Windows installation with no supported way off the machine.
    assert.equal((await fetch(`${base}/uninstall.ps1`)).status, 200);
    for (const part of ["keepalive-install.ps1", "keepalive-run.ps1", "keepalive-remove.ps1", "keepalive-hold.sh"]) {
      assert.equal((await fetch(`${base}/keepalive/${part}`)).status, 200, `/keepalive/${part} must be served`);
    }
    assert.equal((await fetch(`${base}/keepalive/../server.mjs`)).status, 404, "the keepalive route must not escape its directory");
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
    // Windows ships no downloadable installer any more - it is a PowerShell
    // one-liner that installs the Linux build into WSL - so this must lead to
    // the instructions, never to a Setup executable that no longer exists.
    const windowsDownload = await fetch(`${base}/download/windows`, { redirect: "manual" });
    assert.equal(windowsDownload.status, 302);
    assert.equal(windowsDownload.headers.get("location"), "/manual/install-windows");
  } finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
});

test("release metadata stays available when GitHub's unauthenticated API is exhausted", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["site/server.mjs"], {
    cwd: root,
    env: { ...process.env, SITE_PORT: String(port), SITE_RELEASE_FETCH_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/health`);
    const response = await fetch(`${base}/api/releases/linux/latest`);
    // Derived from package.json rather than pinned: the point of this contract
    // is that the offline fallback serves the SHIPPING release, so hardcoding a
    // version here would keep passing while the fallback silently went stale.
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    const server = readFileSync(join(root, "site", "server.mjs"), "utf8");
    const pending = server.includes('const PENDING_DIGEST = "pending-release-digest"')
      && new RegExp(`\\["1Helm-${version.replaceAll(".", "\\.")}-linux-node\\.tgz", PENDING_DIGEST\\]`).test(server);
    if (pending) {
      // Digests are the digests OF the release commit's artifacts, so they are
      // filled in at publish. Until then this must fail closed rather than hand
      // an installer a digest that cannot match what it downloads.
      assert.equal(response.status, 503, "a fallback with pending digests must refuse, not serve a wrong digest");
    } else {
      assert.equal(response.status, 200);
      const offline = await response.json();
      assert.equal(offline.version, version, "the offline fallback serves the shipping version");
      assert.equal(offline.url, `https://github.com/gitcommit90/1Helm/releases/download/v${version}/1Helm-${version}-linux-node.tgz`);
      assert.match(offline.sha256, /^[a-f0-9]{64}$/, "the offline fallback carries a real digest");
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
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
  assert.match(installer, /install-oci-runtime\.sh[\s\S]*channel-machine\.oci\.tar[\s\S]*verify_ready_to_run "\$RELEASE_STAGE"/, "fresh installs reject an artifact without the complete OCI runtime before executing anything the archive shipped");
  assert.match(installer, /resources\/cloudflared-linux-\$NODE_ARCH/, "fresh Linux installs reject archives without the connector for the current architecture");
  assert.match(installer, /NETWORK_BACKEND_FILE[\s\S]*cat "\$NETWORK_BACKEND_FILE"[\s\S]*printf '%s' netavark[\s\S]*install-oci-runtime\.sh/, "the web bootstrap repairs v0.0.30's newline-terminated Podman backend before invoking release code");
  assert.doesNotMatch(installer, /git clone|git checkout/, "fresh installs never combine the current installer with an older source-only tag");
  assert.doesNotMatch(installer, /api\.github\.com/, "fresh installs do not depend on unauthenticated GitHub API quota");
  assert.match(installer, /need=\([^\n]*flock[^\n]*python3[^\n]*\)/, "the host updater and Python prerequisites are probed even when download prerequisites already exist");
  assert.doesNotMatch(installer, /need=\([^\n]*(?:\bmake\b|c\+\+)/, "no compiler is probed: the release ships native addons already compiled against the oldest supported glibc");
  assert.doesNotMatch(installer, /build-essential/, "the Linux host never installs a C/C++ toolchain, because nothing on the user's machine builds 1Helm");
  assert.match(installer, /import ensurepip[\s\S]*python3-venv/, "the Linux host installs Python's venv support required by durable memory instead of accepting a python3 executable alone");
  // The ready-to-run release archive replaces the on-host build entirely. These
  // assertions are the user-visible contract: no compiler, no npm registry, and
  // a refusal rather than a broken install when the archive cannot actually run.
  assert.doesNotMatch(installer, /bin\/npm/, "fresh installs consume the ready-to-run release archive instead of building it on the user's machine");
  assert.match(installer, /node_modules[\s\S]*resources\/linux-native-modules\.json[\s\S]*public\/bundle\.js/, "fresh installs fail closed on a source-only archive that carries neither vendored dependencies nor built client assets");
  assert.match(installer, /manifest\.arch !== hostArch[\s\S]*manifest\.nodeAbi[\s\S]*process\.versions\.modules[\s\S]*process\.dlopen[\s\S]*node-pty[\s\S]*spawn/, "fresh installs prove every shipped native addon loads on this host's exact Node ABI and that node-pty can spawn, so terminals cannot silently be dead");
  assert.match(installer, /verify_ready_to_run "\$RELEASE_STAGE"[\s\S]*RELEASE_ROOT="\$RELEASES_ROOT/, "the staged archive is proven runnable before any release directory is promoted");
  assert.match(installer, /systemctl stop 1helm\.service[\s\S]*createServer\(\)[\s\S]*listen\(8123[\s\S]*network namespace[\s\S]*systemctl start 1helm\.service/, "installs stop first and then refuse to start behind a foreign listener that would answer the readiness probe instead of 1Helm");
  assert.doesNotMatch(installer, /if command -v ss[^\n]*then\n\s*echo "Port 8123/, "the port-collision check never depends on ss being installed, which would skip it in silence");
  assert.match(installer, /systemctl is-active 1helm\.service[\s\S]*api\/setup\/status[\s\S]*journalctl -u 1helm\.service/, "readiness requires this unit to be active rather than any HTTP answer on the port, and prints the journal when it is not");
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
  assert.match(linuxUnits, /Environment=HELM_APP_ROOT=\$INSTALL_ROOT\/current/, "Linux explicitly exposes the active packaged root to runtime resource resolvers");
  assert.match(updater, /\^sha256:\[a-f0-9\]\{64\}\$/, "the Linux updater requires GitHub's exact SHA-256 asset digest");
  assert.match(updater, /sha256sum -c -/);
  assert.match(updater, /CONNECTOR_ARCH[\s\S]*resources\/cloudflared-linux-\$CONNECTOR_ARCH/, "Linux updates reject archives without the connector for the current architecture");
  assert.match(updater, /mv -Tf .*current/);
  assert.match(updater, /atomic host transaction[\s\S]*rollback was proven healthy/i, "the updater defers rollback reporting to the transaction that can prove restored HTTP health");
  assert.match(updater, /VERSION_ORDER[\s\S]*Never downgrade[\s\S]*TARGET_VERSION="\$CURRENT_VERSION"/, "the root updater never replaces a newer installed host with an older latest-release response");
  assert.match(releaseApply, /PREVIOUS_RELEASE[\s\S]*== "\$RELEASES_ROOT\/"\*[\s\S]*\{1\.\.300\}/, "the atomic update transaction rejects unsafe rollback links and uses the same bounded startup allowance");
  assert.match(updater, /\$RELEASE_ROOT\/site\/public\/install-oci-runtime\.sh/, "the updater installs OCI runtime files from the retained release after staging moves");
  assert.match(updater, /install-linux-units\.sh/, "updates retain one coherent host service contract");
  assert.match(updater, /snapshot_host_contract[\s\S]*rollback_host_contract[\s\S]*cleanup_transaction/, "updates transactionally restore runtime files, symlink, and unit state");
  assert.doesNotMatch(updater, /eval|curl[^\n]*\|[^\n]*(?:sh|bash)/, "the root updater never evaluates remote shell content");
  // Updates take the same ready-to-run path as fresh installs. Without this the
  // first install is fast but every later update is slow and needs a compiler.
  assert.doesNotMatch(updater, /bin\/npm/, "host updates consume the ready-to-run release archive instead of building it on the user's machine");
  assert.match(updater, /has_vendored_dependencies "\$STAGE"[\s\S]*bundle\.js[\s\S]*verify_native_addons "\$STAGE"[\s\S]*mv -- "\$STAGE" "\$RELEASE_ROOT"/, "a staged release proves it is runnable before it is promoted into the release store, so a failure leaves nothing half-promoted");
  assert.match(updater, /manifest\.nodeAbi[\s\S]*process\.versions\.modules[\s\S]*process\.dlopen[\s\S]*node-pty[\s\S]*spawn/, "updates prove every shipped native addon loads on this host's exact Node ABI before promoting the release");
  assert.match(releaseApply, /node_modules[\s\S]*linux-native-modules\.json[\s\S]*bundle\.js[\s\S]*process\.dlopen[\s\S]*snapshot_host_contract/, "the delegated transaction proves the retained release is runnable before it opens the transaction that moves the current symlink");
  assert.match(releaseApply, /systemctl is-active "\$SERVICE_NAME"[\s\S]*api\/setup\/status[\s\S]*journalctl/, "the delegated transaction requires its own unit to be active rather than any HTTP answer on the port");
  const linuxPackaging = readFileSync(`${root}/scripts/package-linux-host.mjs`, "utf8");
  assert.match(linuxPackaging, /"npm", "ci", "--omit=dev"/, "the release archive vendors exactly the production dependency tree the host will run");
  assert.doesNotMatch(linuxPackaging, /--omit=optional/, "platform-specific optional build packages are retained in the shipped dependency tree");
  assert.match(linuxPackaging, /nodeAbi[\s\S]*modules,/, "the shipped manifest records the Node ABI and every native addon the host must be able to load");
  const ociInstaller = readFileSync(`${root}/site/public/install-oci-runtime.sh`, "utf8");
  const ociHelper = readFileSync(`${root}/scripts/1helm-oci-runtime`, "utf8");
  const ociManifest = readFileSync(`${root}/deploy/1helm-oci-runtime-v1.conf`, "utf8");
  const ociRecipe = readFileSync(`${root}/container/Containerfile.oci`, "utf8");
  const uninstaller = readFileSync(`${root}/site/public/uninstall-host.sh`, "utf8");
  assert.match(ociManifest, /ONEHELM_OCI_STATE_ROOT="\/var\/lib\/1helm-oci-v1\/runtime\/oci"/, "the clean-slate OCI state has its own fixed data root");
  assert.match(ociInstaller, /acl[\s\S]*crun[\s\S]*fuse-overlayfs[\s\S]*podman/, "the installer supplies the complete OCI and direct-access prerequisites");
  assert.match(ociInstaller, /visudo -cf/, "the minimal helper-only sudo policy is validated before installation");
  assert.match(ociInstaller, /cgroup2fs/, "live CPU and memory controls require cgroup v2");
  assert.match(ociInstaller, /\/etc\/apparmor\.d\/local\/crun[\s\S]*systemd-detect-virt --container[\s\S]*network inet,[\s\S]*network inet6,[\s\S]*apparmor_parser -r/, "nested Linux hosts install the narrow crun address-family grants needed for resident sockets");
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
  assert.match(ociHelper, /Netavark 1\.4 starts aardvark-dns[\s\S]*"dns_enabled"[\s\S]*False[\s\S]*--disable-dns/, "system-service OCI networks bypass netavark's unavailable user-bus DNS scope and inherit working host resolvers");
  assert.doesNotMatch(ociHelper, /network create --disable-dns=false/, "fresh resident networks never point at a gateway DNS listener that cannot start from the system service");
  assert.match(ociHelper, /network-ready-v1[\s\S]*timeout 7[\s\S]*socket\.socket\(socket\.AF_INET,socket\.SOCK_STREAM\)[\s\S]*socket\.getaddrinfo\("example\.com",443[\s\S]*socket\.create_connection/, "a bounded first-start check requires resident socket creation, public DNS, and TCP egress before the network contract becomes ready");
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
  assert.match(uninstaller, /cmp -s[\s\S]*\/etc\/apparmor\.d\/local\/crun[\s\S]*apparmor_parser -r/, "uninstall removes and reloads only the exact app-managed crun profile");
  // Windows has no Add/Remove Programs entry behind it, so this script IS the
  // uninstaller. Its destructive half is `wsl --unregister`, which deletes the
  // virtual disk holding every channel's files and the entire database - and
  // `wsl --shutdown` would additionally stop every other distribution on the
  // machine for every user. Both need to stay behind their guards.
  const windowsUninstaller = readFileSync(`${root}/site/public/uninstall.ps1`, "utf8");
  assert.doesNotMatch(windowsUninstaller, /(?:&\s*\$WslExe|wsl\.exe)[^\n]*--shutdown/, "removal never invokes `wsl --shutdown`, which would stop every distribution for every user on the machine");
  assert.match(windowsUninstaller, /NEVER calls `wsl --shutdown`/, "the shutdown ban is stated where the next maintainer will read it");
  assert.match(windowsUninstaller, /S-1-5-18/, "removal refuses to run as SYSTEM, which cannot see the user's per-user WSL state");
  assert.match(windowsUninstaller, /function Test-SafeTarget[\s\S]*IsNullOrWhiteSpace[\s\S]*ProtectedDistroPattern[\s\S]*-ceq \$Name/, "a blank, protected, or inexactly matching distribution name is refused before anything destructive");
  assert.match(windowsUninstaller, /Test-SafeTarget \$Distro[\s\S]*--terminate[\s\S]*--unregister/, "targeted terminate and unregister both sit behind that exact-name gate");
  assert.match(windowsUninstaller, /if \(-not \$Force\)[\s\S]*Read-Host[\s\S]*-ne 'remove'/, "destroying the data root requires typed confirmation unless -Force is passed");
  assert.match(windowsUninstaller, /keepalive-remove\.ps1[\s\S]*uninstall-host\.sh[\s\S]*--unregister/, "the keepalive stops, then 1Helm's own Linux uninstaller runs inside the distribution, and only then is the distribution discarded");
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

test("the website's offline release fallback names the shipping version", () => {
  // This fallback is served when GitHub's release API is unreachable or rate
  // limited. A stale entry does not fail loudly — it quietly hands every
  // visitor an older build from the download links, which is exactly how a
  // release goes out with the previous version behind the buttons.
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const server = readFileSync(join(root, "site", "server.mjs"), "utf8");
  const block = server.match(/const RELEASE_FALLBACK = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(block, "site/server.mjs still exposes a release fallback block");
  assert.match(server, new RegExp(`RELEASE_FALLBACK_TAG = "v${version.replaceAll(".", "\\.")}"`), "the fallback tag matches package.json");
  // Three artifacts, not six: Windows publishes nothing, it installs the Linux
  // archive inside WSL. A fallback still naming a Setup executable or .nupkg
  // would advertise files the release does not contain.
  for (const asset of [
    `1Helm-${version}-arm64.dmg`,
    `1Helm-${version}-mac-arm64.zip`,
    `1Helm-${version}-linux-node.tgz`,
  ]) {
    assert.ok(block.includes(asset), `the release fallback names ${asset}`);
  }
  for (const gone of ["windows-x64-setup.exe", "full.nupkg", '"RELEASES"']) {
    assert.ok(!block.includes(gone), `the release fallback must not advertise ${gone}`);
  }
  const digests = [...block.matchAll(/"([a-f0-9]{64})"/g)].map((m) => m[1]);
  const pendingCount = [...block.matchAll(/PENDING_DIGEST/g)].length;
  if (pendingCount) {
    // Pre-publish: every digest must be pending, never a mix. A half-filled
    // fallback would serve one real and two wrong digests.
    assert.equal(pendingCount, 3, "either all three fallback digests are pending or none are");
    assert.equal(digests.length, 0, "a pending fallback must not also carry a stale real digest");
  } else {
    assert.equal(digests.length, 3, "all three desktop artifacts carry a fallback digest");
    assert.equal(new Set(digests).size, 3, "no two fallback digests are duplicated");
  }
});
