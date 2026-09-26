// Upstream: game/src/Urges.php
import { Auth } from '../core/Auth';
import { array_unique, int, random_int, shuffle } from '../core/php';
import type { Db, Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Litters } from './Litters';
import { Notifications } from './Notifications';
import { Preferences } from './Preferences';
import { Ranks } from './Ranks';

/**
 * A dam's urge to breed. Each day a fertile dam goes without a breeding attempt, her chance of starting one herself
 * rises by her own rate (urge_rise, percent a day: see randomRise): most gain about RISE_TYPICAL a day, some less, and
 * at MAX_RISE she can't go three days without. Once a day (see rollToday) each fertile dam rolls her chance, and if it
 * comes up she breeds her first choice of partner (see partnerFor): a member of a breeding group she's in, her owner, a
 * fellow slave of her owner's, or else anyone at her rank. Any breeding attempt (hers, or one she's put to) starts her
 * wait over, as do her becoming fertile, giving birth, and her arrival in the game.
 */
export class Urges {
    static readonly MIN_RISE = 1;
    static readonly MAX_RISE = 34;
    // The usual rise, percent a day: most dams' rates are within RISE_SPREAD of it.
    static readonly RISE_TYPICAL = 5;
    static readonly RISE_SPREAD = 2;

    /**
     * A random rate for a new anthro: RISE_TYPICAL give or take RISE_SPREAD for eight in ten, a slower rate (down to
     * MIN_RISE) for one in ten, and a faster one (up to MAX_RISE) for the last one in ten.
     */
    static randomRise(): number {
        const low = Urges.RISE_TYPICAL - Urges.RISE_SPREAD;
        const high = Urges.RISE_TYPICAL + Urges.RISE_SPREAD;
        const roll = random_int(1, 10);
        if (roll === 1) {
            return random_int(Urges.MIN_RISE, low - 1);
        }
        if (roll === 10) {
            return random_int(high + 1, Urges.MAX_RISE);
        }
        return random_int(low, high);
    }

    /**
     * Gives every anthro without a rate a random one (new anthros get theirs the next time the game rolls urges).
     * db: the connection to use.
     */
    static fillRises(db: Db | null = null): void {
        db ??= Auth.db();
        for (const id of db.column('SELECT id FROM game_anthros WHERE urge_rise IS NULL')) {
            db.run('UPDATE game_anthros SET urge_rise = ? WHERE id = ?', [Urges.randomRise(), id]);
        }
    }

    /**
     * The anthro's rate (percent a day), or null if it hasn't been given one yet.
     */
    static rise(anthro: Row): number | null {
        return anthro.urge_rise != null ? int(anthro.urge_rise) : null;
    }

    /**
     * How many days the anthro has gone since its wait last started over: its last breeding attempt (either role), its
     * fertile date, its last litter's birth, or its arrival in the game, whichever came last. 0 if that was today.
     */
    static daysWaiting(anthro: Row): number {
        const days = Auth.db().value(
            `SELECT DATEDIFF(UTC_DATE(), GREATEST(
                 COALESCE((SELECT MAX(DATE(b.bred_at)) FROM game_breedings b WHERE b.sire_id = a.id OR b.dam_id = a.id), '1000-01-01'),
                 COALESCE((SELECT MAX(DATE(l.born_at)) FROM game_litters l WHERE l.dam_id = a.id), '1000-01-01'),
                 COALESCE(a.fertile_on, '1000-01-01'),
                 DATE(a.created_at)))
             FROM game_anthros a WHERE a.id = ?`,
            [anthro.id],
        );
        return Math.max(0, int(days));
    }

    /**
     * The anthro's chance today (percent) of starting a breeding attempt: its days waiting times its rate, at most 100.
     * 0 for one that isn't a dam able to conceive now (see seeking).
     */
    static chance(anthro: Row): number {
        return Urges.seeking(anthro) ? Math.min(100, Urges.daysWaiting(anthro) * int(Urges.rise(anthro))) : 0;
    }

    /**
     * Whether the anthro is a dam whose urge counts today: grown, and able to carry a litter now (fertile, not past
     * bearing, not pregnant, fed, not up for auction: see Anthros::breedingBlocker). The game's own anthros, with no
     * owner, don't seek.
     */
    static seeking(anthro: Row): boolean {
        return anthro.owner_id != null && !Anthros.isYoung(anthro) && Urges.rise(anthro) !== null
            && Anthros.breedingBlocker(anthro, 'dam') === null;
    }

    /**
     * The dam's partner if her urge comes up today, by her order of choice, or null if there's nobody: a member of a
     * breeding group she's in; her owner; a fellow slave of her owner's; anyone at her rank (see Ranks::of). Within a
     * choice the partner is picked at random. A partner has to be able to sire today (see Anthros::breedingBlocker),
     * and both players' eras have to allow the pair (see Preferences). Returns {sire: anthro, group_id: the
     * group it's from, or null, how: 'group', 'owner', 'fellow' or 'rank'}.
     */
    static partnerFor(dam: Row): { sire: Row; group_id: number | null; how: string } | null {
        const db = Auth.db();
        const groups = db.all(
            `SELECT m2.anthro_id, m2.group_id FROM game_group_members m1
             JOIN game_group_members m2 ON m2.group_id = m1.group_id AND m2.anthro_id <> m1.anthro_id
             WHERE m1.anthro_id = ?`,
            [dam.id],
        );
        // Anthro id => the first group it shares with her.
        const groupOf = new Map<number, number>();
        for (const row of groups) {
            if (!groupOf.has(int(row.anthro_id))) {
                groupOf.set(int(row.anthro_id), int(row.group_id));
            }
        }
        const choices: Record<string, number[]> = { group: [...groupOf.keys()] };
        const owned = !Anthros.isFree(dam);
        choices.owner = owned ? [int(dam.owner_id)] : [];
        if (owned) {
            choices.fellow = db.column(
                'SELECT id FROM game_anthros WHERE owner_id = ? AND id <> owner_id AND id <> ? AND died_at IS NULL',
                [dam.owner_id, dam.id],
            ).map(int);
        }
        choices.rank = db.column(
            `SELECT a.id FROM game_anthros a JOIN game_genders ge ON ge.id = a.gender_id
             WHERE a.id <> ? AND a.died_at IS NULL AND a.young = 0 AND ge.is_male AND a.owner_id IS NOT NULL AND ` + Ranks.sql('a') + ' = ?',
            [dam.id, Ranks.of(dam)],
        ).map(int);

        const tried = new Set<number>([dam.id]);
        for (const [how, ids] of Object.entries(choices)) {
            shuffle(ids);
            for (const id of ids) {
                if (tried.has(id)) {
                    continue;
                }
                tried.add(id);
                const sire = Anthros.findAny(id);
                if (sire && Urges.willing(dam, sire)) {
                    return { sire, group_id: how === 'group' ? groupOf.get(id)! : null, how };
                }
            }
        }
        return null;
    }

    /**
     * Whether the anthro can sire for the dam today: it can sire (see Anthros::breedingBlocker), and neither the dam's
     * player nor its own (whoever plays their owners) is in an era that refuses the pair.
     */
    private static willing(dam: Row, sire: Row): boolean {
        if (Anthros.isYoung(sire) || Anthros.breedingBlocker(sire, 'sire') !== null) {
            return false;
        }
        for (const playerId of array_unique([dam.owner_player_id, sire.owner_player_id])) {
            if (playerId != null && Preferences.breedingRefusal(playerId, sire, dam) !== null) {
                return false;
            }
        }
        return true;
    }

    /**
     * Once a day (the game runs this on each request): every seeking dam rolls her chance, and each whose urge comes up
     * breeds her partner (see partnerFor). The parents are told by Litters::attempt; the players who own them (when
     * they're not the parents) hear of it here. Returns how many breedings happened.
     */
    static rollToday(): number {
        const db = Auth.db();
        const claim = db.run("INSERT OR IGNORE INTO game_daily (day, task) VALUES (UTC_DATE(), 'urges')");
        if (!claim) {
            return 0;
        }
        Urges.fillRises(db);
        const ids = db.column(
            `SELECT a.id FROM game_anthros a JOIN game_genders ge ON ge.id = a.gender_id
             WHERE ge.is_female AND a.died_at IS NULL AND a.young = 0 AND a.owner_id IS NOT NULL ORDER BY a.id`,
        );
        let bred = 0;
        for (const id of ids) {
            // Re-read her: an earlier dam's breeding today may have been with her (as a herm's sire), starting her wait over.
            const dam = Anthros.findAny(int(id));
            if (!dam || random_int(1, 100) > Urges.chance(dam)) {
                continue;
            }
            const partner = Urges.partnerFor(dam);
            if (!partner) {
                continue;
            }
            const sire = partner.sire;
            const outcome = Litters.attempt(sire, dam, null, false, partner.group_id);
            bred++;
            const what = `${dam.name} went looking for a mate and bred with ${sire.name}`
                + (outcome.litter ? ": she's expecting." : ', but no litter will come of it.');
            // Owner id => the anthro of theirs to link to.
            const owners = new Map<number, number>();
            for (const parent of [dam, sire]) {
                if (!Anthros.isFree(parent) && ![sire.id, dam.id].includes(parent.owner_id)) {
                    if (!owners.has(parent.owner_id)) {
                        owners.set(parent.owner_id, parent.id);
                    }
                }
            }
            for (const [ownerId, anthroId] of owners) {
                Notifications.toAnthro(ownerId, what, '/game/assets/' + anthroId);
            }
        }
        return bred;
    }
}
