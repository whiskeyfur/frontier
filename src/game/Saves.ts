// Upstream: game/src/Saves.php
import { Auth } from '../core/Auth';
import { gmdate, int, json_encode, mb_strlen, mb_substr, trim } from '../core/php';
import type { Row } from '../db/Db';
import { COLUMNS, FOREIGN_KEYS } from '../db/meta';
import { Anthros } from './Anthros';
import { Board } from './Board';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';

/**
 * Saved games. A save is a snapshot of every game table (the game state that a reset deletes, plus species, genders
 * and names) stored as gzipped JSON. Restoring one replaces the current game with it; the current game is saved
 * first, so a restore can itself be undone.
 *
 * Here the JSON is stored as plain UTF-8 bytes, not gzipped: the browser has no synchronous gzip. The snapshot (and
 * so the download, see json) is the same JSON as upstream's.
 */
export class Saves {
    static readonly MAX_NAME = 100;

    // Saved and restored along with the game state, since anthros refer to them.
    private static readonly CONFIG_TABLES = ['game_species_groups', 'game_species', 'game_genders', 'game_names', 'game_ranks', 'game_skills', 'game_occupations', 'game_building_types', 'game_market_goods'];

    /**
     * Every save, newest first, without its data.
     */
    static all(): Row[] {
        return Auth.db().all(
            `SELECT s.id, s.name, s.anthros, s.created_at, LENGTH(s.data) AS size, u.username AS created_by_name
             FROM game_saves s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.id DESC`,
        );
    }

    static find(id: number): Row | null {
        return Auth.db().row('SELECT * FROM game_saves WHERE id = ?', [id]);
    }

    /**
     * The save's snapshot as JSON (for downloading).
     */
    static json(save: Row): string {
        // Upstream: gzdecode. The data is the JSON's bytes (or, from a TEXT value, the JSON itself).
        return typeof save.data === 'string' ? save.data : new TextDecoder().decode(save.data);
    }

    /**
     * Saves the current game under $name. Returns [save id, null] or [null, error message].
     */
    static create(admin: Row, name: string): [number, null] | [null, string] {
        name = trim(name);
        if (name === '' || mb_strlen(name) > Saves.MAX_NAME) {
            return [null, 'Name the save (up to ' + Saves.MAX_NAME + ' characters).'];
        }
        const db = Auth.db();
        const tables: Record<string, Row[]> = {};
        for (const table of [...Saves.CONFIG_TABLES, ...Board.TABLES]) {
            tables[table] = db.all(`SELECT * FROM ${table}`);
        }
        const snapshot = { saved_at: gmdate('Y-m-d H:i:s'), tables };
        db.run('INSERT INTO game_saves (name, anthros, data, created_by) VALUES (?, ?, ?, ?)', [
            name, tables.game_anthros.length, new TextEncoder().encode(json_encode(snapshot)), admin.id,
        ]);
        return [db.lastInsertId(), null];
    }

    static delete(id: number): string | null {
        return Auth.db().run('DELETE FROM game_saves WHERE id = ?', [id]) ? null : 'That save no longer exists.';
    }

    /**
     * Replaces the current game with a save, after saving the current game. Columns added since the save get their
     * defaults, and references to site accounts deleted since are cleared (or the row dropped where one is
     * required). Returns an error message, or null.
     */
    static restore(admin: Row, id: number): string | null {
        const save = Saves.find(id);
        if (!save) {
            return 'That save no longer exists.';
        }
        const snapshot = jsonDecode(Saves.json(save));
        const saved = snapshot?.tables;
        if (saved == null || typeof saved !== 'object') {
            return "That save can't be read.";
        }
        const [, error] = Saves.create(admin, 'Before restoring "' + mb_substr(save.name, 0, Saves.MAX_NAME - 20) + '"');
        if (error) {
            return error;
        }

        const db = Auth.db();
        // Tables a save doesn't have (older saves predate some) are left as they are.
        const tables = [...Saves.CONFIG_TABLES, ...Board.TABLES].filter((t) => saved[t] !== undefined && saved[t] !== null);
        const columns = Saves.columns(tables);
        // Rows refer to each other in every direction (parents, lieges, litters...); load them without checks.
        // (SQLite only changes this outside a transaction.)
        db.exec('PRAGMA foreign_keys = OFF');
        db.beginTransaction();
        try {
            for (const table of tables) {
                db.exec(`DELETE FROM ${table}`);
            }
            for (const table of tables) {
                for (const full of Object.values<Row>(saved[table] ?? {})) {
                    const row = Object.fromEntries(Object.entries(full).filter(([c]) => columns[table].has(c)));
                    const names = Object.keys(row);
                    if (!names.length) {
                        continue;
                    }
                    db.run(`INSERT INTO ${table} (${names.map((c) => '`' + c + '`').join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
                        Object.values(row));
                }
            }
            Saves.dropMissingUsers(tables);
            // Saves from before free anthros owned themselves have no owner for them.
            Anthros.freeUnowned();
            Ranks.forget();
            db.commit();
            db.exec('PRAGMA foreign_keys = ON');
        } catch (e) {
            db.rollBack();
            db.exec('PRAGMA foreign_keys = ON');
            throw e;
        }
        Notifications.toAdmins(`${admin.username} restored the saved game "${save.name}" (${save.created_at} UTC).`, '/game/admin/saves');
        return null;
    }

    /**
     * The current columns of each table, as [table => [column => true]].
     */
    private static columns(tables: string[]): Record<string, Set<string>> {
        // Upstream reads these from information_schema.
        const columns: Record<string, Set<string>> = {};
        for (const table of tables) {
            columns[table] = new Set(Object.keys(COLUMNS[table] ?? {}));
        }
        return columns;
    }

    /**
     * Clears references to site accounts that no longer exist (deleting the row where the reference is required).
     */
    private static dropMissingUsers(tables: string[]): void {
        const db = Auth.db();
        // Upstream reads the keys from information_schema; whether a column is nullable, from SQLite's own table info.
        for (const { table, column } of FOREIGN_KEYS.filter((k) => k.references === 'users' && tables.includes(k.table))) {
            const nullable = !int(db.value('SELECT "notnull" FROM pragma_table_info(?) WHERE name = ?', [table, column]));
            const missing = `\`${column}\` IS NOT NULL AND \`${column}\` NOT IN (SELECT id FROM users)`;
            db.exec(nullable
                ? `UPDATE ${table} SET \`${column}\` = NULL WHERE ${missing}`
                : `DELETE FROM ${table} WHERE ${missing}`);
        }
    }
}

/** PHP's json_decode($json, true): the value, or null if it isn't JSON. */
function jsonDecode(json: string): any {
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}
