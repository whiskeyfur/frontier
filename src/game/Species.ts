// Upstream: game/src/Species.php
import { Auth } from '../core/Auth';
import { DbError, type Row } from '../db/Db';
import { int, mb_strlen, trim } from '../core/php';

/**
 * Species players can choose, stored as rows in game_species and grouped by game_species_groups.
 * Admins manage them at /game/admin/species.
 */
export class Species {
    static readonly MAX_NAME = 64;

    /**
     * Species grouped for display: Map of group name => Map of id => species name, groups in sort order.
     */
    static grouped(): Map<string, Map<number, string>> {
        const groups = new Map<string, Map<number, string>>();
        for (const group of Species.groupsWithSpecies()) {
            for (const species of group.species) {
                if (!groups.has(group.name)) {
                    groups.set(group.name, new Map());
                }
                groups.get(group.name)!.set(species.id, species.name);
            }
        }
        return groups;
    }

    /**
     * Every group (including empty ones) in sort order, each with its species and how many anthros each has.
     */
    static groupsWithSpecies(): Row[] {
        const db = Auth.db();
        const groups = db.unique('SELECT id, name, sort_order FROM game_species_groups ORDER BY sort_order, name');
        const species = db.all(
            `SELECT s.id, s.name, s.group_id, COUNT(a.id) AS anthros
             FROM game_species s LEFT JOIN game_anthros a ON a.species_id = s.id
             GROUP BY s.id, s.name, s.group_id ORDER BY s.name`,
        );

        for (const [id, group] of groups) {
            group.id = id;
            group.species = [];
        }
        for (const row of species) {
            // As PHP would, a species whose group is missing starts a group of its own.
            if (!groups.has(row.group_id)) {
                groups.set(row.group_id, { species: [] });
            }
            groups.get(row.group_id)!.species.push(row);
        }
        return [...groups.values()];
    }

    static exists(id: number): boolean {
        return !!Auth.db().value('SELECT COUNT(*) FROM game_species WHERE id = ?', [id]);
    }

    // Admin changes. Each returns an error message, or null on success.

    static addSpecies(name: string, groupId: number): string | null {
        return Species.write(
            'INSERT INTO game_species (name, group_id) VALUES (?, ?)', [trim(name), groupId], trim(name), groupId,
        );
    }

    static updateSpecies(id: number, name: string, groupId: number): string | null {
        return Species.write(
            'UPDATE game_species SET name = ?, group_id = ? WHERE id = ?', [trim(name), groupId, id], trim(name), groupId,
        );
    }

    static deleteSpecies(id: number): string | null {
        const count = int(Auth.db().value('SELECT COUNT(*) FROM game_anthros WHERE species_id = ?', [id]));
        if (count) {
            return `That species can't be deleted while ${count} ` + (count === 1 ? 'anthro has' : 'anthros have') + ' it.';
        }
        Auth.db().run('DELETE FROM game_species WHERE id = ?', [id]);
        return null;
    }

    static addGroup(name: string, sortOrder: number): string | null {
        return Species.write(
            'INSERT INTO game_species_groups (name, sort_order) VALUES (?, ?)', [trim(name), sortOrder], trim(name),
        );
    }

    static updateGroup(id: number, name: string, sortOrder: number): string | null {
        return Species.write(
            'UPDATE game_species_groups SET name = ?, sort_order = ? WHERE id = ?', [trim(name), sortOrder, id], trim(name),
        );
    }

    static deleteGroup(id: number): string | null {
        if (int(Auth.db().value('SELECT COUNT(*) FROM game_species WHERE group_id = ?', [id]))) {
            return 'Move or delete the species in that group first.';
        }
        Auth.db().run('DELETE FROM game_species_groups WHERE id = ?', [id]);
        return null;
    }

    /**
     * Validates a name (and group, when given), then runs the insert or update.
     */
    private static write(sql: string, params: unknown[], name: string, groupId: number | null = null): string | null {
        if (name === '' || mb_strlen(name) > Species.MAX_NAME) {
            return 'Names must be 1-' + Species.MAX_NAME + ' characters.';
        }
        if (groupId !== null) {
            if (!Auth.db().value('SELECT COUNT(*) FROM game_species_groups WHERE id = ?', [groupId])) {
                return 'Choose a group.';
            }
        }
        try {
            Auth.db().run(sql, params);
        } catch (e) {
            if (e instanceof DbError && e.isDuplicateKey) {
                return `"${name}" already exists.`;
            }
            throw e;
        }
        return null;
    }
}
