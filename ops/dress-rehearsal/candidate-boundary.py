#!/usr/bin/env python3
"""Fail-closed validation and evidence formatting for the private candidate host."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

KIND = "1helm-dress-rehearsal-candidate"
REPOSITORY = "gitcommit90/1Helm"
REF = "refs/heads/main"
HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
VERSION = re.compile(r"^\d+\.\d+\.\d+$")
BUILD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path, maximum: int = 1024 * 1024) -> dict:
    if not path.is_file() or path.stat().st_size > maximum:
        fail(f"{path.name} is missing or too large")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        fail(f"{path.name} is not valid JSON: {error}")
    if not isinstance(value, dict):
        fail(f"{path.name} must contain a JSON object")
    return value


def sha256_stream(stream) -> str:
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def expect(value, pattern, label: str) -> str:
    text = str(value or "")
    if not pattern.fullmatch(text):
        fail(f"invalid {label}")
    return text


def validate(manifest_path: Path, archive_path: Path, allow_local: bool) -> dict:
    manifest = load_json(manifest_path)
    if manifest.get("schema") != 1 or manifest.get("kind") != KIND:
        fail("candidate manifest schema or kind mismatch")
    source = manifest.get("source") or {}
    if source.get("repository") != REPOSITORY or source.get("ref") != REF:
        fail("candidate repository or ref mismatch")
    state = str(source.get("state") or "")
    if state != "trusted-main" and not (allow_local and state in {"local-worktree", "rollback-fixture"}):
        fail("candidate source is not trusted main")
    commit = expect(source.get("commit"), HEX40, "source commit")
    source_digest = expect(source.get("source_archive_sha256"), HEX64, "source archive digest")
    version = expect(manifest.get("version"), VERSION, "version")
    build = manifest.get("build") or {}
    build_id = expect(build.get("identity"), BUILD, "build identity")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", str(build.get("created_at") or "")):
        fail("invalid candidate creation time")
    ci = manifest.get("ci") or {}
    if state == "trusted-main":
        valid_ci = ci.get("workflow") == "CI" and ci.get("conclusion") == "success" and str(ci.get("run_id") or "").isdigit()
    else:
        valid_ci = ci.get("workflow") == "local" and ci.get("conclusion") == "not_run" and str(ci.get("run_id")) == "0"
    if not valid_ci:
        fail("candidate CI identity does not match its source state")
    artifact = manifest.get("artifact") or {}
    expected_name = f"1Helm-{version}-linux-node.tgz"
    if artifact.get("name") != expected_name:
        fail("candidate artifact name/version mismatch")
    archive_sha = expect(artifact.get("sha256"), HEX64, "artifact digest")
    if not archive_path.is_file() or archive_path.stat().st_size != artifact.get("bytes"):
        fail("candidate archive size mismatch")
    with archive_path.open("rb") as stream:
        if sha256_stream(stream) != archive_sha:
            fail("candidate archive SHA-256 mismatch")
    oci_sha = expect((manifest.get("sealed_oci") or {}).get("sha256"), HEX64, "sealed OCI digest")

    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.isdev():
                fail("candidate archive contains an unsafe entry")
        identity_members = [member for member in members if re.fullmatch(r"[^/]+/resources/candidate-build\.json", member.name)]
        package_members = [member for member in members if re.fullmatch(r"[^/]+/package\.json", member.name)]
        oci_members = [member for member in members if re.fullmatch(r"[^/]+/container/channel-machine\.oci\.tar", member.name)]
        if len(identity_members) != 1 or len(package_members) != 1 or len(oci_members) != 1:
            fail("candidate archive identity/package/sealed OCI layout mismatch")
        try:
            identity = json.load(archive.extractfile(identity_members[0]))
            package = json.load(archive.extractfile(package_members[0]))
        except (TypeError, json.JSONDecodeError) as error:
            fail(f"candidate embedded identity is invalid: {error}")
        embedded_oci = archive.extractfile(oci_members[0])
        if embedded_oci is None or sha256_stream(embedded_oci) != oci_sha:
            fail("sealed OCI bytes do not match the candidate identity")

    comparisons = {
        "schema": 1,
        "kind": KIND,
        "repository": REPOSITORY,
        "ref": REF,
        "commit": commit,
        "source_state": state,
        "build_identity": build_id,
        "created_at": build.get("created_at"),
        "version": version,
        "source_archive_sha256": source_digest,
        "sealed_oci_sha256": oci_sha,
    }
    for key, expected_value in comparisons.items():
        if identity.get(key) != expected_value:
            fail(f"embedded candidate {key} mismatch")
    if identity.get("ci") != ci or package.get("version") != version:
        fail("embedded CI identity or package version mismatch")
    return manifest


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def attempt(manifest: dict) -> dict:
    return {
        "commit": manifest["source"]["commit"],
        "digest": manifest["artifact"]["sha256"],
        "version": manifest["version"],
        "build_identity": manifest["build"]["identity"],
        "source_state": manifest["source"]["state"],
        "ci": ({"workflow": "local", "run_id": "0", "conclusion": "not_run"}
               if manifest["source"]["state"] != "trusted-main" else manifest["ci"]),
    }


def record(manifest_path: Path, previous_path: Path, output_path: Path, result: str,
           health: str, rollback: str, message: str) -> dict:
    manifest = load_json(manifest_path)
    previous = load_json(previous_path) if previous_path.is_file() else {}
    prior_running = previous.get("running_candidate")
    current_attempt = attempt(manifest)
    rollback_record = {"result": rollback, "checked_at": now()}
    previous_rollback = previous.get("last_rollback") or previous.get("rollback") or {}
    if result == "healthy" and rollback == "not_needed" and previous_rollback.get("result") == "healthy":
        rollback_record = previous_rollback
    status = {
        "schema": 1,
        "kind": "1helm-dress-rehearsal-status",
        "checked_at": now(),
        "running_candidate": current_attempt if result == "healthy" else prior_running,
        "last_attempt": current_attempt,
        "previous_candidate": prior_running if result == "healthy" else previous.get("previous_candidate"),
        "install": {"result": result, "health": health, "checked_at": now(), "message": message},
        "rollback": {"result": rollback, "checked_at": now()},
        "last_rollback": rollback_record,
    }
    output_path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    return status


def summary(status: dict) -> str:
    running = status.get("running_candidate") or {}
    previous = status.get("previous_candidate") or {}
    ci = running.get("ci") or (status.get("last_attempt") or {}).get("ci") or {}
    install = status.get("install") or {}
    rollback = status.get("last_rollback") or status.get("rollback") or {}
    ci_line = "not run (local provisioning proof)" if running.get("source_state") != "trusted-main" else (
        f"{ci.get('workflow', 'unknown')} run {ci.get('run_id', 'unknown')} — {ci.get('conclusion', 'unknown')}"
    )
    lines = [
        "1Helm private dress rehearsal",
        f"  Running: v{running.get('version', 'unknown')} @ {running.get('commit', 'unknown')}",
        f"  Digest: {running.get('digest', 'unknown')}",
        f"  Build: {running.get('build_identity', 'unknown')}",
        f"  CI: {ci_line}",
        f"  Install health: {install.get('result', 'unknown')} / {install.get('health', 'unknown')} at {install.get('checked_at', 'unknown')}",
        f"  Previous: {previous.get('commit', 'none')} / {previous.get('digest', 'none')}",
        f"  Rollback: {rollback.get('result', 'unknown')} at {rollback.get('checked_at', 'unknown')}",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("validate")
    check.add_argument("manifest", type=Path)
    check.add_argument("archive", type=Path)
    check.add_argument("output", type=Path)
    check.add_argument("--allow-local", action="store_true")
    evidence = sub.add_parser("record")
    evidence.add_argument("manifest", type=Path)
    evidence.add_argument("previous", type=Path)
    evidence.add_argument("output", type=Path)
    evidence.add_argument("result", choices=["healthy", "failed"])
    evidence.add_argument("health", choices=["healthy", "unhealthy", "unknown"])
    evidence.add_argument("rollback", choices=["not_needed", "healthy", "failed", "unavailable"])
    evidence.add_argument("message")
    show = sub.add_parser("summary")
    show.add_argument("status", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "validate":
            value = validate(args.manifest, args.archive, args.allow_local)
            args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        elif args.command == "record":
            record(args.manifest, args.previous, args.output, args.result, args.health, args.rollback, args.message)
        else:
            print(summary(load_json(args.status)), end="")
    except (OSError, ValueError, tarfile.TarError) as error:
        raise SystemExit(f"Candidate boundary refused input: {error}")


if __name__ == "__main__":
    main()
