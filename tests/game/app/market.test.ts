// Upstream: tests/Game/AppTest.php (the market's pages)
import { describe, expect, test } from 'vitest';
import { int } from '../../../src/core/php';
import { Auctions } from '../../../src/game/Auctions';
import { flash, get, post, request } from '../../AppHarness';
import { admin, anthro, anthroOf, baronyId, player, playerAnthro, refresh, scalar, setCoins } from '../../TestCase';

/** The page's admin panel. */
function panel(page: string): string {
    const start = page.indexOf('id="admin-panel"');
    return start === -1 ? '' : page.substring(start, page.indexOf('>Admin pages</h3>', start));
}

/** The page without its admin panel. */
function body(page: string): string {
    const p = panel(page);
    return p === '' ? page : page.split(p).join('');
}

describe('App: market', () => {
    test('auction bidding', () => {
        const seller = player('seller');
        playerAnthro(seller);
        const lot = anthro({ owner: seller, name: 'Lot' });
        post('/game/assets/' + lot.id + '/sell', { starting_bid: 10, buy_now: 100, days: 1 }, seller);
        const auction = int(scalar('SELECT id FROM game_auctions'));

        const alice = player('alice');
        setCoins(playerAnthro(alice).id, 500);
        expect(get('/game/market', alice)).toContain('Lot');
        get('/game/market/auctions/' + auction, alice);
        post('/game/market/auctions/' + auction, { action: 'bid', amount: 20 }, alice);
        expect(int(Auctions.find(auction)!.current_bid)).toBe(20);
        post('/game/market/auctions/' + auction, { action: 'buy_now' }, alice);
        expect(Auctions.find(auction)!.status).toBe('sold');
        const [status] = request('GET', '/game/market/auctions/999999', {}, alice);
        expect(status).toBe(404);
    });

    test('jobs and land', () => {
        const boss = admin();
        const alice = player('alice');
        setCoins(playerAnthro(alice).id, 20000);
        const worker = anthro({ name: 'Worker', wage: 12 });
        expect(get('/game/market/jobs', alice)).toContain('Worker');
        post('/game/market/jobs', { action: 'hire', only: worker.id }, alice);
        expect(refresh(worker).employer_id).toBe(anthroOf(alice));
        post('/game/market/jobs', { action: 'dismiss', anthro_id: worker.id }, alice);
        expect(refresh(worker).employer_id).toBeNull();

        post('/game/admin/land', { action: 'supply', count: 1, acres: 2, price: 5000, where: String(baronyId()) }, boss);
        const listing = int(scalar('SELECT id FROM game_land_listings'));
        expect(get('/game/market/land', alice)).toContain('2 acres');
        post('/game/market/land', { action: 'buy', listing_id: listing }, alice);
        expect(flash()).toBe('The land is yours.');
    });

    test('bidders are named only in the admin panel', () => {
        const seller = player('seller');
        playerAnthro(seller);
        const lot = anthro({ owner: seller, name: 'Lot' });
        post('/game/assets/' + lot.id + '/sell', { starting_bid: 10, buy_now: 100, days: 1 }, seller);
        const auction = int(scalar('SELECT id FROM game_auctions'));
        const alice = player('alice');
        setCoins(playerAnthro(alice).id, 500);
        post('/game/market/auctions/' + auction, { action: 'bid', amount: 20 }, alice);

        const page = get('/game/market/auctions/' + auction, admin());
        expect(body(page)).not.toContain('alice');
        expect(body(page)).toMatch(/<span>\s*Bidder 1\s*<\/span>/);
        expect(panel(page)).toContain('<li>Bidder 1: alice</li>');
    });
});
