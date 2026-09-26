// Upstream: tests/Game/UrgesTest.php
import { describe, expect, test } from 'vitest';
import { gmdate, range, strtotimeOrThrow } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Clock } from '../../src/game/Clock';
import { Groups } from '../../src/game/Groups';
import { Preferences } from '../../src/game/Preferences';
import { Ranks } from '../../src/game/Ranks';
import { Urges } from '../../src/game/Urges';
import { admin, anthro, anthroOf, db, notificationsFor, player, refresh } from '../TestCase';

describe('Urges', () => {
    // A dam that arrived days days ago, fertile long before, with her urge rising rise% a day.
    const dam = (days: number, rise: number, fields: Row = {}): Row =>
        anthro({
            gender: 'Female', name: 'Fern', urge_rise: rise,
            created_at: Clock.today(-days) + ' 12:00:00', ...fields,
        });

    test('rates', () => {
        const rises: number[] = [];
        for (let i = 0; i < 500; i++) {
            rises.push(Urges.randomRise());
        }
        expect(Math.min(...rises)).toBeGreaterThanOrEqual(Urges.MIN_RISE);
        expect(Math.max(...rises)).toBeLessThanOrEqual(Urges.MAX_RISE);
        const typical = rises.filter((r) => r >= 3 && r <= 7).length;
        expect(typical, 'Most rise 3 to 7% a day.').toBeGreaterThan(300);
        expect(typical, 'Some rise slower or faster.').toBeLessThan(500);

        const created = anthro({ gender: 'Female' });
        expect(Urges.rise(created)).toBeNull();
        Urges.fillRises();
        expect(Urges.rise(refresh(created)), 'New anthros get a rate.').not.toBeNull();
    });

    test('the chance rises with each day without', () => {
        const fern = dam(4, 5);
        expect(Urges.daysWaiting(fern)).toBe(4);
        expect(Urges.chance(fern)).toBe(20);
        expect(Urges.chance(dam(3, Urges.MAX_RISE)), "Some can't go three days without.").toBe(100);
        expect(Urges.chance(dam(40, 5)), 'At most 100%.').toBe(100);
        expect(Urges.chance(dam(0, 30)), 'Nothing on the day she arrives.').toBe(0);

        // A breeding attempt starts her wait over (either role: a herm's siring counts too), as does giving birth.
        db().run('INSERT INTO game_breedings (sire_id, dam_id, bred_at) VALUES (?, ?, SUBDATE(UTC_TIMESTAMP(), 2))', [anthro().id, fern.id]);
        expect(Urges.chance(fern)).toBe(10);
        db().run(
            'INSERT INTO game_litters (dam_id, bred_on, due_on, born_at) VALUES (?, SUBDATE(UTC_DATE(), 70), SUBDATE(UTC_DATE(), 1), SUBDATE(UTC_TIMESTAMP(), 1))',
            [fern.id],
        );
        expect(Urges.chance(fern)).toBe(5);
    });

    test('only dams who can carry look', () => {
        expect(Urges.chance(anthro({ gender: 'Male', urge_rise: 30, created_at: '2000-01-01' }))).toBe(0);
        expect(Urges.chance(dam(9, 30, { fertile_on: gmdate('Y-m-d', strtotimeOrThrow('+1 week')) })), 'Not fertile yet.').toBe(0);
        expect(Urges.chance(dam(9, 30, { hungry_on: gmdate('Y-m-d') })), 'Hungry.').toBe(0);
        const pregnant = dam(9, 30);
        db().run('INSERT INTO game_litters (dam_id, bred_on, due_on) VALUES (?, SUBDATE(UTC_DATE(), 9), ADDDATE(UTC_DATE(), 54))', [pregnant.id]);
        expect(Urges.chance(Anthros.findAny(pregnant.id)!), 'Already expecting.').toBe(0);
        expect(Urges.chance(dam(9, 30, { gender: 'Herm' }))).toBe(100);
    });

    test('her choice of mate', () => {
        const alice = player('alice');
        const owner = anthroOf(alice);
        const fern = dam(9, 30, { owner: alice });
        const fellow = anthro({ owner: alice, name: 'Fellow' });
        const mate = anthro({ name: 'Mate' });
        anthro({ gender: 'Female', owner: alice });
        Groups.create(admin(), 'Hearth', [fern.id, mate.id]);

        const choice = Urges.partnerFor(fern)!;
        expect([choice.how, choice.sire.id], 'Her group first.').toEqual(['group', mate.id]);
        expect(choice.group_id).not.toBeNull();
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [mate.id]);
        expect([Urges.partnerFor(fern)!.how, Urges.partnerFor(fern)!.sire.id], 'Then her owner.').toEqual(['owner', owner]);
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [owner]);
        expect([Urges.partnerFor(fern)!.how, Urges.partnerFor(fern)!.sire.id], 'Then a fellow slave.').toEqual(['fellow', fellow.id]);
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [fellow.id]);
        expect(Urges.partnerFor(fern), 'Nobody else is a slave.').toBeNull();
        const stranger = anthro({ owner: player('bobby'), name: 'Stranger' });
        expect([Urges.partnerFor(fern)!.how, Urges.partnerFor(fern)!.sire.id], 'Then any slave.').toEqual(['rank', stranger.id]);

        // A free dam looks among free commoners, not slaves (their rank), nor nobles.
        const free = dam(9, 30);
        anthro({ name: 'Commoner' });
        anthro({ name: 'Lord', title_rank: 2 });
        for (const _ of range(1, 20)) {
            expect(Ranks.of(Urges.partnerFor(free)!.sire)).toBe(Ranks.COMMONER);
        }
    });

    test('the renaissance keeps the young out', () => {
        const alice = player('alice');
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [anthroOf(alice)]);
        const fern = dam(9, 30, { owner: alice });
        const lad = anthro({
            owner: alice, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-12 weeks')), fertile_on: gmdate('Y-m-d', strtotimeOrThrow('-1 day')),
        });
        expect(Urges.partnerFor(fern)!.sire.id).toBe(lad.id);
        Preferences.setEra(alice, 'renaissance');
        expect(Urges.partnerFor(fern)).toBeNull();
    });

    test('each day their urges are rolled', () => {
        const alice = player('alice');
        const owner = anthroOf(alice);
        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [owner]);
        const fern = dam(5, Urges.MAX_RISE, { owner: alice });
        const fellow = anthro({ owner: alice, name: 'Mack' });
        const waiting = dam(1, 1, { name: 'Patience' });
        Urges.fillRises();
        expect(Urges.rollToday()).toBe(1);
        expect(Urges.rollToday(), 'Once a day.').toBe(0);
        expect(db().all('SELECT sire_id, dam_id FROM game_breedings').map((r) => [Number(r.sire_id), Number(r.dam_id)])).toEqual([[fellow.id, fern.id]]);
        expect(notificationsFor(owner), 'Her owner hears of it.').toContain("Fern went looking for a mate and bred with Mack: she's expecting.");
        expect(Urges.chance(refresh(fern)), 'She waits again from today (and is expecting).').toBe(0);
        expect(Urges.chance(waiting)).toBe(1);
    });

    test('the life form sets her rate', () => {
        const fern = dam(2, 5);
        const life = {
            birthdate: fern.birthdate, fertile_on: fern.fertile_on, fertile_until: fern.fertile_until,
            dies_on: Anthros.diesOn(fern), fertile_weekday: 1, max_cubs: 4,
        };
        expect(Anthros.setLife(fern, { ...life, urge_rise: 35 })).toBe('Her urge rises 1 to 34% a day.');
        expect(Anthros.setLife(fern, { ...life, urge_rise: 20 })).toBeNull();
        expect(Urges.rise(refresh(fern))).toBe(20);
    });
});
