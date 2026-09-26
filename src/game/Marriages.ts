// Upstream: game/src/Marriages.php
import { Auth, type User } from '../core/Auth';
import { gmdate, int, random_int, strtotimeOrThrow } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Clock } from './Clock';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';

/**
 * Marriage: households. A household has a head and any number of spouses who married into it (spouse_of names the
 * head), all free and grown: a lion and his lionesses, or a queen and her husbands. Each spouse shares the head's rank
 * as a consort (see Ranks::of): the lionesses of a King are all Queens, equal to each other. A spouse is in one
 * household at a time, and a head can't marry into another's.
 *
 * Only free anthros marry, each for itself: a player proposes for the anthro they play, to marry another into its
 * household or to marry into the other's. A played anthro's player answers; an unplayed one answers at once, yes one
 * time in ACCEPT_CHANCE, and one that says no can't be asked again by the same anthro for RETRY_DAYS.
 *
 * A spouse can leave, and a head can send a spouse away, without the other's consent; but the household's land counts
 * toward the head's rank (see Ranks::acresHeld), so a head whose title was earned by land can lose it (see
 * Ranks::holdByLand), and the spouse loses the rank it shared. A marriage also ends when either loses its freedom or dies.
 */
export class Marriages {
    static readonly ACCEPT_CHANCE = 2;
    static readonly RETRY_DAYS = 7;

    /**
     * The spouses who married into the anthro's household, by name.
     */
    static spouses(headId: number): Row[] {
        const ids = Auth.db().column('SELECT id FROM game_anthros WHERE spouse_of = ? AND died_at IS NULL ORDER BY name, id', [headId]);
        return ids.map((id) => Anthros.findAny(int(id))!);
    }

    /**
     * Open proposals the anthro is part of: {received: [...], sent: [...]}, each with 'id', 'head_id',
     * 'spouse_id', 'from_id' and 'other' (the other anthro), oldest first.
     */
    static proposals(anthroId: number): { received: Row[]; sent: Row[] } {
        const rows = Auth.db().all(
            "SELECT id, head_id, spouse_id, from_id FROM game_proposals WHERE status = 'open' AND (head_id = ? OR spouse_id = ?) ORDER BY created_at, id",
            [anthroId, anthroId],
        );
        const proposals: { received: Row[]; sent: Row[] } = { received: [], sent: [] };
        for (const row of rows) {
            const otherId = int(row.head_id) === anthroId ? int(row.spouse_id) : int(row.head_id);
            proposals[int(row.from_id) === anthroId ? 'sent' : 'received'].push({ ...row, other: Anthros.findAny(otherId) });
        }
        return proposals;
    }

    /**
     * Why the pair can't marry, the spouse into the head's household, or null: both free, grown and alive; the head
     * isn't a spouse itself, and the spouse is in no household (neither married nor a head).
     */
    static blocker(head: Row, spouse: Row): string | null {
        for (const anthro of [head, spouse]) {
            if (!Anthros.isFree(anthro) || Anthros.isYoung(anthro)) {
                return `${anthro.name} can't marry: only free, grown anthros marry.`;
            }
        }
        if (head.id === spouse.id) {
            return "An anthro can't marry itself.";
        }
        if (head.spouse_of !== null) {
            return `${head.name} is married into ${head.spouse_of_name}'s household, so can't take spouses.`;
        }
        if (spouse.spouse_of !== null) {
            return `${spouse.name} is already married, into ${spouse.spouse_of_name}'s household.`;
        }
        if (Marriages.spouses(spouse.id).length) {
            return `${spouse.name} heads a household, so can't marry into another.`;
        }
        return null;
    }

    /**
     * The user's anthro proposes to another (otherId): to marry it into its own household (intoMine), or to marry
     * into the other's. A played anthro is asked; an unplayed one answers at once. Returns [what happened, null] or
     * [null, error message].
     */
    static propose(user: User, otherId: number, intoMine: boolean): [string | null, string | null] {
        const me = Anthros.player(user.id);
        const other = Anthros.findAny(otherId);
        if (!me) {
            return [null, 'Create or become an anthro first.'];
        }
        if (!other) {
            return [null, 'Choose who to propose to.'];
        }
        const [head, spouse] = intoMine ? [me, other] : [other, me];
        let error: string | null;
        if ((error = Marriages.blocker(head, spouse))) {
            return [null, error];
        }
        const db = Auth.db();
        if (int(db.value("SELECT COUNT(*) FROM game_proposals WHERE status = 'open' AND head_id = ? AND spouse_id = ?", [head.id, spouse.id]))) {
            return [null, 'That proposal is already waiting for an answer.'];
        }
        const when = db.value(
            `SELECT MAX(answered_at) FROM game_proposals WHERE status = 'declined' AND from_id = ? AND (head_id = ? OR spouse_id = ?)
               AND answered_at > SUBDATE(` + Clock.sqlNow() + `, ` + Marriages.RETRY_DAYS + ')',
            [me.id, other.id, other.id],
        );
        if (when) {
            return [null, `${other.name} turned you down lately: ask again after `
                + gmdate('Y-m-d', strtotimeOrThrow(when + ' UTC +' + Marriages.RETRY_DAYS + ' days')) + '.'];
        }
        db.run('INSERT INTO game_proposals (head_id, spouse_id, from_id) VALUES (?, ?, ?)', [head.id, spouse.id, me.id]);
        const id = db.lastInsertId();
        if (other.player_id === null) {
            // Nobody plays it: it answers at once.
            const yes = random_int(1, Marriages.ACCEPT_CHANCE) === 1;
            Marriages.settle(id, yes);
            return [yes ? `${other.name} said yes: ` + Marriages.marriedText(head, spouse, me) : `${other.name} said no.`, null];
        }
        Notifications.toAnthro(other.id, intoMine
            ? `${me.name} asks you to marry into their household.`
            : `${me.name} asks to marry into your household.`, '/game/court');
        return [`You proposed to ${other.name}.`, null];
    }

    /**
     * The user answers a proposal made to the anthro they play. Returns an error message, or null.
     */
    static answer(user: User, proposalId: number, yes: boolean): string | null {
        const proposal = Marriages.openProposal(proposalId);
        const me = Anthros.player(user.id);
        if (!proposal || !me || int(proposal.from_id) === me.id || ![int(proposal.head_id), int(proposal.spouse_id)].includes(me.id)) {
            return 'That proposal is no longer open.';
        }
        let error: string | null;
        if (yes && (error = Marriages.blocker(Anthros.findAny(int(proposal.head_id))!, Anthros.findAny(int(proposal.spouse_id))!))) {
            return error;
        }
        Marriages.settle(proposalId, yes);
        const from = int(proposal.from_id);
        Notifications.toAnthro(from, yes ? `${me.name} said yes to your proposal.` : `${me.name} said no to your proposal.`, '/game/court');
        return null;
    }

    /**
     * The user takes back a proposal they made. Returns an error message, or null.
     */
    static withdraw(user: User, proposalId: number): string | null {
        const proposal = Marriages.openProposal(proposalId);
        const me = Anthros.player(user.id);
        if (!proposal || !me || int(proposal.from_id) !== me.id) {
            return 'That proposal is no longer open.';
        }
        Auth.db().run('DELETE FROM game_proposals WHERE id = ?', [proposalId]);
        return null;
    }

    /**
     * The anthro the user plays leaves the household it married into. Returns an error message, or null.
     */
    static leave(user: User): string | null {
        const me = Anthros.player(user.id);
        if (!me || me.spouse_of === null) {
            return "You haven't married into a household.";
        }
        Marriages.part(me, `${me.name} left your household.`);
        return null;
    }

    /**
     * The head the user plays sends a spouse away. Returns an error message, or null.
     */
    static dismiss(user: User, spouseId: number): string | null {
        const me = Anthros.player(user.id);
        const spouse = Anthros.findAny(spouseId);
        if (!me || !spouse || spouse.spouse_of !== me.id) {
            return (spouse?.name ?? 'That anthro') + " isn't married into your household.";
        }
        Marriages.part(spouse, `${me.name} sent you away from their household.`, spouse.id);
        return null;
    }

    /**
     * Ends the anthro's marriages as it loses its freedom or dies (why): it leaves the household it married into, and
     * its own spouses are free of it. Its open proposals are dropped.
     */
    static end(anthro: Row, why: string): void {
        const db = Auth.db();
        for (const spouse of Marriages.spouses(anthro.id)) {
            Notifications.toAnthro(spouse.id, `${anthro.name} ${why}: your marriage is over.`, '/game/court');
        }
        db.run('UPDATE game_anthros SET spouse_of = NULL WHERE spouse_of = ? OR id = ?', [anthro.id, anthro.id]);
        db.run("DELETE FROM game_proposals WHERE status = 'open' AND (head_id = ? OR spouse_id = ?)", [anthro.id, anthro.id]);
    }

    /**
     * A spouse leaves its household: the other side is told (note, to toId: the head unless given), and titles held
     * by land that no longer hold fall (see Ranks::holdByLand).
     */
    private static part(spouse: Row, note: string, toId: number | null = null): void {
        Auth.db().run('UPDATE game_anthros SET spouse_of = NULL WHERE id = ?', [spouse.id]);
        Notifications.toAnthro(toId ?? int(spouse.spouse_of), note, '/game/court');
        Ranks.holdByLand();
    }

    private static openProposal(id: number): Row | null {
        return Auth.db().row("SELECT * FROM game_proposals WHERE id = ? AND status = 'open'", [id]);
    }

    /**
     * Closes a proposal: yes marries the pair (and drops the spouse's other open proposals to marry into a household),
     * no is kept as a refusal (see RETRY_DAYS).
     */
    private static settle(id: number, yes: boolean): void {
        const proposal = Marriages.openProposal(id)!;
        const db = Auth.db();
        if (!yes) {
            db.run("UPDATE game_proposals SET status = 'declined', answered_at = " + Clock.sqlNow() + ' WHERE id = ?', [id]);
            return;
        }
        db.run('UPDATE game_anthros SET spouse_of = ? WHERE id = ?', [proposal.head_id, proposal.spouse_id]);
        db.run('DELETE FROM game_proposals WHERE id = ? OR (status = \'open\' AND spouse_id = ?)', [id, proposal.spouse_id]);
        const head = Anthros.findAny(int(proposal.head_id))!;
        const spouse = Anthros.findAny(int(proposal.spouse_id))!;
        Notifications.toAnthro(spouse.id, `You married into ${head.name}'s household.`, '/game/court');
        Notifications.toAnthro(head.id, `${spouse.name} married into your household.`, '/game/court');
    }

    private static marriedText(head: Row, spouse: Row, me: Row): string {
        return me.id === head.id ? `${spouse.name} married into your household.` : `you married into ${head.name}'s household.`;
    }
}
