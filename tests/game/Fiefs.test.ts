// Upstream: tests/Game/FiefsTest.php
import { describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import { gmdate, strtotimeOrThrow, ucfirst } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Aging } from '../../src/game/Aging';
import { Fiefs } from '../../src/game/Fiefs';
import { Goods } from '../../src/game/Goods';
import { Land } from '../../src/game/Land';
import { Ranks } from '../../src/game/Ranks';
import { Schedules } from '../../src/game/Schedules';
import { anthro, coins, db, notificationsFor, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

describe('Fiefs', () => {
    const lot = (anthroId: number, acres: number): number => {
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, ?)', [anthroId, acres]);
        return db().lastInsertId();
    };

    const playing = (name: string, fields: Row = {}): [User, Row] => {
        const u = player(name);
        return [u, playerAnthro(u, { name: ucfirst(name), ...fields })];
    };

    // Lord grants acres of lot lotId to the vassal at rate%, and the vassal accepts.
    const grant = (lordUser: User, lotId: number, acres: string, vassalUser: User, vassal: Row, rate = 10): void => {
        const [, error] = Fiefs.offerGrant(lordUser, lotId, acres, vassal.id, rate);
        expect(error).toBeNull();
        expect(Fiefs.answer(vassalUser, Fiefs.offers(vassal.id).received[0].id, true)).toBeNull();
    };

    test('granting a fief', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, bobs] = playing('bobby');
        const lotId = lot(lord.id, 100);
        expect(Fiefs.offerGrant(alice, lotId, '', bobs.id, 60)).toEqual([null, 'The tax is 0 to 50% of what they produce.']);
        expect(Fiefs.offerGrant(alice, lotId, '', anthro({ name: 'Bobby', title_rank: 5 }).id, 10))
            .toEqual([null, "Bobby outranks you, so can't be your vassal."]);
        grant(alice, lotId, '30', bob, bobs, 15);

        const vassal = refresh(bobs);
        expect([vassal.liege_id, vassal.tax_rate], 'Sworn to the lord, on its terms.').toEqual([lord.id, 15]);
        const fief = Fiefs.heldBy(vassal.id);
        expect([Number(fief[0].acres), fief[0].held_of, fief[0].tenure]).toEqual([30.0, lord.id, String(lord.id)]);
        expect(Land.totalAcres(lord.id), 'Split off the lot.').toBe(70.0);
        expect(Ranks.acresHeld(refresh(lord)).total, 'It still counts toward the lord.').toBe(100.0);
        expect(Fiefs.vassalsOf(lord.id).map((v) => v.id)).toEqual([vassal.id]);
        expect(Land.sell(bob, fief[0].id, '30', 100)).toBe("That lot is a fief: it can't be sold, only given back.");
    });

    test('anthros nobody plays answer by the rate', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const lotId = lot(lord.id, 100);
        const npc = anthro({ name: 'Tenant' });
        expect(Fiefs.offerGrant(alice, lotId, '10', npc.id, 30)).toEqual(['Tenant turned down 10 acres at 30% tax.', null]);
        expect(Fiefs.offerGrant(alice, lotId, '10', npc.id, 20)).toEqual(['Tenant accepted 10 acres at 20% tax, and is sworn to you.', null]);
        expect(Fiefs.offerRate(alice, npc.id, 30)).toEqual(['Tenant refused 30% tax.', null]);
        expect(Fiefs.offerRate(alice, npc.id, 5)).toEqual(['Tenant agreed to 5% tax.', null]);
        expect(refresh(npc).tax_rate).toBe(5);
    });

    test('taxes are owed and collected', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, bobs] = playing('bobby');
        grant(alice, lot(lord.id, 50), '', bob, bobs, 50);
        // A day's work as a Weaver (2 coins) and a slave foraging (1-3 food) for Bobby.
        const slave = anthro({ owner: bob, name: 'Serf' });
        const weaver = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Weaver'"));
        db().run("INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, 1 FROM game_skills WHERE name = 'Weaving'", [bobs.id]);
        Schedules.planDay(bob, refresh(bobs), gmdate('Y-m-d'), 'work', 'o:' + weaver);
        Schedules.planDay(bob, slave, gmdate('Y-m-d'), 'work', 'f');
        Schedules.runToday();
        const food = Schedules.today().gathered.get(bobs.id)!.food;
        expect(Fiefs.assessToday()).toBe(1);
        const owed = (2 + food * 2) / 2.0;
        expect(Number(refresh(bobs).tax_balance), 'Half of 2 coins and the food, at 2 coins each.').toBe(owed);

        // Tax day: coins first, then food beyond a week's for the household (2 anthros: 14), then lumber.
        setCoins(bobs.id, 1);
        db().run("UPDATE game_goods SET quantity = 15 WHERE anthro_id = ? AND good = 'food'", [bobs.id]);
        const lordFood = Goods.amount(lord.id);
        Fiefs.collectDue();
        const vassal = refresh(bobs);
        expect(coins(vassal.id)).toBe(0);
        expect(Goods.amount(vassal.id), 'A week of food kept back.').toBe(14);
        expect(Goods.amount(lord.id)).toBe(lordFood + 1);
        expect(Math.max(0.0, Number(vassal.tax_balance))).toBe(Math.max(0.0, owed - 3));
        if (owed > 3) {
            expect(vassal.tax_overdue_since, "What couldn't be paid is overdue.").toBe(gmdate('Y-m-d'));
        }
    });

    test('paying off and ahead', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, bobs] = playing('bobby');
        grant(alice, lot(lord.id, 50), '', bob, bobs);
        db().run('UPDATE game_anthros SET tax_balance = 5, tax_overdue_since = SUBDATE(UTC_DATE(), 3) WHERE id = ?', [bobs.id]);
        setCoins(bobs.id, 20);
        expect(Fiefs.pay(bob, 2)).toBeNull();
        let vassal = refresh(bobs);
        expect([Number(vassal.tax_balance), vassal.tax_overdue_since], 'Still behind.').toEqual([3.0, gmdate('Y-m-d', strtotimeOrThrow('-3 days'))]);
        expect(Fiefs.pay(bob, 10)).toBeNull();
        vassal = refresh(bobs);
        expect([Number(vassal.tax_balance), vassal.tax_overdue_since], 'Paid off, and 7 ahead.').toEqual([-7.0, null]);
        expect(coins(lord.id)).toBe(12);
        expect(Fiefs.pay(bob, 50)).toBe('You have 8 coins.');

        // Credit covers what's owed before anything is collected.
        db().run('UPDATE game_anthros SET tax_balance = tax_balance + 4 WHERE id = ?', [vassal.id]);
        expect(Fiefs.collectDue()).toBe(0);
    });

    test('seizing for cause', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, bobs] = playing('bobby');
        grant(alice, lot(lord.id, 50), '', bob, bobs);
        expect(Fiefs.seize(alice, bobs.id)).toBe("Bobby isn't 14 days behind on their tax: you have no cause.");
        db().run('UPDATE game_anthros SET tax_balance = 9, tax_overdue_since = SUBDATE(UTC_DATE(), 14) WHERE id = ?', [bobs.id]);
        expect(Fiefs.mayBeSeized(refresh(bobs))).toBe(true);
        expect(Fiefs.seize(alice, bobs.id)).toBeNull();
        const vassal = refresh(bobs);
        expect([Fiefs.heldBy(vassal.id), vassal.tax_rate, Number(vassal.tax_balance)]).toEqual([[], null, 0.0]);
        expect(Land.totalAcres(lord.id)).toBe(50.0);
        expect(Land.parcels(lord.id)[0].held_of, "Back in the lord's own hands.").toBeNull();
    });

    test('swearing elsewhere gives it back', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, vassal] = playing('bobby');
        grant(alice, lot(lord.id, 50), '', bob, vassal);
        expect(Ranks.swear(bob, anthro({ title_rank: 5 }).id)).toBeNull();
        expect(Fiefs.heldBy(vassal.id)).toEqual([]);
        expect(Land.totalAcres(lord.id)).toBe(50.0);
        expect(notificationsFor(lord.id)).toContain("Bobby's fiefs (50 acres) came back to you: they are no longer sworn to you.");
    });

    test('granted onward it goes back in turn', () => {
        const [alice, lord] = playing('alice', { title_rank: 5 });
        const [bob, vassal] = playing('bobby', { title_rank: 4 });
        const [carol, sub] = playing('carol');
        grant(alice, lot(lord.id, 50), '', bob, vassal);
        grant(bob, Number(Fiefs.heldBy(vassal.id)[0].id), '20', carol, sub);
        const subFief = Fiefs.heldBy(sub.id)[0];
        expect([subFief.held_of, subFief.tenure]).toEqual([vassal.id, `${lord.id},${vassal.id}`]);
        Ranks.swear(carol, anthro({ title_rank: 6 }).id);
        const back = Land.parcel(Number(subFief.id))!;
        expect([back.anthro_id, back.held_of], 'Back to Bobby, still held of Alice.').toEqual([vassal.id, lord.id]);
    });

    test('a fief passes to a child', () => {
        const [alice, lord] = playing('alice', { title_rank: 4 });
        const [bob, vassal] = playing('bobby');
        grant(alice, lot(lord.id, 50), '', bob, vassal, 20);
        db().run('UPDATE game_anthros SET tax_balance = 3 WHERE id = ?', [vassal.id]);
        let child = anthro({ name: 'Heir', sire_id: vassal.id });
        Aging.die(vassal.id);
        child = refresh(child);
        expect([child.liege_id, child.tax_rate, Number(child.tax_balance)]).toEqual([lord.id, 20, 3.0]);
        expect(Number(Fiefs.heldBy(child.id)[0].acres)).toBe(50.0);

        // With no child, it goes back.
        Aging.die(child.id);
        expect(Land.totalAcres(lord.id)).toBe(50.0);
    });

    test("a vassal can't rise above its lord", () => {
        const [alice, lord] = playing('alice', { title_rank: Ranks.KNIGHT });
        const [bob, vassal] = playing('bobby');
        grant(alice, lot(lord.id, 600), '', bob, vassal);
        expect(Ranks.assumable(refresh(vassal)), 'Its lord is only a knight.').toBeNull();
        expect(Ranks.assumable(refresh(lord)), 'The lord can: the fief counts toward it.').toBe(Ranks.BARONET);
    });
});
