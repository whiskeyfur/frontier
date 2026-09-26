// Upstream: game/src/Litters.php
import { Auth } from '../core/Auth';
import { empty, gmdate, int, random_int, strtotimeOrThrow } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Baronies } from './Baronies';
import { Clock } from './Clock';
import { Genders } from './Genders';
import { Names } from './Names';
import { Notifications } from './Notifications';

/** What came of a breeding attempt: the dam's litter or null, and why there's no litter, or null. */
export type BreedingOutcome = { litter: Row | null; barren: string | null };

/**
 * Pregnancies. Breeding a dam starts a litter due GESTATION_DAYS later; every breeding attempt with her on that
 * same day adds one cub (up to the dam's max_cubs). Attempts that break the rules are recorded but add no cub. Litters are
 * delivered by deliverDue(), which the game runs on each request.
 */
export class Litters {
    // The most cubs any litter can hold; each dam's own limit (game_anthros.max_cubs, see Anthros::maxCubs) is
    // MIN_CUBS to MAX_CUBS, inherited from her mother give or take one.
    static readonly MAX_CUBS = 8;
    static readonly MIN_CUBS = 1;
    static readonly GESTATION_DAYS = 63;

    /**
     * The dam's litter that hasn't been born yet, with how many cubs it has so far, or null.
     */
    static pending(damId: number): Row | null {
        return Auth.db().row(
            `SELECT l.id, l.bred_on, l.due_on, COUNT(b.id) AS cubs
             FROM game_litters l LEFT JOIN game_breedings b ON b.litter_id = l.id
             WHERE l.dam_id = ? AND l.born_at IS NULL
             GROUP BY l.id, l.bred_on, l.due_on`,
            [damId],
        );
    }

    /**
     * Records one breeding attempt. If the pair breaks the rules (see Anthros::barrenReason) it's recorded with the
     * reason and no litter; otherwise it adds one cub to the dam's pending litter, starting a new litter if she has
     * none. The cubs will belong to the dam's owner (see deliver), whoever bred her. bredBy is null and groupId set
     * when a breeding group bred on its own.
     * Both parents are notified. Returns {litter: the dam's litter or null, barren: why there's no litter, or null}.
     */
    static attempt(sire: Row, dam: Row, bredBy: number | null, forced: boolean, groupId: number | null = null): BreedingOutcome {
        const db = Auth.db();
        db.beginTransaction();
        // Re-read the dam, so simultaneous attempts can't both start a litter or overfill one. (Upstream locks her
        // first with SELECT ... FOR UPDATE: nothing to do in SQLite.)
        dam = Anthros.findAny(dam.id)!;
        const barren = Anthros.barrenReason(sire, dam, forced);
        let litterId: number | null = null;
        if (barren === null) {
            const pending = Litters.pending(dam.id);
            if (pending) {
                litterId = pending.id;
            } else {
                const today = Clock.today();
                const due = gmdate('Y-m-d', strtotimeOrThrow(today + ' +' + Litters.GESTATION_DAYS + ' days'));
                db.run('INSERT INTO game_litters (dam_id, bred_on, due_on) VALUES (?, ?, ?)', [dam.id, today, due]);
                litterId = db.lastInsertId();
            }
        }
        db.run(
            `INSERT INTO game_breedings (sire_id, dam_id, litter_id, bred_by, forced, barren_reason, group_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [sire.id, dam.id, litterId, bredBy, int(forced), barren, groupId],
        );
        db.commit();
        const outcome: BreedingOutcome = { litter: barren === null ? Litters.pending(dam.id) : null, barren };
        Litters.tellParents(sire, dam, outcome, groupId);
        return outcome;
    }

    /**
     * Tells both anthros that were bred who with, and what came of it (by name only: never who bred them).
     */
    private static tellParents(sire: Row, dam: Row, outcome: BreedingOutcome, groupId: number | null): void {
        let how = '';
        if (groupId !== null) {
            const name = Auth.db().value('SELECT name FROM game_breeding_groups WHERE id = ?', [groupId]);
            how = ' on your own, as members of ' + (empty(name) ? 'your breeding group' : name);
        }
        // Repeated breedings with the same partner are squashed into one notification (with a count, and the latest
        // text) until it's read, so the text always says where the dam stands now: a try that adds nothing to a litter
        // she's already expecting (it's full, or didn't take) doesn't read as "no litter".
        const litter = outcome.litter ?? Litters.pending(dam.id);
        const none = `no litter will come of it (${outcome.barren}).`;
        let toSire: string;
        let toDam: string;
        if (outcome.litter) {
            toSire = `${dam.name} is expecting a litter of ${litter!.cubs}.`;
            toDam = `you're expecting a litter of ${litter!.cubs}, due ${litter!.due_on}.`;
        } else if (litter) {
            toSire = `no cub from this one (${outcome.barren}), but ${dam.name} is expecting a litter of ${litter.cubs}.`;
            toDam = `no cub from this one (${outcome.barren}), but you're expecting a litter of ${litter.cubs}, due ${litter.due_on}.`;
        } else {
            toSire = toDam = none;
        }
        Notifications.toAnthro(sire.id, `You were bred with ${dam.name}${how}: ${toSire}`, '/game/assets/' + sire.id, `bred-with:${dam.id}`);
        Notifications.toAnthro(dam.id, `You were bred with ${sire.name}${how}: ${toDam}`, '/game/assets/' + dam.id, `bred-with:${sire.id}`);
    }

    /**
     * Delivers every litter whose due date has come: one cub per breeding attempt, born on the due date, with a
     * gender chosen by birth weight, the species of its own sire or dam, a random name, and a random fertile date.
     * Cubs are young until they're grown (see Anthros::comeOfAge): they belong to their mother's owner (herself, if
     * she's free), sworn to them and living with them; a free mother farming a village lot gets VILLAGER_ACRES more of
     * it for each (see Baronies::villageLotOf).
     * Returns how many cubs were born.
     */
    static deliverDue(): number {
        const db = Auth.db();
        const due = db.all(
            'SELECT id, dam_id, due_on FROM game_litters WHERE born_at IS NULL AND due_on <= ' + Clock.sqlToday() + ' ORDER BY id',
        );
        let born = 0;
        for (const litter of due) {
            born += Litters.deliver(litter);
        }
        return born;
    }

    /**
     * Admin: the dam's litter is born now, as if it were due today. Returns an error message, or null.
     */
    static forceBirth(damId: number): string | null {
        const litter = Litters.pending(damId);
        if (!litter) {
            return 'She isn\'t expecting a litter.';
        }
        Auth.db().run('UPDATE game_litters SET due_on = ' + Clock.sqlToday() + ' WHERE id = ?', [litter.id]);
        return Litters.deliver({ id: litter.id, dam_id: damId, due_on: Clock.today() }) ? null : 'No cubs came of it.';
    }

    /**
     * Delivers one litter ({id, dam_id, due_on}): a cub for each attempt in it (see deliverDue). Returns how
     * many cubs were born (none if it was born already).
     */
    private static deliver(litter: Row): number {
        const db = Auth.db();
        let born = 0;
        db.beginTransaction();
        // Claim the litter first, so two requests can't deliver it twice.
        const claimed = db.run('UPDATE game_litters SET born_at = ' + Clock.sqlNow() + ' WHERE id = ? AND born_at IS NULL', [litter.id]);
        if (claimed === 0) {
            db.rollBack();
            return 0;
        }
        // Every cub is its mother's owner's: hers, when she's free (a free employee's cubs are her own).
        const attempts = db.all(
            `SELECT b.id, b.sire_id, b.dam_id, s.species_id AS sire_species, d.species_id AS dam_species,
                    d.owner_id AS dam_owner, d.player_id AS dam_player
             FROM game_breedings b
             LEFT JOIN game_anthros s ON s.id = b.sire_id
             LEFT JOIN game_anthros d ON d.id = b.dam_id
             WHERE b.litter_id = ? ORDER BY b.id`,
            [litter.id],
        );
        for (const attempt of attempts) {
            const species = [attempt.sire_species, attempt.dam_species].filter((s) => !empty(s));
            if (!species.length) {
                continue;
            }
            const genderId = Genders.randomBirthId();
            const name = Names.random(int(attempt.dam_id), Genders.find(genderId)!.presents_as);
            db.run(
                `INSERT INTO game_anthros
                    (owner_id, liege_id, young, name, gender_id, species_id, birthdate, fertile_on, sire_id, dam_id, breeding_id)
                 VALUES (?, ?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    attempt.dam_owner ?? attempt.dam_id, attempt.dam_owner ?? attempt.dam_id, name, genderId, species[random_int(0, species.length - 1)],
                    litter.due_on, Anthros.randomFertileOn(litter.due_on),
                    attempt.sire_id, attempt.dam_id, attempt.id,
                ],
            );
            const lot = Baronies.villageLotOf(int(attempt.dam_id));
            if (lot) {
                db.run('UPDATE game_parcels SET acres = acres + ? WHERE id = ?', [Baronies.VILLAGER_ACRES, lot.id]);
            }
            born++;
        }
        const cubs = int(db.value('SELECT COUNT(*) FROM game_anthros WHERE breeding_id IN (SELECT id FROM game_breedings WHERE litter_id = ?)', [litter.id]));
        const dam = db.row('SELECT id, name, owner_id, player_id FROM game_anthros WHERE id = ?', [litter.dam_id]);
        if (cubs && dam) {
            // Her owner hears of it (herself, when she's free).
            Notifications.toAnthro(dam.owner_id, `${dam.name} gave birth to a litter of ${cubs}.`, '/game/assets/' + litter.dam_id);
        }
        db.commit();
        return born;
    }
}
