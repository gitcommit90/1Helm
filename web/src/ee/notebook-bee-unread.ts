// Separate from approving/dismissing Bee facts. Browser-local, account/channel scoped.
// Persist only opaque identity/version pairs, never notebook text.
type Fact = { id: number | string; at?: number | null };
export function notebookBeeUnread(account: string, channel = "main", storage?: Pick<Storage, "getItem" | "setItem">) {
  const key = `1hc-notebook-bee-seen:${encodeURIComponent(account)}:${encodeURIComponent(channel)}`;
  let seen = new Set<string>(), pending: string[] = [], connected = false;
  const identity = (f: Fact) => `${f.id}:${Number(f.at) || 0}`;
  try { const saved = JSON.parse(storage?.getItem(key) || "[]"); if (Array.isArray(saved)) seen = new Set(saved.filter(x => typeof x === "string" && /^\d+:\d+$/.test(x)).slice(-2000)); } catch {}
  return {
    update(facts: Fact[] | null) { connected = Array.isArray(facts); pending = connected ? facts!.slice(0, 200).filter(f => /^\d+$/.test(String(f.id))).map(identity) : []; },
    unread() { return connected && pending.some(id => !seen.has(id)); },
    visit() {
      if (!connected || !pending.some(id => !seen.has(id))) return;
      for (const id of pending) { seen.delete(id); seen.add(id); }
      const current = new Set(pending); for (const id of seen) { if (seen.size <= 2000) break; if (!current.has(id)) seen.delete(id); }
      try { storage?.setItem(key, JSON.stringify([...seen])); } catch {} // blocked storage still works in memory
    },
  };
}
