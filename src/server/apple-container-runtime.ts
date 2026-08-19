export const APPLE_RUNTIME_VERSION = "1.1.0";

type AppleResult = { code: number; stdout: Buffer; stderr: Buffer };
type AppleCommand = (args: string[], opts?: { timeoutMs?: number }) => Promise<AppleResult>;

export function exactAppleRuntimeVersion(value: unknown): boolean {
  const versions = Array.isArray(value) ? value : value ? [value] : [];
  const cliVersion = versions.find((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).appName || "") === "container") as Record<string, unknown> | undefined;
  const apiVersion = versions.find((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).appName || "") !== "container") as Record<string, unknown> | undefined;
  const apiVersionValue = String(apiVersion?.version || "");
  return String(cliVersion?.version || "") === APPLE_RUNTIME_VERSION
    && (apiVersionValue === APPLE_RUNTIME_VERSION
      || new RegExp(`^container-apiserver version ${APPLE_RUNTIME_VERSION.replaceAll(".", "\\.")}(?:\\s|$)`).test(apiVersionValue));
}

let startPass: Promise<void> | null = null;

/** Apple Container services are scoped to the signed-in user's launchd
 * domain. A logout removes them even though retained machines remain intact. */
export async function ensureAppleRuntimeRunning(apple: AppleCommand): Promise<void> {
  if (!startPass) {
    startPass = (async () => {
      const current = await apple(["system", "status", "--format", "json"], { timeoutMs: 10_000 });
      let status = "";
      if (current.code === 0) {
        try { status = String(JSON.parse(current.stdout.toString("utf8"))?.status || ""); } catch { /* reported below */ }
      }
      if (status !== "running") {
        if (!new Set(["stopped", "unregistered"]).has(status)) {
          throw new Error(Buffer.concat([current.stderr, current.stdout]).toString("utf8").trim() || "Apple container runtime status was unreadable.");
        }
        const started = await apple(
          status === "unregistered" ? ["system", "start", "--enable-kernel-install"] : ["system", "start"],
          { timeoutMs: status === "unregistered" ? 10 * 60_000 : 90_000 },
        );
        if (started.code !== 0) throw new Error(started.stderr.toString("utf8").trim() || started.stdout.toString("utf8").trim() || "Apple container services could not start.");
      }
      const [verifiedStatus, verifiedVersion] = await Promise.all([
        apple(["system", "status", "--format", "json"], { timeoutMs: 10_000 }),
        apple(["system", "version", "--format", "json"], { timeoutMs: 10_000 }),
      ]);
      let verified = "", version: unknown = null;
      try { verified = String(JSON.parse(verifiedStatus.stdout.toString("utf8"))?.status || ""); } catch { /* rejected below */ }
      try { version = JSON.parse(verifiedVersion.stdout.toString("utf8")); } catch { /* rejected below */ }
      if (verifiedStatus.code !== 0 || verified !== "running" || verifiedVersion.code !== 0 || !exactAppleRuntimeVersion(version)) {
        throw new Error("Apple container services started but did not pass the pinned runtime health check.");
      }
    })().finally(() => { startPass = null; });
  }
  await startPass;
}
