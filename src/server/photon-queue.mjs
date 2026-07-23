/** Bounded in-memory handoff for the supervised Photon sidecar. */
export function createPhotonInboundQueue(maxInbound = 2000) {
  const inbound = [];
  const waiters = new Set();

  return {
    push(event) {
      const waiter = waiters.values().next().value;
      if (waiter) {
        waiters.delete(waiter);
        waiter(event);
        return;
      }
      inbound.push(event);
      while (inbound.length > maxInbound) inbound.shift();
    },
    next(timeoutMs = 25_000, signal) {
      if (inbound.length) return Promise.resolve(inbound.shift());
      return new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (event) => {
          if (settled) return;
          settled = true;
          waiters.delete(finish);
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          resolve(event);
        };
        const abort = () => finish(null);
        if (signal?.aborted) return finish(null);
        waiters.add(finish);
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(null), timeoutMs);
        timer.unref?.();
      });
    },
    get size() { return inbound.length; },
    get waiting() { return waiters.size; },
  };
}
