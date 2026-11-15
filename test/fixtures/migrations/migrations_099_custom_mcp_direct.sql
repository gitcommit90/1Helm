-- Custom MCP direct tool runs. Purely additive: one new nullable column on custom_mcp_server.
-- direct_sealed: JSON { v, id, endpoint, header, value } sealed with the platform VAULT_KEY (AES-GCM, sentinel.js sealSecret): the address and the sign-in
-- header (for an API-key server) that 1Helm's Worker needs to call the person's MCP server itself. NULL = the server was added before this column existed
-- (or has no VAULT_KEY), so its tool runs keep going through Composio. The value is never returned, logged or shown; it goes away with the row when the
-- server is disconnected.
ALTER TABLE custom_mcp_server ADD COLUMN direct_sealed TEXT;
