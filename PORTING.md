# Porting guide: upstream PHP → this TypeScript

Frontier here is a port of the game in [jcw-website](https://github.com/whiskeyfur/jcw-website) (`game/`), which is
PHP 8.3 on MariaDB with Blade templates. This repository never pushes there; it reads it (the fetch-only remote
`upstream`, checked out read-only at `reference/jcw-website`) and replicates its changes. See `UPSTREAM.md` for the
commit last synced and how to sync.

**The port is faithful.** Same classes, same methods, same SQL where SQLite allows, same player-facing text (every
message, label and error, word for word), same comments. Someone diffing an upstream change should find the lines to
change in the same place here. Don't improve, rename or restructure while porting. If upstream looks wrong, port it
as it is and note it in your report.

## Where things go

| Upstream                                  | Here                                         |
|-------------------------------------------|----------------------------------------------|
| `game/src/Foo.php` (`Game\Foo`)           | `src/game/Foo.ts` (`export class Foo`)        |
| `game/views/a/b.blade.php` (`game::a.b`)  | `src/game/views/a/b.ts`                      |
| `views/layouts/*.blade.php` (the site's)  | `src/site/views/layouts/*.ts`                |
| `tests/Game/FooTest.php`                  | `tests/game/Foo.test.ts`                     |
| `tests/TestCase.php`, `TestDatabase.php`  | `tests/TestCase.ts`, `tests/setup.ts`        |
| `game/src/Schema.php` (migrations)        | `src/db/schema.sql` etc., generated: see below |
| `Auth`, `Roles`                           | `src/core/Auth.ts`                           |
| `$_SESSION`                               | `Session.data` (`src/core/Session.ts`)       |
| `$_POST`, `$_GET`, `$_SERVER`             | `Request` (`src/core/http.ts`), passed to App |
| `Game\Redirect`                           | `Redirect` in `src/core/http.ts`             |
| PHP built-ins                             | `src/core/php.ts`                            |

Start every ported file with a comment naming its upstream file, e.g. `// Upstream: game/src/Genders.php`.
`src/game/Genders.ts` and `tests/game/Genders.test.ts` are the worked example: copy their style.

## Classes

- `class Foo { public static function bar() }` → `export class Foo { static bar() }`. `private static` stays
  `private static`. Constants → `static readonly NAME = ...`. Keep method order and docblocks (as JSDoc).
- `self::x` → `Foo.x`. Other classes: import them (`import { Anthros } from './Anthros'`) and call `Anthros.x()`.
  Circular imports are fine **as long as nothing uses another class at module load time**: don't initialise a static
  field from another class's constant (`static X = Ranks.KING`); write the value with a comment, or use a getter.
- Static caches (`private static ?array $ranks = null`) → `private static ranks: ... | null = null;` and register a
  reset at the bottom of the file: `onReset(() => { Foo.ranks = null; });` (`src/core/caches.ts`). Tests and loading
  a saved game call every reset.
- Named arguments and defaults: keep the parameter order; defaults as TS defaults.
- `match`/`switch` → `switch` or a lookup object. `list(...)`/`[$a, $b] =` → array destructuring.
- Exceptions: `throw new RuntimeException('x')` → `throw new Error('x')`. `PDOException` duplicate keys:
  `catch (e) { if (e instanceof DbError && e.isDuplicateKey) ... }` (see Genders.write).

## Values and types

- Rows are `Row` (`Record<string, any>`, from `src/db/Db.ts`). INTEGER columns come back as numbers, TEXT as
  strings, NULL as null, DECIMAL (REAL here) as numbers (PHP got strings like `"12.50"`: its `(float)` casts still
  work as `float()`, but don't compare a DECIMAL to a string). Dates are `'YYYY-MM-DD'`, times `'YYYY-MM-DD HH:MM:SS'`, UTC.
- Casts: `(int)$x` → `int(x)`, `(float)` → `float(x)`, `(string)` → `str(x)`, `(bool)` → `!!x` (but PHP's `'0'`
  is false: use `!empty(x)` where a string might be `'0'`), `empty($x)` → `empty(x)`, `isset($a['k'])` →
  `a.k !== undefined && a.k !== null` (or `a.k != null`). `$x ?? $y` → `x ?? y` (both treat null/undefined).
- `===` between an int from the database and an int is fine. Watch values from forms: they're strings, as in PHP.
- **PHP arrays keep insertion order for integer keys; JS objects don't** (integer-like keys come first, ascending).
  Where upstream builds an array keyed by id (or any integer) and its order matters, or it's iterated, use a `Map`.
  Lists (`$a[] = ...`) are arrays. String-keyed arrays can be objects. Document the shape in a type or comment.
  Returned PHP arrays that callers index by id → `Map<number, ...>` (and say so in the JSDoc).
- `array_map(fn, $list)` → `list.map(fn)`, `array_filter` → `.filter` (note: PHP keeps keys; with `array_values`
  around it that's just `.filter`), `array_column($rows, 'x')` → `rows.map((r) => r.x)`, `array_sum`, `in_array` →
  `.includes`, `count` → `.length`/`.size`, `implode(', ', $a)` → `a.join(', ')`, `usort($a, fn)` → `a.sort(fn)`
  (return `spaceship(a, b)` for `<=>`), `array_key_exists` → `in`/`.has`.
- PHP's sort is not stable before PHP 8; it is since, as is JS's. Keep the same comparator.
- String functions: `str_contains` → `.includes`, `str_starts_with` → `.startsWith`, `ucfirst`, `mb_strlen`, `trim`
  (use php.ts's for PHP semantics), `sprintf('%d')` → template strings, `number_format` from php.ts.
- `preg_match('/x/', $s, $m)` → `const m = s.match(/x/)`. PCRE and JS regexes mostly agree; check `\A`, `\z`, `/u`,
  possessive quantifiers and named groups.

## Time and randomness

- Never `Date.now()`, `new Date()` or `Math.random()` in game code. Use `time()`, `gmdate(format, ts)`,
  `strtotime(text)` (`strtotimeOrThrow` when the input is known good), `today()`, `nowDateTime()`, `addDays(date, n)`
  from `src/core/php.ts`, and `random_int`, `array_rand`, `pick`, `shuffle`, `randomHex` (for
  `bin2hex(random_bytes(n))`). They follow the game clock (`src/core/time.ts`) and the dice (`src/core/random.ts`),
  which tests control (`setNow('2026-03-02 12:00:00')`, `setRandom(() => 0)`).
- SQL's `UTC_DATE()`, `UTC_TIMESTAMP()` and `RAND()` use the same clock and dice.

## The database

`Auth.db()` is the connection (a `Db`, `src/db/Db.ts`: read its header for the PDO → Db table). In short:
`$db->prepare($sql)->execute($p)` → `db.run(sql, p)` (returns rows changed, i.e. `rowCount()`), fetchAll → `db.all`,
fetch → `db.row` (null, not false), fetchColumn → `db.value` (null, not false), `FETCH_COLUMN` → `db.column`,
`FETCH_KEY_PAIR` → `db.pairs` (a Map), `FETCH_UNIQUE` → `db.unique` (a Map), `lastInsertId()` → `db.lastInsertId()`
(a number). `beginTransaction`/`commit`/`rollBack`/`inTransaction` keep their names (and, as in PDO, a second
`beginTransaction` throws). `db.transaction(fn)` exists but only use it where upstream has an equivalent.

The schema is SQLite, generated from upstream's real schema (`npm run schema`: `tools/convert-schema.mjs` →
`src/db/schema.sql`, `seed.sql`, `meta.ts`); triggers are hand-written in `src/db/triggers.sql`. Never edit the
generated files. Strings compare case-insensitively when a column is involved (COLLATE NOCASE, like upstream's
utf8mb4_unicode_ci), and so do their UNIQUE keys and ORDER BY.

A saved game remembers its schema version (`PRAGMA user_version`); `src/db/migrations.ts` brings an older one up to
date when it's opened. When upstream's `Schema.php` changes, add a migration that does to an existing game what
upstream's migration does to its database: the same `ALTER TABLE`s (an added column comes last: nothing depends on
column order), the new tables as `schema.sql` now has them, and the seed rows upstream's migration adds (call the
ported seeding code, e.g. `Crafts.seed(db)`, where upstream does). Before changing the schema, copy the current
`schema.sql`, `seed.sql` and `triggers.sql` to `tests/db/v<version>/`, and extend `tests/db/Migrations.test.ts`: a game
made by each earlier version must migrate to the same tables, columns, keys, indexes and rows as a new one.

**Keep upstream's SQL text** wherever SQLite accepts it; these MariaDB functions are registered so it does
(`src/db/functions.ts`): `UTC_DATE()`, `UTC_TIMESTAMP()`, `NOW()`, `CURDATE()`, `RAND()`, `IF(c, a, b)`,
`GREATEST(...)`, `LEAST(...)`, `CONCAT(...)`, `FLOOR`, `CEIL`, `DATEDIFF(a, b)`, `ADDDATE(d, days)`,
`SUBDATE(d, days)`, `TIMESTAMPDIFF('UNIT', a, b)`, `POW`, `SQRT`, `CHAR_LENGTH`. `IFNULL`, `COALESCE`, `DATE()`,
`LOWER`, `UPPER`, `ROUND`, `ABS`, `MIN`/`MAX` (also as 2-argument scalars), `WITH RECURSIVE`, window functions,
`UPDATE ... FROM` and `RETURNING` are SQLite's own. Backtick-quoted names work.

Rewrite these (and only these) when porting SQL:

| MariaDB                                             | SQLite                                                        |
|-----------------------------------------------------|---------------------------------------------------------------|
| `x + INTERVAL n DAY`, `DATE_ADD(x, INTERVAL n DAY)` | `ADDDATE(x, n)` (weeks: `ADDDATE(x, n * 7)`)                  |
| `x - INTERVAL n DAY`                                | `SUBDATE(x, n)`                                               |
| `TIMESTAMPDIFF(HOUR, a, b)`                         | `TIMESTAMPDIFF('HOUR', a, b)`                                 |
| `INSERT IGNORE`                                     | `INSERT OR IGNORE` (it doesn't ignore foreign key errors)     |
| `... ON DUPLICATE KEY UPDATE v = VALUES(v)`         | `... ON CONFLICT (key columns) DO UPDATE SET v = excluded.v`; after `INSERT ... SELECT`, add `WHERE true` before `ON CONFLICT` |
| `SELECT ... FOR UPDATE`                             | drop the `FOR UPDATE` (a lock-only query can go entirely; say so in a comment) |
| `CAST(x AS SIGNED)` / `UNSIGNED`                    | `CAST(x AS INTEGER)`                                          |
| `a / b` where both are integers                     | **SQLite divides integers as integers.** MariaDB gives a decimal. Write `a * 1.0 / b` (or `CAST(a AS REAL) / b`) unless the result is floored anyway. `DIV` → `/` on integers. |
| `GROUP_CONCAT(x ORDER BY y SEPARATOR ', ')`         | `GROUP_CONCAT(x, ', ' ORDER BY y)`                            |
| `UPDATE a JOIN b ON ... SET a.x = b.y`              | `UPDATE a SET x = b.y FROM b WHERE ...` (no alias on the target's columns in SET) |
| `DELETE a FROM a JOIN b ...`                        | `DELETE FROM a WHERE id IN (SELECT a.id FROM a JOIN b ...)`   |
| `UPDATE ... ORDER BY ... [LIMIT]`                   | not supported: see how `Board.advance` does it                |
| `a <=> b` (null-safe equals)                       | `a IS b` (`NOT (a <=> b)` → `a IS NOT b`)                     |
| `TRIM(BOTH ',' FROM x)`                             | `TRIM(x, ',')` (LEADING/TRAILING: `LTRIM`/`RTRIM`)            |
| `SET a = a + 1, b = IF(a > 0, ...)` (reads the new `a`) | SQLite's SET reads the old row for every assignment: repeat the change in the later expression |
| `ORDER BY name` in a join where several tables have `name` | MariaDB takes the selected column; SQLite calls it ambiguous: qualify it (`a.name`) |
| `information_schema` queries                        | `src/db/meta.ts` (`COLUMNS`, `FOREIGN_KEYS`, `dateColumns`)   |
| `SET FOREIGN_KEY_CHECKS = 0/1`                      | `PRAGMA foreign_keys = OFF/ON` (outside a transaction)        |
| `LIMIT ?` bound as a string                         | bind a number                                                 |
| `'abc' = 'ABC'` between two literals/parameters     | binary in SQLite (only columns are NOCASE): add `COLLATE NOCASE` if it matters |
| ORDER BY an ENUM column                             | MariaDB sorts ENUMs by their position in the list, not alphabetically: use a CASE |

`rowCount()` of an UPDATE: MariaDB counts rows actually *changed*; SQLite counts rows *matched*. If upstream relies
on a no-op update counting 0 (e.g. `UPDATE ... SET x = ? WHERE id = ?` to learn whether x changed), add
`AND x IS NOT ?` to the WHERE.

## Tests

Port each PHPUnit test method to a vitest `test(...)` in a `describe('Foo', ...)`, named from the method
(`testGrantingAFief` → `'granting a fief'`), with the same steps and the same assertions:
`assertSame(a, b)` → `expect(b).toBe(a)` for scalars and `toEqual` for arrays/objects, `assertNull` → `toBeNull()`,
`assertTrue` → `toBe(true)`, `assertCount(n, x)` → `toHaveLength(n)` (or `.size`), `assertStringContainsString` →
`toContain`, `assertEqualsCanonicalizing` → compare `sorted(...)`, `expectException` → `expect(() => ...).toThrow()`.
Upstream's `$this->helper()` methods are functions in `tests/TestCase.ts` (`anthro`, `player`, `admin`,
`playerAnthro`, `anthroOf`, `setCoins`, `coins`, `refresh`, `scalar`, `db`, `genderId`, `speciesId`, `baronyId`,
`notificationsFor`, `notificationsForUser`, `login`); private helpers in a test class become local functions.
Upstream's `TestDatabase::setStatic(Foo::class, 'x', v)` → set the static directly (make it non-private if needed,
with a comment `// Tests set this`).

`npm test` runs everything; `npx vitest run tests/game/Foo.test.ts` one file; `-t 'name'` one test.
`npx tsc --noEmit` type-checks.

The upstream suite can be run as the reference (it passes: 403 tests):
`cd reference/jcw-website && TEST_DBNAME=frontier_phpunit XDEBUG_MODE=off vendor/bin/phpunit tests/Game/FooTest.php`.
It uses its own database, `frontier_phpunit`. **Never touch the databases `website` or `website_dev`, or `/var/www`.**

## In the browser

There's no server. `src/worker/` runs the game in a Web Worker: it keeps the SQLite database in memory, saves it to
IndexedDB after each request that changes it, and answers the page's requests the way upstream's `game/index.php`
does. `src/shell/` is the page: it turns links and forms into requests and shows the answers. There is one account,
the person playing, who is both player and admin. Nothing in `src/game` should know about any of this.

## Pages: App's handlers and the views

`src/game/App.ts` is App.php: its constants, `handle()` (the routing, and the pages handled inline there), and
the helpers at its end. App.php's private handler methods live in `src/game/app/<section>.ts` as exported functions
taking the App first: `$this->breed($user, $anthro, $post)` → `assets.breed(app, user, anthro, post)` (from
App.ts: `assets.breed(this, ...)`). Sections: `home` (home), `assets` (anthro pages, breeding, schedules, standards,
transfer, rename, sell, debt, life, group actions, land reshaping, and the shared `showAnthro`, `breedingMessage`,
`pregnancyMessage`), `market` (auction, groupBid, land, jobs), `social` (socials, groups, notifications), `court`
(court, fiefs), `admin` (every /game/admin page). A handler another section uses is imported from its module.

In a handler:

| App.php                                             | here                                                    |
|-----------------------------------------------------|---------------------------------------------------------|
| `(string)($_POST['x'] ?? '')`                       | `field(app.post, 'x')`                                  |
| `(int)($_POST['x'] ?? 0)`                           | `int(field(app.post, 'x', '0'))`                        |
| `(array)($_POST['x'] ?? [])`                        | `fieldArray(app.post, 'x')` (an object) or `fieldList(app.post, 'x')` (strings) |
| `isset($_POST['x'])`, `!empty($_POST['x'])`         | `app.post.x !== undefined`, `!empty(app.post.x)`        |
| `$_GET[...]`                                        | the same on `app.query`                                 |
| `$_FILES['f']`                                      | `app.request.files.f` (`{name, type, text}`)            |
| `$_SESSION['flash'] = ...`                          | `Session.data.flash = ...`                              |
| `$this->redirect($to)`                              | `app.redirect(to)` (throws)                             |
| `echo $this->render('game::a.b', $user, [...])`     | `app.echo(app.render(abView, user, {...}))`             |
| `http_response_code(404)`                           | `app.status = 404`                                      |
| JSON (`header(...); echo json_encode($x)`)          | `app.json(x)` (throws)                                  |
| a download (`Content-Disposition: attachment`)      | `app.download(filename, type, data)` (throws)           |
| `$this->gameNotFound($user)`, `anthroIdFrom`        | `app.gameNotFound(user)`, `app.anthroIdFrom(...)`       |

`src/core/http.ts` has `field`, `fieldArray`, `fieldList`. Form values are strings; nested names (`days[3][activity]`)
arrive as nested objects, as in PHP.

### Views

`game/views/a/b.blade.php` → `src/game/views/a/b.ts`, whose default export is the template: a function
`(v: ViewContext, data: {...}) => Html`. `v` has what Blade shared with every view: `v.user` ($user), `v.csrf`,
`v.flash`, `v.unread`, and `v.path` (the request's path, for templates that read `$_SERVER['REQUEST_URI']`). `data` is
what the handler passed to render (give it a type). See `src/core/html.ts` for the Blade → html`` table, and
`src/game/views/preferences.ts`, `message.ts`, `changes.ts`, `subnav.ts`, `list-search.ts` and
`assets/anthro-link.ts` as worked examples.

- `@extends('game::layouts.game')` with `@section('title', 'X')` and `@section('content')` →
  `return gameLayout(v, { title: 'X', content: html\`...\` })` (`src/game/views/layouts/game.ts`).
- `@include('game::a.b', [...])` → import the partial and call it: `ab(v, {...})`. A Blade include sees all of its
  parent's variables; pass the ones the partial uses. Partials shared between sections are already ported:
  `assets/anthro-link`, `assets/gender`, `assets/pregnant-badge`, `court/barony-line`, `list-search`,
  `market/time-left`, `market/where`, `subnav`, `message`.
- `@php($x = ...)` → a `const` before the `return`, or inside the `.map()` callback for one in a loop.
- `@push('admin') ... @endpush` → `${v.push('admin', html\`...\`)}` where it stood (it prints nothing there).
  Likewise 'scripts' and 'styles'.
- `{{-- comments --}}` become JS comments (keep their text); HTML comments stay.
- `@if(count($x))`, `@if($x)` on an array: PHP's empty array is false, JS's isn't: test `.length` (or `empty(x)`).
- Numbers print as JS prints them: PHP prints `1.5` and `2` the same way, but a DECIMAL that PHP printed as `"2.50"`
  prints here as `2.5`. Where upstream prints a DECIMAL column directly, format it as upstream's output looked.
- Keep the markup identical (classes, ids, names, text): tests and the page's scripts look for it.
- Inline `<script>`s stay inline: the page shell runs them each time the page is shown, and removes the listeners
  they added to `document`/`window` when the next page is shown. Scripts in the layout that fetched JSON are in
  `src/shell/layout-scripts.ts`.
- Links and form actions stay as upstream wrote them (`/game/...`): the shell turns them into `#/game/...`.
