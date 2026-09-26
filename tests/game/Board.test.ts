// Upstream: tests/Game/BoardTest.php
import { describe, expect, test } from 'vitest';
import { Auth } from '../../src/core/Auth';
import { gmdate, int } from '../../src/core/php';
import { Anthros } from '../../src/game/Anthros';
import { Board } from '../../src/game/Board';
import { Clock } from '../../src/game/Clock';
import { Crafts } from '../../src/game/Crafts';
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
        // Empty but for the day claimed by the test setup, and the clock.
        expect(Object.fromEntries(Object.entries(counts).filter(([, n]) => n))).toEqual({ game_daily: 1, game_settings: 4 });
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
        // An empty barony, the notice to admins, and the commoners.
        expect([counts.game_barony_parts, counts.game_baronies, counts.game_notifications, counts.game_anthros]).toEqual([5, 1, 1, Ranks.MIN_COMMONERS]);
        // Enough food trades to feed everyone (at a Journeyman's output, and some over), farmers with their farmland.
        let food = 0;
        for (const row of db().all('SELECT a.id, a.trade_recipe_id FROM game_anthros a WHERE a.trade_recipe_id IS NOT NULL')) {
            const recipe = [...Crafts.byOccupation().values()].flat().filter((r) => r.id === int(row.trade_recipe_id))[0];
            food += Object.entries(recipe.out).filter(([good]) => Goods.edibles().includes(good)).reduce((sum, [, n]) => sum + n, 0) * Crafts.OUTPUT.Journeyman;
            if (recipe.needs_acres !== null) {
                expect(Land.totalAcres(int(row.id)), 'A farmer has its land.').toBeGreaterThanOrEqual(recipe.needs_acres);
            }
        }
        expect(food, `Food for all: ${food} a day.`).toBeGreaterThanOrEqual(Ranks.MIN_COMMONERS * Goods.FOOD_PER_DAY);
        const farmers = count("SELECT COUNT(*) FROM game_anthros a JOIN game_occupations o ON o.id = a.trade_occupation_id WHERE o.title = 'Farmer'");
        expect(farmers).toBeGreaterThan(0);
        expect(counts.game_parcels, "The barony's lots, and one for each farmer.").toBe(6 + farmers);
        // Every trade is someone's, as a Journeyman.
        const occupations = [...Schedules.occupations().keys()];
        const trades = db().column('SELECT DISTINCT trade_occupation_id FROM game_anthros').map(int);
        expect(occupations.filter((o) => !trades.includes(o)), 'Every occupation.').toEqual([]);
        expect(count(`SELECT COUNT(*) FROM game_anthros a LEFT JOIN game_occupations o ON o.id = a.trade_occupation_id
            LEFT JOIN game_anthro_skills k ON k.anthro_id = a.id AND k.skill_id = o.skill_id WHERE k.practice IS NULL OR k.practice < 28`), 'Each a Journeyman.').toBe(0);
        expect(count('SELECT COUNT(*) FROM game_anthros WHERE player_id IS NOT NULL OR title_rank IS NOT NULL OR owner_id <> id'), 'Free, unplayed commoners.').toBe(0);
        expect(Clock.today(), 'A new game starts on 1200-01-01...').toBe(Clock.START);
        expect(scalar('SELECT holder_anthro_id FROM game_baronies')).toBeNull(); // Nobody holds it...
        expect(count('SELECT COUNT(*) FROM game_barony_parts WHERE manager_anthro_id IS NOT NULL')).toBe(0); // ...or manages its parts...
        expect(count('SELECT COUNT(*) FROM game_parcels WHERE anthro_id IS NOT NULL')).toBe(farmers); // ...and its land is the land office's, but the farmers'.
        const kinds = Object.fromEntries(db().pairs('SELECT kind, COUNT(*) FROM game_barony_parts GROUP BY kind'));
        expect(kinds).toEqual({ expanse: 1, town: 1, village: 3 }); // 3 villages, a town and an expanse.
        const acres = Number(scalar('SELECT SUM(acres) FROM game_parcels'));
        expect(acres >= 10000 && acres <= 15000).toBe(true);
        expect(Anthros.findAny(a.id)).toBeNull();
        expect(Anthros.player(boss.id)).toBeNull(); // Nobody is given an anthro.
        expect(count("SELECT COUNT(*) FROM game_names WHERE name = 'Kept'")).toBe(1); // Names are kept.
        expect(notificationsForUser(boss.id)).toHaveLength(1);
        expect(notificationsForUser(boss.id)[0].startsWith("boss reset the game (starting on 1200-01-01), removing 3 anthros, and seated 100 commoners, with no court. Every trade is someone's. An empty barony of ")).toBe(true);
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

        // Unseated: just the title holders, and the commoners every game has.
        expect(Board.reset(boss, Board.CONFIRM_WORD, { 5: 2 }, false, false)).toBeNull();
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(2 + Ranks.MIN_COMMONERS);
        // None seated: the one empty barony.
        expect([count('SELECT COUNT(*) FROM game_baronies'), scalar('SELECT holder_anthro_id FROM game_baronies')]).toEqual([1, null]);

        // At least so many commoners and settlements: the court's count, and the rest are added.
        expect(Board.reset(boss, Board.CONFIRM_WORD, {}, true, true, '1200-01-01', { commoners: '50' })).toBe('Commoners: 100 to 10,000.');
        expect(Board.reset(boss, Board.CONFIRM_WORD, {}, true, true, '1200-01-01', { city: 'many' })).toBe('Cities: 0 to 200.');
        expect(Board.reset(boss, Board.CONFIRM_WORD, {}, true, true, '1200-01-01', { commoners: '150', village: '5', town: '1', city: '2' })).toBeNull();
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(150);
        const kinds = db().pairs('SELECT kind, COUNT(*) FROM game_barony_parts GROUP BY kind');
        // The empty barony's 3 villages and town, and 2 villages and 2 cities more.
        expect([kinds.get('village'), kinds.get('town'), kinds.get('city')].map(Number)).toEqual([5, 1, 2]);
        expect(count('SELECT COUNT(*) FROM game_barony_parts p WHERE NOT EXISTS (SELECT 1 FROM game_parcels l WHERE l.part_id = p.id)'), 'Each with land.').toBe(0);

        expect(Board.reset(boss, Board.CONFIRM_WORD, { 9: 0, 8: 0 })).toBeNull();
        expect(count('SELECT COUNT(*) FROM game_anthros')).toBe(Ranks.MIN_COMMONERS); // No nobles at all: only commoners.
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

        const start = Clock.today();
        expect(Board.advance(boss, 7)).toBeNull();
        expect(Clock.today()).toBe(Clock.add(start, 7)); // The calendar moves on...
        expect(Clock.weekday()).toBe(today); // A week on: the same weekday.
        const activities = Object.fromEntries(db().pairs('SELECT activity, COUNT(*) FROM game_schedule_log WHERE anthro_id = ? GROUP BY activity', [dmitri.id]));
        // Today (its weekday: breeding) and the seven days after, each its own weekday, not the same one seven times.
        expect(activities).toEqual({ breed: 2, forage: 6 });

        expect(Board.advance(boss, 1)).toBeNull();
        expect(Clock.weekday()).toBe(today % 7 + 1); // One more day: the next weekday.
        expect(Board.reset(boss, Board.CONFIRM_WORD, {}, true, true, '1200-13-01')).toBe('Start the game on a date (year 1000 or later), like 1200-01-01.');
        expect(Board.reset(boss, Board.CONFIRM_WORD, {}, true, true, '1350-06-24')).toBeNull();
        expect(Clock.today()).toBe('1350-06-24'); // A new game starts on the date asked for.
    });

    test('advancing time moves every date and runs each day', () => {
        const boss = admin();
        const alice = player('alice');
        let sire = playerAnthro(alice, { name: 'Sire' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Dam' });
        Litters.attempt(sire, dam, null, false);
        db().run('UPDATE game_litters SET due_on = ?', [Clock.today(2)]);
        const skill = count("SELECT id FROM game_skills WHERE name = 'Letters'");
        Schedules.setWeekly(alice, sire, week({ activity: 'train', detail: 's:' + skill }));
        db().run("UPDATE game_goods SET quantity = 100 WHERE anthro_id = ? AND good = 'food'", [sire.id]);
        Board.runDaily();
        const age = Anthros.ageWeeks(sire.birthdate)! * 7;
        const today = Clock.today();

        expect(Board.advance(boss, 0)).toBe('Advance the game 1 to 365 days.');
        expect(Board.advance(boss, 3)).toBeNull();

        sire = refresh(sire);
        expect(Clock.today()).toBe(Clock.add(today, 3)); // The calendar is three days on...
        expect(Clock.daysBetween(sire.birthdate)).toBe(Clock.daysBetween(sire.birthdate, today) + 3); // ...and everyone three days older.
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
});
