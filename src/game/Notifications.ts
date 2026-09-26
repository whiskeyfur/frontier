// Upstream: game/src/Notifications.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { array_fill, array_unique, int, mb_strlen, sha1, trim } from '../core/php';
import { Anthros } from './Anthros';
import { Wallets } from './Wallets';

/**
 * Notifications: system events and messages between anthros. They're addressed to an anthro and seen by whoever
 * plays it, or directly to a user (admins, or players who don't play an anthro yet). Messages only ever show the
 * sending anthro's name, never the player behind it.
 */
export class Notifications {
    static readonly MAX_MESSAGE = 2000;

    /**
     * A system notification for an anthro (seen by the player who plays it, now or later). Notifications with the
     * same group (default: the same text) are squashed while unread: see add().
     */
    static toAnthro(anthroId: number | null, body: string, link: string | null = null, group: string | null = null): void {
        if (anthroId === null) {
            return;
        }
        Notifications.add(anthroId, null, 'system', null, body, link, group);
    }

    /**
     * A system notification for a player: delivered to the anthro they play, or to them directly if they don't
     * play one.
     */
    static toUser(userId: number | null, body: string, link: string | null = null): void {
        if (userId === null) {
            return;
        }
        const anthroId = Wallets.anthroFor(userId);
        if (anthroId !== null) {
            Notifications.toAnthro(anthroId, body, link);
            return;
        }
        Notifications.add(null, userId, 'system', null, body, link);
    }

    /**
     * A notification straight to every admin (for admin work such as reset requests).
     */
    static toAdmins(body: string, link: string | null = null): void {
        for (const candidate of Auth.allUsers()) {
            if (Auth.isAdmin(candidate)) {
                Notifications.add(null, candidate.id, 'system', null, body, link);
            }
        }
    }

    /**
     * A message from the anthro the sender plays to another anthro. Returns an error message, or null.
     */
    static send(user: Row, toAnthroId: number, body: string): string | null {
        const from = Anthros.player(user.id);
        if (!from) {
            return 'Create or become an anthro first; messages are sent as your anthro.';
        }
        const to = Anthros.findAny(toAnthroId);
        if (!to) {
            return 'Choose an anthro to send to.';
        }
        if (to.id === from.id) {
            return "You can't message yourself.";
        }
        body = trim(body);
        if (body === '' || mb_strlen(body) > Notifications.MAX_MESSAGE) {
            return 'Messages must be 1-' + Notifications.MAX_MESSAGE + ' characters.';
        }
        Notifications.add(to.id, null, 'message', from.id, body, null);
        return null;
    }

    /**
     * Admin: a message from an anthro nobody plays, written by the admin on its behalf (the recipient sees only the
     * anthro's name; admins see who wrote it). Returns an error message, or null.
     */
    static sendAs(admin: Row, fromAnthroId: number, toAnthroId: number, body: string): string | null {
        const from = Anthros.findAny(fromAnthroId);
        const to = Anthros.findAny(toAnthroId);
        body = trim(body);
        const error =
            !Auth.isAdmin(admin) ? 'Only admins can speak for an anthro nobody plays.'
            : !from || Anthros.isDead(from) ? 'Choose a living anthro to send as.'
            : from.player_id !== null ? `${from.name} is played: only its player speaks for it.`
            : !to ? 'Choose an anthro to send to.'
            : to.id === from.id ? "An anthro can't message itself."
            : body === '' || mb_strlen(body) > Notifications.MAX_MESSAGE ? 'Messages must be 1-' + Notifications.MAX_MESSAGE + ' characters.'
            : null;
        if (error) {
            return error;
        }
        Auth.db().run("INSERT INTO game_notifications (anthro_id, kind, from_anthro_id, body, group_key, sent_by) VALUES (?, 'message', ?, ?, ?, ?)",
            [to!.id, from!.id, body, sha1(body), admin.id]);
        return null;
    }

    /**
     * What the user sees: notifications for the anthro they play plus ones addressed to them, newest first.
     */
    static forUser(user: Row, limit = 100): Row[] {
        const [where, params] = Notifications.scope(user);
        return Auth.db().all(
            `SELECT n.id, n.kind, n.body, n.link, n.times, n.created_at, n.read_at, n.from_anthro_id, f.name AS from_name
             FROM game_notifications n LEFT JOIN game_anthros f ON f.id = n.from_anthro_id
             WHERE ${where} AND n.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
            [...params, limit],
        );
    }

    static unreadCount(user: Row): number {
        const [where, params] = Notifications.scope(user);
        return int(Auth.db().value(
            `SELECT COUNT(*) FROM game_notifications n WHERE (${where}) AND n.read_at IS NULL AND n.deleted_at IS NULL`,
            params,
        ));
    }

    static markAllRead(user: Row): void {
        const [where, params] = Notifications.scope(user);
        // SQLite: no alias on the target's columns in SET.
        Auth.db().run(`UPDATE game_notifications AS n SET read_at = UTC_TIMESTAMP() WHERE (${where}) AND n.read_at IS NULL`, params);
    }

    /**
     * Hides the user's notifications from them: sets deleted_at (the rows stay, and admins still see them).
     * Only notifications the user can see are affected. Returns how many were deleted.
     */
    static delete(user: Row, ids: unknown[]): number {
        ids = array_unique(ids.map((id) => int(id)));
        if (!ids.length) {
            return 0;
        }
        const [where, params] = Notifications.scope(user);
        return Auth.db().run(
            `UPDATE game_notifications AS n SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?
             WHERE (${where}) AND n.deleted_at IS NULL AND n.id IN (` + array_fill(ids.length, '?').join(', ') + ')',
            [user.id, ...params, ...ids],
        );
    }

    /**
     * Admin view of every notification, deleted ones included, newest first: who it was for (the anthro and who
     * plays it now, or the user), who sent it, and when it was read or deleted.
     */
    static all(limit = 500): Row[] {
        return Auth.db().all(
            `SELECT n.id, n.kind, n.body, n.link, n.times, n.created_at, n.read_at, n.deleted_at,
                    n.anthro_id AS to_anthro_id, a.name AS to_anthro, a.player_id AS to_player_id, a.died_at AS to_died_at,
                    pl.username AS to_player, u.username AS to_user,
                    n.from_anthro_id, f.name AS from_name, fp.username AS from_player, d.username AS deleted_by_name, sb.username AS sent_by_name
             FROM game_notifications n
             LEFT JOIN users sb ON sb.id = n.sent_by
             LEFT JOIN game_anthros a ON a.id = n.anthro_id
             LEFT JOIN users pl ON pl.id = a.player_id
             LEFT JOIN users u ON u.id = n.user_id
             LEFT JOIN game_anthros f ON f.id = n.from_anthro_id
             LEFT JOIN users fp ON fp.id = f.player_id
             LEFT JOIN users d ON d.id = n.deleted_by
             ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
            [limit],
        );
    }

    /**
     * Every living anthro, for choosing who to message. Unplayed anthros are included so the list doesn't reveal which
     * anthros are played.
     */
    static recipients(): Row[] {
        return Auth.db().all('SELECT id, name FROM game_anthros WHERE died_at IS NULL ORDER BY name, id');
    }

    /**
     * Stores a notification, squashing repeats: if the recipient has an unread (and undeleted) one of the same kind,
     * from the same sender and in the same group (default: the same text), that one is updated instead (its count
     * goes up, it takes the new text and link, and it moves to the top) rather than adding another.
     */
    private static add(anthroId: number | null, userId: number | null, kind: string, fromAnthroId: number | null, body: string,
                       link: string | null, group: string | null = null): void {
        const db = Auth.db();
        const key = sha1(group ?? body);
        // SQLite has no UPDATE ... ORDER BY ... LIMIT: the row is picked by a subquery. <=> is IS.
        const squashed = db.run(
            `UPDATE game_notifications SET times = times + 1, body = ?, link = ?, created_at = UTC_TIMESTAMP(6)
             WHERE id = (
                 SELECT id FROM game_notifications
                 WHERE group_key = ? AND kind = ? AND anthro_id IS ? AND user_id IS ? AND from_anthro_id IS ?
                   AND read_at IS NULL AND deleted_at IS NULL
                 ORDER BY id DESC LIMIT 1
             )`,
            [body, link, key, kind, anthroId, userId, fromAnthroId],
        );
        if (squashed === 0) {
            db.run(
                'INSERT INTO game_notifications (anthro_id, user_id, kind, from_anthro_id, body, link, group_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [anthroId, userId, kind, fromAnthroId, body, link, key],
            );
        }
    }

    /**
     * SQL condition (and parameters) for the notifications a user sees.
     */
    private static scope(user: Row): [string, unknown[]] {
        const anthroId = Wallets.anthroFor(user.id);
        return anthroId === null
            ? ['n.user_id = ?', [user.id]]
            : ['(n.user_id = ? OR n.anthro_id = ?)', [user.id, anthroId]];
    }
}
