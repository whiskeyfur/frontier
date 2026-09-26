// Upstream: game/src/Auctions.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { gmdate, int, intdiv, random_int, strtotimeOrThrow, time } from '../core/php';
import { Anthros } from './Anthros';
import { Land } from './Land';
import { Notifications } from './Notifications';
import { Wallets } from './Wallets';

/**
 * Anthro auctions. Players bid with the wallet of the anthro they play: a bid takes the coins at once, and they're
 * returned to that anthro when someone outbids it. When an auction ends (time runs out, or someone pays the buy-now
 * price) the highest bidding anthro owns it and the seller's played anthro is paid; with no bids it stays where it
 * was. seller_id, bidder_id and winner_id are the users who acted. The game sells anthros too (seller_id NULL, and the
 * anthro has no owner): those coins leave the game, and unsold ones go free.
 */
export class Auctions {
    static readonly DURATIONS = [1, 3, 7];
    static readonly MIN_RAISE_PERCENT = 5;

    // Each auction with its current (highest) bid and bidder, and how many bids it has.
    // seller_name is the selling anthro's name; which player that is stays private.
    private static readonly SELECT = `SELECT au.*, sa.name AS seller_name,
                                   top.amount AS current_bid, top.bidder_id AS current_bidder_id,
                                   top.anthro_id AS current_bidder_anthro_id,
                                   (SELECT COUNT(*) FROM game_bids WHERE auction_id = au.id) AS bid_count
                            FROM game_auctions au
                            LEFT JOIN game_anthros sa ON sa.id = au.seller_anthro_id
                            LEFT JOIN game_bids top ON top.id = (
                                SELECT id FROM game_bids WHERE auction_id = au.id ORDER BY amount DESC, id DESC LIMIT 1
                            )`;

    /**
     * Open auctions, ending soonest first, with each anthro's public details.
     */
    static open(): Row[] {
        const auctions = Auth.db().all(Auctions.SELECT + " WHERE au.status = 'open' ORDER BY au.ends_at, au.id");
        return auctions.map((auction) => ({ ...auction, anthro: Anthros.findAny(int(auction.anthro_id)) }));
    }

    /**
     * Auctions the user is selling or has bid on, newest first.
     */
    static involving(userId: number): Row[] {
        return Auth.db().all(
            Auctions.SELECT + ` WHERE au.seller_id = ? OR au.id IN (SELECT auction_id FROM game_bids WHERE bidder_id = ?)
                             ORDER BY au.id DESC LIMIT 50`,
            [userId, userId],
        );
    }

    static find(id: number): Row | null {
        const auction = Auth.db().row(Auctions.SELECT + ' WHERE au.id = ?', [id]);
        return auction ? { ...auction, anthro: auction.anthro_id ? Anthros.findAny(int(auction.anthro_id)) : null } : null;
    }

    /**
     * Bids on an auction, highest first. bidder_id is only for the bidder themselves and admins; others see
     * bidders numbered by when they first bid.
     */
    static bids(auctionId: number): Row[] {
        const rows = Auth.db().all(
            `SELECT b.amount, b.created_at, b.bidder_id, u.username AS bidder_name
             FROM game_bids b LEFT JOIN users u ON u.id = b.bidder_id
             WHERE b.auction_id = ? ORDER BY b.id`,
            [auctionId],
        );
        const numbers = new Map<number | string, number>();
        const bids: Row[] = [];
        for (const bid of rows) {
            const key = bid.bidder_id ?? 'deleted';
            if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
            bids.push({ ...bid, bidder_number: numbers.get(key) });
        }
        return bids.reverse();
    }

    /**
     * Time until a UTC datetime, like "2d 5h", "3h 20m" or "12m"; "ended" once it has passed.
     */
    static timeLeft(endsAt: string): string {
        const seconds = strtotimeOrThrow(endsAt + ' UTC') - time();
        return seconds <= 0 ? 'ended'
            : seconds >= 86400 ? intdiv(seconds, 86400) + 'd ' + intdiv(seconds % 86400, 3600) + 'h'
            : seconds >= 3600 ? intdiv(seconds, 3600) + 'h ' + intdiv(seconds % 3600, 60) + 'm'
            : Math.max(1, intdiv(seconds, 60)) + 'm';
    }

    /**
     * The least the next bid can be: the starting bid, or MIN_RAISE_PERCENT over the current bid (at least +1).
     */
    static minimumBid(auction: Row): number {
        if (auction.current_bid === null) {
            return int(auction.starting_bid);
        }
        const current = int(auction.current_bid);
        return Math.max(current + 1, int(Math.ceil(current * (100 + Auctions.MIN_RAISE_PERCENT) / 100)));
    }

    /**
     * Puts an anthro up for auction. sellerId null means the game is selling it. The caller checks that the
     * seller owns it. Returns [auction id, null] or [null, error message].
     */
    static create(anthro: Row, sellerId: number | null, startingBid: number, buyNow: number | null, days: number): [number | null, string | null] {
        if (startingBid < 1) {
            return [null, 'The starting bid must be at least 1 coin.'];
        }
        if (buyNow !== null && buyNow < startingBid) {
            return [null, 'The buy-now price must be at least the starting bid.'];
        }
        if (!Auctions.DURATIONS.includes(days)) {
            return [null, 'Choose how long the auction runs.'];
        }
        // A player is paid into the wallet of the anthro they play, so they need one to sell.
        const sellerAnthroId = sellerId === null ? null : Wallets.anthroFor(sellerId);
        if (sellerId !== null && sellerAnthroId === null) {
            return [null, 'Create or become an anthro on the game home page first; sales are paid into its wallet.'];
        }
        const db = Auth.db();
        db.beginTransaction();
        // (Upstream locks the anthro here so it can't be listed twice at once: SQLite's transaction already does.)
        if (int(db.value("SELECT COUNT(*) FROM game_auctions WHERE anthro_id = ? AND status = 'open'", [anthro.id]))) {
            db.rollBack();
            return [null, `${anthro.name} is already up for auction.`];
        }
        db.run(
            `INSERT INTO game_auctions (anthro_id, anthro_name, seller_id, seller_anthro_id, starting_bid, buy_now, ends_at)
             VALUES (?, ?, ?, ?, ?, ?, ADDDATE(UTC_TIMESTAMP(), ?))`,
            [anthro.id, anthro.name, sellerId, sellerAnthroId, startingBid, buyNow, days],
        );
        const id = db.lastInsertId();
        db.commit();
        return [id, null];
    }

    /**
     * Places a bid. A bid at or above the buy-now price buys the anthro outright.
     * Returns an error message, or null.
     */
    static bid(auctionId: number, user: Row, amount: number): string | null {
        const db = Auth.db();
        db.beginTransaction();
        const [auction, error] = Auctions.lockForBidding(auctionId, user);
        if (error) {
            db.rollBack();
            return error;
        }
        if (auction!.current_bidder_id === user.id) {
            db.rollBack();
            return "You're already the highest bidder.";
        }
        const minimum = Auctions.minimumBid(auction!);
        if (amount < minimum) {
            db.rollBack();
            return 'Bid at least ' + Wallets.format(minimum) + '.';
        }
        if (auction!.buy_now !== null && amount >= auction!.buy_now) {
            db.rollBack();
            return Auctions.buyNow(auctionId, user);
        }
        const bidError = Auctions.placeBid(auction!, user.id, amount, 'Bid');
        if (bidError) {
            db.rollBack();
            return bidError;
        }
        db.commit();
        return null;
    }

    /**
     * Pays the buy-now price and ends the auction at once. Returns an error message, or null.
     */
    static buyNow(auctionId: number, user: Row): string | null {
        const db = Auth.db();
        db.beginTransaction();
        let [auction, error] = Auctions.lockForBidding(auctionId, user);
        if (!error && auction!.buy_now === null) {
            error = `${auction!.anthro_name} doesn't have a buy-now price.`;
        }
        if (!error && auction!.current_bid !== null && auction!.current_bid >= auction!.buy_now) {
            error = 'Bidding has already reached the buy-now price.';
        }
        if (!error) {
            error = Auctions.placeBid(auction!, user.id, int(auction!.buy_now), 'Bought now');
        }
        if (error) {
            db.rollBack();
            return error;
        }
        Auctions.settle(auctionId);
        db.commit();
        return null;
    }

    /**
     * The seller (or an admin) can cancel an auction that has no bids yet. Returns an error message, or null.
     */
    static cancel(auctionId: number, user: Row): string | null {
        const db = Auth.db();
        db.beginTransaction();
        const auction = Auctions.lock(auctionId);
        const error =
            !auction || auction.status !== 'open' ? 'That auction has already ended.'
            : auction.seller_id !== user.id && !Auth.isAdmin(user) ? "That isn't your auction."
            : auction.current_bid !== null ? "Auctions can't be cancelled once someone has bid."
            : null;
        if (error) {
            db.rollBack();
            return error;
        }
        db.run("UPDATE game_auctions SET status = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE id = ?", [auctionId]);
        if (auction!.anthro_id !== null) {
            Auctions.freeIfTheGames(int(auction!.anthro_id));
        }
        db.commit();
        return null;
    }

    /**
     * The game's anthro (no owner) that it didn't sell goes free.
     */
    private static freeIfTheGames(anthroId: number): void {
        Auth.db().run('UPDATE game_anthros SET owner_id = id WHERE id = ? AND owner_id IS NULL', [anthroId]);
    }

    /**
     * The seller (or an admin) ends an auction now: sold to the highest bidder, or unsold if nobody has bid.
     * Returns an error message, or null.
     */
    static closeEarly(auctionId: number, user: Row): string | null {
        const db = Auth.db();
        db.beginTransaction();
        const auction = Auctions.lock(auctionId);
        const error =
            !auction || auction.status !== 'open' ? 'That auction has already ended.'
            : auction.seller_id !== user.id && !Auth.isAdmin(user) ? "That isn't your auction."
            : null;
        if (error) {
            db.rollBack();
            return error;
        }
        Auctions.settle(auctionId);
        db.commit();
        return null;
    }

    /**
     * Ends every auction whose time is up. The game runs this on each request. Returns how many closed.
     */
    static closeDue(): number {
        const db = Auth.db();
        const due = db.column("SELECT id FROM game_auctions WHERE status = 'open' AND ends_at <= UTC_TIMESTAMP()");
        for (const id of due) {
            db.beginTransaction();
            const auction = Auctions.lock(int(id));
            if (auction && auction.status === 'open') {
                Auctions.settle(int(id));
            }
            db.commit();
        }
        return due.length;
    }

    /**
     * Admin: creates count random, fertile, unowned anthros and puts them up for auction by the game.
     * Returns [how many, null] or [null, error message].
     */
    static supply(count: number, startingBid: number, buyNow: number | null, days: number): [number | null, string | null] {
        if (count < 1 || count > 50) {
            return [null, 'Supply between 1 and 50 anthros at a time.'];
        }
        const species = Auth.db().column('SELECT id FROM game_species');
        if (!species.length) {
            return [null, 'Add some species first.'];
        }
        for (let i = 0; i < count; i++) {
            const anthro = Anthros.createRandom(int(species[random_int(0, species.length - 1)]));
            const [, error] = Auctions.create(anthro, null, startingBid, buyNow, days);
            if (error) {
                return [null, error];
            }
        }
        return [count, null];
    }

    /**
     * Locks an open, still-running auction for a bid by user. Returns [auction, null] or [null, error message].
     */
    private static lockForBidding(auctionId: number, user: Row): [Row | null, string | null] {
        const auction = Auctions.lock(auctionId);
        return !auction || auction.status !== 'open' || auction.ends_at <= gmdate('Y-m-d H:i:s')
                ? [null, 'That auction has ended.']
            : auction.seller_id === user.id ? [null, "You can't bid on your own auction."]
            : !auction.anthro_id ? [null, 'That anthro is no longer available.']
            : Wallets.anthroFor(user.id) === null
                ? [null, 'Create or become an anthro on the game home page first; you bid with its wallet.']
            : [auction, null];
    }

    /**
     * Takes the bid from the wallet of the anthro the bidder plays, returns the previous highest bid to the anthro
     * that paid it, and records the bid. Runs inside the caller's transaction. Returns an error message, or null.
     */
    private static placeBid(auction: Row, bidderId: number, amount: number, label: string): string | null {
        const payer = Wallets.anthroFor(bidderId)!;
        if (!Wallets.change(payer, -amount, `${label} on ${auction.anthro_name}`, int(auction.id), bidderId)) {
            return "You don't have enough coins (you have " + Wallets.format(Wallets.balance(payer)) + ').';
        }
        if (auction.current_bidder_anthro_id !== null) {
            Wallets.change(int(auction.current_bidder_anthro_id), int(auction.current_bid),
                `Outbid on ${auction.anthro_name}: bid returned`, int(auction.id));
            Notifications.toAnthro(int(auction.current_bidder_anthro_id),
                `You were outbid on ${auction.anthro_name}; your ` + Wallets.format(int(auction.current_bid))
                + ' came back.', '/game/market/auctions/' + auction.id);
        }
        Auth.db().run('INSERT INTO game_bids (auction_id, bidder_id, anthro_id, amount) VALUES (?, ?, ?, ?)',
            [auction.id, bidderId, payer, amount]);
        return null;
    }

    /**
     * Ends a locked auction: sold to the highest bidder (anthro to them, coins to the seller), or unsold.
     * If the anthro no longer exists, the highest bid is returned instead. Runs inside the caller's transaction.
     */
    private static settle(auctionId: number): void {
        const db = Auth.db();
        const auction = Auctions.lock(auctionId)!;
        let winnerId = auction.current_bidder_id;
        const price: number | null = auction.current_bid === null ? null : int(auction.current_bid);

        const link = '/game/market/auctions/' + auctionId;
        let status: string;
        if (auction.anthro_id === null) {
            if (auction.current_bidder_anthro_id !== null) {
                Wallets.change(int(auction.current_bidder_anthro_id), price!,
                    `Auction for ${auction.anthro_name} cancelled: bid returned`, auctionId);
                Notifications.toAnthro(int(auction.current_bidder_anthro_id),
                    `The auction for ${auction.anthro_name} was cancelled; your bid came back.`, link);
            }
            status = 'cancelled';
            winnerId = null;
        } else if (winnerId === null) {
            status = 'unsold';
            Notifications.toUser(auction.seller_id,
                `Your auction for ${auction.anthro_name} ended with no bids; it stays yours.`, link);
            Auctions.freeIfTheGames(int(auction.anthro_id));
        } else {
            status = 'sold';
            const anthro = Anthros.findAny(int(auction.anthro_id))!;
            // The anthro that won it owns it now. Any debt was owed to the previous owner; a free anthro loses its
            // title, land and anthros to its new owner.
            const buyerId = int(auction.current_bidder_anthro_id);
            db.run('UPDATE game_anthros SET owner_id = ?, debt = NULL, debt_rate = 0, debt_since = NULL WHERE id = ?',
                [buyerId, auction.anthro_id]);
            Land.forfeit(anthro, buyerId);
            db.run(
                'INSERT INTO game_transfers (anthro_id, from_owner_id, to_owner_id, transferred_by, note) VALUES (?, ?, ?, ?, ?)',
                [auction.anthro_id, anthro.owner_id, buyerId, winnerId, 'Sold at auction for ' + Wallets.format(price!)],
            );
            if (auction.seller_anthro_id !== null) {
                Wallets.change(int(auction.seller_anthro_id), price!, `Sold ${auction.anthro_name} at auction`, auctionId);
                Notifications.toAnthro(int(auction.seller_anthro_id),
                    `You sold ${auction.anthro_name} for ` + Wallets.format(price!) + '.', link);
            }
            Notifications.toAnthro(int(auction.current_bidder_anthro_id),
                `You won ${auction.anthro_name} for ` + Wallets.format(price!) + '.', '/game/assets/' + auction.anthro_id);
            if (anthro.player_id !== null) {
                // Tell whoever plays the sold anthro who owns them now.
                const buyer = Anthros.findAny(buyerId);
                Notifications.toAnthro(int(auction.anthro_id),
                    'You were sold at auction to ' + (buyer?.name ?? 'another anthro') + '.', '/game/assets/' + auction.anthro_id);
            }
        }
        db.run(
            'UPDATE game_auctions SET status = ?, winner_id = ?, final_price = ?, closed_at = UTC_TIMESTAMP() WHERE id = ?',
            [status, status === 'sold' ? winnerId : null, status === 'sold' ? price : null, auctionId],
        );
    }

    private static lock(auctionId: number): Row | null {
        // (Upstream first locks the row with SELECT ... FOR UPDATE: SQLite's transaction already does.)
        return Auth.db().row(Auctions.SELECT + ' WHERE au.id = ?', [auctionId]);
    }
}
