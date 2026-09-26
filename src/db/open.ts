/**
 * Making and opening game databases. The schema, triggers and seed rows are bundled as text; the SQLite engine
 * (sql.js) is handed in, as the browser and the tests load it differently.
 */
import type { SqlJsStatic } from 'sql.js';
import schemaSql from './schema.sql?raw';
import triggersSql from './triggers.sql?raw';
import seedSql from './seed.sql?raw';
import { Db } from './Db';
import { MIGRATIONS } from './migrations';

/** The schema version a new database gets: one more than the number of migrations. */
export const SCHEMA_VERSION = MIGRATIONS.length + 1;

/** A new game database: every table, the triggers, and the configuration rows (species, genders, names...). */
export function createDatabase(SQL: SqlJsStatic): Db {
    const db = new Db(new SQL.Database());
    db.exec(schemaSql);
    db.exec(triggersSql);
    db.exec(seedSql);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return db;
}

/** Opens a saved database, bringing its schema up to date. */
export function openDatabase(SQL: SqlJsStatic, bytes: Uint8Array): Db {
    const db = new Db(new SQL.Database(bytes));
    migrate(db);
    return db;
}

/** Runs the migrations a database hasn't had (each once, in order; see migrations.ts). */
export function migrate(db: Db): void {
    const version = Number(db.value('PRAGMA user_version'));
    if (version > SCHEMA_VERSION) {
        throw new Error(`This game was saved by a newer version of Frontier (schema ${version}; this one knows ${SCHEMA_VERSION}).`);
    }
    for (let v = version; v < SCHEMA_VERSION; v++) {
        db.transaction(() => {
            MIGRATIONS[v - 1](db);
            db.exec(`PRAGMA user_version = ${v + 1}`);
        });
    }
}
