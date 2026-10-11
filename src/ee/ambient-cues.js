// Optional voice-inbox cues are evidence of emphasis, never identity or permission.
export function ambientCueLines(lines, settings, prefix = [], suffix = []) {
  if (settings?.enabled !== true || !Array.isArray(settings.phrases) || !settings.phrases.length) return lines;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = settings.phrases.slice(0, 8).filter((p) => typeof p === "string" && p.trim() && [...p].length <= 80)
    .map((p) => ({ phrase: p, pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${p.trim().split(/\s+/).map(escape).join("\\s+")}(?![\\p{L}\\p{N}_])`, "iu") }));
  const before = prefix.slice(-4), all = [...before, ...lines, ...suffix.slice(0, 4)], matches = [];
  all.forEach((line, index) => {
    for (const { phrase, pattern } of patterns) {
      const match = pattern.exec(line.text); if (!match) continue;
      matches.push({ index, phrase, quote: match[0], at: line.at, utterance_id: line.utterance_id, offset: (line.offset || 0) + match.index, speaker: line.speaker, speaker_id: line.speaker_id || null });
    }
  });
  return all.map((line, index) => {
    const capture_cues = matches.filter((m) => Math.abs(index - m.index) <= 4 && (index === m.index || m.at != null && line.at != null && Math.abs(line.at - m.at) <= 120000)
      && (!m.speaker_id || !line.speaker_id || m.speaker_id === line.speaker_id)
      && (!m.speaker || !line.speaker || /unknown|^speaker\s*\d*$/i.test(m.speaker) || /unknown|^speaker\s*\d*$/i.test(line.speaker) || m.speaker === line.speaker)).slice(-8).map(({ index: _, ...m }) => m);
    return capture_cues.length ? { ...line, intentional_capture: true, capture_cues, capture_attribution: line.is_user ? "wearer_marked_by_provider" : "unconfirmed", cue_settings_revision: settings.revision || 0 } : line;
  }).slice(before.length, before.length + lines.length);
}
