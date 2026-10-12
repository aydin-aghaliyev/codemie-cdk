#!/usr/bin/env python3
"""Read the release version from a release tag, and refuse a release that is not strictly higher.

The tag names the package and the version, for example `python-v0.1.665`. The manifest holds only
the base line (MAJOR.MINOR), and the tag must be on that line. The registry gate then checks that
the version is higher than everything already published.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 10
URLS = {
    "pypi": "https://pypi.org/pypi/{name}/json",
    "npm": "https://registry.npmjs.org/{name}",
}


class VersionError(Exception):
    pass


_PEP440 = re.compile(
    r"""^v?(?:(?P<epoch>\d+)!)?(?P<release>\d+(?:\.\d+)*)
    (?:[-_.]?(?P<pre_l>alpha|a|beta|b|preview|pre|c|rc)[-_.]?(?P<pre_n>\d*))?
    (?:(?:-(?P<post_n1>\d+))|(?:[-_.]?(?:post|rev|r)[-_.]?(?P<post_n2>\d*)))?
    (?:[-_.]?dev[-_.]?(?P<dev_n>\d*))?
    (?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$""",
    re.VERBOSE | re.IGNORECASE,
)
_PRE_ORDER = {"a": 0, "alpha": 0, "b": 1, "beta": 1, "c": 2, "rc": 2, "pre": 2, "preview": 2}
_SEMVER = re.compile(
    r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_BIG = 10**9


def _pep440_key(version: str):
    m = _PEP440.match(version.strip())
    if not m:
        raise VersionError(f"not a PEP 440 version: {version!r}")
    release = [int(p) for p in m["release"].split(".")]
    while release and release[-1] == 0:
        release.pop()
    has_pre = m["pre_l"] is not None
    has_post = m["post_n1"] is not None or m["post_n2"] is not None
    has_dev = m["dev_n"] is not None
    if has_pre:
        pre = (_PRE_ORDER[m["pre_l"].lower()], int(m["pre_n"] or 0))
    elif has_dev and not has_post:
        pre = (-1, 0)
    else:
        pre = (3, 0)
    post = int(m["post_n1"] or m["post_n2"] or 0) if has_post else -1
    dev = int(m["dev_n"] or 0) if has_dev else _BIG
    return (int(m["epoch"] or 0), tuple(release), pre, post, dev)


def _cmp_ident(a: str, b: str) -> int:
    an, bn = a.isdigit(), b.isdigit()
    if an and bn:
        return (int(a) > int(b)) - (int(a) < int(b))
    if an != bn:
        return -1 if an else 1
    return (a > b) - (a < b)


def _cmp_pre(a: str | None, b: str | None) -> int:
    if a == b:
        return 0
    if a is None:
        return 1
    if b is None:
        return -1
    ai, bi = a.split("."), b.split(".")
    for x, y in zip(ai, bi):
        c = _cmp_ident(x, y)
        if c:
            return c
    return (len(ai) > len(bi)) - (len(ai) < len(bi))


def _semver_parse(version: str):
    m = _SEMVER.match(version.strip())
    if not m:
        raise VersionError(f"not a semantic version: {version!r}")
    return (int(m[1]), int(m[2]), int(m[3])), m[4]


def _semver_cmp(a: str, b: str) -> int:
    (ac, ap), (bc, bp) = _semver_parse(a), _semver_parse(b)
    if ac != bc:
        return (ac > bc) - (ac < bc)
    return _cmp_pre(ap, bp)


def _compare(ecosystem: str, a: str, b: str) -> int:
    if ecosystem == "pypi":
        ka, kb = _pep440_key(a), _pep440_key(b)
        return (ka > kb) - (ka < kb)
    return _semver_cmp(a, b)


def _fetch_json(url: str):
    """Return the parsed JSON body, or None when the package does not exist (HTTP 404)."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _published(ecosystem: str, payload) -> list[str]:
    key = "releases" if ecosystem == "pypi" else "versions"
    if not isinstance(payload, dict) or not isinstance(payload.get(key), dict):
        raise VersionError(f"unexpected registry response: missing {key!r} mapping")
    return list(payload[key])


def check(ecosystem: str, name: str, version: str, fetch=_fetch_json) -> str:
    """Return the highest published version ("" if none); raise VersionError unless `version` is higher."""
    if ecosystem not in URLS:
        raise VersionError(f"unknown ecosystem: {ecosystem!r}")
    _compare(ecosystem, version, version)  # validates our own version
    payload = fetch(URLS[ecosystem].format(name=urllib.parse.quote(name, safe="@")))
    if payload is None:
        return ""
    best = ""
    for v in _published(ecosystem, payload):
        try:
            _compare(ecosystem, v, v)
        except VersionError:
            # A version that cannot be ordered could hide a higher one: fail closed.
            raise VersionError(f"unparseable published version {v!r} of {name}: cannot compare") from None
        if not best or _compare(ecosystem, v, best) > 0:
            best = v
    if best and _compare(ecosystem, version, best) <= 0:
        raise VersionError(
            f"version {version} of {name} is not higher than the highest published version {best}"
        )
    return best


_BASE = re.compile(r"(\d+)\.(\d+)(?:\.0)?", re.ASCII)
_TAG_PREFIX = {"pypi": "python-v", "npm": "node-v"}
_NUM = r"(0|[1-9]\d*)"
_TAG_VERSION = re.compile(rf"{_NUM}\.{_NUM}\.{_NUM}(?:-rc{_NUM})?", re.ASCII)


def version_from_tag(ecosystem: str, tag: str, base: str, prefix: str | None = None) -> str:
    """Return the version named by `tag` (`python-vX.Y.Z[-rcN]` or `node-vX.Y.Z[-rcN]`; `prefix` overrides the default).

    `base` is the manifest version and must be MAJOR.MINOR or MAJOR.MINOR.0 (no pre-release).
    The tag must be on that MAJOR.MINOR line. No network is used.
    """
    if ecosystem not in URLS:
        raise VersionError(f"unknown ecosystem: {ecosystem!r}")
    m = _BASE.fullmatch(base.strip())
    if not m:
        raise VersionError(f"base version must be MAJOR.MINOR or MAJOR.MINOR.0, got {base!r}")
    prefix = prefix or _TAG_PREFIX[ecosystem]
    version = tag[len(prefix):] if tag.startswith(prefix) else ""
    r = _TAG_VERSION.fullmatch(version)
    if not r:
        raise VersionError(f"tag must look like {prefix}MAJOR.MINOR.PATCH[-rcN], got {tag!r}")
    if (int(r[1]), int(r[2])) != (int(m[1]), int(m[2])):
        raise VersionError(
            f"tag {tag} is not on the manifest line {int(m[1])}.{int(m[2])}: "
            "raise the base in the manifest first"
        )
    return version


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ecosystem", required=True, choices=["pypi", "npm"])
    p.add_argument("--name", required=True)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--tag", help="release tag (python-vX.Y.Z or node-vX.Y.Z); print the version it names")
    mode.add_argument("--version", help="version to check against the registry")
    p.add_argument("--base", help="manifest version (MAJOR.MINOR[.0]); required with --tag")
    p.add_argument("--tag-prefix", help="tag prefix instead of the ecosystem default, for example cdk-v")
    args = p.parse_args(argv)
    if args.tag and not args.base:
        p.error("--tag needs --base")
    if (args.base or args.tag_prefix) and not args.tag:
        p.error("--base and --tag-prefix only work with --tag")
    try:
        if args.tag:
            print(version_from_tag(args.ecosystem, args.tag, args.base, args.tag_prefix))
            return 0
        latest = check(args.ecosystem, args.name, args.version, fetch=_fetch_json)
    except VersionError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as e:  # URLError, timeouts and bad JSON all land here
        print(f"error: registry check failed: {e}", file=sys.stderr)
        return 1
    print(f"ok: {args.name} {args.version} (registry latest: {latest or 'none'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
