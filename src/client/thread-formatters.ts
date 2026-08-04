import type { AgentProgress, Message, ThreadUsage } from "./api.ts";

/** Pure presentation rules shared by the thread transcript and work log. */
export function progressStatusTone(status: string): string {
  if (status === "running") return "animate-pulse bg-amber-400";
  if (status === "failed") return "bg-danger";
  return "bg-ok";
}

export function progressStatusLabel(status: string): string {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "done";
}

export function humanToolName(raw: string): string {
  return raw.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

/** Split tool progress body: "name: input" then optional "\\nresult". */
export function parseToolBody(body: string): { title: string; input: string; output: string } {
  const text = body || "";
  const nl = text.indexOf("\n");
  const head = nl >= 0 ? text.slice(0, nl) : text;
  const rest = nl >= 0 ? text.slice(nl + 1).trim() : "";
  const colon = head.indexOf(":");
  if (colon < 0) return { title: humanToolName(head) || "tool", input: "", output: rest };
  return {
    title: humanToolName(head.slice(0, colon)) || "tool",
    input: head.slice(colon + 1).trim(),
    output: rest,
  };
}

export function progressPreviewLine(items: AgentProgress[]): string {
  // Live current step only. Falling back to an old thought makes the preview
  // snap backwards after every tool tick.
  const running = [...items].reverse().find((item) => item.status === "running") || items[items.length - 1];
  if (!running) return "";
  if (running.kind === "tool") {
    const { title, input } = parseToolBody(running.body);
    return input ? `${title} · ${input.slice(0, 72)}` : title;
  }
  if (running.kind === "thinking") {
    const line = running.body.trim().split(/\n+/).find(Boolean) || "Thinking…";
    return line.slice(0, 80) + (line.length > 80 ? "…" : "");
  }
  return (running.body || "Working…").slice(0, 80);
}

export function stickyThoughtFromProgress(items: AgentProgress[] | undefined): string {
  if (!items?.length) return "";
  const thought = [...items].reverse().find((item) => item.kind === "thinking" && item.body.trim());
  return thought?.body.trim() || "";
}

/** Replace only the literal Working label, not the whole summary row. */
export function stickyWorkingLabel(items: AgentProgress[] | undefined): string {
  const sticky = stickyThoughtFromProgress(items);
  if (!sticky) return "Working…";
  const line = sticky.split(/\n+/).find(Boolean) || sticky;
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

/** Body shown while an agent turn is mid-flight; keep the last real thought sticky. */
export function workingDisplayBody(message: Message): string {
  if (message.body && message.body !== "_Working…_") return message.body;
  const sticky = stickyThoughtFromProgress(message.progress);
  return sticky || message.body || "_Working…_";
}

export function workingChipLabel(message: Message): string {
  if (message.progress?.length) return stickyWorkingLabel(message.progress);
  if (message.body && message.body !== "_Working…_") {
    const line = message.body.trim().split(/\n+/).find(Boolean) || "Working…";
    return line.length > 72 ? `${line.slice(0, 72)}…` : line;
  }
  return "Working…";
}

export function progressCounts(items: AgentProgress[]): string {
  const tools = items.filter((item) => item.kind === "tool").length;
  const thoughts = items.filter((item) => item.kind === "thinking").length;
  const parts: string[] = [];
  if (tools) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (thoughts) parts.push(`${thoughts} thought${thoughts === 1 ? "" : "s"}`);
  if (!parts.length) parts.push(`${items.length} step${items.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Compact token count for the thread header (1.2k, 340, …). */
export function formatRoughTokens(value: number): string {
  const rounded = Math.max(0, Math.round(Number(value) || 0));
  if (rounded >= 1_000_000) {
    const millions = rounded / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (rounded >= 1000) {
    const thousands = rounded / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(rounded);
}

export function threadUsageLabel(usage: ThreadUsage): string {
  return `Used ${formatRoughTokens(usage.input_tokens)} in · ${formatRoughTokens(usage.output_tokens)} out`;
}

export function formatThreadFollowupCountdown(dueAt: number, nowMs = Date.now()): string {
  const remaining = Math.max(0, Math.floor((dueAt - nowMs) / 1000));
  if (remaining <= 0) return "now";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
