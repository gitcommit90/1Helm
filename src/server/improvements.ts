import { now, q, q1, run, type Row } from "./db.ts";
import { rememberForAgent } from "./memory.ts";

const CHECK_EVERY_MS = Number(process.env.IMPROVEMENT_INTERVAL_MS || 60 * 60_000);
const frustration = /\b(frustrat|annoy|angry|wrong again|not what i asked|stop doing|why (?:do|did) you|i already (?:said|told)|listen to me)\b/i;
const correction = /\b(no,? |actually|instead|do not|don't|never|always|i prefer|please (?:stop|use|remember))\b/i;

export function runImprovementPass(agentId?: number): number {
  const agents = agentId
    ? q("SELECT a.*,ac.channel_id FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id WHERE a.id=? AND a.status<>'deleted'", agentId)
    : q("SELECT a.*,ac.channel_id FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id WHERE a.kind='channel' AND a.status NOT IN ('deleted','archived')");
  let improved = 0;
  let reviewed = 0;
  let signalsSeen = 0;
  const skipper = q1("SELECT a.*, NULL channel_id FROM agents a WHERE a.kind='skipper' AND a.status<>'deleted' LIMIT 1");
  const improvedNames: string[] = [];
  for (const agent of agents) {
    const channelId = Number(agent.channel_id || 0);
    if (!channelId) continue;
    reviewed++;
    const checkpoint = q1("SELECT last_message_id,last_run FROM improvement_checkpoints WHERE agent_id=?", agent.id);
    const since = Number(checkpoint?.last_message_id || 0);
    const messages = q(`SELECT m.id,m.body,m.created,u.display FROM messages m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.channel_id=? AND m.user_id IS NOT NULL AND m.id>? ORDER BY m.id DESC LIMIT 40`, channelId, since).reverse();
    const latest = Number(messages.at(-1)?.id || since);
    if (messages.length) {
      const signals = messages.filter((message) => frustration.test(String(message.body)) || correction.test(String(message.body)));
      signalsSeen += signals.length;
      if (signals.length) {
        const hasFrustration = signals.some((message) => frustration.test(String(message.body)));
        const instruction = hasFrustration
          ? "Treat corrections as high-priority evidence: acknowledge the concrete mismatch, change course immediately, verify the requested outcome, and do not make the user repeat context already present in the thread."
          : "Carry explicit user preferences and corrections into future turns; reflect the corrected constraint before acting and verify that the result follows it.";
        const duplicate = q1("SELECT id FROM agent_improvements WHERE agent_id=? AND instruction=? AND status='active'", agent.id, instruction);
        if (!duplicate) {
          const source = signals.at(-1)!;
          run(`INSERT INTO agent_improvements (agent_id,channel_id,kind,summary,instruction,source_message_id,status,created)
            VALUES (?,?, 'interaction', ?,?,?, 'active',?)`, agent.id, channelId,
          `Skipper reviewed recent interaction signals and strengthened @${agent.name}'s response to corrections.`, instruction, source.id, now());
          run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'improvement',?,'complete','skipper',?)",
            channelId, `Skipper improved @${agent.name}: future turns will adapt faster to corrections and verify the requested outcome.`, now());
          rememberForAgent(agent, instruction, { source: `skipper-improvement:message:${source.id}`, importance: 0.9, metadata: { kind: "behavior-improvement", channel_id: channelId } });
          if (skipper) rememberForAgent(skipper, `In #${String(q1("SELECT name FROM channels WHERE id=?", channelId)?.name || channelId)}, @${agent.name} was improved: ${instruction}`,
            { source: `workspace-improvement:agent:${agent.id}`, importance: 0.8, metadata: { channel_id: channelId, agent_id: agent.id } });
          improved++;
          improvedNames.push(`@${agent.name}`);
        }
      }
    }
    run(`INSERT INTO improvement_checkpoints (agent_id,last_message_id,last_run) VALUES (?,?,?)
      ON CONFLICT(agent_id) DO UPDATE SET last_message_id=MAX(improvement_checkpoints.last_message_id,excluded.last_message_id),last_run=excluded.last_run`, agent.id, latest, now());
  }

  // Workspace breadcrumb on #main so Activity surfaces quiet/hourly Skipper reviews.
  // Skip single-agent scheduleAgentReview noise (thread resolve triggers) when nothing changed.
  const main = q1(`SELECT c.id FROM channels c JOIN users u ON u.id=c.personal_main_owner_id
    WHERE c.name='main' AND c.kind='channel' AND c.status='active' AND u.is_admin=1 ORDER BY u.id,c.id LIMIT 1`);
  if (main && (!agentId || improved > 0)) {
    const summary = improved
      ? `Skipper improvement pass: strengthened ${improved} agent(s) (${improvedNames.slice(0, 6).join(", ")}).`
      : `Skipper improvement pass: reviewed ${reviewed} agent(s), ${signalsSeen} correction signal(s); no new durable guidance.`;
    run(
      "INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'improvement',?,?, 'skipper',?)",
      main.id,
      summary.slice(0, 500),
      improved ? "complete" : "quiet",
      now(),
    );
  }
  return improved;
}

let timer: NodeJS.Timeout | null = null;
export function startImprovementLoop(): void {
  if (timer) return;
  setTimeout(() => runImprovementPass(), Math.min(30_000, CHECK_EVERY_MS)).unref();
  timer = setInterval(() => runImprovementPass(), Math.max(60_000, CHECK_EVERY_MS));
  timer.unref();
}

export function scheduleAgentReview(agentId: number): void {
  setTimeout(() => runImprovementPass(agentId), 250).unref();
}
