// Upstream: game/src/Wallets.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { int, mb_strlen, number_format, trim } from '../core/php';
import { Anthros } from './Anthros';

/**
 * Coins. Every anthro has a wallet and every change to it is written to the ledger. Players spend from the wallet of
 * the anthro they play. Every new anthro starts with a random STARTING_MIN-STARTING_MAX coins (given by a database
 * trigger; see Schema::startingBalances).
 */
export class Wallets {
    static readonly STARTING_MIN = 0;
    static readonly STARTING_MAX = 100;
    static readonly CURRENCY = 'coins';

    /**
     * The anthro whose wallet the user spends from (the one they play), or null.
     */
    static anthroFor(userId: number): number | null {
        const id = Auth.db().value('SELECT id FROM game_anthros WHERE player_id = ?', [userId]);
        return id === null ? null : int(id);
    }

    static balance(anthroId: number): number {
        Wallets.ensure(anthroId);
        return int(Auth.db().value('SELECT balance FROM game_wallets WHERE anthro_id = ?', [anthroId]));
    }

    /**
     * Coins the anthro has tied up as the highest bid in open auctions (already taken from its balance).
     */
    static held(anthroId: number): number {
        return int(Auth.db().value(
            `SELECT COALESCE(SUM(b.amount), 0)
             FROM game_auctions a
             JOIN game_bids b ON b.id = (SELECT id FROM game_bids WHERE auction_id = a.id ORDER BY amount DESC, id DESC LIMIT 1)
             WHERE a.status = 'open' AND b.anthro_id = ?`,
            [anthroId],
        ));
    }

    /**
     * The anthro's ledger, newest first.
     */
    static ledger(anthroId: number, limit = 100): Row[] {
        Wallets.ensure(anthroId);
        return Auth.db().all(
            `SELECT l.amount, l.balance_after, l.reason, l.auction_id, l.created_at, u.username AS created_by_name
             FROM game_ledger l LEFT JOIN users u ON u.id = l.created_by
             WHERE l.anthro_id = ? ORDER BY l.id DESC LIMIT ?`,
            [anthroId, limit],
        );
    }

    /**
     * Adds (or with a negative amount, removes) coins and records why. Must run inside the caller's transaction
     * when it's part of a larger change; locks the wallet row. Returns false (changing nothing) if a removal
     * would leave the balance below zero, unless allowNegative.
     */
    static change(anthroId: number, amount: number, reason: string, auctionId: number | null = null,
                  createdBy: number | null = null, allowNegative = false): boolean {
        Wallets.ensure(anthroId);
        const db = Auth.db();
        const balance = int(db.value('SELECT balance FROM game_wallets WHERE anthro_id = ?', [anthroId])) + amount;
        if (balance < 0 && !allowNegative) {
            return false;
        }
        db.run('UPDATE game_wallets SET balance = ? WHERE anthro_id = ?', [balance, anthroId]);
        db.run(
            'INSERT INTO game_ledger (anthro_id, amount, balance_after, reason, auction_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [anthroId, amount, balance, reason, auctionId, createdBy],
        );
        return true;
    }

    /**
     * Admin adjustment of an anthro's wallet. Returns an error message, or null.
     */
    static adjust(anthroId: number, amount: number, reason: string, adminId: number): string | null {
        reason = trim(reason);
        if (amount === 0) {
            return 'Enter a non-zero amount.';
        }
        if (reason === '' || mb_strlen(reason) > 200) {
            return 'Give a reason (up to 200 characters).';
        }
        if (!Anthros.findAny(anthroId)) {
            return 'That anthro no longer exists.';
        }
        const db = Auth.db();
        db.beginTransaction();
        if (!Wallets.change(anthroId, amount, 'Admin: ' + reason, null, adminId)) {
            db.rollBack();
            return 'That would leave the balance below zero.';
        }
        db.commit();
        return null;
    }

    /**
     * Wallets for the admin page: every played anthro plus any anthro holding coins, richest first.
     */
    static all(q = '', limit: number | null = null): Row[] {
        const [nameWhere, params] = Anthros.nameStartsWith(q);
        const rows = Auth.db().all(
            `SELECT a.id, a.name, pl.username AS player_name, IF(a.owner_id = a.id, NULL, o.name) AS owner_name,
                    COALESCE(w.balance, 0) AS balance
             FROM game_anthros a
             LEFT JOIN game_wallets w ON w.anthro_id = a.id
             LEFT JOIN users pl ON pl.id = a.player_id
             LEFT JOIN game_anthros o ON o.id = a.owner_id
             WHERE (a.player_id IS NOT NULL OR w.balance <> 0)` + nameWhere + `
             ORDER BY balance DESC, a.name` + (limit === null ? '' : ' LIMIT ' + Math.max(1, limit)),
            params,
        );
        for (const row of rows) {
            row.held = Wallets.held(int(row.id));
        }
        return rows;
    }

    /**
     * How many wallets all() would list without a limit.
     */
    static countAll(q = ''): number {
        const [nameWhere, params] = Anthros.nameStartsWith(q);
        return int(Auth.db().value(
            `SELECT COUNT(*) FROM game_anthros a LEFT JOIN game_wallets w ON w.anthro_id = a.id
             WHERE (a.player_id IS NOT NULL OR w.balance <> 0)` + nameWhere,
            params,
        ));
    }

    static format(amount: number): string {
        return number_format(amount) + ' ' + Wallets.CURRENCY;
    }

    /**
     * Creates an empty wallet for the anthro if it doesn't have one yet.
     */
    private static ensure(anthroId: number): void {
        Auth.db().run('INSERT OR IGNORE INTO game_wallets (anthro_id, balance) VALUES (?, 0)', [anthroId]);
    }
}
