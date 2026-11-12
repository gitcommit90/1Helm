// Test stub for the "cloudflare:workers" module, so Durable Object classes can be imported in node.
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
