// Upstream: tests/Game/WalletsTest.php
import { describe, expect, test } from 'vitest';
import { Auctions } from '../../src/game/Auctions';
import { Wallets } from '../../src/game/Wallets';
import { admin, anthro, db, genderId, player, playerAnthro, setCoins, speciesId } from '../TestCase';

describe('Wallets', () => {
    test('new anthros get a starting balance', () => {
        db().run(`INSERT INTO game_anthros (name, gender_id, species_id) VALUES ('Fresh', ${genderId('Male')}, ${speciesId()})`);
        const id = db().lastInsertId();
        const balance = Wallets.balance(id);
        expect(balance).toBeGreaterThanOrEqual(Wallets.STARTING_MIN);
        expect(balance).toBeLessThanOrEqual(Wallets.STARTING_MAX);
        const ledger = Wallets.ledger(id);
        expect(ledger).toHaveLength(1);
        expect(ledger[0].reason).toBe('Starting balance');
        expect(Number(ledger[0].amount)).toBe(balance);
    });

    test('anthro for', () => {
        const alice = player('alice');
        expect(Wallets.anthroFor(alice.id)).toBeNull();
        const a = playerAnthro(alice);
        expect(Wallets.anthroFor(alice.id)).toBe(a.id);
    });

    test('change records the ledger and refuses overdrafts', () => {
        const a = anthro();
        expect(Wallets.change(a.id, 50, 'Gift')).toBe(true);
        expect(Wallets.change(a.id, -51, 'Too much')).toBe(false);
        expect(Wallets.balance(a.id)).toBe(50);
        expect(Wallets.change(a.id, -60, 'Allowed', null, null, true)).toBe(true);
        expect(Wallets.balance(a.id)).toBe(-10);
        const ledger = Wallets.ledger(a.id);
        expect(ledger.map((l) => l.reason).slice(0, 2)).toEqual(['Allowed', 'Gift']);
        expect(Number(ledger[0].balance_after)).toBe(-10);
    });

    test('balance of an anthro without a wallet is zero', () => {
        const a = anthro();
        db().run('DELETE FROM game_wallets WHERE anthro_id = ?', [a.id]);
        expect(Wallets.balance(a.id)).toBe(0);
    });

    test('adjust', () => {
        const boss = admin();
        const a = anthro();
        expect(Wallets.adjust(a.id, 0, 'x', boss.id)).toBe('Enter a non-zero amount.');
        expect(Wallets.adjust(a.id, 5, ' ', boss.id)).toBe('Give a reason (up to 200 characters).');
        expect(Wallets.adjust(999999, 5, 'x', boss.id)).toBe('That anthro no longer exists.');
        expect(Wallets.adjust(a.id, -5, 'x', boss.id)).toBe('That would leave the balance below zero.');
        expect(Wallets.adjust(a.id, 25, 'Prize', boss.id)).toBeNull();
        const entry = Wallets.ledger(a.id)[0];
        expect(entry.reason).toBe('Admin: Prize');
        expect(entry.created_by_name).toBe('boss');
    });

    test('held counts only winning bids in open auctions', () => {
        const seller = player('seller');
        playerAnthro(seller);
        const alice = player('alice');
        const bidder = playerAnthro(alice);
        setCoins(bidder.id, 500);
        const lot = anthro({ owner: seller });
        const [auction] = Auctions.create(lot, seller.id, 10, null, 1);
        Auctions.bid(auction!, alice, 30);
        expect(Wallets.held(bidder.id)).toBe(30);
        expect(Wallets.balance(bidder.id)).toBe(470);
    });

    test('all lists played anthros and ones with coins', () => {
        const alice = player('alice');
        const played = playerAnthro(alice);
        const rich = anthro({ name: 'Rich' });
        setCoins(rich.id, 5);
        anthro({ name: 'Broke' });
        const rows = Wallets.all();
        expect(rows.map((r) => r.name)).toEqual(['Rich', played.name]);
        expect(rows[1].player_name).toBe('alice');
        expect(rows[0].held).toBe(0);
    });

    test('format', () => {
        expect(Wallets.format(1234)).toBe('1,234 coins');
        expect(Wallets.format(-5)).toBe('-5 coins');
    });
});
