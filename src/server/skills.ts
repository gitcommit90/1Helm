import { now, q, q1, run, tx, type Row } from "./db.ts";

export const skillSlug = (value: string): string => value.trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export function listSkills(): Row[] {
  return q(`SELECT s.*, COUNT(ask.agent_id) assigned_agents FROM skills s
    LEFT JOIN agent_skills ask ON ask.skill_id=s.id WHERE s.status='active'
    GROUP BY s.id ORDER BY s.category, s.name`);
}

export function listTemplates(): Row[] {
  return q("SELECT * FROM agent_templates WHERE status='active' ORDER BY sort_order,name").map((template) => ({
    ...template,
    skill_slugs: parseList(template.skill_slugs),
  }));
}

export function skillsForAgent(agentId: number): Row[] {
  return q(`SELECT s.*, ask.reason, ask.permanent, ask.created provisioned_at
    FROM skills s JOIN agent_skills ask ON ask.skill_id=s.id
    WHERE ask.agent_id=? AND s.status='active' ORDER BY s.category,s.name`, agentId);
}

export function provisionSkill(agentId: number, slugInput: string, provisionedBy: number | null, reason = "Provisioned by Skipper."): Row {
  const slug = skillSlug(slugInput);
  const skill = q1("SELECT * FROM skills WHERE slug=? AND status='active'", slug);
  if (!skill) throw new Error(`Skill ${slug || slugInput} is not in the workspace arsenal.`);
  const agent = q1("SELECT id FROM agents WHERE id=? AND status<>'deleted'", agentId);
  if (!agent) throw new Error("Agent not found.");
  run(`INSERT INTO agent_skills (agent_id,skill_id,provisioned_by,reason,permanent,created) VALUES (?,?,?,?,1,?)
    ON CONFLICT(agent_id,skill_id) DO UPDATE SET reason=CASE WHEN agent_skills.reason='' THEN excluded.reason ELSE agent_skills.reason END,permanent=1`,
  agentId, skill.id, provisionedBy, reason.slice(0, 1000), now());
  return q1("SELECT * FROM skills WHERE id=?", skill.id)!;
}

export function provisionInitialSkills(agentId: number, templateSlug = "general", purpose = "", provisionedBy: number | null = null): Row[] {
  const template = q1("SELECT * FROM agent_templates WHERE slug=? AND status='active'", skillSlug(templateSlug))
    || q1("SELECT * FROM agent_templates WHERE slug='general'");
  const wanted = new Set(parseList(template?.skill_slugs));
  const text = purpose.toLowerCase();
  if (/research|investigat|evidence|learn|study/.test(text)) wanted.add("research");
  if (/project|launch|build|plan|product|campaign/.test(text)) wanted.add("project-planning");
  if (/home|house|family|photo|document|drive|storage|server|self.?host/.test(text)) {
    wanted.add("home-ops"); wanted.add("self-hosting-guide");
  }
  if (/mail|email|inbox|message|support/.test(text)) wanted.add("inbox-triage");
  for (const required of ["capability-discovery", "durable-memory", "quality-verification"]) wanted.add(required);
  return [...wanted].map((slug) => provisionSkill(agentId, slug, provisionedBy, `Provisioned for the ${template?.name || "agent"} starting role and channel purpose.`));
}

export function createSkill(opts: { name: string; description: string; instructions: string; category?: string; source?: string }): Row {
  const name = opts.name.trim().slice(0, 100);
  const slug = skillSlug(name);
  const description = opts.description.trim().slice(0, 1000);
  const instructions = opts.instructions.trim().slice(0, 10_000);
  if (!name || !slug || !description || !instructions) throw new Error("A skill needs a name, description, and instructions.");
  const existing = q1("SELECT * FROM skills WHERE slug=?", slug);
  if (existing) return existing;
  const id = run(`INSERT INTO skills (slug,name,description,category,instructions,source,status,created,updated)
    VALUES (?,?,?,?,?,?,'active',?,?)`, slug, name, description, skillSlug(opts.category || "general") || "general", instructions, opts.source || "skipper", now(), now()).lastInsertRowid;
  return q1("SELECT * FROM skills WHERE id=?", id)!;
}

export function proposeSkill(opts: { agentId: number; channelId: number; threadId: number; name: string; description: string; rationale: string }): Row {
  const name = opts.name.trim().slice(0, 100);
  const description = opts.description.trim().slice(0, 1000);
  const rationale = opts.rationale.trim().slice(0, 4000);
  if (!name || !description) throw new Error("Describe the reusable skill you are proposing.");
  return tx(() => {
    const proposalId = run(`INSERT INTO skill_proposals (agent_id,channel_id,thread_id,name,description,rationale,status,created)
      VALUES (?,?,?,?,?,?,'proposed',?)`, opts.agentId, opts.channelId, opts.threadId, name, description, rationale, now()).lastInsertRowid;
    // Safe behavioral skills are accepted immediately. This keeps the self-improvement
    // loop silent and useful; capabilities involving credentials still go through Skipper.
    const skill = createSkill({
      name,
      description,
      instructions: `${description}\n\nUse this workflow only when it matches the current task. Preserve user control, never embed credentials, and verify outcomes before claiming completion.`,
      category: "agent-created",
      source: "agent-proposed",
    });
    provisionSkill(opts.agentId, String(skill.slug), skipperId(), `Approved from this agent's reusable solution: ${rationale || description}`);
    run("UPDATE skill_proposals SET status='approved',resulting_skill_id=?,reviewed=? WHERE id=?", skill.id, now(), proposalId);
    run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,actor_type,created) VALUES (?,?,'skill',?,'skipper',?)",
      opts.channelId, opts.threadId, `Skipper approved @${String(q1("SELECT name FROM agents WHERE id=?", opts.agentId)?.name || "agent")}'s new ${skill.name} skill and added it to the workspace arsenal.`, now());
    return q1("SELECT sp.*, s.slug skill_slug FROM skill_proposals sp LEFT JOIN skills s ON s.id=sp.resulting_skill_id WHERE sp.id=?", proposalId)!;
  });
}

export function requestSkill(agentId: number, channelId: number, threadId: number, requestedSlug: string, reason: string): Row {
  const skill = provisionSkill(agentId, requestedSlug, skipperId(), reason || "Requested by the agent while solving a channel problem.");
  run("INSERT INTO channel_activity (channel_id,thread_id,kind,summary,actor_type,created) VALUES (?,?,'skill',?,'skipper',?)",
    channelId, threadId, `Skipper permanently provisioned ${skill.name} for @${String(q1("SELECT name FROM agents WHERE id=?", agentId)?.name || "agent")}.`, now());
  return skill;
}

export function agentSkillContext(agentId: number): string {
  const assigned = skillsForAgent(agentId);
  const catalog = listSkills();
  const assignedSlugs = new Set(assigned.map((skill) => String(skill.slug)));
  const improvements = q("SELECT summary,instruction,created FROM agent_improvements WHERE agent_id=? AND status='active' ORDER BY created DESC LIMIT 8", agentId);
  return [
    "<assigned-skills>",
    assigned.map((skill) => `### ${skill.name} (${skill.slug})\n${skill.instructions}`).join("\n\n") || "No specialized skills are assigned yet.",
    "</assigned-skills>",
    "<workspace-skill-catalog>",
    "You know these skills exist even when they are not assigned. If one would materially help, call request_skill; the grant is permanent.",
    catalog.map((skill) => `- ${skill.slug}${assignedSlugs.has(String(skill.slug)) ? " [assigned]" : ""}: ${skill.description}`).join("\n"),
    "If a solved workflow would be reusable and no catalog skill covers it, silently call propose_skill.",
    "</workspace-skill-catalog>",
    improvements.length ? `<skipper-improvements>\n${improvements.map((item) => `- ${item.instruction || item.summary}`).join("\n")}\n</skipper-improvements>` : "",
  ].filter(Boolean).join("\n\n");
}

export function templateForSlug(slug: string): Row | undefined {
  return q1("SELECT * FROM agent_templates WHERE slug=? AND status='active'", skillSlug(slug));
}

export function parseList(value: unknown): string[] {
  try { const result = JSON.parse(String(value || "[]")); return Array.isArray(result) ? result.map(String) : []; }
  catch { return []; }
}

function skipperId(): number | null {
  const skipper = q1("SELECT id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
  return skipper ? Number(skipper.id) : null;
}
