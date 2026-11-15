#!/usr/bin/env python3
"""Call the 1Helm design MCP servers (public design sources) from the command line.

Usage:
  design_mcp.py brief "<what it is, who it is for, the mood>"
                                               one compact design brief (references, :root tokens, rules, components)
  design_mcp.py <server> tools                 list the server's tools with their inputs
  design_mcp.py <server> <tool> '<json args>'  call one tool and print its text result (args default to {})

Better Design follows the account's setting (Settings). When it is off, 1Helm sets DESIGN_MCP_BETTER_DESIGN=off for this script: `better-design`
calls then print one plain line and exit 0 without contacting Better Design, and `brief` leaves Better Design out.

Servers: magicui, reactbits, canvasui, better-design, inspo (Inspo's real-site references; its tools are recommend, search_screens, get_screen and more). The base URL comes from DESIGN_MCP_URL (for example https://mcp.1helm.com or your own deploy of design-mcp/). When it is not set the script prints one line saying so, makes no network call and exits 0.
Each run sends initialize first and carries Mcp-Session-Id when the server returns one. JSON and SSE responses both work.
Exit code 0 on success, 1 when the server or the tool reports an error (the message goes to stderr). Python 3 standard library only.
"""
import json
import os
import sys
import urllib.error
import urllib.request

SERVERS = ("magicui", "reactbits", "canvasui", "better-design", "inspo", "brief")
BASE = os.environ.get("DESIGN_MCP_URL", "").strip().rstrip("/")
NOT_CONFIGURED = "The design sources are not configured (DESIGN_MCP_URL is not set), so there is nothing to fetch. Go on without them."
PROTOCOL = "2025-06-18"
TIMEOUT = 60


def better_design_off():
    return os.environ.get("DESIGN_MCP_BETTER_DESIGN", "").strip().lower() in ("off", "0", "false", "no")


def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def read_response(resp, want_id):
    """Return the JSON-RPC message with id want_id from a JSON or SSE response body."""
    raw = resp.read().decode("utf-8", "replace")
    ctype = resp.headers.get("Content-Type", "")
    if "text/event-stream" in ctype:
        msgs = []
        for block in raw.replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in block.split("\n") if line.startswith("data:"))
            if data.strip():
                try:
                    msgs.append(json.loads(data))
                except ValueError:
                    pass
        for m in msgs:
            if isinstance(m, dict) and m.get("id") == want_id:
                return m
        fail("no response with id %s in the event stream" % want_id)
    if not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        fail("server did not return JSON: " + raw[:200])
    if isinstance(data, list):
        for m in data:
            if isinstance(m, dict) and m.get("id") == want_id:
                return m
        fail("no response with id %s" % want_id)
    return data


class Client:
    def __init__(self, server):
        self.url = "%s/%s/mcp" % (BASE, server)
        self.session = None
        self.next_id = 1

    def post(self, body, want_id=None):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL,
            "User-Agent": "1helm-design-mcp-client/1.0",
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            fail("%s answered HTTP %s: %s" % (self.url, e.code, detail))
        except Exception as e:
            fail("could not reach %s: %s" % (self.url, e))
        with resp:
            sid = resp.headers.get("Mcp-Session-Id")
            if sid:
                self.session = sid
            if want_id is None:
                resp.read()
                return None
            return read_response(resp, want_id)

    def request(self, method, params=None):
        rid = self.next_id
        self.next_id += 1
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params
        out = self.post(msg, rid)
        if out is None:
            fail("empty response to " + method)
        if "error" in out:
            fail("%s failed: %s" % (method, out["error"].get("message", out["error"])))
        return out.get("result", {})

    def start(self):
        self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "1helm-design-mcp-client", "version": "1.0"}})
        self.post({"jsonrpc": "2.0", "method": "notifications/initialized"})


def describe(tool):
    props = (tool.get("inputSchema") or {}).get("properties") or {}
    required = set((tool.get("inputSchema") or {}).get("required") or [])
    lines = [tool["name"] + ": " + (tool.get("description") or "").strip().split("\n")[0]]
    for name, spec in props.items():
        kind = spec.get("type", "any")
        if isinstance(kind, list):
            kind = "|".join(kind)
        note = (spec.get("description") or "").strip().split("\n")[0]
        lines.append("    %s (%s%s)%s" % (name, kind, ", required" if name in required else "", ": " + note if note else ""))
    return "\n".join(lines)


def main(argv):
    if len(argv) > 1 and argv[1] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return
    if not BASE:
        print(NOT_CONFIGURED)
        return
    if len(argv) >= 2 and argv[1] == "brief":
        if len(argv) < 3 or not " ".join(argv[2:]).strip():
            fail('usage: design_mcp.py brief "<what it is, who it is for, the mood>"')
        client = Client("brief")
        client.start()
        result = client.request("tools/call", {"name": "design_brief", "arguments": dict({"description": " ".join(argv[2:]).strip()}, **({"debug": True} if os.environ.get("DESIGN_BRIEF_DEBUG") else {}), **({"skip": ["better-design"]} if better_design_off() else {}))})
        text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
        if result.get("isError"):
            fail(text or "the design brief failed")
        print(text)
        return
    if len(argv) < 3 or argv[1] not in SERVERS:
        fail("usage: design_mcp.py <%s> tools | <tool> ['<json args>']" % "|".join(SERVERS))
    server, what = argv[1], argv[2]
    if server == "better-design" and better_design_off():
        print("Better Design is turned off for this account, so it was not used. Continue with the other design sources.")
        return
    client = Client(server)
    client.start()
    if what == "tools":
        tools = client.request("tools/list").get("tools", [])
        print("\n\n".join(describe(t) for t in tools))
        return
    try:
        args = json.loads(argv[3]) if len(argv) > 3 and argv[3].strip() else {}
    except ValueError as e:
        fail("the arguments are not valid JSON: %s" % e)
    if not isinstance(args, dict):
        fail("the arguments must be a JSON object")
    result = client.request("tools/call", {"name": what, "arguments": args})
    text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
    if result.get("isError"):
        fail(text or "the tool reported an error")
    print(text)


if __name__ == "__main__":
    main(sys.argv)
