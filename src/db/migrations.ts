/**
 * Schema changes for games saved by earlier versions, oldest first. A new database is made from schema.sql (the
 * current schema) and marked with the latest version; one saved earlier runs the migrations it hasn't had.
 *
 * When upstream changes its schema: rerun `npm run schema` (a new game gets the new schema.sql) AND add a migration
 * here that makes the same change to an existing game (ALTER TABLE ... ADD COLUMN, CREATE TABLE ..., seed rows).
 * MIGRATIONS[0] takes a database from version 1 to 2, and so on.
 *
 * A migration's tables and columns are as schema.sql has them (the CREATE TABLEs are copied from it), though a column
 * added by ALTER TABLE comes last in its table rather than where upstream put it (AFTER ...): nothing here depends on
 * column order. tests/db/Migrations.test.ts checks a migrated game against a new one.
 */
import { Crafts } from '../game/Crafts';
import type { Db } from './Db';

export const MIGRATIONS: ((db: Db) => void)[] = [
    // 1 → 2. Upstream e5cd15c (Schema::recipes): work that makes goods. Goods that feed anthros (edible), the recipes
    // (seeded once, with the goods they use: see Crafts::seed), and which recipe a day's work plan names.
    (db) => {
        db.exec('ALTER TABLE game_market_goods ADD COLUMN edible INTEGER NOT NULL DEFAULT 0');
        db.exec("UPDATE game_market_goods SET edible = TRUE WHERE good = 'food'");
        db.exec(`
CREATE TABLE game_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occupation_id INTEGER NOT NULL,
    name TEXT COLLATE NOCASE NOT NULL,
    needs_acres REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (occupation_id) REFERENCES game_occupations (id) ON DELETE CASCADE
);
CREATE INDEX game_recipes__occupation_id ON game_recipes (occupation_id);

CREATE TABLE game_recipe_goods (
    recipe_id INTEGER NOT NULL,
    good TEXT COLLATE NOCASE NOT NULL,
    quantity INTEGER NOT NULL,
    role TEXT CHECK (role IN ('in','out')) NOT NULL,
    PRIMARY KEY (recipe_id, role, good),
    FOREIGN KEY (recipe_id) REFERENCES game_recipes (id) ON DELETE CASCADE,
    FOREIGN KEY (good) REFERENCES game_market_goods (good) ON DELETE CASCADE
);
CREATE INDEX game_recipe_goods__good ON game_recipe_goods (good);`);
        Crafts.seed(db);
        for (const table of ['game_schedule_weekly', 'game_schedule_days', 'game_standard_days']) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN recipe_id INTEGER REFERENCES game_recipes (id) ON DELETE SET NULL`);
            db.exec(`CREATE INDEX ${table}__recipe_id ON ${table} (recipe_id)`);
        }
    },
];
