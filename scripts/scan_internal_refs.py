#!/usr/bin/env python3
"""Scan files for internal references that must not appear in the public repo."""
from __future__ import annotations

import argparse
import codecs
import os
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

# Rule order matters: email first so an email is reported as `epam-email`.
# Patterns are anchored on the literal domain (linear scan); the required local
# part / host prefix is checked on the single character before the anchor, so
# very long lines cannot cause quadratic backtracking.
_EMAIL_ANCHOR = re.compile(r"@epam\.com", re.IGNORECASE)
_HOST_ANCHOR = re.compile(r"\.epam\.com", re.IGNORECASE)
_KUBE = re.compile(r"kuberocketci\.io", re.IGNORECASE)
_TICKET = re.compile(r"EPMCDME-\d+", re.IGNORECASE)
_REALM = re.compile(r"\bcodemie-prod\b", re.IGNORECASE)
_EMAIL_PREV = re.compile(r"[\w.+-]")
_HOST_PREV = re.compile(r"[\w.-]")


def _preceded_by(line: str, pattern: re.Pattern[str], prev: re.Pattern[str]) -> bool:
    for m in pattern.finditer(line):
        if m.start() > 0 and prev.match(line[m.start() - 1]):
            return True
    return False


def load_denylist(path: Path | None) -> list[re.Pattern[str]]:
    """Load a private deny-list: one regex or literal per line, `#` comments, case-insensitive."""
    if path is None:
        return []
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise FileNotFoundError(f"deny-list not readable: {path} ({e.strerror or e})") from e
    patterns = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            pattern = re.compile(line, re.IGNORECASE)
        except re.error as e:
            raise ValueError(f"deny-list {path}: invalid pattern {line!r}: {e}") from e
        if pattern.search(""):
            raise ValueError(f"deny-list {path}: pattern {line!r} matches the empty string")
        patterns.append(pattern)
    if not patterns:
        raise ValueError(f"deny-list {path} holds no patterns; refusing to scan with an empty list")
    return patterns


def _line_rules(line: str, extra: Sequence[re.Pattern[str]] = ()) -> list[str]:
    rules = []
    if _preceded_by(line, _EMAIL_ANCHOR, _EMAIL_PREV):
        rules.append("epam-email")
    if _TICKET.search(line):
        rules.append("ticket-key")
    if _KUBE.search(line) or _preceded_by(line, _HOST_ANCHOR, _HOST_PREV):
        rules.append("internal-host")
    if _REALM.search(line):
        rules.append("realm")
    if any(p.search(line) for p in extra):
        rules.append("denylist")
    return rules


SKIP_DIRS = {".git", "node_modules", "dist", ".venv", ".mypy_cache", ".ruff_cache", ".pytest_cache", "__pycache__"}
SELF_EXCLUDED = ("scripts/scan_internal_refs.py",)

_LINE_SPLIT = re.compile(r"\r\n|\r|\n")


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    rule: str


def scan_text(text: str, extra: Sequence[re.Pattern[str]] = ()) -> list[tuple[int, str]]:
    """Return (1-based line, rule) pairs; one finding per line per rule."""
    found: list[tuple[int, str]] = []
    for number, line in enumerate(_LINE_SPLIT.split(text), start=1):
        for name in _line_rules(line, extra):
            found.append((number, name))
    return found


def _is_excluded(rel: str) -> bool:
    return any(rel == p or (p.endswith("/") and rel.startswith(p)) for p in SELF_EXCLUDED)


def _scan_file(path: Path, rel: str, extra: Sequence[re.Pattern[str]] = ()) -> list[Finding]:
    if _is_excluded(rel):
        return []
    try:
        data = path.read_bytes()
    except OSError:
        return [Finding(rel, 0, "unreadable")]
    return [Finding(rel, line, rule) for line, rule in scan_text(_decode(data), extra)]


def _decode(data: bytes) -> str:
    """Decode by BOM; anything else that is not UTF-8 is scanned as latin-1 so no byte is skipped."""
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def scan_files(paths: list[Path], root: Path, extra: Sequence[re.Pattern[str]] = ()) -> list[Finding]:
    root = root.resolve()
    findings: list[Finding] = []
    for p in paths:
        p = Path(p).resolve()
        try:
            rel = p.relative_to(root).as_posix()
        except ValueError:
            rel = p.as_posix()
        findings.extend(_scan_file(p, rel, extra))
    return findings


def scan_tree(root: Path, extra: Sequence[re.Pattern[str]] = ()) -> list[Finding]:
    root = Path(root).resolve()
    findings: list[Finding] = []
    for p in sorted(root.rglob("*")):
        rel_parts = p.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]) or not p.is_file():
            continue
        if p.is_symlink():
            continue
        findings.extend(_scan_file(p, "/".join(rel_parts), extra))
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--tree", type=Path, metavar="ROOT")
    group.add_argument("--files", type=Path, nargs="+", metavar="F")
    parser.add_argument("--denylist", type=Path, default=None, metavar="PATH")
    args = parser.parse_args(argv)
    deny = args.denylist or (Path(os.environ["CODEMIE_SCAN_DENYLIST"]) if os.environ.get("CODEMIE_SCAN_DENYLIST") else None)
    try:
        extra = load_denylist(deny)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if args.tree:
        findings = scan_tree(args.tree, extra)
    else:
        findings = scan_files(args.files, Path.cwd(), extra)
    for f in findings:
        print(f"{f.path}:{f.line}: {f.rule}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
