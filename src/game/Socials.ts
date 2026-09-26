// Upstream: game/src/Socials.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { int, mb_strlen, random_int, trim } from '../core/php';
import { Anthros } from './Anthros';
import { Litters } from './Litters';
import { Notifications } from './Notifications';
import { Preferences } from './Preferences';
import { Wallets } from './Wallets';

/**
 * Socials: an anthro (the one a player plays) flirts with another anthro. If the other accepts, they try breeding
 * there and then, as many times as the flirt asked (1 to Litters::MAX_CUBS, stopping when the dam's litter is full), taking the roles the pair can fill (a pair that can't is recorded with no litter, as usual; see
 * Litters::attempt, which tells both). A played anthro's player answers; an unplayed anthro answers on its own, saying
 * yes 1 time in ACCEPT_CHANCE. Everything is shown by anthro name only.
 */
export class Socials {
    static readonly MAX_MESSAGE = 200;
    static readonly ACCEPT_CHANCE = 2;

    /**
     * Sends a flirt from the anthro the user plays. Returns ['pending' or 'accepted' or 'declined', null] (unplayed
     * anthros answer at once) or [null, error message].
     */
    static flirt(user: Row, toId: number, message: string, times = 1): [string | null, string | null] {
        const from = Anthros.player(user.id);
        const to = Anthros.findAny(toId);
        message = trim(message);
        const error =
            !from ? 'Create or become an anthro first: you flirt as your anthro.'
            : !to ? 'Choose an anthro to flirt with.'
            : to.id === from.id ? "You can't flirt with yourself."
            : Anthros.isDead(to) ? `${to.name} has died.`
            : mb_strlen(message) > Socials.MAX_MESSAGE ? 'Keep it to ' + Socials.MAX_MESSAGE + ' characters.'
            : times < 1 || times > Litters.MAX_CUBS ? 'Breed 1 to ' + Litters.MAX_CUBS + ' times.'
            : from.auction_id !== null ? "You can't flirt while you're up for auction."
            : to.auction_id !== null ? `${to.name} is up for auction.`
            : Socials.pendingBetween(from.id, to.id) !== null ? `There's already a flirt waiting between you and ${to.name}.`
            : null;
        if (error) {
            return [null, error];
        }
        Auth.db().run('INSERT INTO game_flirts (from_anthro_id, to_anthro_id, message, times, created_by) VALUES (?, ?, ?, ?, ?)',
            [from!.id, to!.id, message === '' ? null : message, times, user.id]);
        const id = Auth.db().lastInsertId();
        if (to!.player_id === null) {
            // Nobody plays it: it answers for itself.
            const accept = random_int(1, Socials.ACCEPT_CHANCE) === 1;
            Socials.answer(id, accept);
            return [accept ? 'accepted' : 'declined', null];
        }
        const wants = times === 1 ? '' : ` (and wants to breed ${times} times)`;
        Notifications.toAnthro(to!.id, `${from!.name} is flirting with you${wants}` + (message === '' ? '.' : `: "${message}"`), '/game/socials');
        return ['pending', null];
    }

    /**
     * The player of the anthro flirted with accepts (and they try breeding) or declines. Returns an error message,
     * or null.
     */
    static respond(user: Row, flirtId: number, accept: boolean): string | null {
        const flirt = Socials.find(flirtId);
        const me = Wallets.anthroFor(user.id);
        if (!flirt || flirt.status !== 'pending' || me === null || flirt.to_anthro_id !== me) {
            return 'That flirt has already been answered.';
        }
        return Socials.answer(flirtId, accept);
    }

    /**
     * The flirt's sender takes it back while it's unanswered. Returns an error message, or null.
     */
    static withdraw(user: Row, flirtId: number): string | null {
        const flirt = Socials.find(flirtId);
        const me = Wallets.anthroFor(user.id);
        if (!flirt || flirt.status !== 'pending' || me === null || flirt.from_anthro_id !== me) {
            return 'That flirt has already been answered.';
        }
        Auth.db().run("UPDATE game_flirts SET status = 'withdrawn', answered_at = UTC_TIMESTAMP() WHERE id = ?", [flirtId]);
        return null;
    }

    /**
     * Flirts to and from the anthro, newest first, with both anthros' names and any breeding outcome.
     */
    static forAnthro(anthroId: number, limit = 50): Row[] {
        return Auth.db().all(
            `SELECT f.*, fa.name AS from_name, ta.name AS to_name
             FROM game_flirts f
             LEFT JOIN game_anthros fa ON fa.id = f.from_anthro_id
             LEFT JOIN game_anthros ta ON ta.id = f.to_anthro_id
             WHERE f.from_anthro_id = ? OR f.to_anthro_id = ?
             ORDER BY f.id DESC LIMIT ?`,
            [anthroId, anthroId, limit],
        );
    }

    static find(id: number): Row | null {
        return Auth.db().row('SELECT * FROM game_flirts WHERE id = ?', [id]);
    }

    /**
     * Records the answer; on yes, the pair try breeding the flirt's number of times (if neither is up for auction by
     * now). It's recorded as giving a litter if any attempt did; otherwise with the last attempt's reason. Returns an
     * error message, or null.
     */
    private static answer(flirtId: number, accept: boolean): string | null {
        const flirt = Socials.find(flirtId)!;
        const from = Anthros.findAny(int(flirt.from_anthro_id));
        const to = Anthros.findAny(int(flirt.to_anthro_id));
        if (!from || !to) {
            return 'One of them is no longer in the game.';
        }
        let outcome: Row | null = null;
        // The era of either player (the flirt's, or the one answering) may not allow it (see Preferences).
        const refusal = accept ? Preferences.breedingRefusal(flirt.created_by === null ? null : int(flirt.created_by), from, to)
            ?? Preferences.breedingRefusal(to.player_id, from, to) : null;
        if (refusal) {
            outcome = { litter: null, barren: refusal };
        } else if (accept && from.auction_id === null && to.auction_id === null) {
            // Take the roles the pair can fill; a pair that can't is still recorded, with no litter.
            const [sire, dam] =
                from.is_male && to.is_female ? [from, to]
                : from.is_female && to.is_male ? [to, from]
                : [from, to];
            for (let i = 0; i < int(flirt.times); i++) {
                const attempt = Litters.attempt(sire, dam, flirt.created_by === null ? null : int(flirt.created_by), false);
                outcome = outcome && outcome.litter ? outcome : attempt;
                // Once her litter is full, more tries can't add a cub.
                if ((Litters.pending(dam.id)?.cubs ?? 0) >= Anthros.maxCubs(dam)) {
                    break;
                }
            }
        }
        Auth.db().run(
            'UPDATE game_flirts SET status = ?, answered_at = UTC_TIMESTAMP(), barren_reason = ?, litter = ? WHERE id = ?',
            [accept ? 'accepted' : 'declined', outcome?.barren ?? null, outcome && outcome.litter ? 1 : 0, flirtId],
        );
        if (!accept) {
            Notifications.toAnthro(from.id, `${to.name} turned down your flirt.`, '/game/socials');
        }
        return null;
    }

    private static pendingBetween(a: number, b: number): number | null {
        const id = Auth.db().value(
            `SELECT id FROM game_flirts WHERE status = 'pending'
             AND ((from_anthro_id = ? AND to_anthro_id = ?) OR (from_anthro_id = ? AND to_anthro_id = ?))`,
            [a, b, b, a],
        );
        return id === null ? null : int(id);
    }
}
