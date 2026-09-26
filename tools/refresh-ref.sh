#!/usr/bin/env bash
# Refreshes the upstream reference: fetches jcw-website (fetch-only remote "upstream"), moves the reference checkout
# (reference/jcw-website, gitignored) to upstream/dev, builds its schema in a private MariaDB database with its own
# migration, and dumps the schema and seed rows to tools/ref/. Then run `npm run schema` to regenerate src/db/.
#
# Needs a local MariaDB where the current user can create databases (over the unix socket). It only touches the
# databases named below, never upstream's own (website, website_dev...).
set -euo pipefail
cd "$(dirname "$0")/.."
REF_DB=${REF_DB:-frontier_ref}

git fetch upstream
if [ ! -d reference/jcw-website ]; then
    git worktree add --detach reference/jcw-website upstream/dev
else
    git -C reference/jcw-website checkout --detach upstream/dev
fi
cd reference/jcw-website
[ -f .env ] || printf 'DBHOST=localhost\nDBNAME=%s\nDBUSER=%s\nDBPASS=\nDBADMINUSER=%s\nDBADMINPASS=\n' "$REF_DB" "$USER" "$USER" > .env
composer install --no-interaction -q
mariadb -e "DROP DATABASE IF EXISTS \`$REF_DB\`"
php bin/migrate.php
cd ../..
mysqldump --no-data --skip-comments --skip-add-drop-table --compact --triggers "$REF_DB" > tools/ref/schema.mysql.sql
mysqldump --no-create-info --skip-triggers --skip-comments --compact --skip-extended-insert "$REF_DB" \
    game_species_groups game_species game_genders game_names game_ranks game_skills game_occupations \
    game_building_types game_market_goods game_settings > tools/ref/seed.mysql.sql
echo "Upstream is at $(git rev-parse --short upstream/dev). Now: npm run schema, and compare with UPSTREAM.md's synced commit."
