// Upstream: tests/Game/AppTest.php (the social pages and finances)
import { describe, expect, test } from 'vitest';
import { flash, get, post, request } from '../../AppHarness';
import { admin, anthro, anthroOf, playerAnthro, player, scalar, setCoins } from '../../TestCase';

/**
 * The "This page" part of the admin panel: the page's own admin controls ('' if none, or no panel). (Upstream's panel
 * goes on to the site's "Admin pages", which don't exist here: the game's come next.)
 */
function panel(page: string): string {
    const start = page.indexOf('id="admin-panel"');
    return start === -1 ? '' : page.substring(start, page.indexOf('>Game</h3>', start));
}

/**
 * The page without its admin panel.
 */
function body(page: string): string {
    const p = panel(page);
    return p === '' ? page : page.split(p).join('');
}

describe('App: social', () => {
    test('asking to leave a group', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const owned = playerAnthro(bob, { owner: alice });
        post('/game/groups', { action: 'create', name: 'Pair', ids: [owned.id, anthro({ owner: alice }).id] }, alice);
        const page = get('/game/groups', bob);
        expect(page).toContain('Ask to leave');
        expect(page.replace(/[\n ]/g, '')).not.toContain('>Leave<');
        const group = Number(scalar('SELECT id FROM game_breeding_groups'));
        post('/game/groups', { action: 'ask_to_leave', group_id: group }, bob);
        expect(flash()).toBe('Your owner was asked to take you out of the group.');
    });

    test('joining groups through the page', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob, { name: 'Wren' });
        post('/game/groups', { action: 'create', name: 'Hearth', ids: [anthroOf(alice)] }, alice);
        const group = Number(scalar('SELECT id FROM game_breeding_groups'));
        expect(get('/game/groups', bob), 'Closed by default.').not.toContain('Ask to join');

        post('/game/groups', { action: 'access', group_id: group, access: 'request' }, alice);
        expect(get('/game/groups', bob)).toContain('Ask to join');
        post('/game/groups', { action: 'join', group_id: group, anthro_id: wren.id }, bob);
        expect(flash()).toBe("You asked to join; the group's owner will decide.");
        expect(get('/game/groups', alice)).toContain('asks to join.');

        const pending = Number(scalar('SELECT id FROM game_group_requests'));
        post('/game/groups', { action: 'accept', pending_id: pending }, alice);
        expect(Number(scalar('SELECT COUNT(*) FROM game_group_members'))).toBe(2);
        expect(get('/game/assets/' + wren.id, player('carol'))).toContain('Hearth');

        post('/game/groups', { action: 'access', group_id: group, access: 'private' }, alice);
        const carol = player('dave');
        expect(get('/game/groups', carol)).not.toContain('Hearth');
        expect(get('/game/assets/' + wren.id, carol)).not.toContain('Hearth');
    });

    test('flirting on the socials page', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Mack' });
        const fern = playerAnthro(bob, { name: 'Fern', gender: 'Female' });
        expect(get('/game/assets/' + fern.id, alice)).toContain('/game/socials?to=' + fern.id);
        expect(get('/game/socials', alice, { to: fern.id })).toContain('Fern (#' + fern.id + ')');
        post('/game/socials', { action: 'flirt', to: 'Fern (#' + fern.id + ')', message: 'Hey', times: 2 }, alice);
        expect(flash()).toBe("You flirted. They'll answer when they can.");
        const page = get('/game/socials', bob);
        expect(page).toContain('Flirting with you');
        expect(page).toContain('breed 2×');
        expect(page, 'Anthro names only.').not.toContain('alice');
        const flirt = Number(scalar('SELECT id FROM game_flirts'));
        post('/game/socials', { action: 'accept', flirt_id: flirt }, bob);
        expect(String(flash()).startsWith('You accepted')).toBe(true);
        expect(Number(scalar('SELECT COUNT(*) FROM game_breedings'))).toBe(2);
    });

    test('messages', () => {
        const alice = player('alice');
        playerAnthro(alice, { name: 'Fenn' });
        const bob = player('bobby');
        const wren = playerAnthro(bob, { name: 'Wren' });
        post('/game/notifications', { to: 'Wren (#' + wren.id + ')', body: 'Hello' }, alice);
        expect(flash()).toBe('Message sent to Wren.');
        const inbox = get('/game/notifications', bob);
        expect(inbox).toContain('Hello');
        expect(inbox).toContain('Fenn');
        expect(inbox, 'Messages never name the sending player.').not.toContain('alice');
        const id = Number(scalar("SELECT id FROM game_notifications WHERE body = 'Hello'"));
        post('/game/notifications', { action: 'delete', only: id }, bob);
        expect(get('/game/notifications', bob)).not.toContain('Hello');
    });

    test('admins manage other groups from the panel', () => {
        const alice = player('alice');
        playerAnthro(alice);
        const mate = anthro({ name: 'Matey', owner: alice });
        post('/game/groups', { action: 'create', name: 'Nest', ids: [mate.id] }, alice);
        const boss = admin();
        playerAnthro(boss);

        const page = get('/game/groups', boss);
        expect(panel(page)).toContain('Nest');
        expect(panel(page)).toContain('value="dissolve"');
        expect(body(page), "Not the admin's group: not in the page.").not.toMatch(/id="group-\d/);
        expect(body(page)).toContain("You aren't in any breeding group yet.");

        expect(get('/game/groups', alice), 'Its owner manages it in the page.').toContain('value="dissolve"');
    });

    test('admins reply for anthros nobody plays', () => {
        const boss = admin();
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Alice' });
        const perrin = anthro({ name: 'Perrin' });
        post('/game/notifications', { to: `Perrin (#${perrin.id})`, body: 'Hello there' }, alice);

        const page = get('/game/admin/notifications', boss);
        expect(page).toContain(`/game/admin/notifications?from=${perrin.id}&amp;to=${me.id}#send-as">Reply as Perrin</a>`);
        const form = get('/game/admin/notifications', boss, { from: perrin.id, to: me.id });
        expect(form).toContain('value="Perrin (#' + perrin.id + ')"');

        post('/game/admin/notifications', { from: `Perrin (#${perrin.id})`, to: `Alice (#${me.id})`, body: 'Well met' }, boss);
        expect(flash()).toBe('Sent as Perrin to Alice.');
        const inbox = get('/game/notifications', alice);
        expect(inbox).toContain('Well met');
        expect(inbox, "Only the anthro's name.").not.toContain(boss.username);
        expect(get('/game/admin/notifications', boss)).toContain('(written by ' + boss.username + ')');

        const [, , body] = request('POST', '/game/admin/notifications', { from: `Alice (#${me.id})`, to: `Perrin (#${perrin.id})`, body: 'x' }, boss);
        expect(body).toContain('Alice is played: only its player speaks for it.');
        const [status] = request('POST', '/game/admin/notifications', { from: `Perrin (#${perrin.id})`, to: `Alice (#${me.id})`, body: 'x' }, alice);
        expect(status, 'Admins only.').toBe(404);
    });

    test('finances pages and donating', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Alice' });
        setCoins(me.id, 10);
        const page = get('/game/wallet', alice);
        expect(page, 'The menu item.').toMatch(/href="\/game\/wallet"[^>]*>\s*Finances/);
        expect(page).toContain('href="/game/finances/report"');
        expect(get('/game/finances/report', alice)).toContain('Expected income');

        const friend = anthro({ name: 'Friend' });
        expect(get('/game/assets/' + friend.id, alice)).toContain('action="/game/donate"');
        expect(get('/game/assets/' + me.id, alice), 'Not to itself.').not.toContain('action="/game/donate"');
        const [, location] = request('POST', '/game/donate', { to: friend.id, resource: 'coins', amount: 3 }, alice);
        expect(location).toBe('/game/assets/' + friend.id);
        expect(flash()).toBe('Your gift to Friend was given.');
        const [, , body] = request('POST', '/game/donate', { to: friend.id, resource: 'coins', amount: 99 }, alice);
        expect(body).toContain('You have 7 coins.');
    });
});
