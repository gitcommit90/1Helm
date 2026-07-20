#!/usr/bin/env python3
"""Small JSON-lines bridge between 1Helm's Node runtime and Mnemosyne.

Each invocation opens exactly one agent-owned SQLite file. Content is supplied
on stdin so memories never appear in process listings.
"""

import json
import sys
from pathlib import Path

from mnemosyne import Mnemosyne


def main() -> None:
    request = json.load(sys.stdin)
    memory = Mnemosyne(
        session_id=str(request.get("session_id") or "default"),
        db_path=Path(request["db_path"]),
        author_id=str(request.get("author_id") or ""),
        author_type=str(request.get("author_type") or "system"),
        channel_id=str(request.get("channel_id") or "workspace"),
    )
    operation = request.get("operation")
    if operation == "init":
        result = {"ok": True, "db_path": str(memory.db_path)}
    elif operation == "remember":
        memory_id = memory.remember(
            str(request.get("content") or ""),
            source=str(request.get("source") or "1helm"),
            importance=float(request.get("importance") or 0.7),
            metadata=request.get("metadata") or {},
            scope=str(request.get("scope") or "global"),
            trust_tier=str(request.get("trust_tier") or "STATED"),
        )
        result = {"ok": True, "id": memory_id}
    elif operation == "recall":
        result = {
            "ok": True,
            "memories": memory.recall(
                str(request.get("query") or ""),
                top_k=max(1, min(24, int(request.get("top_k") or 8))),
                temporal_weight=float(request.get("temporal_weight") or 0.15),
            ),
        }
    elif operation == "stats":
        result = {"ok": True, "stats": memory.stats()}
    else:
        raise ValueError(f"Unknown operation: {operation}")
    json.dump(result, sys.stdout, default=str)


if __name__ == "__main__":
    main()
