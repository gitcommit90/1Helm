// Named SQLite Durable Objects belonging to the single-owner workspace.
// The plan is rebuilt from authoritative Archive and Resident state while
// writes are stopped. R2 itself is copied separately with metadata intact.
const bindingOf = Object.freeze({ Archive: "ARCHIVE", Resident: "RESIDENT", ChannelComputer: "CHANNEL_COMPUTER", NativeTransport: "NATIVE_TRANSPORT", UsageLedger: "LEDGER", Computer: "COMPUTER", FilePrep: "FILE_PREP" });

export async function snapshotTargets(env, tenantId) {
  if (env.ENV_NAME !== "selfhost" || !tenantId) throw new Error("snapshot unavailable");
  const target = (kind, name) => ({ kind, name });
  const a = env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tenantId}`));
  const channels = await a.channels();
  const list = [target("Archive", `archive:${tenantId}`), target("UsageLedger", `tenant:${tenantId}`),
    target("Computer", `computer:${tenantId}`), target("Computer", `prepjob:${tenantId}`)];
  for (const ch of channels) {
    const slug = ch.slug || ch.name;
    if (typeof slug !== "string" || !slug || slug.length > 128) throw new Error("invalid channel in snapshot plan");
    const residentName = `res:${tenantId}:${slug}`;
    list.push(target("Resident", residentName), target("ChannelComputer", `cc:${tenantId}:${slug}`));
    if (env.NATIVE_TRANSPORT) list.push(target("NativeTransport", `${tenantId}:${slug}`));
    const resident = env.RESIDENT.get(env.RESIDENT.idFromName(residentName));
    for (const key of await resident.snapshotFileKeys()) list.push(target("FilePrep", `prep:${key}`));
  }
  return [...new Map(list.map((item) => [`${item.kind}\0${item.name}`, item])).values()];
}

export function snapshotStub(env, target) {
  const binding = bindingOf[target?.kind];
  if (!binding || typeof target.name !== "string" || !target.name) throw new Error("invalid snapshot target");
  const namespace = env[binding];
  if (!namespace) throw new Error(`missing snapshot binding: ${binding}`);
  return namespace.get(namespace.idFromName(target.name));
}
