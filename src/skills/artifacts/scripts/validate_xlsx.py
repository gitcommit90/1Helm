#!/usr/bin/env python3
"""Read a finished spreadsheet back before it is shared: does it open, and does it hold data?

Checks a .xlsx/.xlsm with the standard library (zip integrity, the declared sheets and
their parts, populated cells and formulas per sheet), then reopens it with openpyxl.
A formula with no calculated value stored (what openpyxl writes) fails: run recalc_xlsx.py
first, so the person never opens a sheet of blank totals.
A .csv/.tsv gets a csv-module read-back instead (rows, columns, ragged rows).
Exits non-zero on any failure; the reason goes to stderr as a FAIL line.

usage: validate_xlsx.py <file.xlsx|file.csv> [--json-out <path>] [--allow-empty]
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def part_path(target: str) -> str:
    """Turn a workbook relationship target into a zip member name."""
    target = target.lstrip("/")
    return target if target.startswith("xl/") else "xl/" + target.removeprefix("./")


def declared_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str | None]]:
    """(sheet name, part it points at) for every sheet in workbook.xml.

    Pairing names with parts catches a sheet whose part is missing, which a plain
    count of worksheet files would not (and a chartsheet is legitimately not one).
    """
    try:
        root = ET.fromstring(zf.read("xl/workbook.xml"))
    except (KeyError, ET.ParseError):
        return []
    targets: dict[str, str] = {}
    try:
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in rels.iter(f"{PKG_REL_NS}Relationship"):
            if rel.get("Id") and rel.get("Target"):
                targets[rel.get("Id")] = part_path(rel.get("Target"))
    except (KeyError, ET.ParseError):
        pass
    out = []
    for i, el in enumerate(root.iter(f"{SHEET_NS}sheet")):
        rid = el.get(f"{REL_NS}id") or el.get("r:id")
        out.append((el.get("name") or f"Sheet{i + 1}", targets.get(rid) if rid else None))
    return out


def sheet_stats(zf: zipfile.ZipFile, path: str) -> dict:
    """Populated cells, formulas and used extent of one worksheet part.

    Unreadable XML raises instead of returning zeros, so a broken sheet never
    passes as an empty one.
    """
    populated = formulas = max_row = max_col = 0
    uncached: list[str] = []
    for cell in ET.fromstring(zf.read(path)).iter(f"{SHEET_NS}c"):
        has_f = cell.find(f"{SHEET_NS}f") is not None
        v = cell.find(f"{SHEET_NS}v")
        if not (has_f or v is not None or cell.find(f"{SHEET_NS}is") is not None):
            continue
        populated += 1
        formulas += has_f
        # No stored result: openpyxl writes an empty <v/>. An empty text result is t="str" with an empty <v>.
        if has_f and (v is None or not (v.text or "")) and cell.get("t") not in ("str", "inlineStr"):
            uncached.append(cell.get("r") or "?")
        m = re.match(r"([A-Z]+)(\d+)", cell.get("r") or "")
        if m:
            col = 0
            for ch in m.group(1):
                col = col * 26 + ord(ch) - 64
            max_col, max_row = max(max_col, col), max(max_row, int(m.group(2)))
    return {"populated_cells": populated, "formulas": formulas, "rows": max_row, "columns": max_col,
            "formulas_without_value": len(uncached), "_uncached": uncached[:5]}


def openpyxl_readback(path: str) -> dict:
    try:
        import openpyxl  # noqa: PLC0415
    except ImportError:
        return {"ran": False, "reason": "openpyxl not installed"}
    try:
        book = openpyxl.load_workbook(path)
    except Exception as err:  # noqa: BLE001 - any reader failure is the finding
        return {"ran": True, "ok": False, "error": f"{type(err).__name__}: {err}"}
    return {"ran": True, "ok": True, "sheets": list(book.sheetnames), "title": book.properties.title or ""}


def check_csv(path: str, allow_empty: bool) -> dict:
    delim = "\t" if path.lower().endswith(".tsv") else ","
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.reader(fh, delimiter=delim))
    except UnicodeDecodeError as err:
        fail(f"not UTF-8 text: {err}")
    except csv.Error as err:
        fail(f"csv does not parse: {err}")
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows and not allow_empty:
        fail("csv has no rows")
    width = len(rows[0]) if rows else 0
    ragged = [i + 1 for i, r in enumerate(rows) if len(r) != width]
    if ragged:
        fail(f"rows with a different number of fields than the header ({width}): {ragged[:20]}")
    if len(rows) < 2 and not allow_empty:
        fail("csv has a header but no data rows")
    print(f"OK: csv parses, {len(rows) - 1} data row(s) x {width} column(s)")
    return {"path": path, "kind": "csv", "header": rows[0] if rows else [], "data_rows": max(0, len(rows) - 1), "columns": width}


def check_xlsx(path: str, allow_empty: bool) -> dict:
    try:
        with open(path, "rb") as fh:
            head = fh.read(4)
    except OSError as err:
        fail(f"cannot read {path}: {err}")
    if not head:
        fail(f"file is empty: {path}")
    if not head.startswith(b"PK"):
        fail(f"not an OOXML workbook (starts with {head.decode('utf-8', 'replace')!r}, expected a zip). "
             "Text written under a .xlsx name will not open: write it with openpyxl, or name it .csv.")
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as err:
        fail(f"corrupt workbook, not a readable zip: {err}")
    with zf:
        if zf.testzip() is not None:
            fail("corrupt workbook: a zip member failed its CRC check")
        names = set(zf.namelist())
        if "xl/workbook.xml" not in names:
            fail("missing xl/workbook.xml, so this zip is not a spreadsheet")
        declared = declared_sheets(zf)
        if not declared:
            fail("workbook declares no sheets")
        per_sheet = []
        for name, part in declared:
            if part is None or part not in names:
                fail(f"sheet {name!r} points at a part that is not in the file ({part})")
            if not part.startswith("xl/worksheets/"):
                continue  # chartsheet: present, holds no cells
            try:
                per_sheet.append({"sheet": name, **sheet_stats(zf, part)})
            except ET.ParseError as err:
                fail(f"sheet {name!r} ({part}) is not readable XML: {err}")
        summary = {
            "path": path,
            "kind": "xlsx",
            "sheets": [n for n, _ in declared],
            "sheet_count": len(declared),
            "populated_cells": sum(s["populated_cells"] for s in per_sheet),
            "formulas": sum(s["formulas"] for s in per_sheet),
            "formulas_without_value": sum(s["formulas_without_value"] for s in per_sheet),
            "per_sheet": per_sheet,
            "has_chart": any("chart" in n for n in names),
            "has_images": any(n.startswith("xl/media/") for n in names),
            "openpyxl": openpyxl_readback(path),
        }
    examples = [f"{s['sheet']}!{r}" for s in per_sheet for r in s.pop("_uncached")][:5]
    if summary["formulas_without_value"]:
        fail(f"{summary['formulas_without_value']} formula(s) have no calculated value stored (e.g. {', '.join(examples)}), "
             "so the person would see blank cells. Run "
             f"python3 /opt/1hc/skills/artifacts/scripts/recalc_xlsx.py {path} first, then validate again.")
    rb = summary["openpyxl"]
    if rb.get("ran") and not rb.get("ok"):
        fail(f"openpyxl could not open the workbook: {rb['error']}")
    if summary["populated_cells"] == 0 and not allow_empty:
        fail("workbook opens but every sheet is empty. Put the real content in, or pass "
             "--allow-empty when a blank template is what was asked for.")
    print(f"OK: opens as a workbook, {summary['sheet_count']} sheet(s): {', '.join(summary['sheets'])}")
    print(f"OK: {summary['populated_cells']} populated cells, {summary['formulas']} formulas, chart={summary['has_chart']}")
    if rb.get("ran"):
        print("OK: reopened with openpyxl")
        if not rb.get("title"):
            print("WARN: workbook.properties.title is empty; set it before sharing")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--json-out", help="also write the summary as JSON here")
    ap.add_argument("--allow-empty", action="store_true", help="accept a deliberately blank template")
    a = ap.parse_args()
    if a.path.lower().endswith((".csv", ".tsv")):
        summary = check_csv(a.path, a.allow_empty)
    else:
        summary = check_xlsx(a.path, a.allow_empty)
    if a.json_out:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(a.json_out)), exist_ok=True)
            with open(a.json_out, "w", encoding="utf-8") as fh:
                json.dump(summary, fh, indent=2)
            print(f"OK: summary written to {a.json_out}")
        except OSError as err:
            print(f"WARN: the file passed, but the summary could not be written: {err}")


if __name__ == "__main__":
    main()
