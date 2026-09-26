import { Auth } from '../core/Auth';
import { DbError, type Row } from '../db/Db';
import { array_column, array_sum, int, mb_strlen, random_int, trim } from '../core/php';

/**
 * Genders, stored as rows in game_genders. is_male anthros can sire and is_female anthros can be dams;
 * presents_as (male, female, androgynous) sets the symbol and name suggestions.
 * Admins manage them at /game/admin/genders.
 */
export class Genders {
    static readonly PRESENTS_AS = ['male', 'female', 'androgynous'];
    static readonly MAX_NAME = 64;

    /**
     * Every gender in display order, with how many anthros have each.
     */
    static all(): Row[] {
        const rows = Auth.db().all(
            `SELECT g.id, g.name, g.is_male, g.is_female, g.presents_as, g.birth_weight, g.sort_order,
                    COUNT(a.id) AS anthros
             FROM game_genders g LEFT JOIN game_anthros a ON a.gender_id = g.id
             GROUP BY g.id, g.name, g.is_male, g.is_female, g.presents_as, g.birth_weight, g.sort_order
             ORDER BY g.sort_order, g.name`,
        );
        return rows.map(Genders.withFlags);
    }

    static find(id: number): Row | null {
        const row = Auth.db().row('SELECT * FROM game_genders WHERE id = ?', [id]);
        return row ? Genders.withFlags(row) : null;
    }

    /**
     * A gender for a newborn, chosen by birth_weight (or evenly among all genders if every weight is 0).
     */
    static randomBirthId(): number {
        const genders = Genders.all();
        const total = array_sum(array_column(genders, 'birth_weight'));
        if (total === 0) {
            return genders[random_int(0, genders.length - 1)].id;
        }
        let roll = random_int(1, total);
        for (const gender of genders) {
            if ((roll -= gender.birth_weight) <= 0) {
                return gender.id;
            }
        }
        return genders[0].id;
    }

    // Admin changes. Each returns an error message, or null on success.

    static add(fields: Row): string | null {
        return Genders.write(
            `INSERT INTO game_genders (name, is_male, is_female, presents_as, birth_weight, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            fields,
        );
    }

    static update(id: number, fields: Row): string | null {
        return Genders.write(
            `UPDATE game_genders SET name = ?, is_male = ?, is_female = ?, presents_as = ?, birth_weight = ?, sort_order = ?
             WHERE id = ?`,
            fields,
            id,
        );
    }

    static delete(id: number): string | null {
        const count = int(Auth.db().value('SELECT COUNT(*) FROM game_anthros WHERE gender_id = ?', [id]));
        if (count) {
            return `That gender can't be deleted while ${count} ` + (count === 1 ? 'anthro or player has' : 'anthros or players have') + ' it.';
        }
        if (int(Auth.db().value('SELECT COUNT(*) FROM game_genders')) <= 1) {
            return 'There must be at least one gender.';
        }
        Auth.db().run('DELETE FROM game_genders WHERE id = ?', [id]);
        return null;
    }

    /**
     * fields: name, is_male, is_female, presents_as, birth_weight, sort_order (from the admin form).
     */
    private static write(sql: string, fields: Row, id: number | null = null): string | null {
        const name = trim(fields.name);
        if (name === '' || mb_strlen(name) > Genders.MAX_NAME) {
            return 'Names must be 1-' + Genders.MAX_NAME + ' characters.';
        }
        if (!Genders.PRESENTS_AS.includes(fields.presents_as)) {
            return 'Choose how the gender presents.';
        }
        if (fields.birth_weight < 0) {
            return 'Birth weight cannot be negative.';
        }
        const params = [
            name, int(fields.is_male), int(fields.is_female), fields.presents_as,
            fields.birth_weight, fields.sort_order,
        ];
        try {
            Auth.db().run(sql, id === null ? params : [...params, id]);
        } catch (e) {
            if (e instanceof DbError && e.isDuplicateKey) {
                return `"${name}" already exists.`;
            }
            throw e;
        }
        return null;
    }

    private static withFlags(row: Row): Row {
        row.is_male = !!row.is_male;
        row.is_female = !!row.is_female;
        return row;
    }
}
