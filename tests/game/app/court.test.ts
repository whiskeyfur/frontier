// Upstream: tests/Game/AppTest.php (the court's pages)
import { describe, expect, test } from 'vitest';
import type { User } from '../../../src/core/Auth';
import type { Row } from '../../../src/db/Db';
import { Ranks } from '../../../src/game/Ranks';
import { flash, get, post, request } from '../../AppHarness';
import { admin, anthro, db, player, playerAnthro, scalar, setCoins } from '../../TestCase';

describe('App: court', () => {
    /**
     * The admin panel of a page ('' if there's none). (Upstream ends it at the site's "Admin pages" heading, which
     * isn't here: the game's list, headed "Game", follows the page's controls.)
     */
    const panel = (page: string): string => {
        const start = page.indexOf('id="admin-panel"');
        return start === -1 ? '' : page.slice(start, page.indexOf('>Game</h3>', start));
    };

    /** The page without its admin panel. */
    const body = (page: string): string => page.replace(panel(page), '');

    const playerOf = (a: Row): User => {
        const u = player('p' + a.id);
        db().run('UPDATE game_anthros SET player_id = ? WHERE id = ?', [u.id, a.id]);
        return u;
    };

    const squash = (s: string): string => s.replace(/\s+/g, ' ');

    test('court names link to their pages', () => {
        const duke = anthro({ name: 'Duke', title_rank: 8 });
        const knight = anthro({ name: 'Squire', title_rank: 2, liege_id: duke.id });
        const alice = player('alice');
        const court = get('/game/court', alice);
        expect(court).toContain('<a href="/game/assets/' + duke.id + '">Duke</a>');
        expect(court).toContain('<a href="/game/assets/' + knight.id + '">Squire</a>');
        expect(get('/game/assets/' + duke.id, alice)).toContain('Duke');

        // A played noble's page doesn't give its player away.
        const carol = player('carol');
        db().run('UPDATE game_anthros SET player_id = ? WHERE id = ?', [carol.id, knight.id]);
        const page = get('/game/assets/' + knight.id, alice);
        expect(page).not.toContain('carol');
        expect(page).not.toContain('played');
    });

    test('court structure page', () => {
        const king = anthro({ name: 'Rex', title_rank: 9 });
        const duke = anthro({ name: 'Duke', title_rank: 8, liege_id: king.id });
        anthro({ name: 'Plainfolk', liege_id: duke.id });
        const alice = player('alice');
        const page = get('/game/court/structure', alice);
        expect(page).toContain('href="/game/assets/' + duke.id + '"');
        expect(page).toContain('1 commoner');
        expect(page, 'Commoners are counted, not listed.').not.toContain('Plainfolk');
        expect(page).toContain('King/Queen: 1');
        expect(page, 'The Court submenu.').toContain('class="dropdown-item active" href="/game/court/structure"');
        expect(get('/game/court', alice), 'Tabs.').toMatch(/href="\/game\/court\/structure"\s*>Structure<\/a>/);
    });

    test('commoners are sworn on their first request', () => {
        const knight = anthro({ name: 'Sir', title_rank: 2 });
        const alice = player('alice');
        playerAnthro(alice);
        const page = get('/game/court', alice);
        expect(page).toContain('Sworn to <a class="fw-semibold" href="/game/assets/' + knight.id + '"');
        expect(page, 'Commoners can switch liege, not renounce.').not.toContain('No liege');
    });

    test('the court page splits who is sworn to you', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { title_rank: 4 });
        anthro({ name: 'Knighty', title_rank: 2, liege_id: me.id });
        anthro({ name: 'Folky', liege_id: me.id });
        anthro({ name: 'Serfy', owner: alice });
        const page = squash(get('/game/court', alice));
        expect(page).toMatch(/Vassals \(1\):<\/span> Knight <a href="\/game\/assets\/\d+">Knighty<\/a>/);
        expect(page).toMatch(/Followers \(1\):<\/span> <a href="\/game\/assets\/\d+">Folky<\/a>/);
        expect(page).toMatch(/Slaves \(1\):<\/span> <a href="\/game\/assets\/\d+">Serfy<\/a>/);
    });

    test('granting titles as admin is in the panel', () => {
        const boss = admin();
        let page = get('/game/court', boss);
        expect(panel(page)).toContain('Grant a title');
        expect(panel(page)).toContain('<option value="9">King / Queen</option>');
        expect(body(page)).not.toContain('Grant a title');

        // The King grants titles below his in the page.
        const alice = player('alice');
        playerAnthro(alice, { title_rank: 9 });
        page = get('/game/court', alice);
        expect(page).toContain('Grant a title');
        expect(page).not.toContain('<option value="9">');
    });

    test('lands and barony pages', () => {
        const king = anthro({ name: 'Rex', title_rank: 9 });
        const baron = anthro({ name: 'Bram', title_rank: 4, liege_id: king.id });
        const boss = admin();

        post('/game/admin/baronies', { action: 'create', name: 'Ashford', holder: `Bram (#${baron.id})` }, boss);
        const id = Number(scalar("SELECT id FROM game_baronies WHERE name = 'Ashford'"));
        post('/game/admin/baronies', { action: 'save_part', barony_id: id, name: 'Millton', kind: 'town', manager: '' }, boss);
        post('/game/admin/land', { action: 'supply', count: 1, acres: 3, price: 90, where: String(id) }, boss);

        const alice = player('alice');
        const lands = get('/game/court/lands', alice);
        expect(lands).toMatch(/class="dropdown-item active" href="\/game\/court\/lands"/);
        expect(lands).toContain('>Rex</a>');
        expect(lands).toContain('href="/game/court/lands/' + id + '">Ashford</a>');
        expect(lands).toContain('Millton');

        const page = get('/game/court/lands/' + id, alice);
        expect(page).toContain('Barony of Ashford');
        expect(page).toMatch(new RegExp('Held by Baron\\s+<a href="/game/assets/' + baron.id + '">Bram</a>\\s*&middot; of\\s*King\\s+<a'));
        expect(page).toContain('Land office');
        expect(get('/game/market/land', alice), 'Real estate says where.').toContain('>Ashford</a>');
        const [status] = request('GET', '/game/court/lands/999999', {}, alice);
        expect(status).toBe(404);

        const baronet = anthro({ name: 'Bet', title_rank: 3, liege_id: baron.id });
        db().run("UPDATE game_barony_parts SET kind = 'village', manager_anthro_id = ? WHERE barony_id = ?", [baronet.id, id]);
        const villager = anthro({ name: 'Tiller', liege_id: baronet.id });
        expect(get('/game/assets/' + villager.id, alice)).toMatch(
            new RegExp('Lives in</dt>\\s*<dd class="col-sm-9">\\s*Village Millton,\\s*in the barony of <a href="/game/court/lands/' + id + '">Ashford</a>'),
        );
        expect(get('/game/court/lands', alice), 'The baronet and Tiller live in Millton.').toContain('2 people');

        const baronsLand = get('/game/assets/land', playerOf(baron));
        expect(baronsLand).toContain('held directly');
    });

    test('taking up the rank above on the court page', () => {
        const alice = player('alice');
        const baron = playerAnthro(alice, { title_rank: 4 });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 4500)', [baron.id]);
        expect(get('/game/court', alice)).toContain('Become Viscount');
        post('/game/court', { action: 'assume' }, alice);
        expect(flash()).toBe('You are Viscount now.');
        expect(squash(get('/game/court', alice))).toContain(
            'It takes 13,500 acres of land, counting your household\'s and everyone\'s sworn to you, to take up the rank of Earl. You hold 4,500 acres: 33% of the way.',
        );
    });

    test('the court offers baronet to a landholder', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { gender: 'Female' });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 499.5)', [me.id]);
        expect(squash(get('/game/court', alice))).toContain(
            'It takes 500 acres of land, counting your household\'s and everyone\'s sworn to you, to take up the rank of Baronetess. You hold 499.5 acres: 100% of the way.',
        );
        db().run('UPDATE game_parcels SET acres = 500');
        const page = get('/game/court', alice);
        expect(page).toContain('Become Baronetess');
        expect(squash(page)).toContain('You hold 500 acres: enough to take up the rank.');
        expect(page).toContain('Swear to a fellow commoner');
        post('/game/court', { action: 'assume' }, alice);
        expect(flash()).toBe('You are Baronetess now.');
    });

    test('marrying on the court page', () => {
        const rex = player('rex');
        const king = playerAnthro(rex, { name: 'Rex', title_rank: Ranks.KING });
        const regina = player('regina');
        const queen = playerAnthro(regina, { name: 'Regina', gender: 'Female' });
        expect(get('/game/court', rex)).toContain('Not married.');
        post('/game/court', { action: 'propose', anthro: `Regina (#${queen.id})`, into: 'mine' }, rex);
        expect(flash()).toBe('You proposed to Regina.');
        let page = get('/game/court', regina);
        expect(page).toContain('asks you to marry into their household.');
        const id = Number(scalar('SELECT id FROM game_proposals'));
        post('/game/court', { action: 'accept', proposal_id: id }, regina);
        expect(flash()).toBe('You are married. You are Queen now.');
        page = get('/game/court', regina);
        expect(page).toContain('household: Queen by marriage.');
        expect(page).toContain('by marriage to <a href="/game/assets/' + king.id + '">Rex</a>');
        expect(get('/game/court', rex)).toContain('Send away');
        post('/game/court', { action: 'leave' }, regina);
        expect(flash()).toBe('The marriage is over. You are Commoner now.');
    });

    test('the fiefs page', () => {
        const alice = player('alice');
        const lord = playerAnthro(alice, { name: 'Aldric', title_rank: 4 });
        const bob = player('bobby');
        const vassal = playerAnthro(bob, { name: 'Bram' });
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 40)', [lord.id]);
        const lotId = db().lastInsertId();
        expect(get('/game/court/fiefs', alice)).toContain('value="grant"');
        post('/game/court/fiefs', { action: 'grant', parcel_id: lotId, acres: '10', anthro: `Bram (#${vassal.id})`, rate: 12 }, alice);
        expect(flash()).toBe('You offered Bram 10 acres at 12% tax.');
        expect(get('/game/court/fiefs', bob)).toContain('offers you 10 acres as a fief, at 12% tax');
        const offer = Number(scalar('SELECT id FROM game_fief_offers'));
        post('/game/court/fiefs', { action: 'accept', offer_id: offer }, bob);
        expect(flash()).toBe('Accepted.');

        db().run('UPDATE game_anthros SET tax_balance = 6, tax_overdue_since = SUBDATE(UTC_DATE(), 20) WHERE id = ?', [vassal.id]);
        const page = squash(get('/game/court/fiefs', bob));
        expect(page).toContain('You owe 6 coins</strong>, overdue since');
        expect(page).toContain('your lord can seize your fiefs');
        expect(get('/game/court/fiefs', alice)).toContain('value="seize"');
        setCoins(vassal.id, 10);
        post('/game/court/fiefs', { action: 'pay', coins: 8 }, bob);
        expect(flash()).toBe('Paid 8 coins.');
        expect(get('/game/court/fiefs', bob)).toContain("You've paid 2 coins ahead.");
    });
});
