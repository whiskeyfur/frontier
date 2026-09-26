// Upstream: tests/Game/AppTest.php (the schedule, standard schedule and land pages)
import { describe, expect, test } from 'vitest';
import { gmdate, strtotimeOrThrow } from '../../../src/core/php';
import { Schedules } from '../../../src/game/Schedules';
import { flash, get, post, request } from '../../AppHarness';
import { admin, anthro, baronyId, db, player, playerAnthro, scalar } from '../../TestCase';

/** array_fill(1, 7, value): {1: value, ..., 7: value}. */
function week(value: Record<string, string>): Record<number, Record<string, string>> {
    const days: Record<number, Record<string, string>> = {};
    for (let day = 1; day <= 7; day++) {
        days[day] = { ...value };
    }
    return days;
}

describe('App: schedules and land', () => {
    test('splitting and merging on the land page', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        db().run('INSERT INTO game_parcels (anthro_id, acres, barony_id) VALUES (?, 6, ?)', [me.id, baronyId()]);
        const parcel = db().lastInsertId();
        let page = get('/game/assets/land', alice);
        expect(page).toContain('id="split-' + parcel + '"');

        post('/game/assets/land', { action: 'split', parcel_id: parcel, acres: 2 }, alice);
        const added = Number(scalar('SELECT MAX(id) FROM game_parcels'));
        expect(flash()).toBe(`Split off lot #${added}.`);
        expect(get('/game/assets/land', alice)).toContain('Merge selected');
        post('/game/assets/land', { action: 'merge', ids: [parcel, added] }, alice);
        expect(flash()).toBe(`Merged into lot #${parcel}.`);
        [, , page] = request('POST', '/game/assets/land', { action: 'merge', ids: [parcel] }, alice);
        expect(page).toContain('Choose at least two lots to merge.');

        const boss = admin();
        post('/game/admin/land', { action: 'split', parcel_id: parcel, acres: 1 }, boss);
        expect(String(flash()).startsWith('Split off lot #')).toBe(true);
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels'))).toBe(2);
    });

    test('the schedule page', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        expect(get('/game/home', alice)).toContain('/game/assets/' + me.id + '/schedule');
        const page = get('/game/assets/' + me.id + '/schedule', alice);
        expect(page).toContain('Weekly routine');
        expect(page).toContain('>Witchcraft</option>');
        expect(page, 'Not learned yet; a craftsman, by recipe.').toMatch(/>\s*Baker: Bread \(train at Cooking first; 2 flour → 3 bread\)\s*<\/option>/u);
        expect(page, 'A service job.').toMatch(/>Scribe \(train at Letters first; paid in coins\)<\/option>/);
        expect(page).toMatch(/>\s*Farmer: Hops \(train at Agriculture first; 3 hops \(on 10 acres of land\)\)\s*<\/option>/u);
        db().run("INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, 1 FROM game_skills WHERE name = 'Cooking'", [me.id]);
        expect(get('/game/assets/' + me.id + '/schedule', alice), 'Trained: it can work at it.').toMatch(/>\s*Baker: Bread \(Cooking; 2 flour → 3 bread\)\s*<\/option>/u);
        expect(page).toContain('>Clear land in the wilds</option>');
        const days = week({ activity: 'work', detail: 'o:' + scalar("SELECT id FROM game_occupations WHERE title = 'Miller'") });
        post('/game/assets/' + me.id + '/schedule', { action: 'weekly', days }, alice);
        expect(flash()).toBe(`Saved ${me.name}'s weekly routine.`);
        const skill = Number(scalar("SELECT id FROM game_skills WHERE name = 'Witchcraft'"));
        const day = gmdate('Y-m-d', strtotimeOrThrow('+2 days'));
        post('/game/assets/' + me.id + '/schedule', { action: 'plan', date: day, activity: 'train', detail: 's:' + skill }, alice);
        const after = get('/game/assets/' + me.id + '/schedule', alice);
        expect(after).toContain('Train: Witchcraft');
        expect(after).toContain('Work as Miller (Milling)');
        const [status] = request('GET', '/game/assets/' + me.id + '/schedule', {}, player('bobby'));
        expect(status, 'Only for whoever plans its days.').toBe(404);
    });

    test('scheduling several anthros at once', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Mate' });
        const serf = anthro({ owner: alice, name: 'Serf' });
        expect(get('/game/assets/slaves', alice)).toContain('Set their weekly routine');
        expect(get('/game/assets', alice)).toContain('name="week[1][activity]"');

        const farmer = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Farmer'"));
        const days = week({ activity: 'work', detail: 'o:' + farmer });
        days[3] = { activity: 'breed', detail: 'p:' + mate.id };
        const [, location] = request('POST', '/game/assets/group', { action: 'schedule_week', ids: [mate.id, serf.id], week: days,
            back: '/game/assets/slaves' }, alice);
        expect(location, 'Back to the tab it came from.').toBe('/game/assets/slaves');
        expect(flash(), 'Mate can\'t breed with herself.').toEqual(['Set the weekly routine of Serf.', 'Skipped Mate: Wednesday: Choose who to breed with, or which breeding group.']);
        expect(Schedules.weekly(serf.id)[1].activity).toBe('work');

        const day = gmdate('Y-m-d', strtotimeOrThrow('+2 days'));
        post('/game/assets/group', { action: 'schedule_day', ids: [mate.id, serf.id], plan_date: day,
            plan_activity: 'work', plan_detail: 'f' }, alice);
        expect(flash()).toEqual([`Planned ${day} for Mate, Serf.`]);
        expect(Schedules.planned(mate.id)[day].activity).toBe('forage');
    });

    test('standard schedule pages', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const serf = anthro({ owner: alice, name: 'Serf' });
        const mate = anthro({ owner: alice, gender: 'Female', name: 'Mate' });
        expect(get('/game/assets/schedules', alice)).toContain("You don't have any standard schedules yet.");
        const [, location] = request('POST', '/game/assets/schedules', { name: "Smith's week" }, alice);
        const id = Number(scalar('SELECT id FROM game_standard_schedules'));
        expect(location).toBe('/game/assets/schedules/' + id);
        const page = get(location!, alice);
        expect(page).toContain('name="days[1][activity]"');
        expect(page).toContain('confirm(&quot;Remove Smith&#039;s week?');

        post(location!, { action: 'week', days: week({ activity: 'work', detail: 'f' }) }, alice);
        expect(flash()).toBe("Saved Smith's week.");
        const [status] = request('GET', location!, {}, player('bobby'));
        expect(status, 'Only its player sees it.').toBe(404);

        // Followed from the anthro's schedule page, or several at once.
        expect(get('/game/assets/' + serf.id + '/schedule', alice)).toContain('Smith&#039;s week</option>');
        post('/game/assets/' + serf.id + '/schedule', { action: 'follow', standard_id: id }, alice);
        expect(flash()).toBe("Serf follows Smith's week now.");
        expect(get('/game/assets/' + serf.id + '/schedule', alice)).toContain('Following the standard schedule <strong>Smith&#039;s week</strong>');
        post('/game/assets/group', { action: 'schedule_standard', ids: [mate.id, serf.id], standard_id: id }, alice);
        expect(flash()).toEqual(["Mate, Serf follow Smith's week now."]);
        expect(get('/game/assets/schedules', alice)).toContain('2 anthros follow it');
        expect(get('/game/assets/slaves', alice), 'Listed with the anthros following it.')
            .toContain('<a href="/game/assets/schedules/' + id + '">Smith&#039;s week</a>');
        expect(get('/game/assets', alice), 'Alice has her own.').toContain('own routine</a>');

        // Setting their routine as a group has them follow it instead.
        post('/game/assets/group', { action: 'schedule_week', ids: [mate.id], week: week({ activity: 'rest' }) }, alice);
        expect(Schedules.standardFor(mate.id)).toBeNull();
        post(location!, { action: 'delete' }, alice);
        expect(flash()).toBe("Removed Smith's week: its followers are back on their own routines.");
        expect(Schedules.standardFor(serf.id)).toBeNull();
    });

    test('admins schedule others from the panel only', () => {
        const boss = admin();
        playerAnthro(boss);
        const perrin = anthro({ name: 'Perrin' });
        let page = get('/game/assets/' + perrin.id, boss);
        const button = '<a class="btn btn-outline-primary" href="/game/assets/' + perrin.id + '/schedule">Schedule</a>';
        expect(page, 'Not in the player view: the admin neither owns nor plays Perrin.').not.toContain(button);
        expect(page).toContain('/game/assets/' + perrin.id + '/schedule">Schedule (admin)</a>');
        const [status] = request('GET', '/game/assets/' + perrin.id + '/schedule', {}, boss);
        expect(status, 'Still open to admins.').toBe(200);

        const mine = anthro({ owner: boss, name: 'Mine' });
        page = get('/game/assets/' + mine.id, boss);
        expect(page, 'Its own anthros, as a player.').toContain('href="/game/assets/' + mine.id + '/schedule">Schedule</a>');
        expect(page).not.toContain('Schedule (admin)');
    });

    test('an invalid routine keeps what was entered', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        // Foraging and clearing land in turn, and Sunday "work" at nothing.
        const days: Record<number, Record<string, string>> = {};
        for (let day = 1; day <= 6; day++) {
            days[day] = { activity: 'work', detail: day % 2 ? 'f' : 'c:wilds' };
        }
        days[7] = { activity: 'work', detail: '' };
        const [, location, page] = request('POST', '/game/assets/' + me.id + '/schedule', { action: 'weekly', days }, alice);
        expect(location).toBeNull();
        expect(page).toContain('Sunday: Choose what to work at');
        expect(page.match(/<option value="f"\s+selected>/g) ?? [], 'Monday, Wednesday and Friday still forage...').toHaveLength(3);
        expect(page.match(/<option value="c:wilds"\s+selected>/g) ?? [], '...and the other days clear land.').toHaveLength(3);
        expect(page.match(/is-invalid[^>]*name="days\[7\]/g) ?? [], 'Sunday is marked.').toHaveLength(2);
        expect(page.split('is-invalid').length - 1, 'Only Sunday.').toBe(2);
        expect(Schedules.weekly(me.id)[1].activity, 'Nothing was saved.').toBe('rest');
    });

    test('a newborn\'s schedule page', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const baby = anthro({ owner: alice, name: 'Baby', young: 1, birthdate: gmdate('Y-m-d', strtotimeOrThrow('-1 week')),
            fertile_on: gmdate('Y-m-d', strtotimeOrThrow('+9 weeks')) });
        const page = get('/game/assets/' + baby.id + '/schedule', alice).replace(/\s+/g, ' ');
        expect(page).toContain('Baby is under 5 weeks old, and only rests until');
        expect(page, 'No routine to set.').not.toContain('value="weekly"');
        expect(page).toContain('The next two weeks');
    });
});
