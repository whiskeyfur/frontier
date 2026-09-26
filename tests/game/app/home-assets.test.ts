// Upstream: tests/Game/AppTest.php (the home page and an anthro's page)
import { describe, expect, test } from 'vitest';
import { gmdate, strtotimeOrThrow } from '../../../src/core/php';
import type { Row } from '../../../src/db/Db';
import { Anthros } from '../../../src/game/Anthros';
import { Groups } from '../../../src/game/Groups';
import { Litters } from '../../../src/game/Litters';
import { flash, get, post, request } from '../../AppHarness';
import {
    admin, anthro, anthroOf, db, genderId, player, playerAnthro, refresh, scalar, setCoins, speciesId,
} from '../../TestCase';

function life(a: Row, changes: Row = {}): Row {
    a = refresh(a);
    return {
        birthdate: a.birthdate, fertile_on: a.fertile_on, fertile_until: a.fertile_until,
        dies_on: Anthros.diesOn(a), fertile_weekday: a.fertile_weekday, max_cubs: a.max_cubs, ...changes,
    };
}

/** The "This page" part of the admin panel: the page's own admin controls ('' if none, or no panel). */
function panel(page: string): string {
    const start = page.indexOf('id="admin-panel"');
    return start === -1 ? '' : page.substring(start, page.indexOf('>Admin pages</h3>', start));
}

/** The page without its admin panel. */
function body(page: string): string {
    return page.split(panel(page)).join('');
}

describe('App: home and anthro pages', () => {
    test('creating your anthro', () => {
        const alice = player('alice');
        const location = post('/game/home', {
            name: 'Fenn', gender_id: genderId('Male'), species_id: speciesId(), birthdate: gmdate('Y-m-d', strtotimeOrThrow('-10 weeks')),
        }, alice);
        expect(location).toBe('/game/home');
        expect(Anthros.player(alice.id)!.name).toBe('Fenn');
        expect(get('/game/home', alice)).toContain('Your details are saved.');
    });

    test('form errors are shown', () => {
        const [, location, page] = request('POST', '/game/home', { name: '', gender_id: 0, species_id: 0 }, player('alice'));
        expect(location).toBeNull();
        expect(page).toContain('Names must be 1-64 characters.');
    });

    test('becoming an anthro', () => {
        const alice = player('alice');
        const free = anthro({ name: 'Wanderer' });
        anthro({ name: 'Duchess', title_rank: 8 });
        const home = get('/game/home', alice);
        expect(home).toContain('Wanderer');
        expect(home, "Players aren't offered nobles.").not.toContain('Duchess');
        post('/game/home', { action: 'become', anthro_id: free.id }, alice);
        expect(flash()).toBe('You are now Wanderer.');
        expect(Anthros.player(alice.id)!.id).toBe(free.id);
    });

    test('any player can look but only owners act', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const pet = anthro({ owner: alice, name: 'Pet', debt: 40, debt_since: gmdate('Y-m-d H:i:s') });
        const mine = get('/game/assets/' + pet.id, alice);
        expect(mine).toContain('/rename');
        expect(mine).toContain('40 coins');

        const theirs = get('/game/assets/' + pet.id, bob);
        expect(theirs).toContain('Pet');
        for (const secret of ['/rename', '/transfer', '/sell', '/debt', '/breed', '40 coins']) {
            expect(theirs, `A stranger sees ${secret}.`).not.toContain(secret);
        }
        expect(theirs).toContain('href="/game/court"');
        for (const [action, fields] of Object.entries({ '/rename': { name: 'Mine' }, '/debt': { debt: '' }, '/sell': { starting_bid: 1, days: 1 } })) {
            const [status] = request('POST', '/game/assets/' + pet.id + action, fields, bob);
            expect(status, action).toBe(404);
        }
        expect(refresh(pet).name).toBe('Pet');
        const [status] = request('GET', '/game/assets/999999', {}, alice);
        expect(status).toBe(404);
    });

    test('the secret weekday is only shown to admins', () => {
        const alice = player('alice');
        const dam = anthro({ owner: alice, gender: 'Female', fertile_weekday: 3 });
        expect(get('/game/assets/' + dam.id, alice)).not.toContain('Wednesday');
        const page = get('/game/assets/' + dam.id, admin());
        expect(panel(page), 'In the admin panel...').toMatch(/<option value="3"\s+selected\s*>Wednesday<\/option>/);
        expect(body(page), '...not the page.').not.toContain('Wednesday');
        const [status] = request('POST', '/game/assets/' + dam.id + '/life', { fertile_on: '', fertile_weekday: 1 }, alice);
        expect(status).toBe(404);
    });

    test('only dams have a conception day', () => {
        const boss = admin();
        const sire = anthro({ gender: 'Male', name: 'Mack', fertile_weekday: 3 });
        const herm = anthro({ gender: 'Herm', fertile_weekday: 3 });
        const page = get('/game/assets/' + sire.id, boss);
        expect(page).not.toContain('fertile_weekday');
        expect(page).not.toContain('conceives on');
        expect(get('/game/assets/' + herm.id, boss), 'Herms can be dams.').toContain('name="fertile_weekday"');

        post('/game/assets/' + sire.id + '/life', life(sire, { fertile_on: sire.birthdate }), boss);
        expect(refresh(sire).fertile_on, 'Saved without a day.').toBe(sire.birthdate);
        expect(refresh(sire).fertile_weekday, 'Left alone.').toBe(3);
    });

    test('breeding from the breed page', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice, gender: 'Male' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Fern' });
        get('/game/assets/' + sire.id + '/breed', alice);
        post('/game/assets/' + sire.id + '/breed', { sire_id: sire.id, dam_id: dam.id }, alice);
        expect(String(flash()).startsWith('Fern is pregnant: a litter of 1 cub')).toBe(true);

        post('/game/assets/' + sire.id + '/breed', { sire_id: dam.id, dam_id: sire.id }, alice);
        expect(flash()).toContain('no litter will come of it');
        expect(get('/game/assets/' + sire.id, alice)).toContain('No litter');
    });

    test('rename, transfer and debt', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(bob);
        const pet = anthro({ owner: alice, name: 'Pet' });
        post('/game/assets/' + pet.id + '/rename', { name: 'Buddy' }, alice);
        expect(refresh(pet).name).toBe('Buddy');
        post('/game/assets/' + pet.id + '/debt', { debt: '50', debt_rate: '2' }, alice);
        expect(Math.trunc(refresh(pet).debt)).toBe(50);
        const wren = anthroOf(bob);
        post('/game/assets/' + pet.id + '/transfer', { to: 'BobbyAnthro (#' + wren + ')' }, alice);
        expect(refresh(pet).owner_id).toBe(wren);
        expect(get('/game/assets/' + pet.id, alice), 'The old owner can only look now.').not.toContain('/rename');
        expect(get('/game/assets/' + pet.id, bob)).toContain('/rename');
    });

    test('buying freedom from home', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const bob = player('bobby');
        const slave = playerAnthro(bob, { owner: alice });
        Anthros.setDebt(slave, '10', 0);
        setCoins(slave.id, 10);
        expect(get('/game/home', bob)).toContain('Buy my freedom');
        post('/game/home', { action: 'buy_freedom' }, bob);
        expect(refresh(slave).owner_id, 'Free: it owns itself.').toBe(slave.id);
    });

    test("an anthro's admin controls are in the panel", () => {
        const alice = player('alice');
        playerAnthro(alice);
        const dam = anthro({ name: 'Damsel', gender: 'female', owner: alice });
        const boss = admin();
        playerAnthro(boss);

        let page = get('/game/assets/' + dam.id, boss);
        const controls = panel(page);
        for (const control of ['Force breed', '/life"', 'Rename', 'Give']) {
            expect(controls, control).toContain(control);
        }
        const rest = body(page);
        expect(rest).not.toContain('/game/admin/breed?');
        expect(rest, 'Not the owner: no rename in the page.').not.toContain('/game/assets/' + dam.id + '/rename');

        // Who plays an anthro and who renamed it are in the panel too, never the page.
        const played = playerAnthro(player('bobby'), { name: 'Bobbo' });
        Anthros.rename(played, 'Bobbin', boss.id);
        page = get('/game/assets/' + played.id, boss);
        expect(panel(page)).toContain('played by bobby');
        expect(panel(page)).toContain('Bobbo &rarr; Bobbin,');
        expect(panel(page)).toContain('by boss');
        expect(body(page)).not.toContain('bobby');
        expect(body(page)).not.toContain('by boss');

        // Her owner renames her in the page, as usual.
        const owners = get('/game/assets/' + dam.id, alice);
        expect(owners).toContain('/game/assets/' + dam.id + '/rename');
        expect(owners).not.toContain('id="admin-panel"');
    });

    test('admins become nobles and edit their anthro from the panel', () => {
        anthro({ name: 'Dukey', title_rank: 8 });
        anthro({ name: 'Plainy' });
        const boss = admin();

        let page = get('/game/home', boss);
        expect(panel(page)).toContain('Dukey, Duke');
        expect(body(page), 'The page lists what players can become.').not.toContain('Dukey');
        expect(body(page)).toContain('Plainy');
        expect(page).not.toContain('<th>Rank</th>');

        playerAnthro(boss);
        page = get('/game/home', boss);
        expect(panel(page), 'Full edit in the panel.').toContain('id="admin-species_id"');
        expect(body(page), 'Rename only in the page.').not.toContain('id="species_id"');
        expect(body(page)).toContain('>Rename</button>');
    });

    test('aging on the anthro page', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const aged = anthro({ name: 'Aged', lifespan_weeks: 60 });
        const boss = admin();

        let page = get('/game/assets/' + aged.id, alice);
        const diesOn = Anthros.diesOn(aged)!;
        expect(page, 'Players never see the lifespan.').not.toContain(diesOn);
        page = get('/game/assets/' + aged.id, boss);
        expect(panel(page)).toContain('value="' + diesOn + '"');
        expect(body(page), 'Only in the admin panel.').not.toContain(diesOn);
        expect(panel(page)).toContain('/life"');

        // Its death moved to before today: it dies on the next request.
        post('/game/assets/' + aged.id + '/life',
            life(aged, { dies_on: gmdate('Y-m-d', strtotimeOrThrow(aged.birthdate + ' UTC +70 days')) }), boss);
        page = get('/game/assets/' + aged.id, alice);
        expect(page).toContain('>Deceased</span>');
        expect(page).toMatch(new RegExp('<dt class="col-sm-3">Died</dt>\\s*<dd class="col-sm-9">' + gmdate('Y-m-d') + ', aged 20 weeks'));
        expect(page).not.toContain('href="/game/socials?to=');
        const [status] = request('POST', '/game/assets/' + aged.id + '/life', life(aged), alice);
        expect(status, 'Admins only.').toBe(404);
    });

    test('admins set when a dam stops conceiving', () => {
        const boss = admin();
        const dam = anthro({ gender: 'Female', birthdate: '2026-01-01', lifespan_weeks: 80 });
        let page = get('/game/assets/' + dam.id, boss);
        expect(panel(page)).toMatch(/min="2026-11-26"\s+max="2026-12-31"/);
        expect(panel(get('/game/assets/' + anthro().id, boss)), "Sires don't stop.").not.toContain('name="fertile_until"');
        post('/game/assets/' + dam.id + '/life', life(dam, { fertile_until: '2026-12-02' }), boss);
        expect(refresh(dam).fertile_until).toBe('2026-12-02');
        page = get('/game/assets/' + dam.id, player('alice'));
        expect(page, "Players don't see it.").not.toContain('2026-12-02');
        expect(page).toMatch(/<dt class="col-sm-3">Fertile<\/dt>\s*<dd class="col-sm-9">\s*yes, since/s);
    });

    test('breed page takes a number of attempts', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const sire = anthro({ owner: alice, name: 'Rex' });
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Fay' });
        const page = get('/game/assets/' + dam.id + '/breed', alice);
        expect(page).toMatch(/name="times" type="number" min="1"\s+max="8" value="1"/);

        post('/game/assets/' + dam.id + '/breed', { sire_id: sire.id, dam_id: dam.id, times: 3 }, alice);
        expect(String(flash()).startsWith('Rex and Fay were bred 3 times (every time took). Fay is pregnant: a litter of 3 cubs')).toBe(true);
        post('/game/assets/' + dam.id + '/breed', { sire_id: sire.id, dam_id: dam.id, times: 8 }, alice);
        expect(String(flash()).startsWith('Rex and Fay were bred 5 times (every time took). Fay is pregnant: a litter of 8 cubs')).toBe(true);
        post('/game/assets/' + dam.id + '/breed', { sire_id: sire.id, dam_id: dam.id, times: 2 }, alice);
        expect(flash()).toBe('Rex and Fay were bred, but no litter will come of it: Fay litter full. It was recorded in their history.');
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(9);
    });

    test('max cubs on the anthro page', () => {
        const boss = admin();
        const dam = anthro({ gender: 'Female', max_cubs: 4 });
        expect(get('/game/assets/' + dam.id, player('alice')), "Players don't see it.").not.toContain('up to 4');
        const page = get('/game/assets/' + dam.id, boss);
        expect(panel(page)).toMatch(/name="max_cubs" type="number"[^>]*value="4"/s);
        expect(body(page)).not.toContain('up to 4');
        post('/game/assets/' + dam.id + '/life', life(dam, { max_cubs: 6 }), boss);
        expect(refresh(dam).max_cubs).toBe(6);
    });

    test('the life form lists birth, fertility, old age and death in order', () => {
        const boss = admin();
        const dam = anthro({ gender: 'Female', birthdate: '2026-01-01', fertile_on: '2026-03-10',
            fertile_until: '2026-12-01', lifespan_weeks: 76 });
        let controls = panel(get('/game/assets/' + dam.id, boss));
        const order = ['birthdate', 'fertile_on', 'fertile_until', 'dies_on'].map((field) => controls.indexOf('name="' + field + '"'));
        expect(order).not.toContain(-1);
        expect(new Set(order).size).toBe(order.length);
        expect(order, 'Born, fertile from, fertile until, dies on.').toEqual([...order].sort((a, b) => a - b));
        expect(controls, 'Death as a date.').toContain('value="2027-06-17"');
        expect(controls, 'Old age, as an age.').toContain('47 weeks old.');

        // A failed save shows the error and what was entered, with the panel open.
        const [, , page] = request('POST', '/game/assets/' + dam.id + '/life', {
            birthdate: '2026-01-01', fertile_on: '2026-03-10', fertile_until: '2026-12-01', dies_on: '2027-04-15',
            fertile_weekday: 1, max_cubs: 3,
        }, boss);
        controls = panel(page);
        expect(controls).toContain('Dies on must be at least 20 weeks after Fertile until');
        expect(controls).toContain('value="2027-04-15"');
        expect(controls).toContain('data-admin-open');
        expect(page).toContain("getOrCreateInstance('#admin-panel').show()");
        expect(Number(refresh(dam).lifespan_weeks), 'Nothing saved.').toBe(76);
    });

    test('herms breed themselves from the home page', () => {
        const alice = player('alice');
        playerAnthro(alice, { gender: 'Herm', name: 'Selby' });
        expect(get('/game/home', alice)).toContain('Breed thyself');
        post('/game/home', { action: 'self_breed', cubs: 2 }, alice);
        expect(String(flash()).startsWith('Selby bred itself 2 times (every time took). Selby is pregnant: a litter of 2 cubs')).toBe(true);

        const bob = player('bobby');
        playerAnthro(bob, { gender: 'Male' });
        expect(get('/game/home', bob), 'Herms only.').not.toContain('Breed thyself');

        // On an owned herm's own page, for its owner (not for others).
        const pet = anthro({ gender: 'Herm', name: 'Pet', owner: alice });
        expect(get('/game/assets/' + pet.id, alice)).toContain('action="/game/assets/' + pet.id + '/self-breed"');
        expect(get('/game/assets/' + pet.id, bob)).not.toContain('Breed thyself');

        // A herm with no partner can still breed itself: no "you need another anthro".
        const page = get('/game/assets/' + anthroOf(alice), alice);
        expect(page).toContain('Breed thyself');
        expect(page).not.toContain('You need another anthro');
        post('/game/assets/' + pet.id + '/self-breed', { cubs: 1 }, alice);
        expect(String(flash()).startsWith('Pet bred itself')).toBe(true);
        const [status] = request('POST', '/game/assets/' + pet.id + '/self-breed', { cubs: 1 }, bob);
        expect(status).toBe(404);
    });

    test('the first anthro can start with a slave', () => {
        const alice = player('alice');
        const page = get('/game/home', alice);
        expect(page, 'The game is empty.').toContain('A slave to breed with');
        expect(page).toContain("There's no one in the game yet: you'll be the first.");
        expect(page, 'No one to become.').not.toContain('become an anthro already in the game');
        expect(page).not.toContain('become one already in the game');
        const born = gmdate('Y-m-d', strtotimeOrThrow('-15 weeks'));
        post('/game/home', {
            name: 'Adam', gender_id: genderId('Male'), species_id: speciesId('Lion'), birthdate: born, starter: 'mate',
        }, alice);
        const adam = Anthros.player(alice.id)!;
        const slave = Anthros.findAny(Number(scalar('SELECT id FROM game_anthros WHERE id <> ?', [adam.id])))!;
        expect(flash()).toBe(`Welcome! ${slave.name} (Female) is yours to breed with.`);
        expect([slave.owner_id, slave.liege_id], 'Owned by and sworn to Adam.').toEqual([adam.id, adam.id]);
        expect([slave.gender, slave.species, slave.birthdate, slave.fertile_on], 'The opposite sex, the same species and age.')
            .toEqual(['Female', 'Lion', born, adam.fertile_on]);
        expect(slave.player_id).toBeNull();

        // No birthdate: both start just grown, fertile today.
        db().run('DELETE FROM game_anthros');
        const carol = player('carol');
        post('/game/home', { name: 'Eve', gender_id: genderId('Female'), species_id: speciesId(), birthdate: '', starter: 'mate' }, carol);
        const eve = Anthros.player(carol.id)!;
        const mate = Anthros.findAny(Number(scalar('SELECT id FROM game_anthros WHERE id <> ?', [eve.id])))!;
        expect(eve.fertile_on).toBe(gmdate('Y-m-d'));
        const weeks = Anthros.ageWeeks(eve.birthdate)!;
        expect(weeks >= 9 && weeks <= 12, 'Born just long enough ago.').toBe(true);
        expect([mate.birthdate, mate.fertile_on], 'Her slave too.').toEqual([eve.birthdate, eve.fertile_on]);
        expect(mate.gender).toBe('Male');

        // Only while the game is empty.
        const bob = player('bobby');
        expect(get('/game/home', bob)).not.toContain('A slave to breed with');
        post('/game/home', { name: 'Bo', gender_id: genderId('Male'), species_id: speciesId(), birthdate: '', starter: 'mate' }, bob);
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros')), 'No slave for Bo (Eve, her slave and Bo).').toBe(3);
    });

    test('a herm chooses its starting slave', () => {
        const herm = anthro({ gender: 'Herm', name: 'Hera' });
        let [slave] = Anthros.createStarterSlave(herm, 'sire');
        expect(!!slave!.is_male && !slave!.is_female, 'One that sires.').toBe(true);
        [slave] = Anthros.createStarterSlave(herm, 'dam');
        expect(!!slave!.is_female && !slave!.is_male, 'One that carries.').toBe(true);
        expect(Anthros.createStarterSlave(herm, 'mate'))
            .toEqual([null, 'A herm has no opposite sex: choose a slave that sires or one that carries.']);
        const dam = anthro({ gender: 'Female' });
        [slave] = Anthros.createStarterSlave(dam, 'dam');
        expect(!!slave!.is_male, "A dam's slave sires, whatever was asked.").toBe(true);
    });

    test('admins force a birth', () => {
        const boss = admin();
        const alice = player('alice');
        playerAnthro(alice);
        const dam = anthro({ owner: alice, gender: 'Female', name: 'Fay' });
        Litters.attempt(anthro(), dam, null, false);
        expect(panel(get('/game/assets/' + dam.id, boss))).toContain('Force the birth now');
        const [status] = request('POST', '/game/assets/' + dam.id + '/birth', {}, alice);
        expect(status, 'Admins only.').toBe(404);
        post('/game/assets/' + dam.id + '/birth', {}, boss);
        expect(flash()).toBe('Fay gave birth.');
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE dam_id = ?', [dam.id]))).toBe(1);
        expect(get('/game/assets/' + dam.id, boss)).not.toContain('Force the birth now');
    });

    test('becoming an anthro from its page', () => {
        const alice = player('alice');
        const free = anthro({ name: 'Wanderer' });
        const noble = anthro({ name: 'Lord', title_rank: 4 });
        expect(get('/game/assets/' + free.id, alice)).toContain('value="become"');
        expect(get('/game/assets/' + noble.id, alice), 'Nobles are for admins.').not.toContain('value="become"');
        expect(get('/game/assets/' + noble.id, admin())).toContain('value="become"');
        const played = playerAnthro(player('bobby'));
        expect(get('/game/assets/' + played.id, alice), 'Someone plays it.').not.toContain('value="become"');

        post('/game/home', { action: 'become', anthro_id: free.id }, alice);
        expect(flash()).toBe('You are now Wanderer.');
        expect(get('/game/assets/' + anthro().id, alice), 'Alice plays one now.').not.toContain('value="become"');
    });

    test("inviting into a group from an anthro's page", () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Alice' });
        const stranger = anthro({ name: 'Stranger' });
        expect(get('/game/assets/' + stranger.id, alice), 'No group yet.').not.toContain('value="invite"');
        const [groupId] = Groups.create(alice, 'Hearth', [me.id]);
        let page = get('/game/assets/' + stranger.id, alice);
        expect(page, 'Closed: not taking invites...').not.toContain('value="invite"');
        expect(page, '...but it says so.').toContain('<button class="btn btn-outline-success" disabled>Invite to Hearth</button>');
        expect(page).toContain('Hearth is closed: open it to invites');
        Groups.setAccess(alice, groupId!, 'invite');
        expect(get('/game/assets/' + stranger.id, alice)).toContain('Invite to Hearth');
        expect(get('/game/assets/' + me.id, alice), 'Not the anthro Alice plays.').not.toContain('Invite to Hearth');

        const [, location] = request('POST', '/game/groups', {
            action: 'invite', group_id: groupId, anthro_id: stranger.id, back: '/game/assets/' + stranger.id,
        }, alice);
        expect(location, 'Back to its page.').toBe('/game/assets/' + stranger.id);
        expect(flash()).toBe('The invitation was sent.');
        expect(get('/game/assets/' + stranger.id, alice), 'Invited already.').not.toContain('Invite to Hearth');

        // An anthro Alice owns is added straight away, even to a closed group; Bobby owns no group to invite into.
        Groups.setAccess(alice, groupId!, 'closed');
        const slave = anthro({ owner: alice, name: 'Serf' });
        expect(get('/game/assets/' + slave.id, alice)).toContain('Invite to Hearth');
        const bob = player('bobby');
        playerAnthro(bob);
        page = get('/game/assets/' + anthro().id, bob);
        expect(page).not.toContain('value="invite"');
    });

    test('history is most recent first', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const pet = anthro({ owner: alice, name: 'Pet' });
        db().run(
            "INSERT INTO game_renames (anthro_id, old_name, new_name, renamed_at) VALUES (?, 'Old', 'Older', SUBDATE(UTC_TIMESTAMP(), 3)), (?, 'Older', 'Pet', SUBDATE(UTC_TIMESTAMP(), 1))",
            [pet.id, pet.id],
        );
        const page = get('/game/assets/' + pet.id, alice);
        const newer = page.indexOf('Renamed from Older to Pet');
        const older = page.indexOf('Renamed from Old to Older');
        const arrival = page.indexOf('Born &mdash; a founder');
        expect(newer < older && older < arrival, 'Newest first, its arrival last.').toBe(true);
    });

    test('looking for work offers learned work', () => {
        const bob = player('bobby');
        const worker = playerAnthro(bob, { name: 'Worker' });
        expect(get('/game/home', bob)).toContain("You haven't learned a skill to offer yet");
        db().run("INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, 30 FROM game_skills WHERE name = 'Cooking'", [worker.id]);
        const baker = Number(scalar("SELECT id FROM game_occupations WHERE title = 'Baker'"));
        const home = get('/game/home', bob).replace(/\s+/g, ' ');
        expect(home).toMatch(new RegExp('<option value="' + baker + '" > Baker \\(Cooking: Journeyman\\): about 8, or 9 if you may be bred'));
        expect(home).toContain('Food costs 5 coins a unit at the');
        post('/game/home', { action: 'set_wage', wage: '3', occupation_id: baker }, bob);
        expect(flash()).toBe("You're on the job market.");
        expect(get('/game/market/jobs', player('alice'))).toContain('Baker <span class="text-body-secondary small">(Cooking: Journeyman)</span>');
    });

    test("the life form shows a dam's urge", () => {
        const dam = anthro({ gender: 'Female', urge_rise: 20, created_at: gmdate('Y-m-d H:i:s', strtotimeOrThrow('-2 days')) });
        const page = get('/game/assets/' + dam.id, admin());
        expect(page).toContain('name="urge_rise" type="number"');
        expect(page).toContain('2 days so far: 40% today.');
    });
});
