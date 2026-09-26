// Upstream: tests/Game/ResetsTest.php
import { describe, expect, test } from 'vitest';
import { Resets } from '../../src/game/Resets';
import { admin, anthroOf, notificationsForUser, player, playerAnthro, refresh, scalar } from '../TestCase';

describe('Resets', () => {
    test('request', () => {
        const boss = admin();
        const alice = player('alice');
        expect(Resets.request(alice, '')).toBe("You don't play an anthro, so there's nothing to reset.");
        playerAnthro(alice, { name: 'Fenn' });
        expect(Resets.request(alice, 'x'.repeat(501))).toBe('Keep the reason to 500 characters.');
        expect(Resets.request(alice, 'Bored')).toBeNull();
        expect(Resets.request(alice, 'again')).toBe('You already have a reset request waiting for an admin.');
        expect(Resets.pendingFor(alice.id)!.reason).toBe('Bored');
        expect(notificationsForUser(boss.id)).toEqual(['alice asks to stop playing Fenn and choose again: "Bored"']);
        const pending = Resets.pending();
        expect(pending.map((r) => r.username)).toEqual(['alice']);
        expect(pending[0].anthro_name).toBe('Fenn');
    });

    test('reset frees a self owned anthro', () => {
        const boss = admin();
        const alice = player('alice');
        let a = playerAnthro(alice);
        Resets.request(alice, '');
        expect(Resets.players().map((r) => r.user_id)).toEqual([alice.id]);
        expect(Resets.reset(alice.id, boss.id)).toBeNull();
        a = refresh(a);
        expect(a.player_id).toBeNull();
        expect(a.owner_id).toBe(a.id); // It stays free.
        expect(Resets.pendingFor(alice.id)).toBeNull();
        expect(scalar('SELECT status FROM game_reset_requests')).toBe('done');
        expect(notificationsForUser(alice.id)[0].startsWith('An admin released you')).toBe(true);
        expect(Resets.reset(alice.id, boss.id)).toBe("That player doesn't play an anthro.");
    });

    test('reset keeps an owned anthros owner', () => {
        const boss = admin();
        const alice = player('alice');
        const bob = player('bobby');
        const slave = playerAnthro(bob, { owner: alice });
        expect(Resets.reset(bob.id, boss.id)).toBeNull();
        expect(refresh(slave).owner_id).toBe(anthroOf(alice));
    });

    test('dismiss', () => {
        const boss = admin();
        const alice = player('alice');
        playerAnthro(alice);
        Resets.request(alice, '');
        const id = Number(Resets.pendingFor(alice.id)!.id);
        expect(Resets.dismiss(id, boss.id)).toBeNull();
        expect(scalar('SELECT status FROM game_reset_requests')).toBe('dismissed');
        expect(Resets.dismiss(id, boss.id)).toBe('That request has already been handled.');
    });
});
