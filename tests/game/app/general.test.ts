// Upstream: tests/Game/AppTest.php (access, the menus and admin panel, and pages not covered by the other files)
import { describe, expect, test } from 'vitest';
import { gmdate, range, strtotimeOrThrow } from '../../../src/core/php';
import { Anthros } from '../../../src/game/Anthros';
import { App } from '../../../src/game/App';
import { Auctions } from '../../../src/game/Auctions';
import { Goods } from '../../../src/game/Goods';
import { Preferences } from '../../../src/game/Preferences';
import { flash, get, post, request } from '../../AppHarness';
import {
    admin, anthro, baronyId, coins, db, genderId, player, playerAnthro, refresh, scalar, setCoins, user,
} from '../../TestCase';

/**
 * The "This page" part of the admin panel: the page's own admin controls ('' if none, or no panel). (Upstream ends it
 * at the site's "Admin pages" heading; here that heading is still there, before the game's list.)
 */
function panel(page: string): string {
    const start = page.indexOf('id="admin-panel"');
    return start === -1 ? '' : page.substring(start, page.indexOf('>Admin pages</h3>', start));
}

/** The page without its admin panel. */
function body(page: string): string {
    const p = panel(page);
    return p === '' ? page : page.split(p).join('');
}

/**
 * Each menu item's page: its own, or for Docs (which has none of its own), its first.
 */
function menuPages(): string[] {
    return Object.keys(App.PAGES).map((href) => (href === '/game/docs' ? Object.keys(App.SUBPAGES[href])[0] : href));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/#]/g, '\\$&');

/** How many times needle occurs in haystack (PHP's substr_count). */
const substrCount = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('App: general', () => {
    // Access

    test('guests are sent to login', () => {
        // There's no login here: with nobody logged in, the game sends you to / (which picks the person playing).
        const [, location] = request('GET', '/game/home');
        expect(location).toBe('/');
    });

    // There are no passwords here, so none expire.
    test.skip('expired passwords must be changed first', () => {});

    test("users who aren't players get the site's 404", () => {
        // Here it's the game's 404 (there's no site around it).
        const [status, , page] = request('GET', '/game/home', {}, user('writer', ['editor']));
        expect(status).toBe(404);
        expect(page).toContain('There is nothing here.');
    });

    // There's no CSRF here: nothing outside the page can post to the game (see Auth.checkCsrf).
    test.skip('forged posts are refused', () => {});

    test('game root redirects home', () => {
        const [, location] = request('GET', '/game', {}, player('alice'));
        expect(location).toBe('/game/home');
    });

    test('unknown pages are 404', () => {
        const [status] = request('GET', '/game/nowhere', {}, player('alice'));
        expect(status).toBe(404);
    });

    test('every page loads for a player', () => {
        const alice = player('alice');
        playerAnthro(alice);
        for (const path of [...menuPages(), '/game/market/jobs', '/game/market/land', '/game/notifications', '/game/docs/changes']) {
            // (Upstream looks for '</html>': the pages here are the body, which ends with the layout's footer.)
            expect(get(path, alice), path).toContain('</main>');
        }
    });

    test('every page loads for a player without an anthro', () => {
        const alice = player('alice');
        for (const path of [...menuPages(), '/game/market/jobs', '/game/market/land', '/game/notifications', '/game/docs/changes']) {
            get(path, alice);
        }
        expect(get('/game/home', alice)).toContain('Create my anthro');
    });

    test('admin pages are for admins only', () => {
        const boss = admin();
        const alice = player('alice');
        // The game's own admin pages (maintenance, /admin/game, is the main site's).
        for (const path of Object.keys(App.ADMIN_PAGES).filter((p) => p.startsWith('/game/'))) {
            get(path, boss);
            const [status] = request('GET', path, {}, alice);
            expect(status, path).toBe(404);
        }
        const [, location] = request('GET', '/game/admin', {}, boss);
        expect(location).toBe('/game/admin/species');
    });

    // Home: playing an anthro

    test('players are anonymous to others', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(bob);
        const bobsAnthro = playerAnthro(alice, { owner: bob, player_id: alice.id, name: 'Masked' });
        // Bob owns the anthro Alice plays: its page must not reveal that alice plays it.
        const page = get('/game/assets/' + bobsAnthro.id, bob);
        // Every player is listed as someone Bob could transfer it to; nothing else may name alice.
        const withoutPlayerList = page.replace(/<select[^>]*name="to_user_id".*?<\/select>/gs, '');
        expect(withoutPlayerList).not.toContain('alice');
        expect(page).not.toContain('played by');
        expect(get('/game/assets/' + bobsAnthro.id, admin())).toContain('played by alice');
    });

    test('group actions', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const sire = anthro({ owner: alice, gender: 'Male' });
        const dam = anthro({ owner: alice, gender: 'Female' });
        const ids = [sire.id, dam.id];

        post('/game/assets/group', { action: 'breed', times: 2, ids }, alice);
        expect((flash() as string[])[0]).toBe('Bred 2 times over 2 rounds.');
        post('/game/assets/group', { action: 'group', group_name: 'Pair', ids }, alice);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breeding_groups'))).toBe(1);
        post('/game/assets/group', { action: 'sell', starting_bid: 5, days: 1, ids }, alice);
        expect(Auctions.open()).toHaveLength(2);
        post('/game/assets/group', { action: 'breed', ids: [] }, alice);
        expect(flash()).toEqual(['Select some anthros first.']);
    });

    // Market

    test('court and groups pages', () => {
        const boss = admin();
        const squire = anthro({ name: 'Squire' });
        post('/game/court', { action: 'grant', anthro: 'Squire (#' + squire.id + ')', rank: 2 }, boss);
        expect(refresh(squire).title_rank).toBe(2);
        expect(get('/game/court', player('alice'))).toContain('Squire');

        const other = anthro({ name: 'Partner' });
        post('/game/groups', { action: 'create', name: 'Pair', ids: [squire.id, other.id] }, boss);
        expect(get('/game/groups', boss)).toContain('Pair');
    });

    test('the nav bar lists game pages as items', () => {
        const alice = player('alice');
        const page = get('/game/market/land', alice);
        for (const [href, label] of Object.entries(App.PAGES)) {
            expect(page, label).toMatch(new RegExp('<a class="nav-link[^"]*" href="' + escapeRegExp(href) + '"'));
        }
        expect(page, 'A market page highlights Market.').toMatch(/nav-link dropdown-toggle active" href="\/game\/market"[^>]*>Market<\/a>/);
        for (const [href, label] of Object.entries(App.SUBPAGES['/game/market'])) {
            expect(page, `Market → ${label}`).toMatch(new RegExp('class="dropdown-item[^"]*" href="' + escapeRegExp(href) + '"'));
        }
        expect(page, 'The page you are on.').toMatch(/class="dropdown-item active" href="\/game\/market\/land"/);
        // The section's pages in a second bar under the header, before the page itself; on a phone, only in the menu.
        expect(page, 'The second bar matches.').toMatch(/class="nav-link px-3 py-2 active" href="\/game\/market\/land"/);
        const bar = page.indexOf('site-subnav d-none d-md-block');
        expect(bar).not.toBe(-1);
        expect(bar, "It comes before the page's content.").toBeLessThan(page.indexOf('<main'));
        expect(bar, 'And after the header.').toBeGreaterThan(page.indexOf('site-header'));
        expect(get('/game/market/goods', alice)).toContain('Goods bought from, and sold to, the market');
        // Items with a submenu drop down. (Upstream counts one more, the site's app menu, and checks the brand is that
        // menu and there's a logout form: here there's one app and no logging out, so the brand is a plain link.)
        expect(substrCount(page, 'class="dropdown-menu"'), 'Items with a submenu drop down.').toBe(Object.keys(App.SUBPAGES).length);
        expect(page).toMatch(/class="navbar-brand" href="\/game\/home">Frontier<\/a>/);
        expect(page, "Alice hasn't the gurps role.").not.toContain('href="/gurps"');
        expect(page, 'No Admin button for players.').not.toContain('href="/admin"');
        expect(page, 'No Admin button for players.').not.toContain('data-bs-target="#admin-panel"');
        expect(page, 'The bell.').toContain('href="/game/notifications"');
        for (const href of Object.keys(App.ADMIN_PAGES)) {
            expect(page).not.toContain('href="' + href + '"');
        }
    });

    test('admins get an admin button and index', () => {
        const boss = admin();
        const page = get('/game/admin/names', boss);
        expect(page, 'The Admin button opens the panel.').toContain('data-bs-target="#admin-panel"');
        // (Upstream's panel also links the site's admin index, /admin, which isn't here.)
        for (const href of Object.keys(App.ADMIN_PAGES)) {
            expect(page, `${href} is in the panel.`).toContain('list-group-item-action" href="' + href + '"');
        }
        for (const href of Object.keys(App.ADMIN_PAGES)) {
            expect(page, 'Admin pages stay out of the menu.').not.toContain('class="nav-link" href="' + href + '"');
        }

        // Upstream renders the site's admin index (/admin), which lists the game's admin pages with what each is for;
        // there's no /admin here (nor its users, roles and cache pages), so check the admin panel's game page list.
        const index = page.substring(page.indexOf('>Game</h3>'));
        for (const href of Object.keys(App.ADMIN_PAGES)) {
            expect(index, href).toContain('href="' + href + '"');
        }
        expect(index).toContain('Save, download and restore the whole game.');
    });

    test('assets and social submenus', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        anthro({ owner: alice, name: 'Serfy' });
        const worker = anthro({ employer: alice, name: 'Hiredy', employed_wage: 5, employed_since: gmdate('Y-m-d H:i:s'), paid_until: gmdate('Y-m-d') });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 3)', [me.id]);

        const page = get('/game/groups', alice);
        expect(page, 'Breeding groups lights up Social.').toMatch(/nav-link dropdown-toggle active" href="\/game\/socials"[^>]*>Social<\/a>/);
        for (const [href, label] of Object.entries({ '/game/socials': 'Flirt', '/game/groups': 'Breeding groups', '/game/notifications': 'Notifications' })) {
            expect(page, label).toContain('href="' + href + '"');
        }
        expect(page, 'The bell stays.').toMatch(/href="\/game\/notifications"\s+title="Notifications"/);
        const navbar = page.substring(0, page.indexOf('</nav>'));
        expect(navbar, 'No longer a top-level item.').not.toMatch(/class="nav-link[^"]*" href="\/game\/groups"/);

        const slaves = get('/game/assets/slaves', alice);
        expect(slaves).toContain('Serfy');
        expect(slaves, 'Not yourself.').not.toContain('>' + me.name + '</a>');
        expect(slaves).toMatch(/nav-link dropdown-toggle active" href="\/game\/assets"/);

        const workers = get('/game/assets/workers', alice);
        expect(workers).toContain('Hiredy');
        const [, location] = request('POST', '/game/market/jobs', { action: 'dismiss', anthro_id: worker.id, back: '/game/assets/workers' }, alice);
        expect(location, 'Back where you came from.').toBe('/game/assets/workers');

        expect(get('/game/assets/land', alice)).toContain('3 acres');
        expect(get('/game/assets/goods', alice)).toContain('<th>Food <span class="badge text-bg-success fw-normal">food</span></th>');
    });

    test('only admins get the admin panel', () => {
        const alice = player('alice');
        let page = get('/game/home', alice);
        expect(page).not.toContain('id="admin-panel"');
        expect(page).not.toContain('data-bs-target="#admin-panel"');

        page = get('/game/wallet', admin());
        expect(page).toContain('id="admin-panel"');
        expect(page, 'Nothing for a page without admin controls.').not.toContain('>This page</h3>');
    });

    test('who plays anthros in lists is in the admin panel', () => {
        const boss = admin();
        playerAnthro(boss);
        const bob = player('bobby');
        const sire = playerAnthro(bob, { name: 'Papa' });
        const cub = anthro({ name: 'Cubby', sire_id: sire.id, owner: boss });

        // A parent link on an anthro's page.
        let page = get('/game/assets/' + cub.id, boss);
        expect(page).not.toContain('(played)');
        expect(page).toContain('>Played anthros on this page</h3>');
        expect(page).toContain('>Papa</a>: bobby</li>');
        expect(body(page)).not.toContain('bobby');

        // A breeding list, with an anthro of the admin's that carol plays.
        anthro({ name: 'Pet', gender: 'Female', owner: boss, player_id: player('carol').id });
        page = get('/game/assets/' + cub.id + '/breed', boss);
        expect(body(page)).not.toContain('carol');
        expect(page).toContain('>Pet</a>: carol</li>');

        // Players see none of it.
        page = get('/game/assets/' + cub.id, player('alice'));
        expect(page).not.toContain('Played anthros');
        expect(page).not.toContain('bobby');
    });

    test('name fields search as you type', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const fern = anthro({ name: 'Fernando' });
        anthro({ name: 'Fernly', died_at: gmdate('Y-m-d H:i:s') });
        anthro({ name: '50%' });
        let [, , json] = request('GET', '/game/anthros/search', {}, alice, { q: 'Fern' });
        expect(JSON.parse(json), 'The living only.').toEqual([{ id: fern.id, label: `Fernando (#${fern.id})` }]);
        [, , json] = request('GET', '/game/anthros/search', {}, alice, { q: `Fernando (#${fern.id}` });
        expect(JSON.parse(json), 'A picked name still finds itself.').toHaveLength(1);
        [, , json] = request('GET', '/game/anthros/search', {}, alice, { q: '#' + fern.id });
        expect(JSON.parse(json)[0].label.split(' (')[0]).toBe('Fernando');
        [, , json] = request('GET', '/game/anthros/search', {}, alice, { q: '5%' });
        expect(JSON.parse(json), '% is only a character.').toEqual([]);
        const page = get('/game/socials', alice);
        expect(page).toContain('list="flirt-anthros" data-anthro-search');
        expect(page, "Names aren't all listed in the page.").not.toContain('Fernando');
    });

    test('long lists are searched a page at a time', () => {
        for (const i of range(1, App.LIST_LIMIT + 5)) {
            anthro({ name: 'Folk' + String(i).padStart(3, '0'), wage: 5 });
        }
        const zed = anthro({ name: 'Zed', wage: 5 });
        setCoins(zed.id, 5);
        const newbie = player('newbie');
        const page = get('/game/home', newbie);
        expect(page).toContain('Showing the first 100 of 106');
        expect(page).not.toContain('>Zed<');
        expect(get('/game/home', newbie, { q: 'Ze' })).toContain('Zed');
        expect(get('/game/home', newbie, { q: 'Ze' })).toContain('1 matching');

        const alice = player('alice');
        playerAnthro(alice);
        expect(get('/game/market/jobs', alice)).toContain('Showing the first 100 of 106');
        expect(get('/game/market/jobs', alice, { q: 'z' })).toContain('Zed');
        expect(get('/game/admin/wallets', admin(), { q: 'Z' })).toContain('Zed');
    });

    test('goods and hunger', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        anthro({ owner: alice });
        const page = get('/game/assets/goods', alice);
        expect(page, "A week's food, less today's meals for two.").toMatch(/<th>Food <span class="badge text-bg-success fw-normal">food<\/span><\/th>\s*<td class="text-end">5<\/td>/);
        expect(page).toMatch(/2 mouths to feed, 2 food a day\.\s+That(&#039;|')s 2 days of food\./);
        expect(page).toContain('<th>Lumber</th>');

        db().run('UPDATE game_anthros SET hungry_on = UTC_DATE() WHERE id = ?', [me.id]);
        expect(get('/game/assets/' + me.id, alice)).toContain('>Hungry</span>');
    });

    test('the goods market and its admin', () => {
        const boss = admin();
        const alice = player('alice');
        const me = playerAnthro(alice);
        setCoins(me.id, 20);
        const page = get('/game/market/goods', alice);
        expect(page).toContain('name="trade" value="buy:food"');
        expect(page, 'Sortable and filtered.').toContain('<table data-sortable');
        expect(page, 'Food goods say so.').toMatch(/<td>Bread<\/td>\s*<td>food<\/td>/);
        post('/game/market/goods', { trade: 'buy:lumber', quantity: { lumber: 3, food: 1 } }, alice);
        expect(flash()).toBe('Bought 3 lumber.');
        expect([coins(me.id), Goods.amount(me.id, 'lumber')]).toEqual([5, 3]);

        post('/game/admin/goods', { action: 'save', good: '', name: 'Mead', buy_price: '4', sell_price: '1', sort_order: 30 }, boss);
        expect(flash()).toBe('Saved.');
        expect(get('/game/market/goods', alice)).toContain('name="trade" value="buy:mead"');
        const [, , page2] = request('POST', '/game/admin/goods', { action: 'save', good: 'mead', name: 'Mead', buy_price: '4', sell_price: '6' }, boss);
        expect(page2).toContain('It can&#039;t sell for more than it costs.');
        const [status] = request('GET', '/game/admin/goods', {}, alice);
        expect(status, 'Admins only.').toBe(404);
    });

    test('the admin panel shows coins and food', () => {
        const perrin = anthro({ name: 'Perrin', trade_occupation_id: Number(scalar("SELECT id FROM game_occupations WHERE title = 'Baker'")) });
        setCoins(perrin.id, 17);
        const page = get('/game/assets/' + perrin.id, admin()).replace(/\s+/g, ' ');
        expect(page, "A week of food, less today's meal.").toContain('<a href="/game/admin/wallets">17 coins</a> &middot; 6 food &middot; trade: Baker');
    });

    // There's no maintenance mode here: nobody else plays the game while it's being worked on.
    test.skip('the game down for maintenance', () => {});

    test('the preferences page', () => {
        const alice = player('alice');
        const page = get('/game/preferences', alice);
        expect(page).toMatch(/value="dark" id="era-dark"\s+checked/);
        expect(get('/game/home', alice), 'In the Game menu.').toContain('class="dropdown-item" href="/game/preferences"');
        post('/game/preferences', { era: 'renaissance' }, alice);
        expect(flash()).toBe('Your preferences are saved.');
        expect(Preferences.era(alice.id)).toBe('renaissance');
    });

    test('changes page', () => {
        const alice = player('alice');
        const page = get('/game/docs/changes', alice);
        expect(page).toContain("What's changed");
        expect(page).toContain('<h2 id="2026-09-25">2026-09-25</h2>');
        expect(page, 'Admin tools only for admins.').not.toContain('Admins speak for anthros');
        expect(get('/game/docs/changes', admin())).toContain('Admins speak for anthros');
        expect(page, 'Under Docs in the game menu.').toMatch(/class="dropdown-item active" href="\/game\/docs\/changes"/);
        expect(request('GET', '/game/changes', {}, alice)[1], 'Its old address.').toBe('/game/docs/changes');
        expect(page).toContain('The day turns over at 00:00 UTC.');
        expect(page).toContain('Next: ' + gmdate('Y-m-d', strtotimeOrThrow('tomorrow')) + ' 00:00 UTC');
    });

    test('pages within a section show its bar', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const pet = anthro({ owner: alice });
        // An anthro's pages are under Assets (Overview); the game home has its own bar.
        for (const path of ['/game/assets/' + pet.id, '/game/assets/' + pet.id + '/schedule', '/game/assets/' + pet.id + '/breed']) {
            expect(get(path, alice), path).toMatch(/class="nav-link px-3 py-2 active" href="\/game\/assets"/);
        }
        expect(get('/game/home', alice)).toMatch(/class="nav-link px-3 py-2 active" href="\/game\/home"/);
        // A barony is under Lands, not Nobility (the longest address that starts it).
        const barony = get('/game/court/lands/' + baronyId(), alice);
        expect(barony).toMatch(/class="nav-link px-3 py-2 active" href="\/game\/court\/lands"/);
        expect(barony).not.toMatch(/class="nav-link px-3 py-2 active" href="\/game\/court"/);
    });

    test('knowledge base', () => {
        const alice = player('alice');
        expect(request('GET', '/game/docs', {}, alice)[1]).toBe('/game/docs/knowledge-base');
        const page = get('/game/docs/knowledge-base', alice);
        expect(page).toMatch(/nav-link dropdown-toggle active" href="\/game\/docs"[^>]*>Docs<\/a>/);
        expect(page, 'The Docs bar.').toMatch(/class="nav-link px-3 py-2 active" href="\/game\/docs\/knowledge-base"/);
        // Every section heading has an id, and the contents link to each.
        const headings = [...page.matchAll(/<h([23]) id="([a-z0-9-]+)">/g)].map((m) => m[2]);
        expect(headings.length).toBeGreaterThan(10);
        expect(new Set(headings).size, 'Ids are unique.').toBe(headings.length);
        for (const id of headings) {
            expect(page).toContain('href="#' + id + '"');
        }
        expect(page).toContain('Frontier Knowledge Base');
    });

    test('random name endpoint', () => {
        const page = get('/game/names/random', player('alice'), { gender: genderId('Female') });
        const name = JSON.parse(page).name;
        expect(Number(scalar('SELECT is_female FROM game_names WHERE name = ?', [name]))).toBe(1);
    });

    // Admin

    test('waiting work happens on any request', () => {
        const alice = player('alice');
        const sire = anthro({ owner: alice, gender: 'Male' });
        const dam = anthro({ owner: alice, gender: 'Female' });
        Anthros.breed(alice.id, sire.id, dam.id);
        db().run('UPDATE game_litters SET due_on = UTC_DATE()');
        get('/game/home', alice);
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE dam_id = ?', [dam.id])), 'Litters are born.').toBe(1);
    });
});
