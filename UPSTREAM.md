# Upstream

This is a browser port of the game Frontier from [whiskeyfur/jcw-website](https://github.com/whiskeyfur/jcw-website)
(its `game/` directory, plus the few site pieces the game uses). **This repository never pushes to jcw-website.**

- Remote `upstream` fetches jcw-website; its push URL is deliberately invalid.
- `reference/jcw-website` (gitignored) is a read-only checkout of `upstream/dev`, for reading and for running the
  upstream test suite as the reference (see PORTING.md).

## Synced commit

Ported from upstream `dev` at **f2b89b0c06ee211c118b6ea7321e2b985dacea1b** (Frontier's section tabs become a second navigation bar under the header, 2026-09-26).

## Syncing an upstream change

1. `tools/refresh-ref.sh`: fetches upstream, moves `reference/jcw-website` to `upstream/dev`, and dumps its schema.
2. See what changed in the game since the synced commit:
   `git diff <synced>..upstream/dev --stat -- game/ tests/Game/ views/layouts/ js/`
3. Port each change to the matching file (PORTING.md's table). Schema changes: `npm run schema` regenerates
   `src/db/`, and a migration in `src/db/migrations.ts` brings existing saved games along. New or changed triggers go
   in `src/db/triggers.sql` by hand.
4. `npm test`, then `npm run build`, then update the synced commit above.
