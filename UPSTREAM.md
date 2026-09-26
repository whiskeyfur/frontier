# Upstream

This is a browser port of the game Frontier from [whiskeyfur/jcw-website](https://github.com/whiskeyfur/jcw-website)
(its `game/` directory, plus the few site pieces the game uses). **This repository never pushes to jcw-website.**

- Remote `upstream` fetches jcw-website; its push URL is deliberately invalid.
- `reference/jcw-website` (gitignored) is a read-only checkout of `upstream/dev`, for reading and for running the
  upstream test suite as the reference (see PORTING.md).

## Synced commit

Ported from upstream `dev` at **a79b6525170a8672e86890e0ffd9ec350949fdb8** (Game clock and pace, peopled resets, starting skills, deploy clears cache, 2026-09-26).

## Local changes

Deliberate differences from upstream, because this is a single-player game in a browser. Keep them when syncing:
upstream changes to the same code are ported around them. Each is marked in the code with "Not upstream".

- **The game's pace is the player's** (`Clock.wanted`): upstream's shared game runs at the slowest pace anyone playing
  asks for; here the player's choice is binding, at once, whether or not they play an anthro. The texts that describe
  it follow (the clock, the clock bar, Preferences, the Knowledge Base), and `changes.md` has an entry for it
  ("Your pace"); the tests are `Clock.test.ts` ("the player's pace is binding") and `general.test.ts` (the clock bar).
- **The player resets themselves** (`Resets.resetSelf`, the home page's "Stop playing" button): upstream's player
  asks the admins, with a reason, and waits; here the anthro is released at once with no notification. The admins'
  resets page and `Resets.request`/`dismiss` are kept. Tests: `Resets.test.ts` and `home-assets.test.ts`.
- The site around the game (accounts, login, CSRF, maintenance, site admin and docs) isn't ported: see PORTING.md
  and the header comments in `src/site/`.

## Syncing an upstream change

1. `tools/refresh-ref.sh`: fetches upstream, moves `reference/jcw-website` to `upstream/dev`, and dumps its schema.
2. See what changed in the game since the synced commit:
   `git diff <synced>..upstream/dev --stat -- game/ tests/Game/ views/layouts/ js/`
3. Port each change to the matching file (PORTING.md's table). Schema changes: `npm run schema` regenerates
   `src/db/`, and a migration in `src/db/migrations.ts` brings existing saved games along. New or changed triggers go
   in `src/db/triggers.sql` by hand.
4. `npm test`, then `npm run build`, then update the synced commit above.
