// Upstream: tests/Game/FinancesTest.php
import { describe, expect, test } from 'vitest';
import { Finances } from '../../src/game/Finances';
import { Fiefs } from '../../src/game/Fiefs';
import { Goods } from '../../src/game/Goods';
import { Schedules } from '../../src/game/Schedules';
import { anthro, coins, db, notificationsFor, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

function learn(anthroId: number, skill: string, practice = 28): void {
    db().run('INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, ? FROM game_skills WHERE name = ?',
        [anthroId, practice, skill]);
}

/** array_fill(1, 7, ...): days 1 to 7 (Monday to Sunday) => the same plan. */
function everyDay(activity: string, detail = ''): Record<number, { activity: string; detail: string }> {
    const days: Record<number, { activity: string; detail: string }> = {};
    for (let day = 1; day <= 7; day++) days[day] = { activity, detail };
    return days;
}

/** array_column($lines, null, 'label'). */
function byLabel(lines: Record<string, any>[]): Record<string, any> {
    return Object.fromEntries(lines.map((l) => [l.label, l]));
}

describe('Finances', () => {
    test('the week ahead', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Alice' });
        setCoins(me.id, 10);
        const servant = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Servant'"));
        learn(me.id, 'Service');
        Schedules.setWeekly(alice, me, everyDay('work', 'o:' + servant));
        const serf = anthro({ owner: alice, name: 'Serf' });
        Schedules.setWeekly(alice, serf, everyDay('work', 'f'));

        const report = Finances.report(refresh(me));
        const lines = byLabel(report.lines);
        expect(lines['Alice (you)'].coins).toBe(7 * 8); // A Journeyman servant, 8 coins a day.
        expect(lines['Alice (you)'].detail).toBe('Servant 7 days');
        expect(lines['Serf'].goods).toEqual({ food: 14 }); // Foraging, 2 food a day on average.
        expect(lines['Food for your household'].goods).toEqual({ food: -14 }); // Two mouths, fed from the store and the foraging.
        expect(lines).not.toHaveProperty(['Meals bought at the market']);
        expect([report.balance, report.income, report.expenses, report.projected]).toEqual([10, 56.0, 0.0, 66.0]);
    });

    test('meals wages and taxes', () => {
        const alice = player('alice');
        const lord = playerAnthro(alice, { name: 'Aldric', title_rank: 4 });
        const bob = player('bobby');
        const vassal = playerAnthro(bob, { name: 'Bram' });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 50)', [lord.id]);
        const [, error] = Fiefs.offerGrant(alice, db().lastInsertId(), '', vassal.id, 50);
        expect(error).toBeNull();
        Fiefs.answer(bob, Fiefs.offers(vassal.id).received[0].id, true);
        learn(vassal.id, 'Service');
        const servant = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Servant'"));
        Schedules.setWeekly(bob, refresh(vassal), everyDay('work', 'o:' + servant));
        db().run("UPDATE game_goods SET quantity = 3 WHERE anthro_id = ? AND good = 'food'", [vassal.id]);

        const theirs = byLabel(Finances.report(refresh(vassal)).lines);
        expect(theirs['Meals bought at the market'].coins).toBe(-20); // 4 of 7 days' food bought, at 5 coins.
        expect(theirs['Tax to Aldric'].coins).toBe(-28.0); // Half of 56 coins.
        const mine = byLabel(Finances.report(refresh(lord)).lines);
        expect(mine['Tax from Bram'].coins).toBe(28.0);
    });

    test('donating', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Alice' });
        setCoins(me.id, 10);
        const friend = anthro({ name: 'Friend' });
        expect(Finances.donate(alice, friend.id, 'coins', 4)).toBeNull();
        expect([coins(me.id), coins(friend.id)]).toEqual([6, 4]);
        expect(notificationsFor(friend.id)).toContain('Alice gave you 4 coins.');
        expect(Finances.donate(alice, friend.id, 'coins', 7)).toBe('You have 6 coins.');

        // Goods for an owned anthro go to the store it's fed from: its owner's.
        const bob = player('bobby');
        const owner = playerAnthro(bob, { name: 'Bobby' });
        const serf = anthro({ owner: bob, name: 'Serf' });
        expect(Finances.donate(alice, serf.id, 'food', 3)).toBeNull();
        expect([Goods.amount(me.id), Goods.amount(owner.id)]).toEqual([4, 10]);
        expect(notificationsFor(owner.id)).toContain('Alice gave Serf 3 food, for your store.');
        expect(Finances.donate(alice, serf.id, 'food', 5)).toBe('You have only 4 food.');
        expect(Finances.donate(alice, me.id, 'coins', 1)).toBe("You can't give to yourself.");
        expect(Finances.donate(alice, serf.id, 'unobtainium', 1)).toBe('Choose what to give.');
    });
});
