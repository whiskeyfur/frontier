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
import { gmdate, int, strtotimeOrThrow, time } from '../core/php';
import { Clock } from '../game/Clock';
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
    // 2 → 3. Upstream a79b652 (Schema::recipes, Schema::gameClock): which of its trade's recipes an anthro works when
    // nobody plans it; the pace each player asks the game's time to run at; rows stamped when they're made take the
    // game's time (the triggers, as src/db/triggers.sql has them); and the game moves to its own calendar (see
    // toGameCalendar), once.
    (db) => {
        db.exec('ALTER TABLE game_anthros ADD COLUMN trade_recipe_id INTEGER REFERENCES game_recipes (id) ON DELETE SET NULL');
        db.exec('CREATE INDEX game_anthros__trade_recipe_id ON game_anthros (trade_recipe_id)');
        // The rate each player asks the game to run at, in game days per real day (see Clock::wanted).
        db.exec('ALTER TABLE game_preferences ADD COLUMN time_rate REAL');
        for (const [table, column] of Object.entries({ game_anthros: 'created_at', game_breedings: 'bred_at', game_parcels: 'created_at', game_buildings: 'started_at' })) {
            db.exec(`DROP TRIGGER IF EXISTS ${table}_game_time`);
            // Only the column's default (the real now): a time given (a save restored, a test) is kept.
            db.exec(`CREATE TRIGGER ${table}_game_time AFTER INSERT ON ${table} FOR EACH ROW
WHEN VARIABLE('game_now') IS NOT NULL AND TIMESTAMPDIFF('SECOND', NEW.${column}, NOW()) <= 60
BEGIN
    UPDATE ${table} SET ${column} = VARIABLE('game_now') WHERE id = NEW.id;
END;`);
        }
        if (int(db.value("SELECT COUNT(*) FROM game_settings WHERE name = 'clock_game'"))) {
            return;
        }
        toGameCalendar(db, gmdate('Y-m-d'));
    },
];

// Upstream: Schema::GAME_TIME_COLUMNS.
// The game's own dates and times (see Clock), by table; the rest of the game's times are real (auctions, messages...).
export const GAME_TIME_COLUMNS: Record<string, string[]> = {
    game_anthros: ['birthdate', 'fertile_on', 'fertile_until', 'died_at', 'hungry_on', 'debt_since', 'employed_since', 'paid_until',
        'tax_overdue_since', 'title_since', 'created_at'],
    game_breedings: ['bred_at'], game_breeding_groups: ['rolled_through'], game_buildings: ['started_at', 'finished_at'],
    game_daily: ['day'], game_litters: ['bred_on', 'due_on', 'born_at'], game_parcels: ['created_at'],
    game_proposals: ['created_at', 'answered_at'], game_schedule_days: ['day'], game_schedule_log: ['day'],
};

// Here, not upstream: how far (in days, about 2,700 years) toGameCalendar parks days that are part of a row's key.
const PARKING_DAYS = 1000000;

/**
 * Upstream: Schema::toGameCalendar.
 * Moves a game that ran on the real calendar (its "today" was today) to the game's own, starting at Clock::START:
 * every game date (see GAME_TIME_COLUMNS) shifts alike, so ages and waits keep their length, and the clock starts
 * there (its first day's business counted as begun). Used once by the migration, and for saves from before. (Here a
 * new game gets its clock this way too, as upstream's migration gives a new database one: see createDatabase.)
 */
export function toGameCalendar(db: Db, today: string): void {
    const shift = int(db.value('SELECT DATEDIFF(?, ?)', [Clock.START, today]));
    for (const [table, columns] of Object.entries(GAME_TIME_COLUMNS)) {
        // Days that are part of a row's key move earliest first (the shift is back), so no two rows share one on the way.
        // (Upstream: UPDATE ... ORDER BY `day`. SQLite has no ORDER BY on UPDATE and checks keys row by row, so those
        // days go far into the future first, where no row has one, and then back to where they belong.)
        if (columns.includes('day')) {
            db.exec(`UPDATE \`${table}\` SET \`day\` = ADDDATE(\`day\`, ${PARKING_DAYS})`);
        }
        const set = columns.map((c) => `\`${c}\` = ADDDATE(\`${c}\`, ${c === 'day' ? shift - PARKING_DAYS : shift})`).join(', ');
        db.exec(`UPDATE \`${table}\` SET ${set}`);
    }
    db.exec("DELETE FROM game_settings WHERE name = 'days_advanced'");
    const start = strtotimeOrThrow(Clock.START + ' ' + gmdate('H:i:s') + ' UTC');
    for (const [name, value] of Object.entries({ clock_game: start, clock_real: time(), clock_rate: Clock.DEFAULT_RATE, clock_day: Clock.add(Clock.START, -1) })) {
        db.run('INSERT INTO game_settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', [name, String(value)]);
    }
}
