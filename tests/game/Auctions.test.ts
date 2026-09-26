// Upstream: tests/Game/AuctionsTest.php
import { beforeEach, describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import type { Row } from '../../src/db/Db';
import { gmdate, time } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Auctions } from '../../src/game/Auctions';
import { admin, anthro, coins, db, notificationsFor, player, playerAnthro, scalar, setCoins } from '../TestCase';

describe('Auctions', () => {
    let seller: User;
    let sellerAnthro: Row;
    let lot: Row;

    beforeEach(() => {
        seller = player('seller');
        sellerAnthro = playerAnthro(seller);
        lot = anthro({ owner: seller, name: 'Lot' });
    });

    function bidder(name: string, amount = 1000): [User, Row] {
        const user = player(name);
        const a = playerAnthro(user);
        setCoins(a.id, amount);
        return [user, a];
    }

    function create(buyNow: number | null = null, start = 10): number {
        const [id, error] = Auctions.create(lot, seller.id, start, buyNow, 3);
        expect(error).toBeNull();
        return id!;
    }

    test('create validates', () => {
        expect(Auctions.create(lot, seller.id, 0, null, 1)).toEqual([null, 'The starting bid must be at least 1 coin.']);
        expect(Auctions.create(lot, seller.id, 10, 5, 1)).toEqual([null, 'The buy-now price must be at least the starting bid.']);
        expect(Auctions.create(lot, seller.id, 10, null, 2)).toEqual([null, 'Choose how long the auction runs.']);
        const noAnthro = player('noanthro');
        expect(Auctions.create(lot, noAnthro.id, 10, null, 1)[1]!.startsWith('Create or become an anthro')).toBe(true);
        create();
        expect(Auctions.create(lot, seller.id, 10, null, 1)).toEqual([null, 'Lot is already up for auction.']);
    });

    test('find open involving', () => {
        const id = create(50);
        const auction = Auctions.find(id)!;
        expect(auction.anthro_name).toBe('Lot');
        expect(auction.seller_name).toBe('SellerAnthro'); // Sellers are named by anthro, never by player.
        expect(auction.current_bid).toBeNull();
        expect(auction.anthro.id).toBe(lot.id);
        expect(Auctions.open().map((a) => a.id)).toEqual([id]);
        expect(Auctions.involving(seller.id).map((a) => a.id)).toEqual([id]);
        expect(Auctions.find(999999)).toBeNull();
    });

    test('bidding takes coins and returns them when outbid', () => {
        const [alice, aliceAnthro] = bidder('alice');
        const [bob, bobAnthro] = bidder('bobby');
        const id = create();

        expect(Auctions.bid(id, alice, 9)).toBe('Bid at least 10 coins.');
        expect(Auctions.bid(id, alice, 100)).toBeNull();
        expect(coins(aliceAnthro.id)).toBe(900);
        expect(Auctions.bid(id, alice, 200)).toBe("You're already the highest bidder.");
        expect(Auctions.minimumBid(Auctions.find(id)!)).toBe(105);
        expect(Auctions.bid(id, bob, 104)).toBe('Bid at least 105 coins.');
        expect(Auctions.bid(id, bob, 105)).toBeNull();
        expect(coins(aliceAnthro.id)).toBe(1000); // Outbid: coins returned.
        expect(coins(bobAnthro.id)).toBe(895);
        expect(notificationsFor(aliceAnthro.id)[0].startsWith('You were outbid on Lot')).toBe(true);
        expect(Auctions.involving(alice.id).map((a) => a.id)).toEqual([id]);
    });

    test('bid refusals', () => {
        const [alice] = bidder('alice', 50);
        const id = create();
        expect(Auctions.bid(id, seller, 20)).toBe("You can't bid on your own auction.");
        expect(Auctions.bid(999999, alice, 20)).toBe('That auction has ended.');
        expect(Auctions.bid(id, player('nobody'), 20)!.startsWith('Create or become an anthro')).toBe(true);
        expect(Auctions.bid(id, alice, 60)).toBe("You don't have enough coins (you have 50 coins).");
        // Upstream: UTC_TIMESTAMP() - INTERVAL 1 MINUTE
        db().run("UPDATE game_auctions SET ends_at = datetime(UTC_TIMESTAMP(), '-1 minute')");
        expect(Auctions.bid(id, alice, 20)).toBe('That auction has ended.');
    });

    test('buy now sells at once', () => {
        const [alice, aliceAnthro] = bidder('alice');
        const id = create(200);
        expect(Auctions.buyNow(id, alice)).toBeNull();
        const auction = Auctions.find(id)!;
        expect(auction.status).toBe('sold');
        expect(Number(auction.final_price)).toBe(200);
        expect(Anthros.findAny(lot.id)!.owner_id).toBe(aliceAnthro.id); // The winning anthro owns it.
        expect(coins(aliceAnthro.id)).toBe(800);
        expect(coins(sellerAnthro.id)).toBe(200);
        expect(Anthros.transfers(lot.id)[0].note).toBe('Sold at auction for 200 coins');
    });

    test('a bid at the buy now price buys it', () => {
        const [alice] = bidder('alice');
        const id = create(200);
        expect(Auctions.bid(id, alice, 250)).toBeNull();
        expect(Auctions.find(id)!.status).toBe('sold');
        expect(Number(Auctions.find(id)!.final_price)).toBe(200);
    });

    test('buy now refusals', () => {
        const [alice] = bidder('alice');
        const [poor] = bidder('poor', 5);
        const noPrice = create();
        expect(Auctions.buyNow(noPrice, alice)).toBe("Lot doesn't have a buy-now price.");
        Auctions.cancel(noPrice, seller);
        const priced = create(100);
        expect(Auctions.buyNow(priced, seller)).toBe("You can't bid on your own auction.");
        expect(Auctions.buyNow(priced, poor)).toBe("You don't have enough coins (you have 5 coins).");
        expect(Auctions.find(priced)!.status).toBe('open');
    });

    test('cancel', () => {
        const [alice] = bidder('alice');
        const boss = admin();
        const id = create();
        expect(Auctions.cancel(id, alice)).toBe("That isn't your auction.");
        expect(Auctions.cancel(id, seller)).toBeNull();
        expect(Auctions.find(id)!.status).toBe('cancelled');
        expect(Auctions.cancel(id, seller)).toBe('That auction has already ended.');

        const again = create();
        Auctions.bid(again, alice, 20);
        expect(Auctions.cancel(again, boss)).toBe("Auctions can't be cancelled once someone has bid.");
    });

    test('close early', () => {
        const [alice, aliceAnthro] = bidder('alice');
        const unsold = create();
        expect(Auctions.closeEarly(unsold, seller)).toBeNull();
        expect(Auctions.find(unsold)!.status).toBe('unsold');
        expect(Anthros.findAny(lot.id)!.owner_id).toBe(sellerAnthro.id);

        const sold = create();
        Auctions.bid(sold, alice, 30);
        expect(Auctions.closeEarly(sold, alice)).toBe("That isn't your auction.");
        expect(Auctions.closeEarly(sold, admin())).toBeNull();
        expect(Auctions.find(sold)!.status).toBe('sold');
        expect(Anthros.findAny(lot.id)!.owner_id).toBe(aliceAnthro.id);
    });

    test('close due settles expired auctions', () => {
        const [alice] = bidder('alice');
        const id = create();
        Auctions.bid(id, alice, 40);
        expect(Auctions.closeDue()).toBe(0);
        // Upstream: UTC_TIMESTAMP() - INTERVAL 1 SECOND
        db().run("UPDATE game_auctions SET ends_at = datetime(UTC_TIMESTAMP(), '-1 second')");
        expect(Auctions.closeDue()).toBe(1);
        expect(Auctions.find(id)!.status).toBe('sold');
    });

    test('selling a played anthro tells its player', () => {
        const [alice] = bidder('alice');
        const bob = player('bobby');
        const played = playerAnthro(bob, { owner: seller, name: 'Played' });
        const [id] = Auctions.create(played, seller.id, 10, 20, 1);
        Auctions.buyNow(id!, alice);
        expect(notificationsFor(played.id)).toContain('You were sold at auction to AliceAnthro.');
    });

    test('settling after the anthro is gone refunds the bid', () => {
        const [alice, aliceAnthro] = bidder('alice');
        const id = create();
        Auctions.bid(id, alice, 50);
        db().run('DELETE FROM game_anthros WHERE id = ?', [lot.id]);
        db().run("UPDATE game_auctions SET ends_at = datetime(UTC_TIMESTAMP(), '-1 second')");
        Auctions.closeDue();
        expect(Auctions.find(id)!.status).toBe('cancelled');
        expect(coins(aliceAnthro.id)).toBe(1000);
    });

    test('bids number bidders anonymously', () => {
        const [alice] = bidder('alice');
        const [bob] = bidder('bobby');
        const id = create();
        Auctions.bid(id, alice, 10);
        Auctions.bid(id, bob, 20);
        Auctions.bid(id, alice, 30);
        const bids = Auctions.bids(id);
        expect(bids.map((b) => Number(b.amount))).toEqual([30, 20, 10]);
        expect(bids.map((b) => b.bidder_number)).toEqual([1, 2, 1]);
    });

    test('time left', () => {
        expect(Auctions.timeLeft(gmdate('Y-m-d H:i:s', time() - 5))).toBe('ended');
        expect(Auctions.timeLeft(gmdate('Y-m-d H:i:s', time() + 2 * 86400 + 3 * 3600 + 100))).toBe('2d 3h');
        expect(Auctions.timeLeft(gmdate('Y-m-d H:i:s', time() + 4 * 3600 + 10 * 60 + 30))).toBe('4h 10m');
        expect(Auctions.timeLeft(gmdate('Y-m-d H:i:s', time() + 12 * 60 + 30))).toBe('12m');
        expect(Auctions.timeLeft(gmdate('Y-m-d H:i:s', time() + 20))).toBe('1m');
    });

    test('minimum bid', () => {
        expect(Auctions.minimumBid({ current_bid: null, starting_bid: 10 })).toBe(10);
        expect(Auctions.minimumBid({ current_bid: 100, starting_bid: 10 })).toBe(105);
        expect(Auctions.minimumBid({ current_bid: 1, starting_bid: 1 })).toBe(2); // Always at least +1.
    });

    test('supply', () => {
        expect(Auctions.supply(0, 10, null, 1)).toEqual([null, 'Supply between 1 and 50 anthros at a time.']);
        expect(Auctions.supply(3, 10, 50, 1)).toEqual([3, null]);
        const game = Auctions.open().filter((a) => a.seller_id === null);
        expect(game).toHaveLength(3);
        expect(Auctions.supply(1, 10, 5, 1)).toEqual([null, 'The buy-now price must be at least the starting bid.']);
    });

    test("the game's unsold anthros go free", () => {
        Auctions.supply(2, 10, null, 1);
        const ids = Auctions.open().map((a) => a.id);
        const anthros = ids.map((id) => Number(Auctions.find(id)!.anthro_id));
        for (const a of anthros) {
            expect(Anthros.findAny(a)!.owner_id).toBeNull(); // The game's while for sale.
            expect(Anthros.isFree(Anthros.findAny(a))).toBe(false);
        }
        Auctions.cancel(ids[0], admin());
        db().run("UPDATE game_auctions SET ends_at = datetime(UTC_TIMESTAMP(), '-1 second')");
        Auctions.closeDue();
        for (const a of anthros) {
            expect(Anthros.isFree(Anthros.findAny(a))).toBe(true); // Cancelled or unsold: free.
        }
    });

    test('game sales money leaves the game', () => {
        const [alice, aliceAnthro] = bidder('alice');
        Auctions.supply(1, 10, 25, 1);
        const id = Number(scalar('SELECT id FROM game_auctions WHERE seller_id IS NULL'));
        expect(Auctions.buyNow(id, alice)).toBeNull();
        expect(coins(aliceAnthro.id)).toBe(975);
        expect(Auctions.find(id)!.anthro.owner_id).toBe(aliceAnthro.id);
    });
});
