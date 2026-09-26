// Upstream: tests/Game/LandTest.php
import { describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Land } from '../../src/game/Land';
import { Ranks } from '../../src/game/Ranks';
import { admin, anthro, baronyId, coins, db, notificationsFor, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

describe('Land', () => {
    const landOf = (anthroId: number): number[] => Land.parcels(anthroId).map((p) => Number(p.acres));

    const buyer = (name: string, amount = 100000): [User, Row] => {
        const u = player(name);
        const a = playerAnthro(u);
        setCoins(a.id, amount);
        return [u, a];
    };

    test('formatting', () => {
        expect(Land.acres(0.05)).toBe('0.05 acres');
        expect(Land.acres(1)).toBe('1 acre');
        expect(Land.acres('1.50')).toBe('1.5 acres');
        expect(Land.acres(1200)).toBe('1,200 acres');
        expect(Land.hundredths('10.5')).toBe(1050);
        expect(Land.hundredths('0.1')).toBe(10);
        expect(Land.hundredths('0')).toBeNull();
        expect(Land.hundredths('1.234')).toBeNull();
        expect(Land.hundredths('-2')).toBeNull();
    });

    test('can trade needs a played free anthro', () => {
        const [, free] = buyer('alice');
        expect(Land.canTrade(free)).toBe(true);
        expect(Land.canTrade(anthro()), 'Unplayed.').toBe(false);
        expect(Land.canTrade(playerAnthro(player('bobby'), { owner: player('carol') }))).toBe(false);
        expect(Land.canTrade(null)).toBe(false);
    });

    test('supply and buy from the land office', () => {
        const boss = admin();
        const [alice, me] = buyer('alice', 12000);
        expect(Land.supply(0, 1, 10, boss.id, baronyId())).toEqual([null, 'Supply 1-50 lots at a time.']);
        expect(Land.supply(1, 1001, 10, boss.id, baronyId())).toEqual([null, 'Each lot must be 0.01 acres to 1,000 acres.']);
        expect(Land.supply(1, 1, 0, boss.id, baronyId())).toEqual([null, 'The price must be at least 1 coin.']);
        expect(Land.supply(2, 3, 5000, boss.id, baronyId())).toEqual([2, null]);
        const open = Land.open();
        expect(open).toHaveLength(2);
        expect(Number(open[0].from_game)).toBe(1);

        expect(Land.buy(alice, Number(open[0].id))).toBeNull();
        expect(landOf(me.id)).toEqual([3.0]);
        expect(Land.totalAcres(me.id)).toBe(3.0);
        expect(coins(me.id)).toBe(7000);
        expect(Land.buy(alice, Number(open[0].id))).toBe('That land is no longer for sale.');
        expect(Land.recent()).toHaveLength(1);
        setCoins(me.id, 4999);
        expect(Land.buy(alice, Number(open[1].id))).toBe('You need 5,000 coins but have 4,999 coins.');
    });

    test('buy refusals', () => {
        const boss = admin();
        Land.supply(1, 1, 500, boss.id, baronyId());
        const listing = Number(Land.open()[0].id);
        const [poor] = buyer('poor', 10);
        expect(Land.buy(poor, listing)).toBe('You need 500 coins but have 10 coins.');
        expect(Land.buy(player('nobody'), listing)!.startsWith('Create or become an anthro first')).toBe(true);
        const slave = player('slave');
        playerAnthro(slave, { owner: poor, name: 'Slave' });
        expect(Land.buy(slave, listing)).toBe("Only an anthro that owns itself can buy land, and Slave doesn't.");
    });

    test('sell splits and pays the seller', () => {
        const boss = admin();
        const [alice, aliceAnthro] = buyer('alice');
        const [bob, bobAnthro] = buyer('bobby');
        Land.supply(1, 5, 100, boss.id, baronyId());
        Land.buy(alice, Number(Land.open()[0].id));
        const parcel = Number(Land.parcels(aliceAnthro.id)[0].id);
        setCoins(aliceAnthro.id, 0);

        expect(Land.sell(alice, parcel, 6, 10)).toBe('Sell between 0.01 acres and 5 acres.');
        expect(Land.sell(alice, parcel, 'lots', 10)).toBe('Sell between 0.01 acres and 5 acres.');
        expect(Land.sell(alice, parcel, 2, 0)).toBe('The price must be at least 1 coin.');
        expect(Land.sell(bob, parcel, 2, 10)).toBe("That isn't your land.");
        expect(Land.sell(alice, parcel, '2.5', 700)).toBeNull();
        expect(landOf(aliceAnthro.id)).toEqual([2.5, 2.5]);
        const listing = Land.open()[0];
        expect(Number(listing.acres)).toBe(2.5);
        expect(Land.sell(alice, Number(listing.parcel_id), 1, 5)).toBe('That lot is already for sale.');
        expect(Land.buy(alice, Number(listing.id))).toBe("That's your own listing.");

        expect(Land.buy(bob, Number(listing.id))).toBeNull();
        expect(coins(aliceAnthro.id)).toBe(700);
        expect(landOf(bobAnthro.id)).toEqual([2.5]);
        expect(notificationsFor(aliceAnthro.id)).toEqual(['BobbyAnthro bought your lot #' + listing.parcel_id + ' (2.5 acres) for 700 coins.']);
    });

    test('cancel', () => {
        const boss = admin();
        const [alice, me] = buyer('alice');
        const [bob] = buyer('bobby');
        Land.supply(1, 2, 10, boss.id, baronyId());
        Land.buy(alice, Number(Land.open()[0].id));
        Land.sell(alice, Number(Land.parcels(me.id)[0].id), 2, 50);
        const listing = Number(Land.open()[0].id);
        expect(Land.cancel(bob, listing)).toBe("That isn't your listing.");
        expect(Land.cancel(alice, listing)).toBeNull();
        expect(Land.open()).toEqual([]);
        expect(landOf(me.id)).toEqual([2.0]);
        expect(Land.cancel(alice, listing)).toBe('That land is no longer for sale.');

        Land.sell(alice, Number(Land.parcels(me.id)[0].id), 2, 50);
        expect(Land.cancel(boss, Number(Land.open()[0].id))).toBeNull();
        expect(notificationsFor(me.id)[0]).toContain('An admin took your lot');
    });

    test('relist and all', () => {
        const boss = admin();
        const [alice, me] = buyer('alice');
        Land.supply(1, 1, 10, boss.id, baronyId());
        Land.cancel(boss, Number(Land.open()[0].id));
        const officeParcel = Number(Land.all()[0].id);
        expect(Land.relist(officeParcel, 0, boss.id)).toBe('The price must be at least 1 coin.');
        expect(Land.relist(officeParcel, 99, boss.id)).toBeNull();
        expect(Land.relist(officeParcel, 99, boss.id)).toBe('That lot is already for sale.');
        Land.buy(alice, Number(Land.open()[0].id));
        expect(Land.relist(officeParcel, 99, boss.id)).toBe('Only land office lots can be listed here.');
        expect(Land.all(), 'The land office holds none now.').toEqual([]);
        const row = Land.all(baronyId())[0];
        expect(row.holder_name).toBe(me.name);
        expect(row.player_name).toBe('alice');
        expect(Land.listing(Number(scalar('SELECT MIN(id) FROM game_land_listings')))).not.toBeNull();
        expect(Land.listing(999999)).toBeNull();
    });

    test('forfeit gives land to the new owner\'s anthro', () => {
        const boss = admin();
        const [alice, aliceAnthro] = buyer('alice');
        const [, bobAnthro] = buyer('bobby');
        Land.supply(2, 2, 10, boss.id, baronyId());
        for (const listing of Land.open()) {
            Land.buy(alice, Number(listing.id));
        }
        Land.sell(alice, Number(Land.parcels(aliceAnthro.id)[0].id), 1, 5);

        Anthros.transfer(aliceAnthro, bobAnthro.id, alice.id);
        expect(Land.totalAcres(aliceAnthro.id)).toBe(0.0);
        expect(Land.totalAcres(bobAnthro.id)).toBe(4.0);
        expect(Land.open(), 'Its listings are cancelled.').toEqual([]);
        expect(notificationsFor(bobAnthro.id)).toContain(`${aliceAnthro.name}'s land (4 acres) is yours now.`);
        expect(Land.forfeit(refresh(aliceAnthro), bobAnthro.id), 'No longer free: nothing to forfeit.').toBe(0.0);
    });

    test('forfeit to the crown goes to the liege or the next rank up', () => {
        const boss = admin();
        const [alice, knight] = buyer('alice');
        db().run('UPDATE game_anthros SET title_rank = ? WHERE id = ?', [Ranks.KNIGHT, knight.id]);
        const baron = anthro({ name: 'Baron', title_rank: 4, title_since: '2025-01-01' });
        const liege = anthro({ name: 'Liege', title_rank: 6, title_since: '2025-01-01' });
        Land.supply(1, 3, 10, boss.id, baronyId());
        Land.buy(alice, Number(Land.open()[0].id));

        // Forfeit with no new owner, and no liege: the next rank up that's held (baron, skipping baronet).
        Land.forfeit(refresh(knight), null);
        expect(Land.totalAcres(baron.id)).toBe(3.0);
        expect(refresh(knight).title_rank, 'Losing freedom loses the title.').toBeNull();

        // With a liege that outranks it: the liege.
        db().run('UPDATE game_anthros SET liege_id = ? WHERE id = ?', [liege.id, baron.id]);
        const parcel = Number(Land.parcels(baron.id)[0].id);
        expect(Land.seize(parcel)).toBeNull();
        expect(Land.totalAcres(liege.id)).toBe(3.0);
        expect(notificationsFor(liege.id)[0]).toContain('was forfeit to the crown and granted to you');
    });

    test('forfeit with nobody above goes to the land office', () => {
        const king = anthro({ name: 'King', title_rank: Ranks.KING });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 4)', [king.id]);
        const parcel = db().lastInsertId();
        expect(Land.seize(parcel)).toBeNull();
        expect(Land.all()[0].anthro_id).toBeNull();
        expect(Land.seize(parcel)).toBe('That lot belongs to the land office already.');
    });

    test('split and merge', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const barony = baronyId();
        const insert = 'INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (?, ?, ?, ?)';
        db().run(insert, [me.id, 10, barony, null]);
        const parcel = db().lastInsertId();

        const [created, error] = Land.split(alice, parcel, '3.25');
        const newId = created!;
        expect(error).toBeNull();
        // (Upstream compares the DECIMAL strings '6.75' and '3.25'.)
        expect([scalar('SELECT acres FROM game_parcels WHERE id = ?', [parcel]),
            scalar('SELECT acres FROM game_parcels WHERE id = ?', [newId])]).toEqual([6.75, 3.25]);
        expect(Number(scalar('SELECT barony_id FROM game_parcels WHERE id = ?', [newId])), 'It lies where it was.').toBe(barony);
        expect(Land.split(alice, parcel, '6.75')).toEqual([null, 'Split off 0.01 acres to 6.74 acres.']);
        expect(Land.split(player('bobby'), parcel, 1)).toEqual([null, "That isn't your land."]);

        // Merging: same owner and place, nothing for sale.
        expect(Land.merge(alice, [parcel])).toEqual([null, 'Choose at least two lots to merge.']);
        db().run(insert, [me.id, 2, null, null]);
        const elsewhere = db().lastInsertId();
        expect(Land.merge(alice, [parcel, elsewhere]))
            .toEqual([null, 'Only lots in the same barony (and the same village, town, city or expanse) can be merged.']);
        expect(Land.sell(alice, newId, '3.25', 50)).toBeNull();
        expect(Land.merge(alice, [parcel, newId])).toEqual([null, `Lot #${newId} is for sale: take it off the market first.`]);
        expect(Land.cancel(alice, Number(scalar('SELECT id FROM game_land_listings')))).toBeNull();
        expect(Land.merge(alice, [newId, parcel])).toEqual([parcel, null]);
        // (Upstream: the DECIMAL string '10.00'.)
        expect(scalar('SELECT acres FROM game_parcels WHERE id = ?', [parcel])).toBe(10);
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE id = ?', [newId]))).toBe(0);
        expect(Number(scalar('SELECT parcel_id FROM game_land_listings')), 'Its past listing moves with it.').toBe(parcel);
        expect(Land.split(alice, parcel, '9.99')[1]).toBeNull();
        expect(Land.split(alice, parcel, '0.01')).toEqual([null, 'A lot of 0.01 acres can\'t be split.']);
    });

    test('admins reshape any land', () => {
        const boss = admin();
        Land.supply(2, 3, 10, boss.id, baronyId());
        const ids = db().column('SELECT id FROM game_parcels ORDER BY id').map(Number);
        expect(Land.merge(boss, ids)).toEqual([null, `Lot #${ids[0]} is for sale: take it off the market first.`]);
        db().run("UPDATE game_land_listings SET status = 'cancelled'");
        expect(Land.merge(boss, ids)).toEqual([ids[0], null]);
        expect(Land.split(boss, ids[0], 5)[1]).toBeNull();
        expect(Land.split(player('alice'), ids[0], 1), 'The land office\'s is not a player\'s.').toEqual([null, "That isn't your land."]);
    });
});
