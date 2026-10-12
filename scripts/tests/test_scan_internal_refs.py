import subprocess
import sys
from pathlib import Path

import scan_internal_refs as scan

SCRIPT = Path(scan.__file__)

# Forbidden strings are built at runtime so this file scans clean.
TICKET = "EPM" + "CDME-" + "123"
HOST = "git." + "ep" + "am.com"
KUBE = "report." + "kubero" + "cketci.io"
EMAIL = "someone@" + "ep" + "am.com"


def test_reports_ticket_host_email_with_file_and_line(tmp_path):
    (tmp_path / "a.py").write_text(f"ok\n# see {TICKET}\nurl = 'https://{HOST}/x'\nmail {EMAIL}\nh {KUBE}\n")
    findings = scan.scan_tree(tmp_path)
    got = {(f.path, f.line, f.rule) for f in findings}
    assert got == {
        ("a.py", 2, "ticket-key"),
        ("a.py", 3, "internal-host"),
        ("a.py", 4, "epam-email"),
        ("a.py", 5, "internal-host"),
    }


def test_case_insensitive():
    text = "x " + "Epm" + "cdme-12" + "\n" + "HOST." + "EP" + "AM.COM"
    assert scan.scan_text(text) == [(1, "ticket-key"), (2, "internal-host")]


def test_crlf_and_no_trailing_newline_line_numbers():
    assert scan.scan_text(f"a\r\nb\r\n{TICKET}") == [(3, "ticket-key")]


def test_binary_non_utf8_and_utf16_are_still_scanned(tmp_path):
    (tmp_path / "b.bin").write_bytes(b"\x00\x01" + TICKET.encode())
    (tmp_path / "c.txt").write_bytes(b"\xff\xfa " + TICKET.encode())
    (tmp_path / "d.txt").write_bytes(f"ok\n{TICKET}\n".encode("utf-16"))
    got = {(f.path, f.rule) for f in scan.scan_tree(tmp_path)}
    assert got == {("b.bin", "ticket-key"), ("c.txt", "ticket-key"), ("d.txt", "ticket-key")}


def test_unreadable_file_is_reported(tmp_path):
    f = tmp_path / "locked.txt"
    f.write_text("x")
    f.chmod(0)
    try:
        if f.stat().st_mode & 0o777 == 0 and not _can_read(f):
            assert [(x.path, x.rule) for x in scan.scan_tree(tmp_path)] == [("locked.txt", "unreadable")]
    finally:
        f.chmod(0o600)


def _can_read(path):
    try:
        path.read_bytes()
        return True
    except OSError:
        return False


def test_scripts_tests_dir_is_scanned(tmp_path):
    (tmp_path / "scripts" / "tests").mkdir(parents=True)
    (tmp_path / "scripts" / "tests" / "t.py").write_text(f"# {TICKET}\n")
    assert [(f.path, f.rule) for f in scan.scan_tree(tmp_path)] == [("scripts/tests/t.py", "ticket-key")]


def test_skips_ignored_dirs(tmp_path):
    for d in (".git", "node_modules", "dist", ".venv"):
        (tmp_path / d).mkdir()
        (tmp_path / d / "x.txt").write_text(TICKET)
    assert scan.scan_tree(tmp_path) == []


def test_files_mode_scans_only_listed(tmp_path):
    (tmp_path / "a.txt").write_text(TICKET)
    (tmp_path / "b.txt").write_text(TICKET)
    findings = scan.scan_files([tmp_path / "a.txt"], tmp_path)
    assert [f.path for f in findings] == ["a.txt"]


def test_only_scanner_itself_is_excluded(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "scan_internal_refs.py").write_text(TICKET)
    assert scan.scan_tree(tmp_path) == []
    assert scan.scan_files([tmp_path / "scripts" / "scan_internal_refs.py"], tmp_path) == []


def test_cli_exit_codes_and_format(tmp_path):
    (tmp_path / "ok.txt").write_text("fine\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--tree", str(tmp_path)], capture_output=True, text=True)
    assert r.returncode == 0
    (tmp_path / "bad.txt").write_text(f"\n{TICKET}\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--tree", str(tmp_path)], capture_output=True, text=True)
    assert r.returncode == 1
    assert r.stdout.strip() == "bad.txt:2: ticket-key"
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--files", str(tmp_path / "ok.txt")], capture_output=True, text=True
    )
    assert r.returncode == 0


def test_gitleaks_config_reports_planted_secret_with_file_and_line(tmp_path):
    import json
    import shutil

    gitleaks = shutil.which("gitleaks")
    if not gitleaks:
        import pytest
        pytest.skip("gitleaks not installed")
    config = SCRIPT.parents[1] / ".gitleaks.toml"
    secret = "gh" + "p_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5"
    (tmp_path / "leak.py").write_text(f"x = 1\ntoken = '{secret}'\n")
    report = tmp_path.parent / "gitleaks-report.json"
    r = subprocess.run(
        [gitleaks, "detect", "--no-git", "--source", str(tmp_path), "--config", str(config),
         "--report-format", "json", "--report-path", str(report), "--redact"],
        capture_output=True, text=True,
    )
    assert r.returncode == 1, r.stderr
    leaks = json.loads(report.read_text())
    assert [(Path(x["File"]).name, x["StartLine"]) for x in leaks] == [("leak.py", 2)]


def test_long_lines_scan_in_linear_time():
    import time

    for filler in ("a" * 200_000, "a." * 100_000, "a@" * 100_000, ("a" * 50 + ".ep" + "am.co") * 20_000):
        start = time.monotonic()
        assert scan.scan_text(filler) == []
        assert time.monotonic() - start < 2, filler[:8]
    start = time.monotonic()
    assert scan.scan_text("a" * 200_000 + "@ep" + "am.com") == [(1, "epam-email")]
    assert scan.scan_text("a" * 200_000 + ".ep" + "am.com") == [(1, "internal-host")]
    assert time.monotonic() - start < 2


def test_cache_dirs_skipped(tmp_path):
    for d in (".mypy_cache", ".ruff_cache", ".pytest_cache", "__pycache__"):
        (tmp_path / d).mkdir()
        (tmp_path / d / "x.txt").write_text(TICKET)
    assert scan.scan_tree(tmp_path) == []


REALM = "codemie-" + "prod"


def test_realm_rule_flags_with_file_and_line(tmp_path):
    (tmp_path / "e.env").write_text(f"A=1\nCODEMIE_REALM={REALM}\n")
    assert [(f.path, f.line, f.rule) for f in scan.scan_tree(tmp_path)] == [("e.env", 2, "realm")]


def test_realm_rule_is_word_bounded():
    assert scan.scan_text("codemie-production-ready and mycodemie-prod") == []


def test_denylist_applies_only_when_supplied(tmp_path):
    term = "ta" + "desk"
    (tmp_path / "a.txt").write_text(f"hello {term.upper()}\n")
    assert scan.scan_tree(tmp_path) == []
    deny = tmp_path.parent / "deny.txt"
    deny.write_text(f"# comment\n\n{term}\n")
    found = scan.scan_tree(tmp_path, scan.load_denylist(deny))
    assert [(f.path, f.line, f.rule) for f in found] == [("a.txt", 1, "denylist")]


def test_denylist_missing_path_is_clear_error(tmp_path):
    import pytest

    with pytest.raises(FileNotFoundError, match="deny-list"):
        scan.load_denylist(tmp_path / "nope.txt")
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--tree", str(tmp_path), "--denylist", str(tmp_path / "nope.txt")],
        capture_output=True, text=True,
    )
    assert r.returncode == 2 and "deny-list" in r.stderr


def test_denylist_cli_flag_and_env(tmp_path):
    import os

    term = "ta" + "desk"
    tree = tmp_path / "t"
    tree.mkdir()
    (tree / "a.txt").write_text(term + "\n")
    deny = tmp_path / "d.txt"
    deny.write_text(term + "\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--tree", str(tree), "--denylist", str(deny)],
                       capture_output=True, text=True)
    assert (r.returncode, r.stdout.strip()) == (1, "a.txt:1: denylist")
    r = subprocess.run([sys.executable, str(SCRIPT), "--tree", str(tree)], capture_output=True, text=True,
                       env={**os.environ, "CODEMIE_SCAN_DENYLIST": str(deny)})
    assert r.returncode == 1



def test_denylist_empty_or_comment_only_is_an_error(tmp_path):
    import pytest

    for body in ("", "\n\n", "# only a comment\n"):
        f = tmp_path / "d.txt"
        f.write_text(body)
        with pytest.raises(ValueError, match="no patterns"):
            scan.load_denylist(f)
    r = subprocess.run([sys.executable, str(SCRIPT), "--tree", str(tmp_path), "--denylist", str(f)],
                       capture_output=True, text=True)
    assert r.returncode == 2


def test_denylist_invalid_regex_and_empty_match_are_errors(tmp_path):
    import pytest

    f = tmp_path / "d.txt"
    f.write_text("foo(\n")
    with pytest.raises(ValueError, match="invalid"):
        scan.load_denylist(f)
    f.write_text("a*\n")
    with pytest.raises(ValueError, match="empty"):
        scan.load_denylist(f)
