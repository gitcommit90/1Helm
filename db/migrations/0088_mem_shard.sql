-- Memory shards (src/mem-shard.js): the shard that holds an account's memory. 0 is the main database. Additive; existing accounts stay on shard 0.
ALTER TABLE tenants ADD COLUMN mem_shard INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tenants_mem_shard ON tenants (mem_shard);
