// Upstream: game/src/Anthros.php
import { Auth } from '../core/Auth';
import type { Db, Row } from '../db/Db';
import {
    array_fill, array_unique, ctype_digit, float, gmdate, int, intdiv, mb_strlen, random_int, strtotime, strtotimeOrThrow,
    trim,
} from '../core/php';
import { Baronies } from './Baronies';
import { Clock } from './Clock';
import { Genders } from './Genders';
import { Goods } from './Goods';
import { Land } from './Land';
import { Litters } from './Litters';
import { Names } from './Names';
import { Notifications } from './Notifications';
import { Preferences } from './Preferences';
import { Ranks } from './Ranks';
import { Species } from './Species';
import { Urges } from './Urges';
import { Wallets } from './Wallets';

/** What breed() and selfBreed() return for the tries made (see breed()). */
export type BreedOutcome = { litter: Row | null; barren: string | null; attempts: number; took: number };

/** What groupBreed() returns: litters is a Map of dam id => litter (in the order first bred). */
export type GroupBreedResult = {
    pairs: Record<string, number>;
    litters: Map<number, Row>;
    barren: Record<string, number>;
    skipped: string[];
};

/**
 * Anthros and their breedings. Players see their own anthros; admins can see any.
 */
export class Anthros {
    static readonly MAX_NAME = 64;
    // How long anthros live, in weeks: each gets a random lifespan in this range when it's added (see Aging).
    static readonly LIFESPAN_MIN = 52;
    // How old anthros are when they become fertile, in days (see randomFertileOn).
    static readonly FERTILE_AGE_DAYS = [63, 84] as const;
    // A dam can conceive until a random day this many weeks after her birth (fertile_until); sires don't stop.
    static readonly FERTILE_UNTIL_WEEKS = [47, 52] as const;
    static readonly LIFESPAN_MAX = 80;
    // Anthros already older than their lifespan when aging began got up to this many more weeks.
    static readonly LIFESPAN_GRACE = 28;
    // A dam lives at least this many weeks past her fertile_until (her old age), so her lifespan starts later.
    static readonly OLD_AGE_WEEKS = 20;
    // New grown anthros (the game's supply, a new court) are this many weeks old: fertile, with most of life ahead.
    private static readonly ADULT_WEEKS = [12, 40] as const;
    // Why a breeding off the dam's fertile day of the week gave no litter (worded so it doesn't give the day away).
    static readonly DIDNT_TAKE = "it didn't take";

    // Each anthro with its gender, species, owner, and parents (who may belong to someone else). Anthros own and
    // employ anthros (owner_id, employer_id); a free anthro owns itself (owner_id = id), and one with no owner is
    // the game's, for sale. Players only play anthros (player_id). owner_name is NULL for a free anthro.
    // *_player_id columns say which user plays the owner, employer and so on, for access checks. player_id is for
    // that player and admins only: nothing shown to other players may reveal it.
    // (Queries on it order by a.name, not upstream's bare name: SQLite finds a bare name ambiguous across the joins.)
    private static readonly SELECT = `SELECT a.id, a.name, a.player_id, pl.username AS player_name,
                                   a.gender_id, ge.name AS gender, ge.is_male, ge.is_female, ge.presents_as,
                                   a.species_id, sp.name AS species, a.birthdate, a.fertile_on, a.fertile_until, a.fertile_weekday, a.max_cubs, a.urge_rise, a.standard_schedule_id, a.trade_occupation_id, a.seeking_occupation_id,
                                   a.lifespan_weeks, a.died_at, a.young, a.hungry_on,
                                   pg.bred_on AS pregnant_bred_on, pg.due_on AS pregnant_due_on, pg.cubs AS pregnant_cubs,
                                   au.id AS auction_id, au.ends_at AS auction_ends_at, a.debt_rate, a.debt_since,
                                   a.debt + a.debt_rate * FLOOR(TIMESTAMPDIFF('HOUR', a.debt_since, UTC_TIMESTAMP()) / 24) AS debt,
                                   a.owner_id, IF(a.owner_id = a.id, NULL, o.name) AS owner_name, o.player_id AS owner_player_id, a.created_at, a.breeding_id,
                                   a.title_rank, a.title_since, a.title_by_land, a.granted_rank, a.tax_rate, a.tax_balance, a.tax_overdue_since, a.liege_id, lg.name AS liege_name,
                                   a.spouse_of, hd.name AS spouse_of_name,
                                   IF(hd.owner_id = hd.id AND hd.died_at IS NULL, hd.title_rank, NULL) AS consort_rank,
                                   a.wage, a.employer_id, e.name AS employer_name, e.player_id AS employer_player_id,
                                   a.employed_wage, a.employed_since, a.paid_until,
                                   a.sire_id, s.name AS sire_name,
                                   s.owner_id AS sire_owner_id, IF(s.owner_id = s.id, NULL, so.name) AS sire_owner_name, so.player_id AS sire_owner_player_id,
                                   s.player_id AS sire_player_id,
                                   a.dam_id, d.name AS dam_name,
                                   d.owner_id AS dam_owner_id, IF(d.owner_id = d.id, NULL, do_.name) AS dam_owner_name, do_.player_id AS dam_owner_player_id,
                                   d.player_id AS dam_player_id
                            FROM game_anthros a
                            JOIN game_genders ge ON ge.id = a.gender_id
                            LEFT JOIN game_species sp ON sp.id = a.species_id
                            LEFT JOIN game_anthros o ON o.id = a.owner_id
                            LEFT JOIN users pl ON pl.id = a.player_id
                            LEFT JOIN game_anthros s ON s.id = a.sire_id
                            LEFT JOIN game_anthros so ON so.id = s.owner_id
                            LEFT JOIN game_anthros d ON d.id = a.dam_id
                            LEFT JOIN game_anthros do_ ON do_.id = d.owner_id
                            LEFT JOIN game_anthros lg ON lg.id = a.liege_id
                            LEFT JOIN game_anthros hd ON hd.id = a.spouse_of
                            LEFT JOIN game_anthros e ON e.id = a.employer_id
                            LEFT JOIN (
                                SELECT l.dam_id, l.bred_on, l.due_on, COUNT(b.id) AS cubs
                                FROM game_litters l LEFT JOIN game_breedings b ON b.litter_id = l.id
                                WHERE l.born_at IS NULL
                                GROUP BY l.id, l.dam_id, l.bred_on, l.due_on
                            ) pg ON pg.dam_id = a.id
                            LEFT JOIN game_auctions au ON au.anthro_id = a.id AND au.status = 'open'`;

    /**
     * What the user has: every anthro owned by the anthro they play (including itself, while it's free), their own
     * first. Empty if they don't play an anthro.
     */
    static forOwner(userId: number): Row[] {
        const me = Wallets.anthroFor(userId);
        if (me === null) {
            return [];
        }
        return Auth.db().all(
            Anthros.SELECT + ' WHERE a.owner_id = ? ORDER BY a.id <> ?, a.name, a.id',
            [me, me],
        ).map(Anthros.withFlags);
    }

    /**
     * Whether the user has the anthro: it's owned by the anthro they play (which, when free, owns itself).
     */
    static isOwner(user: Row, anthro: Row): boolean {
        return anthro.owner_player_id !== null && anthro.owner_player_id === user.id;
    }

    /**
     * Whether the anthro the user plays employs this one.
     */
    static isEmployer(user: Row, anthro: Row): boolean {
        return anthro.employer_player_id !== null && anthro.employer_player_id === user.id;
    }

    /**
     * Who the user can breed: everything they own. (Employees are hired to work: an employer can't breed them.)
     */
    static breedable(ownerId: number): Row[] {
        return Anthros.forOwner(ownerId);
    }

    /**
     * Whether the user decides the anthro's breeding: they have it (see isOwner).
     */
    static mayBreed(user: Row, anthro: Row): boolean {
        return Anthros.isOwner(user, anthro);
    }

    /**
     * Every anthro and player, for admin tools, ordered by owner (players first) then name.
     */
    static all(): Row[] {
        return Auth.db().all(Anthros.SELECT + ' ORDER BY o.name, a.player_id IS NULL, a.name, a.id').map(Anthros.withFlags);
    }

    /**
     * Anthros with no owner: the game's (supplied for auction), for admins to transfer.
     */
    static unowned(): Row[] {
        return Auth.db().all(Anthros.SELECT + ' WHERE a.owner_id IS NULL ORDER BY a.name, a.id').map(Anthros.withFlags);
    }

    /**
     * The player's own row (whoever owns it), or null until they set themselves up.
     */
    static player(userId: number): Row | null {
        const row = Auth.db().row(Anthros.SELECT + ' WHERE a.player_id = ?', [userId]);
        return row ? Anthros.withFlags(row) : null;
    }

    /**
     * Whether the game has no anthros at all (as after a reset): then the first player can start with a slave.
     */
    static gameIsEmpty(): boolean {
        return !Auth.db().value('SELECT 1 FROM game_anthros LIMIT 1');
    }

    /**
     * Gives the anthro the user just created, the game's first, a slave to breed with (see gameIsEmpty): its own
     * species, birthdate and fertile date, owned by and sworn to it, and a random name. kind is 'mate' (the other role:
     * one that carries for a sire, one that sires for a dam), 'sire' or 'dam'; a herm must choose 'sire' or 'dam', and
     * anyone else always gets the other role.
     * Returns [the slave, null] or [null, error message].
     */
    static createStarterSlave(owner: Row, kind: string): [Row | null, string | null] {
        const canSire = !!owner.is_male;
        const canCarry = !!owner.is_female;
        let role: string | null | false;
        if (!canSire && !canCarry) {
            role = null;
        } else if (canSire && canCarry) {
            role = ['sire', 'dam'].includes(kind) ? kind : false;
        } else {
            role = canSire ? 'dam' : 'sire';
        }
        if (role === null) {
            return [null, `As ${owner.gender}, ${owner.name} can't breed, so there's no slave to breed with.`];
        }
        if (role === false) {
            return [null, 'A herm has no opposite sex: choose a slave that sires or one that carries.'];
        }
        // The gender most often born that can only fill that role.
        const genderId = Auth.db().value(
            'SELECT id FROM game_genders WHERE ' + (role === 'sire' ? 'is_male AND NOT is_female' : 'is_female AND NOT is_male')
            + ' ORDER BY birth_weight DESC, sort_order LIMIT 1',
        );
        if (!genderId) {
            return [null, 'No gender can ' + (role === 'sire' ? 'sire' : 'carry') + " on its own, so there's no slave to give."];
        }
        const db = Auth.db();
        db.run(
            'INSERT INTO game_anthros (name, gender_id, species_id, birthdate, fertile_on, owner_id, liege_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                Names.random(owner.id, Genders.find(int(genderId))!.presents_as), genderId, owner.species_id,
                owner.birthdate, owner.fertile_on, owner.id, owner.id,
            ],
        );
        return [Anthros.findAny(db.lastInsertId()), null];
    }

    /**
     * Creates the anthro a new player plays as (name, gender, species, optional birthdate), free. With no birthdate
     * it's just grown: born FERTILE_AGE_DAYS ago and fertile from today.
     * For a player who already plays an anthro, only renames it, except that admins can change all of it.
     * Returns an error message, or null.
     */
    static setPlayer(user: Row, name: string, genderId: number, speciesId: number, birthdate: string): string | null {
        name = trim(name);
        let error = Anthros.validateName(name);
        if (error) {
            return error;
        }
        // Once a player plays an anthro, only its name can change; gender, species and birthdate are fixed.
        const player = Anthros.player(user.id);
        if (player && !Auth.isAdmin(user)) {
            return Anthros.rename(player, name, user.id);
        }
        if (!Genders.find(genderId)) {
            return 'Choose a gender.';
        }
        if (!Species.exists(speciesId)) {
            return 'Choose a species from the list.';
        }
        birthdate = trim(birthdate);
        if (birthdate !== '' && (error = Anthros.validateBirthdate(birthdate))) {
            return error;
        }
        let born: string | null = birthdate === '' ? null : birthdate;

        const db = Auth.db();
        if (player) {
            // An admin changing their own anthro. A new birthdate gets new fertile dates to match.
            if ((error = Anthros.rename(player, name, user.id))) {
                return error;
            }
            const same = born === player.birthdate;
            db.run('UPDATE game_anthros SET gender_id = ?, species_id = ?, birthdate = ?, fertile_on = ?, fertile_until = ? WHERE id = ?', [
                genderId, speciesId, born,
                same ? player.fertile_on : Anthros.randomFertileOn(born),
                same ? player.fertile_until : Anthros.randomFertileUntil(born), player.id,
            ]);
            Anthros.fitLifespan(player.id);
            return null;
        }
        // No birthdate given: just grown, born as long ago as anthros take to become fertile, and fertile from today.
        let fertileOn = Anthros.randomFertileOn(born);
        if (born === null) {
            fertileOn = gmdate('Y-m-d');
            born = gmdate('Y-m-d', strtotimeOrThrow('-' + random_int(Anthros.FERTILE_AGE_DAYS[0], Anthros.FERTILE_AGE_DAYS[1]) + ' days'));
        }
        db.run(
            'INSERT INTO game_anthros (gender_id, species_id, birthdate, fertile_on, player_id, name) VALUES (?, ?, ?, ?, ?, ?)',
            [genderId, speciesId, born, fertileOn, user.id, name],
        );
        Anthros.free(db.lastInsertId());
        return null;
    }

    /**
     * A new player (one who doesn't play an anthro yet) becomes an existing anthro that nobody plays and that isn't
     * up for auction, whoever owns it. Once chosen it can't be changed. Returns an error message, or null.
     */
    static become(user: Row, anthroId: number): string | null {
        if (Anthros.player(user.id)) {
            return "You already play an anthro, and that can't be changed.";
        }
        const db = Auth.db();
        db.beginTransaction();
        // (Upstream locks the row here with SELECT ... FOR UPDATE; the transaction is enough in SQLite.)
        const anthro = Anthros.findAny(anthroId);
        if (!anthro || anthro.player_id !== null || anthro.auction_id !== null || Anthros.isDead(anthro)
            || (!Auth.isAdmin(user) && Ranks.isNoble(Ranks.of(anthro)))) {
            db.rollBack();
            return "That anthro isn't available to become.";
        }
        db.run('UPDATE game_anthros SET player_id = ? WHERE id = ? AND player_id IS NULL', [user.id, anthroId]);
        db.commit();
        return null;
    }

    /**
     * The owner (or an admin) sets what the anthro owes to buy its freedom and how many coins it grows by each day.
     * An empty amount means no debt: the anthro can't buy its freedom. Returns an error message, or null.
     */
    static setDebt(anthro: Row, amount: string, rate: number): string | null {
        amount = trim(amount);
        if (amount !== '' && (!ctype_digit(amount) || int(amount) < 1)) {
            return 'The debt must be a whole number of coins (at least 1), or empty for no debt.';
        }
        if (rate < 0) {
            return "The daily increase can't be negative.";
        }
        const db = Auth.db();
        if (amount === '') {
            db.run('UPDATE game_anthros SET debt = NULL, debt_rate = 0, debt_since = NULL WHERE id = ?', [anthro.id]);
            Anthros.toAnthroIfPlayed(anthro, 'Your owner removed your debt; you can no longer buy your freedom.');
            return null;
        }
        db.run('UPDATE game_anthros SET debt = ?, debt_rate = ?, debt_since = UTC_TIMESTAMP() WHERE id = ?',
            [int(amount), rate, anthro.id]);
        Anthros.toAnthroIfPlayed(anthro, 'Your owner set your debt to ' + Wallets.format(int(amount))
            + (rate ? ', growing by ' + Wallets.format(rate) + ' a day' : '') + '. Pay it to buy your freedom.');
        return null;
    }

    /**
     * The player pays the current debt of the anthro they play, from its wallet, to the anthro that owns it, and it
     * becomes free. Returns an error message, or null.
     */
    static buyFreedom(user: Row): string | null {
        const db = Auth.db();
        db.beginTransaction();
        let anthro = Anthros.player(user.id);
        if (anthro) {
            // (Upstream locks the row first with SELECT ... FOR UPDATE; the transaction is enough in SQLite.)
            anthro = Anthros.findAny(anthro.id);
        }
        let error: string | null = null;
        if (!anthro) {
            error = "You don't play an anthro.";
        } else if (Anthros.isFree(anthro)) {
            error = 'You already own yourself.';
        } else if (anthro.debt === null) {
            error = "Your owner hasn't set a debt, so you can't buy your freedom.";
        } else if (anthro.auction_id !== null) {
            error = "You can't buy your freedom while you're up for auction.";
        }
        if (error || !anthro) {
            db.rollBack();
            return error;
        }
        const price = int(anthro.debt);
        const ownerId = int(anthro.owner_id);
        if (!Wallets.change(anthro.id, -price, 'Bought freedom from ' + anthro.owner_name, null, user.id)) {
            db.rollBack();
            return 'You need ' + Wallets.format(price) + ' but have ' + Wallets.format(Wallets.balance(anthro.id)) + '.';
        }
        Wallets.change(ownerId, price, `${anthro.name} bought their freedom`);
        db.run('UPDATE game_anthros SET owner_id = id, debt = NULL, debt_rate = 0, debt_since = NULL WHERE id = ?',
            [anthro.id]);
        db.run(
            'INSERT INTO game_transfers (anthro_id, from_owner_id, to_owner_id, transferred_by, note) VALUES (?, ?, ?, ?, ?)',
            [anthro.id, ownerId, anthro.id, user.id, 'Bought its freedom for ' + Wallets.format(price)],
        );
        db.commit();
        Notifications.toAnthro(ownerId, `${anthro.name} paid their debt of ` + Wallets.format(price) + ' and is now free.',
            '/game/wallet');
        Notifications.toAnthro(anthro.id, 'You paid ' + Wallets.format(price) + ' and now own yourself.', '/game/home');
        return null;
    }

    private static toAnthroIfPlayed(anthro: Row, body: string): void {
        if (anthro.player_id !== null) {
            Notifications.toAnthro(anthro.id, body, '/game/home');
        }
    }

    /**
     * Anthros a new player could become: nobody plays them and they aren't up for auction. Only admins can become a
     * noble (see Ranks::isNoble).
     */
    static available(nobles = false, q = '', limit: number | null = null): Row[] {
        const [where, params] = Anthros.availableWhere(nobles, q);
        return Auth.db().all(
            Anthros.SELECT + ` WHERE ${where} ORDER BY a.name, a.id` + (limit === null ? '' : ' LIMIT ' + Math.max(1, limit)),
            params,
        ).map(Anthros.withFlags);
    }

    /**
     * How many anthros available() would list without a limit.
     */
    static countAvailable(nobles = false, q = ''): number {
        const [where, params] = Anthros.availableWhere(nobles, q);
        return int(Auth.db().value(`SELECT COUNT(*) FROM game_anthros a
            LEFT JOIN game_auctions au ON au.anthro_id = a.id AND au.status = 'open' WHERE ${where}`, params));
    }

    /**
     * Available anthros that are nobles (only admins can become them), by name.
     */
    static availableNobles(): Row[] {
        const nobles = Anthros.nobleRanks();
        if (!nobles.length) {
            return [];
        }
        const [where, params] = Anthros.availableWhere(true, '');
        return Auth.db().all(Anthros.SELECT + ` WHERE ${where} AND ` + Anthros.freeSql('a') + ' AND a.title_rank IN ('
            + nobles.map(int).join(', ') + ') ORDER BY a.name, a.id', params).map(Anthros.withFlags);
    }

    /**
     * [SQL condition, parameters] for available(): unplayed, alive, not up for auction, no noble unless nobles, and
     * a name starting with q.
     */
    private static availableWhere(nobles: boolean, q: string): [string, unknown[]] {
        let where = 'a.player_id IS NULL AND au.id IS NULL AND a.died_at IS NULL';
        const nobleRanks = Anthros.nobleRanks();
        if (!nobles && nobleRanks.length) {
            where += ' AND NOT (' + Anthros.freeSql('a') + ' AND COALESCE(a.title_rank, 0) IN (' + nobleRanks.map(int).join(', ') + '))';
        }
        const [nameWhere, params] = Anthros.nameStartsWith(q);
        return [where + nameWhere, params];
    }

    /**
     * The noble ranks, in Ranks::all()'s order (upstream: array_keys(array_filter(Ranks::all(), fn ($r) => $r['is_noble']))).
     */
    private static nobleRanks(): number[] {
        return [...Ranks.all()].filter(([, r]) => r.is_noble).map(([rank]) => rank);
    }

    /**
     * [" AND a.name LIKE ...", parameters] for names starting with q, or ['', []] for no filter.
     */
    static nameStartsWith(q: string, alias = 'a'): [string, unknown[]] {
        q = trim(q);
        return q === '' ? ['', []] : [` AND ${alias}.name LIKE ? ESCAPE '!'`, [likeEscape(q) + '%']];
    }

    /**
     * A random date 9-12 weeks after the birthdate, when an anthro becomes fertile (null for an unknown birthdate).
     */
    static randomFertileOn(birthdate: string | null): string | null {
        return birthdate === null ? null : gmdate('Y-m-d', strtotimeOrThrow(birthdate + ' +' + random_int(Anthros.FERTILE_AGE_DAYS[0], Anthros.FERTILE_AGE_DAYS[1]) + ' days'));
    }

    /**
     * Age in whole weeks since birth (UTC), or null for an unknown birthdate.
     */
    static ageWeeks(birthdate: string | null, asOf: string | null = null): number | null {
        if (birthdate === null) {
            return null;
        }
        asOf = asOf === null ? gmdate('Y-m-d') : asOf.slice(0, 10);
        const days = Math.floor((int(strtotime(asOf + ' UTC')) - int(strtotime(birthdate + ' UTC'))) / 86400);
        return intdiv(Math.max(0, days), 7);
    }

    /**
     * A birthdate for a new grown anthro: ADULT_WEEKS old, so it's fertile (see randomFertileOn) and has most of its
     * life ahead.
     */
    static randomAdultBirthdate(): string {
        return gmdate('Y-m-d', strtotimeOrThrow('-' + random_int(Anthros.ADULT_WEEKS[0] * 7, Anthros.ADULT_WEEKS[1] * 7) + ' days'));
    }

    /**
     * The day the anthro dies of old age (its birthdate plus its lifespan), or null if its birthdate is unknown
     * (then it doesn't age).
     */
    static diesOn(anthro: Row): string | null {
        if (anthro.birthdate === null || anthro.lifespan_weeks === null) {
            return null;
        }
        return gmdate('Y-m-d', strtotimeOrThrow(anthro.birthdate + ' UTC +' + (int(anthro.lifespan_weeks) * 7) + ' days'));
    }

    /**
     * Whether the anthro is young: born in the game and not grown yet (see comeOfAge). Young anthros belong to their
     * mother's owner (herself, if she's free).
     */
    static isYoung(anthro: Row): boolean {
        return !!(anthro.young ?? false) && !Anthros.isDead(anthro);
    }

    /**
     * Young anthros that have reached their fertile date come of age and go free, whoever owns them. One whose mother
     * is a free commoner is sworn to her liege (so it stays where it grew up) and, if it was raised on her village
     * lot, takes its VILLAGER_ACRES of it as its own lot. The game runs this on each request. Returns how many came
     * of age.
     */
    static comeOfAge(): number {
        const db = Auth.db();
        const grown: number[] = db.column(
            'SELECT id FROM game_anthros WHERE young AND died_at IS NULL AND (fertile_on IS NULL OR fertile_on <= UTC_DATE()) ORDER BY id',
        );
        for (const id of grown) {
            db.beginTransaction();
            const anthro = Anthros.findAny(int(id))!;
            const mother = anthro.dam_id === null ? null : Anthros.findAny(int(anthro.dam_id));
            const raisedByHer = !!mother && Anthros.isFree(mother) && anthro.owner_id === mother.id;
            const lot = raisedByHer ? Baronies.villageLotOf(mother!.id) : null;
            db.run('UPDATE game_anthros SET young = FALSE, owner_id = id, liege_id = ?, debt = NULL, debt_rate = 0, debt_since = NULL WHERE id = ?',
                [raisedByHer && mother!.title_rank === null ? mother!.liege_id : null, id]);
            if (lot && float(lot.acres) > Baronies.VILLAGER_ACRES) {
                Land.splitOff(lot, Baronies.VILLAGER_ACRES * 100, int(id));
            }
            db.commit();
            Notifications.toAnthro(anthro.owner_id, `${anthro.name} has grown up and is free now.`, '/game/assets/' + id);
        }
        return grown.length;
    }

    /**
     * The shortest lifespan, in weeks, the anthro may have: a dam lives OLD_AGE_WEEKS past her fertile_until.
     */
    static shortestLifespan(anthro: Row): number {
        if (!anthro.is_female || anthro.birthdate === null || anthro.fertile_until === null) {
            return 1;
        }
        const days = (strtotimeOrThrow(anthro.fertile_until + ' UTC') - strtotimeOrThrow(anthro.birthdate + ' UTC')) / 86400;
        return int(Math.ceil((days + Anthros.OLD_AGE_WEEKS * 7) / 7));
    }

    /**
     * Admin: an anthro's life, in order: birthdate, fertile from, fertile until (dams), and the day it dies (a whole
     * number of weeks after birth: its lifespan), plus a dam's conceiving weekday and max cubs. Every field is
     * checked before anything is saved: birth <= fertile from <= fertile until (FERTILE_UNTIL_WEEKS after birth) and
     * fertile until at least OLD_AGE_WEEKS before death. An empty birthdate means unknown: no fertile until or death
     * (it doesn't age). fields: birthdate, fertile_on, fertile_until, dies_on, fertile_weekday, max_cubs, urge_rise
     * (fertile_until and the last three only for dams). Returns an error message, or null.
     */
    static setLife(anthro: Row, fields: Row): string | null {
        if (Anthros.isDead(anthro)) {
            return `${anthro.name} has already died.`;
        }
        const dates: Record<string, string | null> = {};
        const labels: [string, string][] = [['birthdate', 'Born'], ['fertile_on', 'Fertile from'], ['fertile_until', 'Fertile until'], ['dies_on', 'Dies on']];
        for (const [key, label] of labels) {
            const value = trim(String(fields[key] ?? ''));
            if (value !== '') {
                if (!isValidDate(value)) {
                    return `${label}: enter a valid date.`;
                }
            }
            dates[key] = value === '' ? null : value;
        }
        const { birthdate: born, fertile_on: from, dies_on: dies } = dates;
        let until = dates.fertile_until;
        const isDam = !!anthro.is_female;
        const weeks = (date: string) => ((strtotimeOrThrow(date + ' UTC') - strtotimeOrThrow(born + ' UTC')) / 86400) / 7;
        let lifespan: number | null = anthro.lifespan_weeks;
        if (born === null) {
            if (until !== null || dies !== null) {
                return "With no birthdate, leave Fertile until and Dies on empty: the anthro doesn't age.";
            }
            until = null;
        } else {
            if (born > gmdate('Y-m-d')) {
                return 'Born: the birthdate cannot be in the future.';
            }
            if (from !== null && from < born) {
                return 'Fertile from must be on or after the birthdate.';
            }
            if (isDam) {
                const [fromWeeks, toWeeks] = Anthros.FERTILE_UNTIL_WEEKS;
                if (until === null || weeks(until) < fromWeeks || weeks(until) > toWeeks) {
                    return `Fertile until must be ${fromWeeks} to ${toWeeks} weeks after birth.`;
                }
                if (from !== null && until < from) {
                    return 'Fertile until must be on or after Fertile from.';
                }
            } else {
                // Not held to it (only dams are), but kept in step with the birthdate in case its gender changes.
                until = born === anthro.birthdate && anthro.fertile_until !== null ? anthro.fertile_until : Anthros.randomFertileUntil(born);
            }
            if (dies === null) {
                return 'Choose the day it dies.';
            }
            lifespan = weeks(dies);
            if (lifespan < 1 || lifespan > 1000 || Math.floor(lifespan) !== lifespan) {
                return 'Dies on must be a whole number of weeks after birth (1 to 1000): the same weekday it was born on.';
            }
            lifespan = int(lifespan);
            if (isDam && lifespan < weeks(until!) + Anthros.OLD_AGE_WEEKS) {
                return 'Dies on must be at least ' + Anthros.OLD_AGE_WEEKS + ' weeks after Fertile until (on or after '
                    + gmdate('Y-m-d', strtotimeOrThrow(until + ' UTC +' + (Anthros.OLD_AGE_WEEKS * 7) + ' days')) + ').';
            }
        }
        const weekday = isDam ? int(fields.fertile_weekday ?? anthro.fertile_weekday) : anthro.fertile_weekday;
        const maxCubs = isDam ? int(fields.max_cubs ?? Anthros.maxCubs(anthro)) : anthro.max_cubs;
        const rise = isDam ? int(fields.urge_rise ?? anthro.urge_rise ?? Urges.randomRise()) : anthro.urge_rise;
        if (isDam && (weekday < 1 || weekday > 7)) {
            return 'Choose a day of the week.';
        }
        if (isDam && (maxCubs < Litters.MIN_CUBS || maxCubs > Litters.MAX_CUBS)) {
            return 'A litter holds ' + Litters.MIN_CUBS + ' to ' + Litters.MAX_CUBS + ' cubs.';
        }
        if (isDam && (rise < Urges.MIN_RISE || rise > Urges.MAX_RISE)) {
            return 'Her urge rises ' + Urges.MIN_RISE + ' to ' + Urges.MAX_RISE + '% a day.';
        }
        Auth.db().run(
            `UPDATE game_anthros SET birthdate = ?, fertile_on = ?, fertile_until = ?, lifespan_weeks = ?, fertile_weekday = ?, max_cubs = ?,
                                     urge_rise = ?
             WHERE id = ?`,
            [born, from, until, lifespan, weekday, maxCubs, rise, anthro.id],
        );
        return null;
    }

    /**
     * Makes sure a dam lives at least OLD_AGE_WEEKS past her fertile_until (after her birthdate or gender changes),
     * moving her death later if not.
     */
    static fitLifespan(id: number): void {
        const anthro = Anthros.findAny(id);
        let shortest: number;
        if (anthro && int(anthro.lifespan_weeks) < (shortest = Anthros.shortestLifespan(anthro))) {
            Auth.db().run('UPDATE game_anthros SET lifespan_weeks = ? WHERE id = ?',
                [random_int(shortest, Math.max(shortest, Anthros.LIFESPAN_MAX)), id]);
        }
    }

    /**
     * Admin: how many weeks the anthro lives. Returns an error message, or null.
     */
    static setLifespan(anthro: Row, weeks: number): string | null {
        if (Anthros.isDead(anthro)) {
            return `${anthro.name} has already died.`;
        }
        if (weeks < 1 || weeks > 1000) {
            return 'Choose a lifespan of 1 to 1000 weeks.';
        }
        if (weeks < Anthros.shortestLifespan(anthro)) {
            return `As a dam, ${anthro.name} must live at least ` + Anthros.OLD_AGE_WEEKS + ' weeks past her fertile until: '
                + Anthros.shortestLifespan(anthro) + ' weeks or more.';
        }
        Auth.db().run('UPDATE game_anthros SET lifespan_weeks = ? WHERE id = ?', [weeks, anthro.id]);
        return null;
    }

    /**
     * Age for display, today or as of a date (the day it died): "58 weeks", "1 week", or "unknown".
     */
    static age(birthdate: string | null, asOf: string | null = null): string {
        const weeks = Anthros.ageWeeks(birthdate, asOf);
        return weeks === null ? 'unknown' : weeks + ' ' + (weeks === 1 ? 'week' : 'weeks');
    }

    /**
     * Whether the anthro can breed today (no fertile date means no restriction).
     */
    static isFertile(anthro: Row): boolean {
        return anthro.fertile_on === null || anthro.fertile_on <= gmdate('Y-m-d');
    }

    /**
     * The most cubs the anthro's litters can hold (Litters::MAX_CUBS if it has no limit of its own).
     */
    static maxCubs(anthro: Row): number {
        return int(anthro.max_cubs ?? Litters.MAX_CUBS);
    }

    /**
     * Admin: the most cubs the dam's litters can hold. Returns an error message, or null.
     */
    static setMaxCubs(anthro: Row, cubs: number): string | null {
        if (cubs < Litters.MIN_CUBS || cubs > Litters.MAX_CUBS) {
            return 'A litter holds ' + Litters.MIN_CUBS + ' to ' + Litters.MAX_CUBS + ' cubs.';
        }
        Auth.db().run('UPDATE game_anthros SET max_cubs = ? WHERE id = ?', [cubs, anthro.id]);
        return null;
    }

    /**
     * A random last day a dam can conceive: FERTILE_UNTIL_WEEKS after her birth (null for an unknown birthdate).
     */
    static randomFertileUntil(birthdate: string | null): string | null {
        const [from, to] = Anthros.FERTILE_UNTIL_WEEKS;
        return birthdate === null ? null
            : gmdate('Y-m-d', strtotimeOrThrow(birthdate + ' UTC +' + random_int(from * 7, to * 7) + ' days'));
    }

    /**
     * Whether the anthro is past the age a dam can conceive (its fertile_until has gone by). Sires aren't held to it.
     */
    static pastBearing(anthro: Row): boolean {
        return (anthro.fertile_until ?? null) !== null && anthro.fertile_until < gmdate('Y-m-d');
    }

    /**
     * Fertility for lists: "yes", "from <date>" (not yet), or for a dam past bearing "no longer" (or "sires only" if
     * it can also sire).
     */
    static fertility(anthro: Row): string {
        if (!Anthros.isFertile(anthro)) {
            return 'from ' + anthro.fertile_on;
        }
        if (anthro.is_female && Anthros.pastBearing(anthro)) {
            return anthro.is_male ? 'sires only' : 'no longer';
        }
        return 'yes';
    }

    /**
     * Why breeding the anthro today in this role ('sire' or 'dam') would produce no litter (or, for 'up for auction',
     * isn't allowed), for breeding lists; null if it's fine. Forced (admin) breeding ignores fertility, auctions and
     * which day a pregnancy started. Breeding itself re-checks (see barrenReason()).
     */
    static breedingBlocker(anthro: Row, role: string, forced = false): string | null {
        if (Anthros.isDead(anthro)) {
            return 'died';
        }
        if (!forced && Goods.isHungry(anthro)) {
            return 'too hungry';
        }
        if (role === 'sire' && !anthro.is_male) {
            return `can't sire (${anthro.gender})`;
        }
        if (role === 'dam' && !anthro.is_female) {
            return `can't be a dam (${anthro.gender})`;
        }
        if (!forced && !Anthros.isFertile(anthro)) {
            return `not fertile until ${anthro.fertile_on}`;
        }
        if (!forced && role === 'dam' && Anthros.pastBearing(anthro)) {
            return 'too old to carry';
        }
        if (!forced && anthro.auction_id !== null) {
            return 'up for auction';
        }
        if (role === 'dam' && anthro.pregnant_due_on !== null) {
            if (anthro.pregnant_cubs >= Anthros.maxCubs(anthro)) {
                return 'litter full';
            }
            if (!forced && anthro.pregnant_bred_on !== gmdate('Y-m-d')) {
                return `pregnant, due ${anthro.pregnant_due_on}`;
            }
        }
        return null;
    }

    /**
     * Admin change to when an anthro becomes fertile; empty means no restriction. Returns an error message, or null.
     */
    static setFertileOn(anthro: Row, date: string): string | null {
        date = trim(date);
        if (date !== '') {
            if (!isValidDate(date)) {
                return 'Enter a valid date.';
            }
        }
        Auth.db().run('UPDATE game_anthros SET fertile_on = ? WHERE id = ?', [date === '' ? null : date, anthro.id]);
        return null;
    }

    /**
     * Admin change to the last day a dam can conceive: always FERTILE_UNTIL_WEEKS after her birth (empty only when
     * her birthdate is unknown). Returns an error message, or null.
     */
    static setFertileUntil(anthro: Row, date: string): string | null {
        date = trim(date);
        if (anthro.birthdate === null) {
            if (date !== '') {
                return `${anthro.name} has no birthdate, so can't have a last fertile day.`;
            }
            return null;
        }
        const [from, to] = Anthros.FERTILE_UNTIL_WEEKS;
        const earliest = gmdate('Y-m-d', strtotimeOrThrow(anthro.birthdate + ' UTC +' + (from * 7) + ' days'));
        const latest = gmdate('Y-m-d', strtotimeOrThrow(anthro.birthdate + ' UTC +' + (to * 7) + ' days'));
        if (!isValidDate(date) || date < earliest || date > latest) {
            return `Fertile until must be ${from} to ${to} weeks after birth: ${earliest} to ${latest}.`;
        }
        let diesOn: string | null;
        if (anthro.is_female && (diesOn = Anthros.diesOn(anthro))
            && date > gmdate('Y-m-d', strtotimeOrThrow(diesOn + ' UTC -' + (Anthros.OLD_AGE_WEEKS * 7) + ' days'))) {
            return 'Fertile until must be at least ' + Anthros.OLD_AGE_WEEKS + ` weeks before ${anthro.name} dies (${diesOn}).`;
        }
        Auth.db().run('UPDATE game_anthros SET fertile_until = ? WHERE id = ?', [date, anthro.id]);
        return null;
    }

    /**
     * Gives an anthro to another anthro to own. The caller checks that the actor has it or is an admin.
     * A free anthro given away loses its freedom (see Land::forfeit). Returns an error message, or null.
     */
    static transfer(anthro: Row, toAnthroId: number, actorId: number): string | null {
        const recipient = Anthros.findAny(toAnthroId);
        if (!recipient) {
            return 'Choose an anthro to transfer to.';
        }
        if (recipient.id === anthro.id) {
            return 'Choose another anthro; an anthro that owns itself is free.';
        }
        if (Anthros.isDead(recipient) || Anthros.isDead(anthro)) {
            return "The dead can't own or be owned.";
        }
        if (recipient.id === anthro.owner_id) {
            return `${recipient.name} already owns ${anthro.name}.`;
        }
        if (anthro.auction_id !== null) {
            return `${anthro.name} is up for auction.`;
        }
        const db = Auth.db();
        db.beginTransaction();
        // Any debt was owed to the previous owner; a free anthro loses its title, land and anthros to the new owner.
        db.run('UPDATE game_anthros SET owner_id = ?, debt = NULL, debt_rate = 0, debt_since = NULL WHERE id = ?',
            [recipient.id, anthro.id]);
        Land.forfeit(anthro, recipient.id);
        db.run(
            'INSERT INTO game_transfers (anthro_id, from_owner_id, to_owner_id, transferred_by) VALUES (?, ?, ?, ?)',
            [anthro.id, anthro.owner_id, recipient.id, actorId],
        );
        db.commit();
        const from = anthro.owner_name ?? (anthro.player_id === actorId ? anthro.name : 'An admin');
        Notifications.toAnthro(recipient.id, `${from} gave ${anthro.name} to you.`, '/game/assets/' + anthro.id);
        if (anthro.player_id !== null) {
            Notifications.toAnthro(anthro.id, `You now belong to ${recipient.name}.`, '/game/assets/' + anthro.id);
        }
        return null;
    }

    /**
     * An anthro's changes of owner, oldest first.
     */
    static transfers(id: number): Row[] {
        // MariaDB's null-safe <=> is SQLite's IS.
        return Auth.db().all(
            `SELECT t.transferred_at, t.note, t.anthro_id, t.from_owner_id, t.to_owner_id, f.name AS from_name, o.name AS to_name,
                    b.username AS by_name, t.transferred_by IS f.player_id AS by_owner
             FROM game_transfers t
             JOIN game_anthros a ON a.id = t.anthro_id
             LEFT JOIN game_anthros f ON f.id = t.from_owner_id
             LEFT JOIN game_anthros o ON o.id = t.to_owner_id
             LEFT JOIN users b ON b.id = t.transferred_by
             WHERE t.anthro_id = ?
             ORDER BY t.transferred_at, t.id`,
            [id],
        );
    }

    /**
     * Every anthro, by name, for choosing one to give an anthro (or offspring) to. Unplayed anthros are listed too,
     * so the list doesn't reveal which are played.
     */
    static recipients(): Row[] {
        return Notifications.recipients();
    }

    /**
     * Living anthros whose name starts with q (or, for "#123", that id), by name, as "Name (#id)" labels for name
     * fields: [{ id, label }, ...]. Played ones are included, so the list doesn't reveal which are played.
     */
    static search(q: string, limit = 20): { id: number; label: string }[] {
        q = trim(q);
        if (q === '') {
            return [];
        }
        let rows: Row[];
        const match = q.match(/^#?(\d+)\)?$/);
        if (match) {
            rows = Auth.db().all('SELECT id, name FROM game_anthros WHERE died_at IS NULL AND id = ?', [int(match[1])]);
        } else {
            // "Name (#12" typed or picked: search by the name part.
            const name = q.replace(/\s*\(#?\d*\)?\s*$/, '');
            rows = Auth.db().all(
                "SELECT id, name FROM game_anthros WHERE died_at IS NULL AND name LIKE ? ESCAPE '!' ORDER BY name, id LIMIT " + Math.max(1, limit),
                [likeEscape(name) + '%'],
            );
        }
        return rows.map((row) => ({ id: int(row.id), label: `${row.name} (#${row.id})` }));
    }

    /**
     * One of the user's anthros (see forOwner).
     */
    static find(userId: number, id: number): Row | null {
        const me = Wallets.anthroFor(userId);
        const row = Auth.db().row(Anthros.SELECT + ' WHERE a.owner_id = ? AND a.id = ?', [me, id]);
        return row ? Anthros.withFlags(row) : null;
    }

    /**
     * Any anthro regardless of owner. Only for admins, or after checking canView().
     */
    static findAny(id: number): Row | null {
        const row = Auth.db().row(Anthros.SELECT + ' WHERE a.id = ?', [id]);
        return row ? Anthros.withFlags(row) : null;
    }

    /**
     * Whether the user may open an anthro's page: they play it, or the anthro that owns or employs it, or they're an
     * admin. Takes user ids: who plays the owner, the anthro itself, and the employer.
     */
    static canView(user: Row, ownerPlayerId: number | null, playerId: number | null = null, employerPlayerId: number | null = null): boolean {
        return (ownerPlayerId !== null && ownerPlayerId === user.id) || (playerId !== null && playerId === user.id)
            || (employerPlayerId !== null && employerPlayerId === user.id) || Auth.isAdmin(user);
    }

    /**
     * canView() for an anthro row.
     */
    static canSee(user: Row, anthro: Row): boolean {
        return Anthros.canView(user, anthro.owner_player_id, anthro.player_id, anthro.employer_player_id);
    }

    /**
     * Whether the anthro is free: it owns itself. Anything else (owned by another anthro, or the game's) is a slave.
     */
    static isFree(anthro: Row | null): boolean {
        return anthro !== null && anthro.owner_id !== null && anthro.owner_id === anthro.id && !Anthros.isDead(anthro);
    }

    /**
     * Whether the anthro has died (see Aging). The dead own themselves but aren't free: they hold nothing.
     */
    static isDead(anthro: Row | null): boolean {
        return (anthro?.died_at ?? null) !== null;
    }

    /**
     * Frees every anthro with no owner that the game isn't auctioning (so it owns itself): ones from before free
     * anthros owned themselves, from a restored save, or whose owner was deleted. db: the connection to use.
     */
    static freeUnowned(db: Db | null = null): number {
        // SQLite: no alias on the target's columns in SET.
        return (db ?? Auth.db()).run(
            `UPDATE game_anthros AS a SET owner_id = a.id
             WHERE a.owner_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM game_auctions au WHERE au.anthro_id = a.id AND au.status = 'open')`,
        );
    }

    /**
     * Makes the anthro free: it owns itself.
     */
    static free(id: number): void {
        Auth.db().run('UPDATE game_anthros SET owner_id = id WHERE id = ?', [id]);
    }

    /**
     * isFree() in SQL, for the game_anthros alias given.
     */
    static freeSql(alias: string): string {
        return `(${alias}.owner_id = ${alias}.id AND ${alias}.died_at IS NULL)`;
    }

    /**
     * The anthros employed by the anthro the user plays, by name.
     */
    static employedBy(userId: number): Row[] {
        return Auth.db().all(Anthros.SELECT + ' WHERE a.employer_id = ? ORDER BY a.name, a.id', [Wallets.anthroFor(userId)])
            .map(Anthros.withFlags);
    }

    /**
     * Free anthros looking for work (an asking wage, no employer, not up for auction), cheapest first.
     */
    static forHire(q = '', limit: number | null = null): Row[] {
        const [nameWhere, params] = Anthros.nameStartsWith(q);
        return Auth.db().all(
            Anthros.SELECT + ' WHERE a.wage IS NOT NULL AND a.employer_id IS NULL AND au.id IS NULL AND ' + Anthros.freeSql('a') + nameWhere
            + ' ORDER BY a.wage, a.name, a.id' + (limit === null ? '' : ' LIMIT ' + Math.max(1, limit)),
            params,
        ).map(Anthros.withFlags);
    }

    /**
     * How many anthros forHire() would list without a limit.
     */
    static countForHire(q = ''): number {
        const [nameWhere, params] = Anthros.nameStartsWith(q);
        return int(Auth.db().value(
            `SELECT COUNT(*) FROM game_anthros a LEFT JOIN game_auctions au ON au.anthro_id = a.id AND au.status = 'open'
             WHERE a.wage IS NOT NULL AND a.employer_id IS NULL AND au.id IS NULL AND ` + Anthros.freeSql('a') + nameWhere,
            params,
        ));
    }

    /**
     * One of the anthros the user can breed: one they have (see forOwner).
     */
    static findControlled(userId: number, id: number): Row | null {
        const me = Wallets.anthroFor(userId);
        const row = Auth.db().row(Anthros.SELECT + ' WHERE a.owner_id = ? AND a.id = ?', [me, id]);
        return row ? Anthros.withFlags(row) : null;
    }

    /**
     * Anthros that can sire (is_male genders).
     */
    static sires(anthros: Row[]): Row[] {
        return anthros.filter((anthro) => anthro.is_male);
    }

    /**
     * Anthros that can be dams (is_female genders).
     */
    static dams(anthros: Row[]): Row[] {
        return anthros.filter((anthro) => anthro.is_female);
    }

    /**
     * Whether the user has another anthro to breed this one with (whether a litter would come of it or not).
     */
    static canBreed(ownerId: number, anthro: Row): boolean {
        return Anthros.breedable(ownerId).filter((other) => other.id !== anthro.id).length > 0;
    }

    /**
     * An anthro's breeding attempts, oldest first: when, whether forced, the partner, the litter the attempt
     * belongs to (bred/due/born dates and how many cubs), and the cub it produced once born.
     */
    static history(id: number): Row[] {
        const db = Auth.db();
        const breedings = db.all(
            `SELECT b.id, b.bred_at, b.forced, b.barren_reason, bu.username AS bred_by_name, bg.name AS group_name,
                    b.group_id,
                    p.id AS partner_id, p.name AS partner_name,
                    p.owner_id AS partner_owner_id, po.player_id AS partner_owner_player_id, p.player_id AS partner_player_id,
                    po.name AS partner_owner_name, IF(b.sire_id = ?, 'dam', 'sire') AS partner_role,
                    b.litter_id, l.due_on, l.born_at,
                    (SELECT COUNT(*) FROM game_breedings lb WHERE lb.litter_id = b.litter_id) AS litter_size
             FROM game_breedings b
             LEFT JOIN game_litters l ON l.id = b.litter_id
             LEFT JOIN users bu ON bu.id = b.bred_by
             LEFT JOIN game_breeding_groups bg ON bg.id = b.group_id
             LEFT JOIN game_anthros p ON p.id = IF(b.sire_id = ?, b.dam_id, b.sire_id)
             LEFT JOIN game_anthros po ON po.id = p.owner_id
             WHERE b.sire_id = ? OR b.dam_id = ?
             ORDER BY b.bred_at, b.id`,
            [id, id, id, id],
        );
        if (!breedings.length) {
            return [];
        }

        const ids = breedings.map((b) => b.id);
        const offspring = db.all(
            `SELECT a.id, a.name, ge.name AS gender, ge.presents_as, sp.name AS species,
                    a.owner_id, IF(a.owner_id = a.id, NULL, o.name) AS owner_name, o.player_id AS owner_player_id, a.player_id, a.breeding_id
             FROM game_anthros a
             JOIN game_genders ge ON ge.id = a.gender_id
             JOIN game_species sp ON sp.id = a.species_id
             LEFT JOIN game_anthros o ON o.id = a.owner_id
             WHERE a.breeding_id IN (` + array_fill(ids.length, '?').join(', ') + `)
             ORDER BY a.id`,
            ids,
        );
        const byBreeding = new Map<number, Row[]>();
        for (const child of offspring) {
            if (!byBreeding.has(child.breeding_id)) {
                byBreeding.set(child.breeding_id, []);
            }
            byBreeding.get(child.breeding_id)!.push(child);
        }
        for (const breeding of breedings) {
            breeding.offspring = byBreeding.get(breeding.id) ?? [];
        }
        return breedings;
    }

    /**
     * A random fertile anthro of the species for the game to sell (the game's: no owner): random gender and name,
     * grown (see randomAdultBirthdate).
     */
    static createRandom(speciesId: number): Row {
        const genderId = Genders.randomBirthId();
        const birthdate = Anthros.randomAdultBirthdate();
        const db = Auth.db();
        db.run(
            'INSERT INTO game_anthros (owner_id, name, gender_id, species_id, birthdate, fertile_on) VALUES (NULL, ?, ?, ?, ?, ?)',
            [
                Names.random(0, Genders.find(genderId)!.presents_as), genderId, speciesId,
                birthdate, Anthros.randomFertileOn(birthdate),
            ],
        );
        return Anthros.findAny(db.lastInsertId())!;
    }

    /**
     * Breeds two of the user's anthros times times (1 to Litters::MAX_CUBS, stopping once the dam's
     * litter is full). A pair that breaks the rules (see barrenReason()) is still bred and recorded, but produces no
     * litter; otherwise each try adds a cub to the dam's litter. Only choosing anthros the user doesn't control, the
     * same anthro twice, or one that's up for auction is refused.
     * Returns [{ litter: the litter if any try took, barren: the last reason a try didn't, attempts: tries
     * made, took: tries that added a cub }, null] or [null, error message].
     */
    static breed(ownerId: number, sireId: number, damId: number, times = 1): [BreedOutcome | null, string | null] {
        if (times < 1 || times > Litters.MAX_CUBS) {
            return [null, 'Breed 1 to ' + Litters.MAX_CUBS + ' times.'];
        }
        const sire = Anthros.findControlled(ownerId, sireId);
        const dam = Anthros.findControlled(ownerId, damId);
        if (!sire || !dam) {
            return [null, 'Choose a sire and a dam from your anthros.'];
        }
        if (sire.id === dam.id) {
            return [null, 'The sire and dam must be different anthros.'];
        }
        for (const parent of [sire, dam]) {
            if (parent.auction_id !== null) {
                return [null, `${parent.name} is up for auction.`];
            }
        }
        // The breeder's era may not allow it (see Preferences).
        const refusal = Preferences.breedingRefusal(ownerId, sire, dam);
        if (refusal) {
            return [null, refusal];
        }
        return [Anthros.tries(sire, dam, ownerId, times), null];
    }

    /**
     * Whether the anthro is a herm: its gender can both sire and be a dam.
     */
    static isHerm(anthro: Row): boolean {
        return !!anthro.is_male && !!anthro.is_female;
    }

    /**
     * A herm breeds itself: up to cubs tries (1 to Litters::MAX_CUBS; its own limit is secret), stopping once its
     * litter is full. The usual rules apply (fertile, its conceiving day...). The user must decide its breeding, as for
     * breed(): they have it (the anthro they play, while it's free, or one it owns).
     * Returns [as breed() does, null] or [null, error message].
     */
    static selfBreed(user: Row, anthroId: number, cubs: number): [BreedOutcome | null, string | null] {
        const anthro = Anthros.findAny(anthroId);
        if (!anthro || !Anthros.isHerm(anthro)) {
            return [null, 'Only a herm can breed itself.'];
        }
        if (!Anthros.findControlled(user.id, anthroId)) {
            return [null, anthro.player_id === user.id && anthro.owner_name !== null
                ? `${anthro.owner_name} decides ${anthro.name}'s breeding.` : "That isn't your anthro to breed."];
        }
        if (anthro.auction_id !== null) {
            return [null, `${anthro.name} is up for auction.`];
        }
        if (cubs < 1 || cubs > Litters.MAX_CUBS) {
            return [null, 'Choose a litter of 1 to ' + Litters.MAX_CUBS + '.'];
        }
        const refusal = Preferences.breedingRefusal(user.id, anthro);
        if (refusal) {
            return [null, refusal];
        }
        return [Anthros.tries(anthro, anthro, user.id, cubs), null];
    }

    /**
     * Breeds the pair up to times times, stopping once the dam's litter is full. Returns { litter, barren,
     * attempts, took } (see breed()).
     */
    private static tries(sire: Row, dam: Row, bredBy: number, times: number): BreedOutcome {
        const result: BreedOutcome = { litter: null, barren: null, attempts: 0, took: 0 };
        for (let i = 0; i < times; i++) {
            const outcome = Litters.attempt(sire, dam, bredBy, false);
            result.attempts++;
            if (outcome.litter) {
                result.took++;
                result.litter = outcome.litter;
            } else {
                result.barren = outcome.barren;
            }
            // Once her litter is full, more tries can't add a cub.
            if ((Litters.pending(dam.id)?.cubs ?? 0) >= Anthros.maxCubs(dam)) {
                break;
            }
        }
        return result;
    }

    /**
     * Breeds a group of the user's anthros times rounds. Each round, every anthro that can sire breeds
     * once with a random anthro from the group that can be a dam (never itself). Pairs that break the rules are still
     * bred and recorded, but produce no litter. Returns { pairs: {"Sire × Dam": count}, litters: Map of dam id =>
     * litter, barren: {"Sire × Dam: reason": count}, skipped: [reason, ...] }.
     */
    static groupBreed(ownerId: number, ids: unknown[], times: number): GroupBreedResult {
        const result: GroupBreedResult = { pairs: {}, litters: new Map(), barren: {}, skipped: [] };
        const group: Row[] = [];
        for (const id of array_unique(ids.map(int))) {
            const anthro = Anthros.findControlled(ownerId, id);
            if (anthro && anthro.auction_id !== null) {
                result.skipped.push(`${anthro.name} is up for auction.`);
            } else if (anthro) {
                group.push(anthro);
            }
        }
        const sires = Anthros.sires(group);
        if (!sires.length || !Anthros.dams(group).length) {
            result.skipped.push('Select at least one anthro that can sire and one that can be a dam.');
            return result;
        }
        for (let round = 0; round < times; round++) {
            for (const sire of sires) {
                const dams = Anthros.dams(group).filter((dam) => dam.id !== sire.id);
                if (!dams.length) {
                    result.skipped.push(`${sire.name}: no one else in the group can be a dam.`);
                    continue;
                }
                const dam = dams[random_int(0, dams.length - 1)];
                const [outcome, error] = Anthros.breed(ownerId, sire.id, dam.id);
                if (error || !outcome) {
                    result.skipped.push(error!);
                    continue;
                }
                const pair = `${sire.name} × ${dam.name}`;
                result.pairs[pair] = (result.pairs[pair] ?? 0) + 1;
                if (outcome.litter) {
                    // PHP's ['dam' => ...] + $litter: the dam's name comes first and wins.
                    const entry: Row = { dam: dam.name, ...outcome.litter };
                    entry.dam = dam.name;
                    result.litters.set(dam.id, entry);
                } else {
                    const key = `${pair}: ${outcome.barren}`;
                    result.barren[key] = (result.barren[key] ?? 0) + 1;
                }
            }
        }
        result.skipped = array_unique(result.skipped);
        return result;
    }

    /**
     * Admin breeding that ignores ownership, fertility, auctions, and which day the dam's litter started. Other rules
     * (gender roles, a full litter) still apply: the breeding is recorded but produces no litter. The cubs belong to
     * the dam's owner, as any cubs do (see Litters::deliverDue).
     * Returns [{ litter: ?Row, barren: ?string }, null] or [null, error message].
     */
    static forceBreed(sireId: number, damId: number, adminId: number): [Row | null, string | null] {
        const sire = Anthros.findAny(sireId);
        const dam = Anthros.findAny(damId);
        if (!sire || !dam) {
            return [null, 'Choose a sire and a dam.'];
        }
        if (sire.id === dam.id) {
            return [null, 'The sire and dam must be different anthros.'];
        }
        for (const parent of [sire, dam]) {
            if (Anthros.isDead(parent)) {
                return [null, `${parent.name} has died.`];
            }
        }
        return [Litters.attempt(sire, dam, adminId, true), null];
    }

    /**
     * Renames an anthro and records it in the anthro's history (unchanged names aren't recorded).
     * The caller checks that the actor owns it, plays it, or is an admin. Returns an error message, or null.
     */
    static rename(anthro: Row, name: string, actorId: number): string | null {
        name = trim(name);
        const error = Anthros.validateName(name);
        if (error) {
            return error;
        }
        if (name === anthro.name) {
            return null;
        }
        const db = Auth.db();
        db.beginTransaction();
        db.run('UPDATE game_anthros SET name = ? WHERE id = ?', [name, anthro.id]);
        db.run('INSERT INTO game_renames (anthro_id, old_name, new_name, renamed_by) VALUES (?, ?, ?, ?)',
            [anthro.id, anthro.name, name, actorId]);
        db.commit();
        return null;
    }

    /**
     * An anthro's name changes, oldest first. renamed_by_name is for admins only.
     */
    static renames(id: number): Row[] {
        return Auth.db().all(
            `SELECT r.renamed_at, r.old_name, r.new_name, u.username AS renamed_by_name
             FROM game_renames r LEFT JOIN users u ON u.id = r.renamed_by
             WHERE r.anthro_id = ? ORDER BY r.renamed_at, r.id`,
            [id],
        );
    }

    /**
     * Why breeding this pair would break the rules and so produce no litter, or null if it would. The breeding still
     * happens and is recorded with this reason. Forced (admin) breeding ignores fertility, including the dam's day.
     */
    static barrenReason(sire: Row, dam: Row, forced = false): string | null {
        for (const [role, parent] of [['sire', sire], ['dam', dam]] as const) {
            const reason = Anthros.breedingBlocker(parent, role, forced);
            if (reason) {
                return `${parent.name} ${reason}`;
            }
        }
        if (sire.species_id === null && dam.species_id === null) {
            return 'neither parent has a species for the cubs to inherit';
        }
        // A dam only conceives on her one day of the week. Players mustn't learn which, so the reason doesn't say.
        if (!forced && dam.fertile_weekday !== null && int(dam.fertile_weekday) !== Clock.weekday()) {
            return Anthros.DIDNT_TAKE;
        }
        return null;
    }

    /**
     * The name of an ISO weekday (1 = Monday).
     */
    static weekday(day: number | null): string {
        return day ? ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day] : 'not set';
    }

    /**
     * Admin: sets the day of the week (ISO 1-7) the dam can conceive. Returns an error message, or null.
     */
    static setFertileWeekday(anthro: Row, day: number): string | null {
        if (day < 1 || day > 7) {
            return 'Choose a day of the week.';
        }
        Auth.db().run('UPDATE game_anthros SET fertile_weekday = ? WHERE id = ?', [day, anthro.id]);
        return null;
    }


    /**
     * Returns an error message for a birthdate that isn't a real YYYY-MM-DD date from 1900 to today, or null.
     */
    private static validateBirthdate(birthdate: string): string | null {
        if (!isValidDate(birthdate) || int(birthdate.slice(0, 4)) < 1900) {
            return 'Enter a valid birthdate.';
        }
        if (birthdate > gmdate('Y-m-d')) {
            return 'The birthdate cannot be in the future.';
        }
        if (Anthros.ageWeeks(birthdate)! >= Anthros.LIFESPAN_MIN) {
            return 'Anthros only live about a year: choose a birthdate less than ' + Anthros.LIFESPAN_MIN + ' weeks ago.';
        }
        return null;
    }

    private static withFlags(row: Row): Row {
        row.is_male = !!row.is_male;
        row.is_female = !!row.is_female;
        return row;
    }

    private static validateName(name: string): string | null {
        if (name === '' || mb_strlen(name) > Anthros.MAX_NAME) {
            return 'Names must be 1-' + Anthros.MAX_NAME + ' characters.';
        }
        return null;
    }
}

/**
 * Whether the text is a real date written as YYYY-MM-DD (upstream: DateTimeImmutable::createFromFormat('!Y-m-d', ...)
 * with no errors, formatting back to the same text).
 */
function isValidDate(value: string): boolean {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        return false;
    }
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Upstream's addcslashes(str_replace('!', '!!', $q), '%_') for LIKE ... ESCAPE '!'. (It puts a backslash, not '!',
 * before % and _, so those stay wildcards after a literal backslash; kept as upstream has it.)
 */
function likeEscape(q: string): string {
    return q.replace(/!/g, '!!').replace(/[%_]/g, '\\$&');
}
