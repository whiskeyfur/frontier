// Upstream: tests/Game/JobsTest.php
import { describe, expect, test } from 'vitest';
import { gmdate } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Anthros } from '../../src/game/Anthros';
import { Jobs } from '../../src/game/Jobs';
import { Ranks } from '../../src/game/Ranks';
import { Schedules } from '../../src/game/Schedules';
import { Wallets } from '../../src/game/Wallets';
import { admin, anthro, anthroOf, coins, db, notificationsFor, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

describe('Jobs', () => {
    test('assign wages gives untitled free anthros a wage', () => {
        const free = anthro();
        const noble = anthro({ title_rank: Ranks.KNIGHT });
        const owned = anthro({ owner: player('alice') });
        Jobs.assignWages();
        const wage = Number(refresh(free).wage);
        expect(wage).toBeGreaterThanOrEqual(Jobs.WAGE_MIN);
        expect(wage).toBeLessThanOrEqual(Jobs.WAGE_MAX);
        expect(refresh(noble).wage).toBeNull();
        expect(refresh(owned).wage).toBeNull();
    });

    test('hire pays the first day', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice);
        setCoins(boss.id, 100);
        let worker = anthro({ name: 'Worker', wage: 15 });
        const result = Jobs.hire(alice, [worker.id]);
        expect(result).toEqual({ hired: ['Worker'], skipped: [] });
        worker = refresh(worker);
        expect(worker.employer_id).toBe(boss.id);
        expect(Number(worker.employed_wage)).toBe(15);
        expect(worker.paid_until).toBe(gmdate('Y-m-d'));
        expect(coins(boss.id)).toBe(85);
        expect(coins(worker.id)).toBe(15);
    });

    test('hire refusals', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice);
        setCoins(boss.id, 10);
        const noWage = anthro({ name: 'Idle' });
        const owned = anthro({ name: 'Owned', owner: alice, wage: 5 });
        const pricey = anthro({ name: 'Pricey', wage: 20 });
        const taken = anthro({ name: 'Taken', wage: 5, employer: player('bobby') });
        const result = Jobs.hire(alice, [noWage.id, owned.id, pricey.id, taken.id, boss.id, 999999]);
        expect(result.hired).toEqual([]);
        expect(result.skipped).toEqual([
            'Idle: Not looking for work.',
            'Owned: Not looking for work.',
            'Pricey: You need 20 coins for the first day but have 10 coins.',
            'Taken: Already employed.',
            boss.name + ": You can't hire yourself.",
            'That anthro no longer exists.',
        ]);
        expect(Jobs.hireOne(player('nobody'), noWage.id)!.startsWith('Create or become an anthro')).toBe(true);
    });

    test('set asking', () => {
        const alice = player('alice');
        expect(Jobs.setAsking(alice, '10')).toBe("You don't play an anthro.");
        const a = playerAnthro(alice);
        expect(Jobs.setAsking(alice, 'x')).toBe('The wage must be 1 to 16 coins a day, or empty if you are not looking for work.');
        expect(Jobs.setAsking(alice, '0')!.startsWith('The wage must be 1 to 16')).toBe(true);
        expect(Jobs.setAsking(alice, '17')!.startsWith('The wage must be 1 to 16'), 'A Master\'s pay and a coin more, at most.').toBe(true);
        expect(Jobs.setAsking(alice, ' 4 ', false)).toBeNull();
        expect([Number(refresh(a).wage), refresh(a).hire_breedable]).toEqual([4, 0]);
        expect(Anthros.forHire().map((w: Row) => w.id)).toEqual([a.id]);
        expect(Jobs.setAsking(alice, '')).toBeNull();
        expect(refresh(a).wage).toBeNull();
    });

    test('offering learned work', () => {
        const bob = player('bobby');
        const worker = playerAnthro(bob, { name: 'Worker' });
        const baker = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Baker'"));
        expect(Jobs.offerable(worker).size, 'Nothing learned yet.').toBe(0);
        expect(Jobs.setAsking(bob, '3', true, baker)).toBe("Choose work you've learned the skill for (train at it first).");

        db().run("INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, 30 FROM game_skills WHERE name = 'Cooking'", [worker.id]);
        const offer = Jobs.offerable(worker);
        expect(offer.has(baker)).toBe(true);
        expect(offer.get(baker)!.level).toBe('Journeyman');
        expect(Jobs.setAsking(bob, '3', true, baker)).toBeNull();
        expect(Jobs.offered(refresh(worker))!.title).toBe('Baker');

        // Hired, it starts on that work every day.
        const alice = player('alice');
        setCoins(anthroOf(alice), 10);
        expect(Jobs.hireOne(alice, worker.id)).toBeNull();
        const week = Schedules.weekly(worker.id);
        expect(Object.values(week).map((d) => d.occupation_id)).toEqual(Array(7).fill(baker));
        expect(notificationsFor(worker.id)).toContain('AliceAnthro hired you for 3 coins a day to work as Baker.');
    });

    test('expected wages', () => {
        expect([Jobs.expectedWage('Novice', false), Jobs.expectedWage('Novice', true),
            Jobs.expectedWage('Journeyman', false), Jobs.expectedWage('Journeyman', true), Jobs.expectedWage('Master', false),
            Jobs.expectedWage('Master', true), Jobs.expectedWage(null, false)]).toEqual([2, 3, 8, 9, 15, 16, 1]);
        expect(Jobs.WAGE_MAX, 'A Master\'s pay and a coin more.').toBe(16);
        const master = anthro({ name: 'Master', hire_breedable: 1 });
        db().run("INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, 90 FROM game_skills WHERE name = 'Cooking'", [master.id]);
        Jobs.assignWages();
        expect(Number(refresh(master).wage), 'Unplayed workers ask what their best skill pays.').toBe(16);
    });

    test('dismiss and quit', () => {
        const alice = player('alice');
        setCoins(playerAnthro(alice).id, 100);
        const bob = player('bobby');
        const bobAnthro = playerAnthro(bob, { wage: 10 });
        const worker = anthro({ wage: 10 });
        Jobs.hire(alice, [bobAnthro.id, worker.id]);

        expect(Jobs.dismiss(bob, worker.id)).toBe("That anthro doesn't work for you.");
        expect(Jobs.dismiss(alice, worker.id)).toBeNull();
        expect(refresh(worker).employer_id).toBeNull();

        expect(Jobs.quit(bob)).toBeNull();
        expect(refresh(bobAnthro).employer_id).toBeNull();
        expect(notificationsFor(Wallets.anthroFor(alice.id)!)).toContain('BobbyAnthro quit working for you.');
        expect(Jobs.quit(bob)).toBe("You don't have a job.");
    });

    test('pay due pays each missed day', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice);
        setCoins(boss.id, 100);
        const worker = anthro({ wage: 10 });
        Jobs.hire(alice, [worker.id]);
        db().run('UPDATE game_anthros SET paid_until = SUBDATE(UTC_DATE(), 3) WHERE id = ?', [worker.id]);
        expect(Jobs.payDue()).toBe(3);
        expect(coins(boss.id)).toBe(60);
        expect(coins(worker.id)).toBe(40);
        expect(refresh(worker).paid_until).toBe(gmdate('Y-m-d'));
        expect(Jobs.payDue()).toBe(0);
    });

    test('pay due ends jobs the employer can\'t pay for', () => {
        const alice = player('alice');
        const boss = playerAnthro(alice);
        setCoins(boss.id, 25);
        const worker = anthro({ wage: 10 });
        Jobs.hire(alice, [worker.id]);
        db().run('UPDATE game_anthros SET paid_until = SUBDATE(UTC_DATE(), 3) WHERE id = ?', [worker.id]);
        expect(Jobs.payDue()).toBe(1);
        expect(coins(boss.id)).toBe(5);
        expect(refresh(worker).employer_id).toBeNull();
        expect(notificationsFor(boss.id)[0].startsWith("You couldn't pay")).toBe(true);
    });

    test('end does nothing without a job', () => {
        const a = anthro();
        Jobs.end(a, 'x', 'y');
        expect(Number(scalar('SELECT COUNT(*) FROM game_notifications'))).toBe(0);
    });

    test('losing freedom ends the job', () => {
        const alice = player('alice');
        setCoins(playerAnthro(alice).id, 100);
        const worker = anthro({ wage: 10 });
        Jobs.hire(alice, [worker.id]);
        const bob = player('bobby');
        Anthros.transfer(refresh(worker), anthroOf(bob), admin().id);
        expect(refresh(worker).employer_id).toBeNull();
    });

    test('supplying workers', () => {
        expect(Jobs.supply(0, null, null, null)).toEqual([null, 'Supply 1 to 50 workers at a time.']);
        expect(Jobs.supply(1, null, null, 17)).toEqual([null, 'Wages are 1 to 16 coins a day.']);
        const cooking = Number(scalar("SELECT id FROM game_skills WHERE name = 'Cooking'"));
        expect(Jobs.supply(3, cooking, false, 2)).toEqual([3, null]);
        const workers: Row[] = Anthros.forHire();
        expect(workers).toHaveLength(3);
        for (const worker of workers) {
            expect(Anthros.isFree(worker)).toBe(true);
            expect([Number(worker.wage), worker.hire_breedable]).toEqual([2, 0]);
            const trade = Schedules.skillsOf(worker.id)[0];
            expect(trade.name).toBe('Cooking');
            expect(['Novice', 'Apprentice', 'Journeyman']).toContain(trade.level);
        }

        // Otherwise they ask what their trade pays at their level, and a coin more if they may be bred.
        const fixed = workers.map((w) => w.id);
        Jobs.supply(40, null, null, null);
        for (const worker of (Anthros.forHire() as Row[]).filter((w) => !fixed.includes(w.id))) {
            const level = Schedules.skillsOf(worker.id)[0].level;
            expect(Number(worker.wage), `${level}.`).toBe(Schedules.PAY[level] + (worker.hire_breedable ? 1 : 0));
        }
    });

    test('only workers hired to be bred can be bred', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const mate = anthro({ owner: alice, name: 'Mate' });
        const employed = { employed_wage: 1, employed_since: gmdate('Y-m-d H:i:s'), paid_until: gmdate('Y-m-d') };
        const willing = anthro({ name: 'Willing', gender: 'Female', employer: alice, ...employed });
        const not = anthro({ name: 'Not', gender: 'Female', employer: alice, hire_breedable: 0, ...employed });
        expect(Anthros.mayBreed(alice, willing)).toBe(true);
        expect(Anthros.mayBreed(alice, not)).toBe(false);
        const me = Anthros.player(alice.id)!.name;
        expect(Anthros.breedable(alice.id).map((a: Row) => a.name).filter((n: string) => n !== me)).toEqual(['Mate', 'Willing']);
        expect(Anthros.breed(alice.id, mate.id, willing.id)[1]).toBeNull();
        expect(Anthros.breed(alice.id, mate.id, not.id)).toEqual([null, 'Choose a sire and a dam from your anthros and employees.']);
    });
});
