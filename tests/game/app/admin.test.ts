// Upstream: tests/Game/AppTest.php (the /game/admin pages)
import { describe, expect, test } from 'vitest';
import { Anthros } from '../../../src/game/Anthros';
import { Auctions } from '../../../src/game/Auctions';
import { Clock } from '../../../src/game/Clock';
import { Ranks } from '../../../src/game/Ranks';
import { Saves } from '../../../src/game/Saves';
import { Wallets } from '../../../src/game/Wallets';
import { gmdate, strtotimeOrThrow } from '../../../src/core/php';
import { flash, get, post, request } from '../../AppHarness';
import { admin, anthro, baronyId, coins, db, player, playerAnthro, refresh, scalar } from '../../TestCase';

describe('App: admin', () => {
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

    test('ranks admin pages', () => {
        const boss = admin();
        let page = get('/game/admin/ranks', boss);
        expect(page).toContain('value="Baronetess"');
        expect(page, 'Commoners and slaves are neither.').toMatch(/name="is_noble" aria-label="Noble"\s+disabled/);

        post('/game/admin/ranks', { rank: 3, name: 'Baronet', female_name: 'Baronetess', is_noble: '1' }, boss);
        expect(Ranks.isNoble(3)).toBe(true);
        expect(Ranks.isHereditary(3), 'Unticked.').toBe(false);

        const baron = anthro({ name: 'Olde', title_rank: 4 });
        anthro({ name: 'Scion', sire_id: baron.id });
        page = get('/game/admin/ranks/4', boss);
        expect(page).toContain('>Olde</a>');
        expect(page, 'The heir.').toContain('>Scion</a>');

        let [status] = request('GET', '/game/admin/ranks/1', {}, boss);
        expect(status, 'Only titles have holders pages.').toBe(404);
        [status] = request('GET', '/game/admin/ranks', {}, player('alice'));
        expect(status).toBe(404);
    });

    test('the rank page names players only in the panel', () => {
        const boss = admin();
        playerAnthro(player('bobby'), { name: 'Baronne', title_rank: 4 });
        const page = get('/game/admin/ranks/4', boss);
        expect(body(page)).not.toContain('bobby');
        expect(page).toContain('>Baronne</a>: bobby</li>');
    });

    test('force breeding by name', () => {
        const boss = admin();
        const sire = anthro({ name: 'Rex' });
        const dam = anthro({ name: 'Fay', gender: 'Female' });
        let page = get('/game/admin/breed', boss, { dam: dam.id });
        expect(page, "Filled in from the anthro page's link.").toContain('value="Fay (#' + dam.id + ')"');
        post('/game/admin/breed', { sire: `Rex (#${sire.id})`, dam: `Fay (#${dam.id})` }, boss);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings WHERE sire_id = ? AND dam_id = ? AND forced', [sire.id, dam.id]))).toBe(1);
        [, , page] = request('POST', '/game/admin/breed', { sire: 'Nobody', dam: `Fay (#${dam.id})` }, boss);
        expect(page).toContain('Choose a sire and a dam.');
    });

    test('the land office shows a barony at a time and moves ticked lots', () => {
        const boss = admin();
        const from = baronyId();
        db().run("INSERT INTO game_baronies (name) VALUES ('Elsewhere')");
        const to = db().lastInsertId();
        const mine = anthro({ name: 'Holder' });
        db().run('INSERT INTO game_parcels (anthro_id, acres, barony_id) VALUES (NULL, 1, ?), (NULL, 2, ?), (?, 3, ?)',
            [from, from, mine.id, from]);
        const office = get('/game/admin/land', boss);
        expect(office, "By default, just the land office's own lots.").not.toContain('>Holder</a>');
        expect(get('/game/admin/land', boss, { barony: from })).toContain('>Holder</a>');

        const ids = db().column('SELECT id FROM game_parcels WHERE anthro_id IS NULL').map(Number);
        post('/game/admin/land', { action: 'move', ids, where: String(to) }, boss);
        expect(flash()).toBe('Moved the ticked lots.');
        expect(Number(scalar('SELECT COUNT(*) FROM game_parcels WHERE barony_id = ?', [to]))).toBe(2);
    });

    test('admins manage building types', () => {
        const boss = admin();
        expect(get('/game/admin/buildings', boss)).toContain('value="Mill"');
        post('/game/admin/buildings', { action: 'save', name: 'Tower', days: 50, acres: '0.3', sort_order: 5 }, boss);
        const tower = Number(scalar("SELECT id FROM game_building_types WHERE name = 'Tower'"));
        // (Upstream reads the DECIMAL as '0.30'; here it's a number.)
        expect([String(scalar('SELECT days FROM game_building_types WHERE id = ?', [tower])),
            Number(scalar('SELECT acres FROM game_building_types WHERE id = ?', [tower])).toFixed(2)]).toEqual(['50', '0.30']);
        const [, , page] = request('POST', '/game/admin/buildings', { action: 'save', name: 'Mill', days: 5, acres: '1' }, boss);
        expect(page).toContain('There&#039;s already a kind of building called Mill.');
        post('/game/admin/buildings', { action: 'delete', id: tower }, boss);
        expect(Number(scalar("SELECT COUNT(*) FROM game_building_types WHERE name = 'Tower'"))).toBe(0);
        const [status] = request('GET', '/game/admin/buildings', {}, player('alice'));
        expect(status).toBe(404);
    });

    test('the advance time page', () => {
        const boss = admin();
        const alice = player('alice');
        const me = playerAnthro(alice);
        expect(get('/game/admin/time', boss)).toContain('Advance 1 week');
        post('/game/admin/time', { days: 7, save_first: '1' }, boss);
        expect(flash()).toBe('The game moved 7 days ahead.');
        expect(refresh(me).birthdate, 'Dates stay: the calendar moves on.').toBe(me.birthdate);
        expect(Clock.today()).toBe(gmdate('Y-m-d', strtotimeOrThrow('+7 days')));
        expect(Saves.all().map((s) => s.name)).toContain('Before advancing 7 days');
        const [status] = request('POST', '/game/admin/time', { days: 1 }, alice);
        expect(status).toBe(404);
    });

    test('admins supply workers', () => {
        const boss = admin();
        expect(get('/game/admin/supply', boss)).toContain('Supply workers');
        post('/game/admin/supply', { action: 'workers', count: 2, skill_id: 'random', wage: '5' }, boss);
        expect(flash()).toBe('Put 2 workers on the job market.');
        const alice = player('alice');
        playerAnthro(alice);
        const page = get('/game/market/jobs', alice);
        expect(page, 'Workers are hired to work: no breeding terms.').toContain('<th>Trade</th><th>Species</th>');
        expect(page).not.toContain('May be bred');
        expect(page.split('>5 ' + Wallets.CURRENCY + '</td>').length - 1).toBe(2);
    });

    test('saves and reset', () => {
        const boss = admin();
        anthro({ name: 'Doomed' });
        post('/game/admin/saves', { action: 'save', name: 'Manual' }, boss);
        const save = Number(scalar("SELECT id FROM game_saves WHERE name = 'Manual'"));
        const json = JSON.parse(get('/game/admin/saves/' + save + '.json', boss));
        expect(Object.values<any>(json.tables.game_anthros).map((a) => a.name)).toEqual(['Doomed']);

        let location: string | null;
        let page: string;
        [, location, page] = request('POST', '/game/admin/reset-game', { confirm: 'nope' }, boss);
        expect(location).toBeNull();
        expect(page).toContain('Type RESET to confirm.');
        post('/game/admin/reset-game', { confirm: 'RESET', save_first: '1' }, boss);
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros')), 'The game starts with its commoners, and no one else.').toBe(Ranks.MIN_COMMONERS);
        // A player choosing whom to become sees their jobs.
        const home = get('/game/home', player('newcomer'));
        expect(home).toContain('<th>Job</th>');
        expect(home).toMatch(/<td>[A-Z][a-z -]+ \([A-Za-z ]+: Journeyman\)<\/td>/);
        expect(Saves.all().map((s) => s.name)).toContain('Before reset');
        expect(get('/game/admin/reset-game', boss)).toContain('name="ranks[9]"');
        post('/game/admin/reset-game', { confirm: 'RESET', ranks: { 4: 1, 3: 2 }, settle: '1' }, boss);
        expect(flash()).toBe('The game was reset: every anthro is gone, and players start over, with a new court.');
        expect(Number(scalar('SELECT COUNT(*) FROM game_anthros WHERE title_rank IS NOT NULL'))).toBe(3);

        [, location, page] = request('POST', '/game/admin/saves', { action: 'restore', id: save }, boss);
        expect(page).toContain('Type RESTORE to confirm.');
        post('/game/admin/saves', { action: 'restore', id: save, confirm: 'RESTORE' }, boss);
        expect(Anthros.all().map((a) => a.name)).toEqual(['Doomed']);
    });

    test('admin management forms', () => {
        const boss = admin();
        post('/game/admin/names', { action: 'add', names: 'Zed', is_male: '1' }, boss);
        expect(Number(scalar("SELECT COUNT(*) FROM game_names WHERE name = 'Zed'"))).toBe(1);
        post('/game/admin/genders', { action: 'add', name: 'Neuter', presents_as: 'androgynous', birth_weight: 0, sort_order: 70 }, boss);
        expect(Number(scalar("SELECT COUNT(*) FROM game_genders WHERE name = 'Neuter'"))).toBe(1);
        post('/game/admin/supply', { count: 2, starting_bid: 10, days: 1 }, boss);
        expect(Auctions.open()).toHaveLength(2);
        const target = anthro();
        post('/game/admin/wallets', { anthro_id: target.id, amount: 30, reason: 'Gift' }, boss);
        expect(coins(target.id)).toBe(30);
    });
});
