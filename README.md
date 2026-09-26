# Frontier

An anthro-breeding and feudal-life simulation, played entirely in the browser. It's a port of the game in
[jcw-website](https://github.com/whiskeyfur/jcw-website) (PHP and MariaDB) to TypeScript: the game's rules run in a
Web Worker over an SQLite database (sql.js) that's kept in the browser's IndexedDB. There's no server.

`npm run build` makes **`dist/index.html`**, one self-contained file (the game, its worker, the SQLite engine and the
styles are all inside it). Open it from the disk, or put it anywhere that serves files.

## Development

Needs Node 18 or later.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # the test suite (vitest)
npm run typecheck
npm run build      # dist/index.html
```

## How it's put together

- `src/game/`: the game, class for class and template for template as upstream (`game/src`, `game/views`).
- `src/db/`: the SQLite schema, generated from upstream's (`npm run schema`), its triggers, and the `Db` wrapper.
- `src/core/`: what PHP and the site gave the game: PHP built-ins, the clock, dice, templating, requests, the account.
- `src/site/`: the router (what upstream's web server and router.php did) and the site's layouts.
- `src/worker/`: the worker that runs the game and keeps it in IndexedDB.
- `src/shell/`: the page, which turns links and forms into requests to the worker and shows the answers.

[PORTING.md](PORTING.md) is how the PHP maps to this code; [UPSTREAM.md](UPSTREAM.md) is which upstream commit this
matches and how to bring in upstream's changes.
