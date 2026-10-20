// A Resident's numeric approval IDs are channel-local, never workspace-wide.
export function approvalCards(channels: any[], slug: string, id: string) {
  return channels.filter(c => c.slug === slug).flatMap(c => c.sessions).flatMap(s => s.messages).flatMap(m => m.cards || [])
    .filter(c => c.t === 'approval' && String(c.a.id) === String(id));
}
export function approvalResponse(channels: any[], slug: string, id: string, decision: string, result: any) {
  const cards = approvalCards(channels, slug, id), already = /^already (approved|denied|expired)/.exec(result?.error || '');
  for (const card of cards) {
    card.busy = '';
    if (!result?.error && result?.approval && String(result.approval.id) === String(id)) card.a = { ...card.a, ...result.approval };
    if (!result?.error) { card.st = result?.state === 'host_key_confirmation_required' ? 'host_key_required' : decision; card.confirm = false; }
    else if (already) { if (card.st === 'pending') card.st = already[1] === 'denied' ? 'deny' : already[1] === 'expired' ? 'expired' : 'allowed'; card.confirm = false; }
    else if (['ssh','ssh_hostkey'].includes(card.a.perm) && ['expired','cancelled','failed','consumed','host_key_required'].includes(result.status)) { card.st = result.status; card.confirm = false; }
    else card.err = `Couldn't send that (${result.error}). Try again.`;
  }
  const next = result?.approval;
  if (result?.error || !next || String(next.id) === String(id) || next.status !== 'pending' || next.perm !== 'ssh_hostkey' || next.ssh?.channel !== slug) return;
  const channel = channels.find(c => c.slug === slug);
  for (const session of channel?.sessions || []) {
    if (next.session && String(session.id) !== String(next.session)) continue;
    for (const message of session.messages) {
      if (!(message.cards || []).some((c: any) => c.t === 'approval' && String(c.a.id) === String(id))) continue;
      if (!message.cards.some((c: any) => c.t === 'approval' && String(c.a.id) === String(next.id))) message.cards.push({ t:'approval', a:next, st:'pending', fresh:true });
      session.status = 'waiting'; session.state = 'idle'; session.rawLine = 'waiting for server fingerprint confirmation';
    }
  }
}
