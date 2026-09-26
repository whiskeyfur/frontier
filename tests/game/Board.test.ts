// Upstream: tests/Game/BoardTest.php
import { describe, expect, test } from 'vitest';
import { Auth } from '../../src/core/Auth';
import { gmdate, strtotimeOrThrow } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Board } from '../../src/game/Board';
import { Clock } from '../../src/game/Clock';
import { Goods } from '../../src/game/Goods';
import { Groups } from '../../src/game/Groups';
import { Land } from '../../src/game/Land';
import { Litters } from '../../src/game/Litters';
import { Notifications } from '../../src/game/Notifications';
import { Ranks } from '../../src/game/Ranks';
import { Schedules } from '../../src/game/Schedules';
import {
    admin, anthro, baronyId, db, notificationsFor, notificationsForUser, player, playerAnthro, refresh, scalar, setCoins,
} from '../TestCase';

/** array_fill(1, 7, $day): a week of the same day, keyed by weekday. */
function week(day: Record<string, string>): Record<number, Record<string, string>> {
    const out: Record<number, Record<string, string>> = {};
    for (let d = 1; d <= 7; d++) out[d] = { ...day };
    return out;
}

const count = (sql: string, params: unknown[] = []) => Number(scalar(sql, params));

describe('Board', () => {
    test('counts every game table', () => {
        const counts = Board.counts();
        expect(Object.keys(counts)).toEqual(Board.TABLES);
        // Empty but for the day claimed by the test setup.
        expect(Object.fromEntries(Object.entries(counts).filter(([, n]) => n))).toEqual({ game_daily: 1 });
    });

    test('reset needs the confirm word', () => {
        anthro();
        expect(Board.reset(admin(), 'reset')).toBe('Type RESET to confirm.');
        expect(Board.counts().game_anthros).toBe(1);
    });

    test('reset empties the game', () => {
        const boss = admin();
        const alice = player('alice');
        const a = playerAnthro(alice);
        Land.supply(1, 1, 10, boss.id, baronyId());
        Groups.create(boss, 'Old', [anthro().id, anthro().id]);
        Notifications.toUser(alice.id, 'old news');
        db().run("INSERT INTO game_names (name, is_male) VALUES ('Kept', 1)");

        expect(Board.reset(boss, Board.CONFIRM_WORD)).toBeNull();

        const counts = Board.counts();
        // Nobody in the game: only an empty barony, and the notice to admins.
        expect(Object.fromEntries(Object.entries(counts).filter(([, n]) => n)))
            .toEqual({ game_parcels: 6, game_barony_parts: 5, game_baronies: 1, game_notifications: 1 });
        expect(scalar('SELECT holder_anthro_id FROM game_baronies')).toBeNull(); // Nobody holds it...
        expect(count('SELECT COUNT(*) FROM game_barony_parts WHERE manager_anthro_id IS NOT NULL')).toBe(0); // ...or manages its parts...
        expect(count('SELECT COUNT(*) FROM game_parcels WHERE anthro_id IS NOT NULL')).toBe(0); // ...and its land is the land office's.
        const kinds = Object.fromEntries(db().pairs('SELECT kind, COUNT(*) FROM game_barony_parts GROUP BY kind'));
        expect(kinds).toEqual({ expanse: 1, town: 1, village: 3 }); // 3 villages, a town and an expanse.
        const acres = Number(scalar('SELECT SUM(acres) FROM game_parcels'));
        expect(acres >= 10000 && acres <= 15000).toBe(true);
        expect(Anthros.gameIsEmpty()).toBe(true);
        expect(Anthros.findAny(a.id)).toBeNull();
        expect(Anthros.player(boss.id)).toBeNull(); // Nobody is given an anthro.
        expect(count("SELECT COUNT(*) FROM game_names WHERE name = 'Kept'")).toBe(1); // Names are kept.
        expect(notificationsForUser(boss.id)).toHaveLength(1);
        expect(notificationsForUser(boss.id)[0].startsWith('boss reset the game, removing 3 anthros. The game is empty: the first player to create an anthro can start with a slave to breed with. An empty barony of ')).toBe(true);
        expect(Auth.find(alice.id)).not.toBeNull(); // Accounts are kept.
    });

    test('reset seats the court asked for', () => {
        const boss = admin();
        expect(Board.reset(boss, Board.CONFIRM_WORD, { 9: 2 })).toBe('King: 0 to 1 (there is one monarch).');
        expect(Board.reset(boss, Board.CONFIRM_WORD, { 8: 'lots' })).toBe('Duke: 0 to 1000.');

        expect(Board.reset(boss, Board.CONFIRM_WORD, { 9: 1, 4: 2, 3: 3, 2: 0 })).toBeNull();
        const ranks = db().pairs('SELECT title_rank, COUNT(*) FROM game_anthros WHERE title_rank IS NOT NULL GROUP BY title_rank ORDER BY title_rank DESC');
        expect([...ranks]).toEqual([[9, 1], [4, 2], [3, 3]]);
        const king = Ranks.monarch()!;
        expect(count('SELECT COUNT(*) FROM game_anthros WHERE spouse_of = ?', [king.id])).toBe(1); // His Queen consort.
        // Barons sworn to the King, the nearest rank above with anyone.
        expect(count('SELECT COUNT(*) FROM game_anthros WHERE title_rank = 4 AND liege_id <> ?', [king.id])).toBe(0);
        // Baronets spread over the barons.
        expect(db().column(
            'SELECT COUNT(*) FROM game_anthros v JOIN game_anthros l ON l.id = v.liege_id WHERE v.title_rank = 3 GROUP BY l.id ORDER BY COUNT(*) DESC',
        ).map(Number)).toEqual([2, 1]);
        expect(count('SELECT COUNT(*) FROM game_baronies')).toBe(3); // The crown's and each baron's.
        expect(count('SELECT COUNT(*) FROM game_barony_parts')).toBe(3); // A baronet's settlement each.
        expect(count('SELECT COUNT(*) FROM game_anthros WHERE title_rank IS NULL AND spouse_of IS NULL')).toBeGreaterThan(0); // Commoners.

        // Unseated: just the title holders.
        expect(Board.reset(boss, Board.CONFIRM_WORD, { 5: 2 }, false, false)).toBeNull();
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(2);
        // None seated: the one empty barony.
        expect([count('SELECT COUNT(*) FROM game_baronies'), scalar('SELECT holder_anthro_id FROM game_baronies')]).toEqual([1, null]);

        expect(Board.reset(boss, Board.CONFIRM_WORD, { 9: 0, 8: 0 })).toBeNull();
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(0); // No nobles at all: empty.
    });

    test('each day advanced is the next weekday', () => {
        const boss = admin();
        const alice = player('alice');
        const dmitri = playerAnthro(alice, { name: 'Dmitri' });
        const mate = anthro({ owner: alice, name: 'Mate', gender: 'Female' });
        const [groupId] = Groups.create(alice, 'Haven', [dmitri.id, mate.id]);
        // Breed on today's weekday only; forage the rest of the week.
        const today = Clock.weekday();
        const days = week({ activity: 'work', detail: 'f' });
        days[today] = { activity: 'breed', detail: 'g:' + groupId };
        expect(Schedules.setWeekly(alice, dmitri, days)).toBeNull();

        expect(Board.advance(boss, 7)).toBeNull();
        expect(Clock.daysAdvanced()).toBe(7);
        expect(Clock.weekday()).toBe(today); // A week on: the same weekday.
        const activities = Object.fromEntries(db().pairs('SELECT activity, COUNT(*) FROM game_schedule_log WHERE anthro_id = ? GROUP BY activity', [dmitri.id]));
        // Seven different weekdays, not the same one seven times.
        expect(activities).toEqual({ breed: 1, forage: 6 });

        expect(Board.advance(boss, 1)).toBeNull();
        expect(Clock.weekday()).toBe(today % 7 + 1); // One more day: the next weekday.
        expect(Board.reset(boss, Board.CONFIRM_WORD)).toBeNull();
        expect(Clock.daysAdvanced()).toBe(0); // A new game starts its own calendar.
    });

    test('advancing time moves every date and runs each day', () => {
        const boss = admin();
        const alice = player('alice');
        let sire = playerAnthro(alice, { name: 'Sire' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Dam' });
        Litters.attempt(sire, dam, null, false);
        db().run('UPDATE game_litters SET due_on = ADDDATE(UTC_DATE(), 2)');
        const skill = count("SELECT id FROM game_skills WHERE name = 'Letters'");
        Schedules.setWeekly(alice, sire, week({ activity: 'train', detail: 's:' + skill }));
        db().run("UPDATE game_goods SET quantity = 100 WHERE anthro_id = ? AND good = 'food'", [sire.id]);
        Board.runDaily();
        const born = sire.birthdate;

        expect(Board.advance(boss, 0)).toBe('Advance the game 1 to 365 days.');
        expect(Board.advance(boss, 3)).toBeNull();

        sire = refresh(sire);
        expect(sire.birthdate).toBe(gmdate('Y-m-d', strtotimeOrThrow(born + ' UTC -3 days'))); // Three days older.
        expect(count('SELECT COUNT(*) FROM game_anthros WHERE dam_id = ?', [dam.id])).toBe(1); // The litter came due and was born.
        expect(count('SELECT COUNT(*) FROM game_schedule_log WHERE anthro_id = ?', [sire.id])).toBe(4); // Today, and each day since.
        expect(Schedules.skillsOf(sire.id)[0].practice).toBe(4);
        // Four days of meals for two, and for the cub once it was born.
        expect(Goods.amount(sire.id)).toBe(100 - 2 - 2 - 3 - 3);
        expect(notificationsForUser(boss.id)).toContain('boss moved the game 3 days ahead.');
    });

    test('a daily report', () => {
        const alice = player('alice');
        const frost = playerAnthro(alice, { name: 'Frost' });
        const alma = anthro({ owner: alice, name: 'Alma' });
        const bob = player('bobby');
        const pet = playerAnthro(bob, { name: 'Pet', owner: alice });
        db().run("UPDATE game_goods SET quantity = 2 WHERE anthro_id = ? AND good = 'food'", [frost.id]);
        setCoins(frost.id, 0);
        for (const a of [frost, alma, pet]) {
            Schedules.planDay(alice, a, gmdate('Y-m-d'), 'work', 'f');
        }
        Board.runDaily();

        const report = notificationsFor(frost.id)[0];
        expect(report.startsWith("The day's report. Frost: Foraged ")).toBe(true);
        expect(report).toContain(' Alma: Foraged ');
        expect(report).toContain(' Pet: Foraged ');
        // Upstream: SUM(CAST(REGEXP_SUBSTR(outcome, '[0-9]+') AS UNSIGNED)); SQLite has no REGEXP_SUBSTR.
        const gathered = db().column('SELECT outcome FROM game_schedule_log')
            .reduce((sum: number, outcome: string) => sum + Number(outcome.match(/[0-9]+/)?.[0] ?? 0), 0);
        expect(report).toContain(`Food: ${gathered} gathered, 2 eaten, ${gathered} in store.`); // Three mouths, two meals...
        expect(report.endsWith('Went hungry: Pet.')).toBe(true); // ...and the last in line went hungry (but could still forage).
        expect(notificationsFor(pet.id)[0].startsWith('Your day: Foraged ')).toBe(true); // Its own player hears too.
        expect(notificationsFor(pet.id)[0].endsWith('You went hungry.')).toBe(true);

        const reports = () => notificationsFor(frost.id).filter((n) => n.startsWith("The day's report."));
        Board.runDaily();
        expect(reports()).toHaveLength(1); // Once a day.
        expect(Board.advance(admin(), 2)).toBeNull();
        expect(reports()).toHaveLength(3); // One for each day, kept apart.
    });

    // Not upstream: dates that are part of a key (upstream moves them with UPDATE ... ORDER BY `day`).
    test('advancing moves days that are part of a key without collisions', () => {
        const boss = admin();
        const alice = player('alice');
        const a = playerAnthro(alice);
        const day = (n: number) => gmdate('Y-m-d', strtotimeOrThrow(`${n} days`));
        for (let n = -3; n <= 3; n++) {
            db().run("INSERT INTO game_schedule_days (anthro_id, day, activity) VALUES (?, ?, 'rest')", [a.id, day(n)]);
            db().run("INSERT OR IGNORE INTO game_daily (day, task) VALUES (?, 'test')", [day(n)]);
        }
        expect(Board.advance(boss, 1)).toBeNull();
        // (The day's business may tidy away past plans: look at today's and later.)
        const days = db().column('SELECT day FROM game_schedule_days WHERE anthro_id = ? AND day >= ? ORDER BY day', [a.id, day(0)]);
        expect(days).toEqual([0, 1, 2].map(day));
        expect(db().column("SELECT day FROM game_daily WHERE task = 'test' ORDER BY day")).toEqual([-4, -3, -2, -1, 0, 1, 2].map(day));
    });
});
