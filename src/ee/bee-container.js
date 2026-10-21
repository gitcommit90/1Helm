// BeeContainer: unused. The Bee data calls and Live notes run in the Worker with fetch (src/ee/bee-api.js), so no Bee job runs in a container any more.
// The empty class is kept for now only because deleting a Durable Object class needs its own wrangler migration (a deleted_classes entry), and a
// version upload refuses new Durable Object migrations, so the deletion is a separate deploy step. To remove it later: delete this file and its exports in
// src/index.js and src/ee/index.js, then add the migration.
import { DurableObject } from "cloudflare:workers";

export class BeeContainer extends DurableObject {}
