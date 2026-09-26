// Not upstream: upstream migrates its one database in place (Game\Schema::migrate). Here a saved game carries the
// schema version it was made with, and src/db/migrations.ts brings it up to date; a migrated game must match a new one.
//
// tests/db/v1/*.sql are the database files of schema version 1 (git show 34f07eb:src/db/{schema,seed,triggers}.sql),
// tests/db/v2/*.sql those of version 2 (git show c4a50ed:src/db/{schema,seed,triggers}.sql).
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { Db, type Row } from '../../src/db/Db';
import { setNow } from '../../src/core/time';
import { SCHEMA_VERSION, createDatabase, migrate, openDatabase } from '../../src/db/open';
import v1Schema from './v1/schema.sql?raw';
import v1Seed from './v1/seed.sql?raw';
import v1Triggers from './v1/triggers.sql?raw';
import v2Schema from './v2/schema.sql?raw';
import v2Seed from './v2/seed.sql?raw';
import v2Triggers from './v2/triggers.sql?raw';

let SQL: SqlJsStatic;

beforeAll(async () => {
    SQL = await initSqlJs();
});

/** A new game as version 1 made it. */
function version1(): Db {
    const db = new Db(new SQL.Database());
    db.exec(v1Schema);
    db.exec(v1Triggers);
    db.exec(v1Seed);
    db.exec('PRAGMA user_version = 1');
    return db;
}

/** A new game as version 2 made it. */
function version2(): Db {
    const db = new Db(new SQL.Database());
    db.exec(v2Schema);
    db.exec(v2Triggers);
    db.exec(v2Seed);
    db.exec('PRAGMA user_version = 2');
    return db;
}

const tables = (db: Db): string[] =>
    db.column("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");

/** Every table's columns (in name order: an added column comes last), keys, indexes and triggers. */
function shape(db: Db): Row {
    const byName = (a: Row, b: Row) => String(a.name ?? a.from).localeCompare(String(b.name ?? b.from));
    const out: Row = {};
    for (const table of tables(db)) {
        out[table] = {
            columns: db.all(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}')`).sort(byName),
            foreignKeys: db.all(`SELECT "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list('${table}')`).sort(byName),
            indexes: db.all(`SELECT name, "unique", origin FROM pragma_index_list('${table}')`)
                .map((index) => ({ ...index, columns: db.column(`SELECT name FROM pragma_index_info('${index.name}') ORDER BY seqno`) }))
                .sort(byName),
        };
    }
    out.triggers = db.column("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
    return out;
}

/** Every row of every table, in key order. */
function rows(db: Db): Row {
    const out: Row = {};
    for (const table of tables(db)) {
        out[table] = db.all(`SELECT * FROM ${table} ORDER BY ${db.column(`SELECT name FROM pragma_table_info('${table}')`).join(', ')}`);
    }
    return out;
}

describe('Migrations', () => {
    test('a version 1 game migrates to what a new game is', () => {
        // The clock stopped, so the game's clock starts at the same moment in both (see toGameCalendar).
        setNow('2026-09-26 15:00:00');
        const old = version1();
        migrate(old);
        const fresh = createDatabase(SQL);
        expect(Number(old.value('PRAGMA user_version'))).toBe(SCHEMA_VERSION);
        expect(tables(old)).toEqual(tables(fresh));
        expect(shape(old)).toEqual(shape(fresh));
        // The seed rows too: the new goods (and which feed anthros), the recipes and what they use and make, with the
        // same ids.
        expect(rows(old)).toEqual(rows(fresh));
        expect(Number(old.value('SELECT COUNT(*) FROM game_recipes'))).toBeGreaterThan(40);
        expect(old.column('SELECT good FROM game_market_goods WHERE edible ORDER BY good'))
            .toEqual(['bread', 'fish', 'food', 'meals', 'meat', 'vegetables']);
        expect(old.all('PRAGMA foreign_key_check')).toEqual([]);
    });

    test('a saved game keeps its data, and its plans work at the new columns', () => {
        const old = version1();
        old.run("INSERT INTO game_anthros (name, gender_id) VALUES ('Old', (SELECT MIN(id) FROM game_genders))");
        const id = old.lastInsertId();
        old.run("INSERT INTO game_schedule_weekly (anthro_id, weekday, activity, occupation_id) VALUES (?, 1, 'work', 16)", [id]);
        old.run("UPDATE game_goods SET quantity = 12 WHERE anthro_id = ? AND good = 'food'", [id]);

        const db = openDatabase(SQL, old.export());
        expect(db.value('SELECT name FROM game_anthros WHERE id = ?', [id])).toBe('Old');
        expect(db.value("SELECT quantity FROM game_goods WHERE anthro_id = ? AND good = 'food'", [id])).toBe(12);
        expect(db.row('SELECT occupation_id, recipe_id FROM game_schedule_weekly WHERE anthro_id = ?', [id]))
            .toEqual({ occupation_id: 16, recipe_id: null });
        // A recipe named by a plan, and removed, leaves the plan (to work the occupation's first).
        const bread = Number(db.value("SELECT id FROM game_recipes WHERE occupation_id = 16 AND name = 'Bread'"));
        db.run('UPDATE game_schedule_weekly SET recipe_id = ? WHERE anthro_id = ?', [bread, id]);
        db.run('DELETE FROM game_recipes WHERE id = ?', [bread]);
        expect(db.value('SELECT recipe_id FROM game_schedule_weekly WHERE anthro_id = ?', [id])).toBeNull();
        expect(Number(db.value('SELECT COUNT(*) FROM game_recipe_goods WHERE recipe_id = ?', [bread]))).toBe(0);

        // Opening it again changes nothing.
        const again = openDatabase(SQL, db.export());
        expect(rows(again)).toEqual(rows(db));
    });
    test('a version 2 game migrates to what a new game is', () => {
        setNow('2026-09-26 15:00:00');
        const old = version2();
        migrate(old);
        const fresh = createDatabase(SQL);
        expect(Number(old.value('PRAGMA user_version'))).toBe(SCHEMA_VERSION);
        expect(shape(old)).toEqual(shape(fresh));
        // The rows too: the game's clock, started on its first day.
        expect(rows(old)).toEqual(rows(fresh));
        expect(Object.fromEntries(old.pairs("SELECT name, value FROM game_settings WHERE name LIKE 'clock%' ORDER BY name"))).toEqual({
            clock_day: '1199-12-31', clock_game: String(Date.UTC(1200, 0, 1, 15) / 1000), clock_rate: '1', clock_real: String(Date.UTC(2026, 8, 26, 15) / 1000),
        });
        expect(old.all('PRAGMA foreign_key_check')).toEqual([]);
    });

    test('a saved version 2 game moves to the game calendar', () => {
        setNow('2026-09-26 15:00:00');
        const old = version2();
        old.run("INSERT INTO game_anthros (name, gender_id, birthdate, fertile_on) VALUES ('Old', (SELECT MIN(id) FROM game_genders), '2026-05-01', '2026-07-10')");
        const id = old.lastInsertId();
        old.run("INSERT INTO game_settings (name, value) VALUES ('days_advanced', '12')");
        // Days that are part of a key, one after another: they move without colliding (upstream: UPDATE ... ORDER BY day).
        for (let n = 20; n <= 26; n++) {
            old.run("INSERT INTO game_schedule_days (anthro_id, day, activity) VALUES (?, ?, 'rest')", [id, `2026-09-${n}`]);
            old.run("INSERT INTO game_daily (day, task) VALUES (?, 'feed')", [`2026-09-${n}`]);
        }
        old.run("INSERT INTO game_schedule_log (anthro_id, day, activity) VALUES (?, '2026-09-26', 'rest')", [id]);
        old.run("INSERT INTO game_auctions (anthro_id, anthro_name, starting_bid, ends_at) VALUES (?, 'Old', 10, '2026-09-28 12:00:00')", [id]);

        const db = openDatabase(SQL, old.export());
        expect(db.row('SELECT birthdate, fertile_on FROM game_anthros WHERE id = ?', [id])).toEqual({ birthdate: '1199-08-06', fertile_on: '1199-10-15' });
        expect(db.column('SELECT day FROM game_schedule_days ORDER BY day')).toEqual(['1199-12-26', '1199-12-27', '1199-12-28', '1199-12-29', '1199-12-30', '1199-12-31', '1200-01-01']);
        expect(db.column("SELECT day FROM game_daily WHERE task = 'feed' ORDER BY day")).toHaveLength(7);
        expect(db.value('SELECT day FROM game_schedule_log')).toBe('1200-01-01');
        // What happens between people keeps real time.
        expect(db.value('SELECT ends_at FROM game_auctions')).toBe('2026-09-28 12:00:00');
        expect(db.value("SELECT COUNT(*) FROM game_settings WHERE name = 'days_advanced'")).toBe(0);
        expect(db.row('SELECT trade_recipe_id FROM game_anthros WHERE id = ?', [id])).toEqual({ trade_recipe_id: null });
        // A trade's recipe, removed, leaves the trade (to work the occupation's first).
        const recipe = Number(db.value('SELECT MIN(id) FROM game_recipes'));
        db.run('UPDATE game_anthros SET trade_recipe_id = ? WHERE id = ?', [recipe, id]);
        db.run('DELETE FROM game_recipes WHERE id = ?', [recipe]);
        expect(db.value('SELECT trade_recipe_id FROM game_anthros WHERE id = ?', [id])).toBeNull();
        // Rows made take the game's time, once the clock gives it (see Clock.bind).
        db.setVariable('game_now', '1200-01-01 00:00:00');
        db.run("INSERT INTO game_anthros (name, gender_id) VALUES ('New', (SELECT MIN(id) FROM game_genders))");
        expect(db.value('SELECT created_at FROM game_anthros WHERE id = ?', [db.lastInsertId()])).toBe('1200-01-01 00:00:00');

        // Opening it again changes nothing.
        const again = openDatabase(SQL, db.export());
        expect(rows(again)).toEqual(rows(db));
    });
});
