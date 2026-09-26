// Not upstream: upstream migrates its one database in place (Game\Schema::migrate). Here a saved game carries the
// schema version it was made with, and src/db/migrations.ts brings it up to date; a migrated game must match a new one.
//
// tests/db/v1/*.sql are the database files of schema version 1 (git show 34f07eb:src/db/{schema,seed,triggers}.sql).
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { Db, type Row } from '../../src/db/Db';
import { SCHEMA_VERSION, createDatabase, migrate, openDatabase } from '../../src/db/open';
import v1Schema from './v1/schema.sql?raw';
import v1Seed from './v1/seed.sql?raw';
import v1Triggers from './v1/triggers.sql?raw';

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
});
