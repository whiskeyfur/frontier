#!/usr/bin/env bash
# Publishes the game to GitHub Pages (https://whiskeyfur.github.io/frontier/): builds it here, checks it, and pushes
# the one file it makes (dist/index.html) to the gh-pages branch of origin, which Pages serves.
#
#   npm run deploy            # typecheck, tests, build, browser check, publish
#   npm run deploy -- --quick # skip the tests and the browser check
#
# It publishes the commit you have checked out, so commit (and push) first: it refuses a tree with changes.
set -euo pipefail
cd "$(dirname "$0")/.."

QUICK=false
[ "${1:-}" = "--quick" ] && QUICK=true

if [ -n "$(git status --porcelain)" ]; then
    echo "The working tree has changes: commit them first, so the published page matches a commit." >&2
    exit 1
fi
SOURCE=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

npm run typecheck
$QUICK || npx vitest run
npx vite build
$QUICK || node tools/e2e.cjs

# Pages serves the branch as it is: the page, and .nojekyll so it isn't run through Jekyll.
SITE=$(mktemp -d)
trap 'rm -rf "$SITE"' EXIT
cp dist/index.html "$SITE/index.html"
touch "$SITE/.nojekyll"

git -C "$SITE" init -q -b gh-pages
git -C "$SITE" add -A
git -C "$SITE" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
    commit -q -m "Frontier ${SOURCE} (${BRANCH})"
# The branch only ever holds the latest build: each deploy replaces it.
git -C "$SITE" push -q --force "$(git remote get-url origin)" gh-pages
git fetch -q origin gh-pages

echo "Published ${SOURCE} (${BRANCH}) to gh-pages: https://whiskeyfur.github.io/frontier/ (Pages takes a minute to update)."
