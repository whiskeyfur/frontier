// Upstream: game/src/Resets.php
import { Auth } from '../core/Auth';
import { int, mb_strlen, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Notifications } from './Notifications';

/**
 * Players can't change which anthro they play, but can ask the admins to release it. A reset makes that anthro an
 * ordinary anthro again (it keeps its coins, anthros, and its owner or freedom) so the player can create or become
 * another.
 *
 * (Not upstream: with a single player, who is the admin too, there's nobody to ask. The player resets themselves
 * (resetSelf), at once and with no message; request, dismiss and the admins' page are kept as they are.)
 */
export class Resets {
    static readonly MAX_REASON = 500;

    static pendingFor(userId: number): Row | null {
        return Auth.db().row("SELECT * FROM game_reset_requests WHERE user_id = ? AND status = 'pending'", [userId]);
    }

    /**
     * Asks the admins for a reset (one pending request at a time) and notifies them. Returns an error message, or null.
     */
    static request(user: Row, reason: string): string | null {
        const anthro = Anthros.player(user.id);
        if (!anthro) {
            return "You don't play an anthro, so there's nothing to reset.";
        }
        if (Resets.pendingFor(user.id)) {
            return 'You already have a reset request waiting for an admin.';
        }
        reason = trim(reason);
        if (mb_strlen(reason) > Resets.MAX_REASON) {
            return 'Keep the reason to ' + Resets.MAX_REASON + ' characters.';
        }
        Auth.db().run('INSERT INTO game_reset_requests (user_id, anthro_id, reason) VALUES (?, ?, ?)',
            [user.id, anthro.id, reason === '' ? null : reason]);
        Notifications.toAdmins(
            `${user.username} asks to stop playing ${anthro.name} and choose again`
            + (reason === '' ? '.' : `: "${reason}"`),
            '/game/admin/resets',
        );
        return null;
    }

    /**
     * Not upstream: the player stops playing their anthro, at once: it's released as an admin's reset releases it (it
     * stays as it was, free or owned, just unplayed), and the player can create or become another. Nobody is asked or
     * told. It's recorded as a reset they handled themselves. Returns an error message, or null.
     */
    static resetSelf(user: Row): string | null {
        const anthro = Anthros.player(user.id);
        if (!anthro) {
            return "You don't play an anthro, so there's nothing to reset.";
        }
        const db = Auth.db();
        const pending = Resets.pendingFor(user.id);
        db.beginTransaction();
        db.run('UPDATE game_anthros SET player_id = NULL WHERE id = ?', [anthro.id]);
        if (pending) {
            // A request made before this rule is answered by it.
            db.run("UPDATE game_reset_requests SET status = 'done', handled_by = ?, handled_at = UTC_TIMESTAMP() WHERE id = ?",
                [user.id, pending.id]);
        } else {
            db.run(
                `INSERT INTO game_reset_requests (user_id, anthro_id, status, handled_by, handled_at)
                 VALUES (?, ?, 'done', ?, UTC_TIMESTAMP())`,
                [user.id, anthro.id, user.id],
            );
        }
        db.commit();
        return null;
    }

    /**
     * Pending requests, oldest first.
     */
    static pending(): Row[] {
        return Auth.db().all(
            `SELECT r.*, u.username, a.name AS anthro_name
             FROM game_reset_requests r JOIN users u ON u.id = r.user_id LEFT JOIN game_anthros a ON a.id = r.anthro_id
             WHERE r.status = 'pending' ORDER BY r.id`,
        );
    }

    /**
     * Every player who plays an anthro, for resetting directly.
     */
    static players(): Row[] {
        return Auth.db().all(
            `SELECT a.id AS anthro_id, a.name AS anthro_name, u.id AS user_id, u.username
             FROM game_anthros a JOIN users u ON u.id = a.player_id ORDER BY u.username`,
        );
    }

    /**
     * Admin: releases the anthro the user plays and closes their pending request. Returns an error message, or null.
     */
    static reset(userId: number, adminId: number): string | null {
        const user = Auth.find(userId);
        const anthro = user ? Anthros.player(userId) : null;
        if (!anthro) {
            return "That player doesn't play an anthro.";
        }
        const db = Auth.db();
        db.beginTransaction();
        // It stays as it was, free or owned, just unplayed.
        db.run('UPDATE game_anthros SET player_id = NULL WHERE id = ?', [anthro.id]);
        db.run(
            `UPDATE game_reset_requests SET status = 'done', handled_by = ?, handled_at = UTC_TIMESTAMP()
             WHERE user_id = ? AND status = 'pending'`,
            [adminId, userId],
        );
        db.commit();
        // They no longer play an anthro, so this reaches them directly.
        Notifications.toUser(userId, `An admin released you from playing ${anthro.name}. Create or become an anthro to play again.`, '/game/home');
        return null;
    }

    /**
     * Admin: turns down a pending request. Returns an error message, or null.
     */
    static dismiss(requestId: number, adminId: number): string | null {
        const request = Auth.db().row("SELECT * FROM game_reset_requests WHERE id = ? AND status = 'pending'", [requestId]);
        if (!request) {
            return 'That request has already been handled.';
        }
        Auth.db().run(
            "UPDATE game_reset_requests SET status = 'dismissed', handled_by = ?, handled_at = UTC_TIMESTAMP() WHERE id = ?",
            [adminId, requestId],
        );
        Notifications.toUser(int(request.user_id), 'An admin declined your request to choose a different anthro.', '/game/home');
        return null;
    }
}
