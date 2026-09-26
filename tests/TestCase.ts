/**
 * The test harness: upstream's Tests\TestCase and TestDatabase, as functions. Before each test (tests/setup.ts) the
 * game gets a fresh copy of a new database (seeded species, genders, names, ranks... and no users), an empty session,
 * the real clock and real randomness, the game's clock started today (see Clock.start), and the day's 'defaults' task already claimed (test anthros would otherwise all
 * work their trades each day: see Schedules::runDefaults; tests of that feature delete the claim).
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Auth, Roles, type User } from '../src/core/Auth';
import { resetCaches } from '../src/core/caches';
import { Session } from '../src/core/Session';
import { setNow } from '../src/core/time';
import { setRandom } from '../src/core/random';
import { gmdate, random_int, strtotimeOrThrow, ucfirst } from '../src/core/php';
import { Db, type Params, type Row } from '../src/db/Db';
import { createDatabase } from '../src/db/open';
import { Anthros } from '../src/game/Anthros';
import { Clock } from '../src/game/Clock';
import { Wallets } from '../src/game/Wallets';

let SQL: SqlJsStatic | null = null;
let template: Uint8Array | null = null;

export async function freshDatabase(): Promise<Db> {
    SQL ??= await initSqlJs();
    if (!template) {
        const built = createDatabase(SQL);
        template = built.export();
        built.close();
    }
    safeDb()?.close();
    const db = new Db(new SQL.Database(template));
    Auth.setDb(db);
    resetCaches();
    Session.reset();
    setNow(null);
    setRandom(null);
    // The game's clock starts today (real), so tests can speak of dates the way the game does; tests of the clock set
    // their own.
    Clock.start(gmdate('Y-m-d'));
    db.run("INSERT INTO game_daily (day, task) VALUES (UTC_DATE(), 'defaults')");
    return db;
}

function safeDb(): Db | null {
    try {
        return Auth.db();
    } catch {
        return null;
    }
}

export function db(): Db {
    return Auth.db();
}

/** The first column of the first row (upstream's $this->scalar). */
export function scalar(sql: string, params: Params = []): any {
    return db().value(sql, params);
}

/** A user with the given roles. */
export function user(username: string, roles: string[] = []): User {
    return Auth.create(username, roles);
}

export function admin(username = 'boss'): User {
    return user(username, [Roles.ADMIN, Roles.PLAYER]);
}

export function player(username: string): User {
    return user(username, [Roles.PLAYER]);
}

/** Logs the user in for this "request". */
export function login(u: User): void {
    Session.data.user_id = u.id;
}

export function genderId(name: string): number {
    return Number(scalar('SELECT id FROM game_genders WHERE name = ?', [name]));
}

export function speciesId(name = 'Wolf'): number {
    return Number(scalar('SELECT id FROM game_species WHERE name = ?', [name]));
}

/**
 * Inserts an anthro and returns it (as Anthros.findAny does). Defaults: free (owns itself; owner_id: null makes it
 * the game's), unplayed, male wolf, 20 weeks old (a lifespan of at least 52 weeks), fertile, conceiving today, with
 * litters of up to 8. Its starting coins are set to 0 so balances are predictable. owner: user and employer: user mean
 * the anthro that user plays (one is made for them if they don't play one yet).
 */
export function anthro(fields: Row = {}): Row {
    const gender = fields.gender ?? 'Male';
    const row: Row = { ...fields };
    for (const [key, column] of [['owner', 'owner_id'], ['employer', 'employer_id']] as const) {
        if (row[key] !== undefined && row[key] !== null) row[column] = anthroOf(row[key]);
    }
    delete row.gender;
    delete row.owner;
    delete row.employer;
    const defaults: Row = {
        name: 'Anthro' + random_int(1000, 999999),
        gender_id: genderId(gender),
        species_id: speciesId(),
        birthdate: gmdate('Y-m-d', strtotimeOrThrow('-20 weeks')),
        fertile_on: gmdate('Y-m-d', strtotimeOrThrow('-10 weeks')),
        fertile_weekday: Number(gmdate('N')),
        max_cubs: 8,
        player_id: null,
    };
    for (const [k, v] of Object.entries(defaults)) if (!(k in row)) row[k] = v;
    const columns = Object.keys(row);
    db().run(
        `INSERT INTO game_anthros (${columns.map((c) => '`' + c + '`').join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        Object.values(row),
    );
    const id = db().lastInsertId();
    if (!('owner_id' in row)) {
        Anthros.free(id);
    }
    setCoins(id, 0);
    return Anthros.findAny(id)!;
}

/** A barony for land to lie in (created, held by nobody, the first time it's asked for in a test). */
export function baronyId(): number {
    let id = scalar("SELECT id FROM game_baronies WHERE name = 'Testholm'");
    if (!id) {
        db().run("INSERT INTO game_baronies (name) VALUES ('Testholm')");
        id = db().lastInsertId();
    }
    return Number(id);
}

/** An anthro the user plays (free, unless an owner is given). */
export function playerAnthro(u: User, fields: Row = {}): Row {
    return anthro({ player_id: u.id, name: ucfirst(u.username) + 'Anthro', ...fields });
}

/** The id of the anthro the user plays, making them one if they don't play one yet. */
export function anthroOf(u: User): number {
    return Wallets.anthroFor(u.id) ?? playerAnthro(u).id;
}

export function setCoins(anthroId: number, coins: number): void {
    db().run(
        'INSERT INTO game_wallets (anthro_id, balance) VALUES (?, ?) ON CONFLICT (anthro_id) DO UPDATE SET balance = excluded.balance',
        [anthroId, coins],
    );
}

export function coins(anthroId: number): number {
    return Number(scalar('SELECT balance FROM game_wallets WHERE anthro_id = ?', [anthroId]) ?? 0);
}

export function refresh(a: Row): Row {
    return Anthros.findAny(a.id)!;
}

/** Bodies of the notifications addressed to an anthro, oldest first. */
export function notificationsFor(anthroId: number): string[] {
    return db().column('SELECT body FROM game_notifications WHERE anthro_id = ? ORDER BY id', [anthroId]);
}

export function notificationsForUser(userId: number): string[] {
    return db().column('SELECT body FROM game_notifications WHERE user_id = ? ORDER BY id', [userId]);
}

/** PHPUnit's assertEqualsCanonicalizing for lists: the same items in any order. */
export function sorted<T>(list: Iterable<T>): T[] {
    return [...list].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}
