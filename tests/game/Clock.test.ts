// Upstream: tests/Game/ClockTest.php
import { describe, expect, test } from 'vitest';
import { Board } from '../../src/game/Board';
import { Clock } from '../../src/game/Clock';
import { Preferences } from '../../src/game/Preferences';
import { Saves } from '../../src/game/Saves';
import { Schedules } from '../../src/game/Schedules';
import { toGameCalendar } from '../../src/db/migrations';
import { admin, anthro, db, player, playerAnthro, refresh, scalar } from '../TestCase';

/**
 * Pretends the anchor was realDays real days ago (at the same game time), as if that much real time had passed.
 */
function realDaysPass(realDays: number): void {
    db().run("UPDATE game_settings SET value = value - ? WHERE name = 'clock_real'", [Math.round(realDays * 86400)]);
    Clock.forget();
}

/**
 * The game's own clock (see Clock): apart from real time, at the slowest pace the players ask for.
 */
describe('Clock', () => {
    test('time runs at its rate', () => {
        Clock.start('1200-01-01');
        expect(Clock.today()).toBe('1200-01-01');
        expect(Clock.weekday(), '1 January 1200 was a Saturday.').toBe(6);
        realDaysPass(2);
        expect(Clock.today(), 'A game day a real day, to start.').toBe('1200-01-03');
        db().exec("UPDATE game_settings SET value = '3' WHERE name = 'clock_rate'");
        Clock.forget();
        expect(Clock.today(), 'Three a real day: two real days are six game days.').toBe('1200-01-07');
        expect(Clock.today(3)).toBe('1200-01-10');
        expect(Clock.daysBetween('1200-01-01', '1200-01-10')).toBe(9);
    });

    test('the slowest pace anyone playing asks for is kept', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const idle = player('idle');
        playerAnthro(alice);
        playerAnthro(bob);
        expect(Clock.wanted(), 'Nobody asks: a game day a real day.').toBe(Clock.DEFAULT_RATE);
        expect(Preferences.setTimeRate(alice, '30')).toBe('Ask for 0.25 to 24 game days per real day, or leave it empty.');
        expect(Preferences.setTimeRate(alice, 'fast')).toBe('Ask for 0.25 to 24 game days per real day, or leave it empty.');
        expect(Preferences.setTimeRate(alice, '7')).toBeNull();
        expect(Preferences.setTimeRate(bob, '2.5')).toBeNull();
        expect(Preferences.setTimeRate(idle, '0.25')).toBeNull();
        expect(Clock.rate(), "The slowest of those playing (someone not playing an anthro doesn't count).").toBe(2.5);
        expect(Preferences.timeRate(bob.id)).toBe(2.5);
        expect(Preferences.setTimeRate(bob, '')).toBeNull();
        expect(Clock.rate(), "Bob doesn't mind any more.").toBe(7.0);
        expect(Preferences.timeRate(bob.id)).toBeNull();

        // A change of pace keeps the time that has passed at the pace it passed.
        const before = Clock.time();
        realDaysPass(1);
        expect(Clock.time(), 'A real day at 7: a game week.').toBe(before + 7 * 86400);
        Preferences.setTimeRate(alice, '1');
        expect(Clock.time()).toBe(before + 7 * 86400);
        realDaysPass(1);
        expect(Clock.time(), 'Then a game day a real day.').toBe(before + 8 * 86400);
    });

    test('each game day passed is done in turn', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        const skill = Number(scalar("SELECT id FROM game_skills WHERE name = 'Letters'"));
        const week: Record<number, Record<string, string>> = {};
        for (let d = 1; d <= 7; d++) week[d] = { activity: 'train', detail: 's:' + skill };
        Schedules.setWeekly(alice, me, week);
        Board.runDaily();
        expect(Number(scalar('SELECT COUNT(*) FROM game_schedule_log WHERE anthro_id = ?', [me.id])), 'Today.').toBe(1);
        Board.runDaily();
        expect(Number(scalar('SELECT COUNT(*) FROM game_schedule_log WHERE anthro_id = ?', [me.id])), 'Once a day.').toBe(1);
        realDaysPass(3);
        Board.runDaily();
        expect(Number(scalar('SELECT COUNT(*) FROM game_schedule_log WHERE anthro_id = ?', [me.id])), 'And each of the three since, in turn.').toBe(4);
        expect(db().column('SELECT day FROM game_schedule_log ORDER BY day'))
            .toEqual([Clock.today(-3), Clock.today(-2), Clock.today(-1), Clock.today()]);
        expect(Clock.doneThrough()).toBe(Clock.today(-1));
    });

    test("rows made take the game's time", () => {
        Clock.start('1200-03-01');
        const a = anthro();
        expect(a.created_at.substring(0, 10), "An anthro arrives in the game's time...").toBe('1200-03-01');
        const given = anthro({ created_at: '1199-05-05 10:00:00' });
        expect(given.created_at, "...unless it's given one (a saved game restored).").toBe('1199-05-05 10:00:00');
    });

    test('a game on the real calendar moves to its own', () => {
        db().exec("DELETE FROM game_settings WHERE name LIKE 'clock\\_%' ESCAPE '\\'");
        const old = anthro({ birthdate: '2026-05-01', fertile_on: '2026-07-10' });
        db().run('INSERT INTO game_schedule_log (anthro_id, day, activity) VALUES (?, ?, ?)', [old.id, '2026-09-26', 'rest']);
        toGameCalendar(db(), '2026-09-26');
        Clock.forget();
        const moved = refresh(old);
        expect([moved.birthdate, moved.fertile_on], 'Shifted alike: its age and the rest keep their length.').toEqual(['1199-08-06', '1199-10-15']);
        expect(scalar('SELECT day FROM game_schedule_log'), "Its today is the game's first day.").toBe('1200-01-01');
        expect(Clock.today()).toBe('1200-01-01');
        expect(Clock.doneThrough()).toBe('1199-12-31');
    });

    // Upstream takes the game down with \Maintenance::set(true, 'Updating') and brings it up with ::set(false), which
    // pause and unpause the clock. There's no maintenance mode here (see App.ADMIN_PAGES): the test calls those.
    test('the clock stands still while the game is down', () => {
        Clock.start('1200-01-01');
        realDaysPass(1);
        Clock.pause();
        realDaysPass(3);
        expect(Clock.today(), 'Down: no days go by.').toBe('1200-01-02');
        Clock.unpause();
        realDaysPass(1);
        expect(Clock.today(), 'Up again: it carries on from where it stood.').toBe('1200-01-03');
    });

    test('a saved game carries on from when it was saved', () => {
        const boss = admin();
        Clock.start('1300-06-01');
        realDaysPass(2);
        const [id] = Saves.create(boss, 'June');
        realDaysPass(5);
        expect(Clock.today()).toBe('1300-06-08');
        expect(Saves.restore(boss, id!)).toBeNull();
        expect(Clock.today(), 'Back to the day it was saved.').toBe('1300-06-03');
    });
});
