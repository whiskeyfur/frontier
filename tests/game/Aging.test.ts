// Upstream: tests/Game/AgingTest.php
import { describe, expect, test } from 'vitest';
import { gmdate, range, strtotimeOrThrow } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Aging } from '../../src/game/Aging';
import { Anthros } from '../../src/game/Anthros';
import { Auctions } from '../../src/game/Auctions';
import { Goods } from '../../src/game/Goods';
import { Groups } from '../../src/game/Groups';
import { Land } from '../../src/game/Land';
import { Notifications } from '../../src/game/Notifications';
import { Ranks } from '../../src/game/Ranks';
import { Socials } from '../../src/game/Socials';
import { Wallets } from '../../src/game/Wallets';
import {
    admin, anthro, coins, db, genderId, notificationsFor, notificationsForUser, player, playerAnthro, refresh, scalar, setCoins,
    speciesId,
} from '../TestCase';

describe('Aging', () => {
    /**
     * An anthro that reaches its lifespan today (so buryDue takes it).
     */
    const dueToDie = (fields: Row = {}): Row =>
        anthro({ birthdate: gmdate('Y-m-d', strtotimeOrThrow('-60 weeks')), lifespan_weeks: 60, ...fields });

    const acres = (anthroId: number): number => Land.totalAcres(anthroId);

    test('every anthro gets its own lifespan', () => {
        const spans = range(1, 40).map(() => Number(anthro().lifespan_weeks));
        expect(Math.min(...spans)).toBeGreaterThanOrEqual(Anthros.LIFESPAN_MIN);
        expect(Math.max(...spans)).toBeLessThanOrEqual(Anthros.LIFESPAN_MAX);
        expect(new Set(spans).size, 'Some live longer than others.').toBeGreaterThan(1);
    });

    test('bury due takes only those whose time has come', () => {
        const old = dueToDie({ name: 'Oldie' });
        const young = anthro({ birthdate: gmdate('Y-m-d', strtotimeOrThrow('-59 weeks')), lifespan_weeks: 60 });
        const unknown = anthro({ birthdate: null, fertile_on: null });
        expect(Aging.buryDue()).toBe(1);
        expect(Anthros.isDead(refresh(old))).toBe(true);
        expect(Anthros.isDead(refresh(young))).toBe(false);
        expect(Anthros.isDead(refresh(unknown)), 'No birthdate: it doesn\'t age.').toBe(false);
        expect(Aging.buryDue(), 'Only once.').toBe(0);
        expect(Aging.die(old.id)).toBe(false);
    });

    test('the dead hold nothing and are left out', () => {
        const alice = player('alice');
        let dead = dueToDie({ name: 'Gone', title_rank: Ranks.KNIGHT, wage: 5 });
        Aging.buryDue();
        dead = refresh(dead);
        expect(dead.owner_id).toBe(dead.id);
        expect(Anthros.isFree(dead), 'The dead aren\'t free.').toBe(false);
        expect(dead.title_rank).toBeNull();
        expect(dead.wage).toBeNull();
        expect(Ranks.title(dead)).toBe('Deceased');
        expect(Anthros.available(true).map((a: Row) => a.name)).not.toContain('Gone');
        expect(Notifications.recipients().map((a: Row) => a.name)).not.toContain('Gone');
        expect(Ranks.titled().map((a: Row) => a.id)).not.toContain(dead.id);
        expect(Anthros.become(alice, dead.id)).toBe("That anthro isn't available to become.");
        playerAnthro(alice);
        expect(Socials.flirt(alice, dead.id, '')).toEqual([null, 'Gone has died.']);
        expect(Anthros.breedingBlocker(dead, 'sire', true)).toBe('died');
        // (Upstream still passes forceBreed a fourth argument, 1, from before it lost its owner parameter; PHP ignores it.)
        expect(Anthros.forceBreed(dead.id, anthro({ gender: 'Female' }).id, 0)).toEqual([null, 'Gone has died.']);
        expect(Anthros.transfer(anthro({ owner: alice }), dead.id, alice.id)).toBe("The dead can't own or be owned.");
    });

    test('their player is released', () => {
        const alice = player('alice');
        const mine = playerAnthro(alice, { birthdate: gmdate('Y-m-d', strtotimeOrThrow('-60 weeks')), lifespan_weeks: 60 });
        Aging.buryDue();
        expect(Anthros.player(alice.id)).toBeNull();
        expect(refresh(mine).player_id).toBeNull();
        expect(notificationsForUser(alice.id)).toContain(`${mine.name} died of old age, aged 60 weeks. You can create or become another anthro.`);
    });

    test('an owned anthro\'s estate goes to its owner', () => {
        const alice = player('alice');
        const owner = playerAnthro(alice);
        const slave = dueToDie({ owner: alice, name: 'Serf' });
        setCoins(slave.id, 30);
        expect(Aging.heir(slave)!.id).toBe(owner.id);
        Aging.buryDue();
        expect(coins(owner.id)).toBe(30);
        expect(coins(slave.id)).toBe(0);
        // Its goods too (every anthro starts with a week's food).
        expect(Goods.amount(owner.id)).toBe(14);
        expect(Goods.amount(slave.id)).toBe(0);
        expect(notificationsFor(owner.id)).toContain('Serf died of old age, aged 60 weeks. You inherited their 30 ' + Wallets.CURRENCY + ', 7 food.');
    });

    test('an auction ends with its bid returned', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const bob = player('bobby');
        const bidder = playerAnthro(bob);
        setCoins(bidder.id, 50);
        const lot = dueToDie({ owner: alice, name: 'Lot' });
        const [auctionId] = Auctions.create(lot, alice.id, 10, null, 3);
        expect(Auctions.bid(auctionId!, bob, 12)).toBeNull();
        expect(coins(bidder.id), 'The bid is taken when it\'s made.').toBe(38);
        Aging.buryDue();
        expect(scalar('SELECT status FROM game_auctions WHERE id = ?', [auctionId])).toBe('cancelled');
        expect(coins(bidder.id), 'And comes back when the anthro dies.').toBe(50);
        expect(notificationsFor(bidder.id)).toContain('Lot died before the auction ended; your 12 ' + Wallets.CURRENCY + ' came back.');
    });

    test('a free anthro\'s estate goes to its eldest living free child', () => {
        const liege = anthro({ title_rank: 5 });
        const parent = dueToDie({ name: 'Elder', title_rank: 4, liege_id: liege.id });
        anthro({ sire_id: parent.id, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-30 weeks')), died_at: gmdate('Y-m-d H:i:s') });
        const heir = anthro({ name: 'Kid', sire_id: parent.id, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-25 weeks')) });
        anthro({ sire_id: parent.id, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-5 weeks')) });
        const owned = anthro({ owner_id: parent.id });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 4)', [parent.id]);
        setCoins(parent.id, 12);

        Aging.buryDue();
        expect(coins(heir.id)).toBe(12);
        expect(acres(heir.id)).toBe(4.0);
        expect(refresh(owned).owner_id).toBe(heir.id);
        expect(refresh(heir).title_rank, 'A barony is hereditary.').toBe(4);
        expect(notificationsFor(heir.id)).toContain('Elder died, and you inherited their title: you are Baron now.');
    });

    test('with no child the liege inherits and otherwise nobody', () => {
        const liege = anthro({ title_rank: 3 });
        const knight = dueToDie({ title_rank: Ranks.KNIGHT, liege_id: liege.id });
        setCoins(knight.id, 7);
        Aging.buryDue();
        expect(coins(liege.id)).toBe(7);

        const loner = dueToDie();
        let owned = anthro({ owner_id: loner.id });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 2)', [loner.id]);
        db().run('UPDATE game_anthros SET liege_id = NULL WHERE id = ?', [loner.id]);
        Aging.buryDue();
        owned = refresh(owned);
        expect(Anthros.isFree(owned), 'No heir: its anthros go free.').toBe(true);
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE anthro_id IS NOT NULL AND anthro_id = ?', [loner.id]))).toBe(0);
    });

    test('jobs, groups, litters and flirts end', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice);
        const worker = dueToDie({ employer: alice, employed_wage: 5, employed_since: gmdate('Y-m-d H:i:s'), paid_until: gmdate('Y-m-d') });
        const [groupId] = Groups.create(alice, 'Nest', [anthro({ owner: alice }).id]);
        db().run('INSERT INTO game_group_members (group_id, anthro_id) VALUES (?, ?)', [groupId, worker.id]);
        const dam = dueToDie({ gender: 'Female', name: 'Mama', player_id: player('bobby').id }); // played: answers later
        db().run('INSERT INTO game_litters (dam_id, bred_on, due_on) VALUES (?, UTC_DATE(), ADDDATE(UTC_DATE(), 5))', [dam.id]);
        Socials.flirt(alice, dam.id, 'hi');

        Aging.buryDue();
        expect(refresh(worker).employer_id).toBeNull();
        expect(Groups.find(groupId!)!.members.map((m: Row) => m.id)).not.toContain(worker.id);
        expect(Number(scalar('SELECT COUNT(*) FROM game_litters WHERE dam_id = ?', [dam.id]))).toBe(0);
        expect(scalar('SELECT status FROM game_flirts WHERE to_anthro_id = ?', [dam.id])).toBe('withdrawn');
        expect(notificationsFor(boss.id)).toContain(`${worker.name} died, so their job with you ended.`);
    });

    test('a group passes to its longest member', () => {
        const alice = player('alice');
        const owner = playerAnthro(alice, { birthdate: gmdate('Y-m-d', strtotimeOrThrow('-60 weeks')), lifespan_weeks: 60 });
        const other = anthro({ owner: alice });
        const [groupId] = Groups.create(alice, 'Den', [owner.id, other.id]);
        Aging.buryDue();
        const group = Groups.find(groupId!)!;
        expect(group.owner_anthro_id).toBe(other.id);
        expect(group.members.map((m: Row) => m.id)).toEqual([other.id]);
    });

    test('set lifespan', () => {
        let a = anthro();
        expect(Anthros.setLifespan(a, 70)).toBeNull();
        a = refresh(a);
        expect(Number(a.lifespan_weeks)).toBe(70);
        expect(Anthros.diesOn(a)).toBe(gmdate('Y-m-d', strtotimeOrThrow(a.birthdate + ' UTC +490 days')));
        expect(Anthros.setLifespan(a, 0)).toBe('Choose a lifespan of 1 to 1000 weeks.');
        expect(Anthros.setLifespan(a, 20), 'Already reached: it dies on the next request.').toBeNull();
        expect(Aging.buryDue()).toBe(1);
        expect(Anthros.setLifespan(refresh(a), 70)).toBe(`${a.name} has already died.`);
    });

    test('dams live at least 20 weeks past their fertile until', () => {
        for (const _ of range(1, 40)) {
            const dam = anthro({ gender: 'Female', lifespan_weeks: null });
            expect(strtotimeOrThrow(Anthros.diesOn(dam)!) - strtotimeOrThrow(dam.fertile_until + ' +20 weeks')).toBeGreaterThanOrEqual(0);
            expect(Number(dam.lifespan_weeks)).toBeLessThanOrEqual(Anthros.LIFESPAN_MAX);
        }
        const sires = range(1, 60).map(() => Number(anthro({ lifespan_weeks: null }).lifespan_weeks));
        expect(Math.min(...sires), 'Anthros that can\'t carry keep the full 52-80 weeks.').toBeLessThan(67);
    });

    test('set life', () => {
        let dam = anthro({ gender: 'Female', birthdate: '2026-01-01', fertile_on: '2026-03-10', lifespan_weeks: 75 });
        const life = (changes: Row) => ({
            birthdate: '2026-01-01', fertile_on: '2026-03-10', fertile_until: '2026-12-01',
            dies_on: '2027-06-17', fertile_weekday: 2, max_cubs: 5, ...changes,
        });
        expect(Anthros.setLife(dam, life({}))).toBeNull();
        dam = refresh(dam);
        expect([dam.fertile_until, Number(dam.lifespan_weeks), dam.fertile_weekday, dam.max_cubs]).toEqual(['2026-12-01', 76, 2, 5]);
        expect(Anthros.diesOn(dam)).toBe('2027-06-17');

        expect(Anthros.setLife(dam, life({ dies_on: '2027-04-15' })))
            .toBe('Dies on must be at least 20 weeks after Fertile until (on or after 2027-04-20).');
        expect(Anthros.setLife(dam, life({ fertile_until: '2026-11-26', dies_on: '2027-04-15' })), 'Earlier old age: fine.').toBeNull();
        expect(Anthros.setLife(dam, life({ fertile_until: '2026-11-25' }))).toBe('Fertile until must be 47 to 52 weeks after birth.');
        expect(Anthros.setLife(dam, life({ fertile_on: '2025-12-31' }))).toBe('Fertile from must be on or after the birthdate.');
        expect(Anthros.setLife(dam, life({ dies_on: '2027-06-18' })))
            .toBe('Dies on must be a whole number of weeks after birth (1 to 1000): the same weekday it was born on.');
        expect(Anthros.setLife(dam, life({ dies_on: '' }))).toBe('Choose the day it dies.');
        expect(Anthros.setLife(dam, life({ birthdate: '2026-02-30' }))).toBe('Born: enter a valid date.');
        expect(Anthros.setLife(dam, life({ max_cubs: 9 }))).toBe('A litter holds 1 to 8 cubs.');
        expect(Anthros.setLife(dam, life({ birthdate: '' })))
            .toBe("With no birthdate, leave Fertile until and Dies on empty: the anthro doesn't age.");
        expect(Anthros.setLife(dam, life({ birthdate: '', fertile_until: '', dies_on: '' }))).toBeNull();
        expect(Anthros.diesOn(refresh(dam)), 'Unknown birthdate: it doesn\'t age.').toBeNull();

        const sire = anthro({ birthdate: '2026-01-01', fertile_on: '2026-03-10' });
        expect(Anthros.setLife(sire, { birthdate: '2026-01-01', fertile_on: '', dies_on: '2026-12-31' }), 'No old age for sires.').toBeNull();
        expect(Number(refresh(sire).lifespan_weeks)).toBe(52);
    });

    test('the other setters keep the gap', () => {
        let dam = anthro({ gender: 'Female', birthdate: '2026-01-01', fertile_until: '2026-12-01', lifespan_weeks: 72 });
        expect(Anthros.setLifespan(dam, 67)).toBe('As a dam, ' + dam.name + ' must live at least 20 weeks past her fertile until: 68 weeks or more.');
        expect(Anthros.setLifespan(dam, 68)).toBeNull();
        dam = refresh(dam);
        expect(Anthros.setFertileUntil(dam, '2026-12-04')).toBe('Fertile until must be at least 20 weeks before ' + dam.name + ' dies (2027-04-22).');
        expect(Anthros.setFertileUntil(dam, '2026-12-03'), 'Exactly 20 weeks is enough.').toBeNull();
    });

    test('an admin becoming a dam lives long enough', () => {
        const a = admin();
        Anthros.setPlayer(a, 'Ravnos', genderId('Male'), speciesId(), gmdate('Y-m-d', strtotimeOrThrow('-10 weeks')));
        db().run('UPDATE game_anthros SET lifespan_weeks = 52 WHERE player_id = ?', [a.id]);
        Anthros.setPlayer(a, 'Ravna', genderId('Female'), speciesId(), gmdate('Y-m-d', strtotimeOrThrow('-10 weeks')));
        const ravna = Anthros.player(a.id)!;
        expect(Number(ravna.lifespan_weeks)).toBeGreaterThanOrEqual(Anthros.shortestLifespan(ravna));
    });
});
