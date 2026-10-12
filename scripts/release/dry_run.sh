#!/usr/bin/env bash
# Local dry run of a release: reads the live registry, stamps a COPY of the SDK, builds it.
# Publishes nothing and needs no credentials. Usage: scripts/release/dry_run.sh python|node TAG   (TAG: python-vX.Y.Z or node-vX.Y.Z)
set -euo pipefail

kind="${1:-}"
tag="${2:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
check="$root/scripts/release/check_version.py"

case "$kind" in
  python) sdk=sdk/codemie-python; eco=pypi; name=codemie-sdk-python ;;
  node) sdk=sdk/codemie-nodejs; eco=npm; name=codemie-sdk ;;
  *) echo "usage: $0 python|node TAG" >&2; exit 2 ;;
esac
[ -n "$tag" ] || { echo "usage: $0 python|node TAG" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rsync -a --exclude node_modules --exclude .venv --exclude dist --exclude __pycache__ "$root/$sdk/" "$work/"
cd "$work"

if [ "$kind" = python ]; then
  base="$(poetry version --short)"
else
  base="$(node -p "require('./package.json').version")"
fi
version="$(python3 "$check" --ecosystem "$eco" --name "$name" --tag "$tag" --base "$base")"
echo "base $base, tag $tag -> release $version"

if [ "$kind" = python ]; then
  poetry version "$version" >/dev/null
  poetry install --no-interaction
  poetry run ruff check .
  poetry run pytest tests/
else
  npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
  npm install --no-audit --no-fund
  npm run lint
  npm test
  npm run build
fi

python3 "$check" --ecosystem "$eco" --name "$name" --version "$version"

if [ "$kind" = python ]; then
  poetry build
  ls dist
else
  mkdir -p "$work/pack"
  npm pack --pack-destination "$work/pack" >/dev/null
  ls "$work/pack"
fi
echo "dry run ok: $name $version would be released (nothing published)"
