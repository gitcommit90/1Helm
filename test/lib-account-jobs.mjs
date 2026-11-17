// A fake ACCOUNT_JOBS queue for tests: it keeps what the cron sends, and drain() hands the messages to the Worker's queue handler the way Cloudflare does.
export const fakeQueue = () => { const sent = []; return { sent, sendBatch: async (ms) => { sent.push(...ms.map((m) => m.body)); } }; };
export async function drain(worker, env, q, queue = "account-jobs") {
  const out = { acked: 0, retried: [] };
  while (q.sent.length) {
    const bodies = q.sent.splice(0);
    await worker.queue({ queue, messages: bodies.map((body) => ({ body, attempts: 1, ack: () => out.acked++, retry: (o) => out.retried.push({ body, ...o }) })) }, env);
  }
  return out;
}
