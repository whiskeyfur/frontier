// Upstream: game/src/Buildings.php
import { Auth } from '../core/Auth';
import { array_fill, float, int, mb_strlen, round, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Goods } from './Goods';
import { Land } from './Land';
import { Notifications } from './Notifications';

/**
 * Buildings on lots. Admins define the kinds (game_building_types): how many days of work each takes and how many
 * acres of land it stands on. A building is started on a lot by whoever holds the lot, if the lot has that much land
 * free of other buildings; anthros then build it, a day's work at a time (see Schedules), until its days are done.
 */
export class Buildings {
    static readonly MAX_NAME = 40;
    // Lumber a day's building uses, from the store of whoever holds the lot.
    static readonly LUMBER_PER_DAY = 1;
    // The kinds a new game starts with: [name, days of work, acres].
    static readonly SEED_TYPES: [string, number, number][] = [
        ['House', 10, 0.25], ['Barn', 15, 0.5], ['Granary', 15, 0.5], ['Workshop', 12, 0.25], ['Smithy', 15, 0.25],
        ['Bakery', 12, 0.25], ['Mill', 30, 0.5], ['Inn', 30, 0.5], ['Chapel', 40, 1],
    ];

    /**
     * Every kind of building, in order: Map(id => {id, name, days, acres, sort_order, built (how many there are)}).
     */
    static types(): Map<number, Row> {
        const rows = Auth.db().all(
            'SELECT t.*, (SELECT COUNT(*) FROM game_buildings b WHERE b.type_id = t.id) AS built FROM game_building_types t ORDER BY t.sort_order, t.name',
        );
        const types = new Map<number, Row>();
        for (const row of rows) {
            types.set(int(row.id), row);
        }
        return types;
    }

    /**
     * Admin: adds a kind of building (or, with id, changes one). Returns an error message, or null.
     */
    static saveType(id: number | null, name: string, days: number, acres: string, order: number): string | null {
        name = trim(name);
        const size = Land.hundredths(acres);
        if (name === '' || mb_strlen(name) > Buildings.MAX_NAME) {
            return 'Name it (up to ' + Buildings.MAX_NAME + ' characters).';
        }
        if (days < 1 || days > 1000) {
            return 'It takes 1 to 1000 days to build.';
        }
        if (size === null || size > Land.MAX_ACRES * 100) {
            return 'It stands on ' + Land.acres(Land.MIN_ACRES) + ' to ' + Land.acres(Land.MAX_ACRES) + '.';
        }
        if (Auth.db().value('SELECT COUNT(*) FROM game_building_types WHERE name = ? AND id <> ?', [name, id ?? 0])) {
            return `There's already a kind of building called ${name}.`;
        }
        if (id === null) {
            Auth.db().run('INSERT INTO game_building_types (name, days, acres, sort_order) VALUES (?, ?, ?, ?)',
                [name, days, size / 100, order]);
        } else {
            Auth.db().run('UPDATE game_building_types SET name = ?, days = ?, acres = ?, sort_order = ? WHERE id = ?',
                [name, days, size / 100, order, id]);
        }
        return null;
    }

    /**
     * Admin: removes a kind of building nobody has built or started. Returns an error message, or null.
     */
    static deleteType(id: number): string | null {
        const type = Buildings.types().get(id) ?? null;
        if (!type) {
            return 'No such kind of building.';
        }
        if (type.built) {
            return `${type.name}s have been built or started: it can't be removed.`;
        }
        Auth.db().run('DELETE FROM game_building_types WHERE id = ?', [id]);
        return null;
    }

    /**
     * One building, with its kind (name, days, acres), its lot (holder_id, where it lies) and whether it's done.
     */
    static find(id: number): Row | null {
        return Auth.db().row(Buildings.SELECT + ' WHERE b.id = ?', [id]);
    }

    /**
     * The buildings on lots the anthro holds, unfinished first (see find()).
     */
    static heldBy(anthroId: number): Row[] {
        return Auth.db().all(Buildings.SELECT + ' WHERE p.anthro_id = ? ORDER BY b.finished_at IS NOT NULL, b.started_at, b.id', [anthroId]);
    }

    /**
     * The buildings on these lots: Map(lot id => [building, ...]).
     */
    static onLots(parcelIds: number[]): Map<number, Row[]> {
        if (!parcelIds.length) {
            return new Map();
        }
        const rows = Auth.db().all(
            Buildings.SELECT + ' WHERE b.parcel_id IN (' + array_fill(parcelIds.length, '?').join(', ') + ') ORDER BY b.id',
            [...parcelIds],
        );
        const byLot = new Map<number, Row[]>();
        for (const building of rows) {
            if (!byLot.has(building.parcel_id)) byLot.set(building.parcel_id, []);
            byLot.get(building.parcel_id)!.push(building);
        }
        return byLot;
    }

    /**
     * How many acres of the lot buildings stand on (finished or not), in hundredths of an acre.
     */
    static usedHundredths(parcelId: number): number {
        const used = Auth.db().value(
            'SELECT COALESCE(SUM(t.acres), 0) FROM game_buildings b JOIN game_building_types t ON t.id = b.type_id WHERE b.parcel_id = ?',
            [parcelId],
        );
        return int(round(float(used) * 100));
    }

    /**
     * Starts a building on a lot: the user's (the anthro they play holds it) or any, for an admin. The lot needs the
     * building's acres free of other buildings. Returns [its id, null] or [null, error message].
     */
    static start(user: Row, typeId: number, parcelId: number): [number | null, string | null] {
        const type = Buildings.types().get(typeId) ?? null;
        const parcel = Land.parcel(parcelId);
        const player = Anthros.player(user.id);
        if (!type) {
            return [null, 'Choose what to build.'];
        }
        if (!parcel || (!Auth.isAdmin(user) && (!player || parcel.anthro_id !== player.id))) {
            return [null, 'Choose a lot of yours to build on.'];
        }
        const free = int(round(float(parcel.acres) * 100)) - Buildings.usedHundredths(parcelId);
        if (int(round(float(type.acres) * 100)) > free) {
            return [null, `A ${type.name} needs ` + Land.acres(type.acres) + ', and lot #' + parcelId + ' has ' + Land.acres(free / 100) + ' free.'];
        }
        Auth.db().run('INSERT INTO game_buildings (type_id, parcel_id, started_by) VALUES (?, ?, ?)', [typeId, parcelId, user.id]);
        return [Auth.db().lastInsertId(), null];
    }

    /**
     * A day's building work on it by the anthro. Returns what came of it, for the anthro's log.
     */
    static work(building: Row, anthro: Row): string {
        if (building.finished_at !== null) {
            return `Went to build the ${building.name}, but it's finished.`;
        }
        // A day's building uses a lumber from the store of whoever holds the lot.
        if (!Goods.take(int(building.holder_id), 'lumber', Buildings.LUMBER_PER_DAY)) {
            return `Went to build the ${building.name}, but there was no lumber.`;
        }
        const progress = int(building.progress) + 1;
        const done = progress >= int(building.days);
        Auth.db().run('UPDATE game_buildings SET progress = ?, finished_at = IF(?, UTC_TIMESTAMP(), NULL) WHERE id = ?',
            [progress, int(done), building.id]);
        if (done) {
            Notifications.toAnthro(building.holder_id, `The ${building.name} on lot #${building.parcel_id} is finished.`, '/game/assets/land');
            return `Built the ${building.name}: it's finished.`;
        }
        return `Built at the ${building.name} (${progress} of ${building.days} days).`;
    }

    // A building with its kind and its lot.
    private static readonly SELECT = `SELECT b.*, t.name, t.days, t.acres, p.anthro_id AS holder_id, p.barony_id, p.part_id, br.name AS barony_name, pt.name AS part_name
                            FROM game_buildings b
                            JOIN game_building_types t ON t.id = b.type_id
                            JOIN game_parcels p ON p.id = b.parcel_id
                            LEFT JOIN game_baronies br ON br.id = p.barony_id
                            LEFT JOIN game_barony_parts pt ON pt.id = p.part_id`;
}
