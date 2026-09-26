// Upstream: tests/Game/NotificationsTest.php
import { describe, expect, test } from 'vitest';
import { Notifications } from '../../src/game/Notifications';
import { admin, anthro, db, notificationsFor, notificationsForUser, player, playerAnthro, scalar } from '../TestCase';

describe('Notifications', () => {
    test('to anthro and to user', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const a = playerAnthro(alice);
        Notifications.toAnthro(a.id, 'For the anthro', '/game/home');
        Notifications.toAnthro(null, 'Dropped');
        Notifications.toUser(alice.id, 'Via the played anthro');
        Notifications.toUser(bob.id, 'Straight to the user');
        Notifications.toUser(null, 'Dropped');
        expect(notificationsFor(a.id)).toEqual(['For the anthro', 'Via the played anthro']);
        expect(notificationsForUser(bob.id)).toEqual(['Straight to the user']);
        expect(Number(scalar('SELECT COUNT(*) FROM game_notifications'))).toBe(3);
    });

    test('to admins', () => {
        const boss = admin();
        player('alice');
        Notifications.toAdmins('Admins only', '/game/admin/resets');
        expect(notificationsForUser(boss.id)).toEqual(['Admins only']);
        expect(Number(scalar('SELECT COUNT(*) FROM game_notifications'))).toBe(1);
    });

    test('send', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const from = playerAnthro(alice, { name: 'Fenn' });
        const to = anthro({ name: 'Wren' });

        expect(Notifications.send(bob, to.id, 'hi')).toBe('Create or become an anthro first; messages are sent as your anthro.');
        expect(Notifications.send(alice, 999999, 'hi')).toBe('Choose an anthro to send to.');
        expect(Notifications.send(alice, from.id, 'hi')).toBe("You can't message yourself.");
        expect(Notifications.send(alice, to.id, '  ')).toBe('Messages must be 1-2000 characters.');
        expect(Notifications.send(alice, to.id, 'x'.repeat(2001))).toBe('Messages must be 1-2000 characters.');
        expect(Notifications.send(alice, to.id, ' Hello Wren ')).toBeNull();
        const row = db().row('SELECT kind, from_anthro_id, body FROM game_notifications');
        expect(row).toEqual({ kind: 'message', from_anthro_id: from.id, body: 'Hello Wren' });
    });

    test('for user unread and mark all read', () => {
        const alice = player('alice');
        const a = playerAnthro(alice);
        const sender = player('bobby');
        playerAnthro(sender, { name: 'Sender' });
        Notifications.toAnthro(a.id, 'first');
        Notifications.send(sender, a.id, 'second');
        db().run('INSERT INTO game_notifications (user_id, body) VALUES (?, ?)', [alice.id, 'third']);

        const list = Notifications.forUser(alice);
        expect(list.map((n) => n.body)).toEqual(['third', 'second', 'first']);
        expect(list[1].from_name).toBe('Sender'); // Messages show the sending anthro, never its player.
        expect(list[1]).not.toHaveProperty('from_player');
        expect(Notifications.unreadCount(alice)).toBe(3);
        Notifications.markAllRead(alice);
        expect(Notifications.unreadCount(alice)).toBe(0);
        expect(Notifications.forUser(alice, 2)).toHaveLength(2);
    });

    test('users without an anthro see only their own', () => {
        const alice = player('alice');
        const other = anthro();
        Notifications.toAnthro(other.id, 'not hers');
        Notifications.toUser(alice.id, 'hers');
        expect(Notifications.forUser(alice).map((n) => n.body)).toEqual(['hers']);
    });

    test('delete is soft and only for the owner', () => {
        const alice = player('alice');
        const bob = player('bobby');
        Notifications.toUser(alice.id, 'mine');
        Notifications.toUser(bob.id, 'his');
        const ids = db().column('SELECT id FROM game_notifications ORDER BY id').map(Number);

        expect(Notifications.delete(alice, [])).toBe(0);
        expect(Notifications.delete(alice, [...ids, ids[0]])).toBe(1);
        expect(Notifications.forUser(alice)).toEqual([]);
        expect(Notifications.unreadCount(alice)).toBe(0);
        expect(Notifications.forUser(bob)).toHaveLength(1); // Other users' notifications are untouched.
        expect(Number(scalar('SELECT COUNT(*) FROM game_notifications'))).toBe(2); // Rows are kept.
        expect(Number(scalar('SELECT deleted_by FROM game_notifications WHERE id = ?', [ids[0]]))).toBe(alice.id);
    });

    test('all shows everything to admins', () => {
        const alice = player('alice');
        const bob = player('bobby');
        playerAnthro(alice, { name: 'Fenn' });
        const toAnthro = playerAnthro(bob, { name: 'Wren' });
        Notifications.send(alice, toAnthro.id, 'psst');
        Notifications.delete(bob, [Number(scalar('SELECT id FROM game_notifications'))]);
        const row = Notifications.all()[0];
        expect(row.to_anthro).toBe('Wren');
        expect(row.to_player).toBe('bobby');
        expect(row.from_name).toBe('Fenn');
        expect(row.from_player).toBe('alice');
        expect(row.deleted_at).not.toBeNull();
        expect(row.deleted_by_name).toBe('bobby');
    });

    test('repeats are squashed while unread', () => {
        const alice = player('alice');
        const a = playerAnthro(alice);
        Notifications.toAnthro(a.id, 'Same thing', '/a');
        Notifications.toAnthro(a.id, 'Something else');
        Notifications.toAnthro(a.id, 'Same thing', '/b');
        const list = Notifications.forUser(alice);
        expect(list.map((n) => n.body)).toEqual(['Same thing', 'Something else']); // The repeat moved to the top.
        expect(list.map((n) => n.times)).toEqual([2, 1]);
        expect(list[0].link).toBe('/b');
        expect(Notifications.unreadCount(alice)).toBe(2);

        Notifications.markAllRead(alice);
        Notifications.toAnthro(a.id, 'Same thing');
        expect(Notifications.forUser(alice).map((n) => n.times)).toEqual([1, 2, 1]); // Read ones are left alone.

        Notifications.delete(alice, [Notifications.forUser(alice)[0].id]);
        Notifications.toAnthro(a.id, 'Same thing');
        expect(Notifications.forUser(alice)[0].times).toBe(1); // So are deleted ones.
    });

    test('groups squash different texts', () => {
        const a = anthro();
        Notifications.toAnthro(a.id, 'first version', null, 'topic');
        Notifications.toAnthro(a.id, 'second version', null, 'topic');
        expect(notificationsFor(a.id)).toEqual(['second version']);
    });

    test('messages squash only from the same sender', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const carol = player('carol');
        playerAnthro(alice, { name: 'Fenn' });
        playerAnthro(carol, { name: 'Cy' });
        const to = playerAnthro(bob, { name: 'Wren' });
        Notifications.send(alice, to.id, 'hi');
        Notifications.send(alice, to.id, 'hi');
        Notifications.send(carol, to.id, 'hi');
        expect(Notifications.forUser(bob).map((n) => [n.from_name, n.times])).toEqual([['Cy', 1], ['Fenn', 2]]);
    });

    test('user notifications squash too', () => {
        const boss = admin();
        Notifications.toAdmins('Reset requested');
        Notifications.toAdmins('Reset requested');
        expect(notificationsForUser(boss.id)).toEqual(['Reset requested']);
        expect(Notifications.forUser(boss)[0].times).toBe(2);
    });

    test('recipients include unplayed anthros', () => {
        const alice = player('alice');
        playerAnthro(alice, { name: 'Played' });
        anthro({ name: 'Unplayed' });
        expect(Notifications.recipients().map((r) => r.name)).toEqual(['Played', 'Unplayed']);
        expect(Object.keys(Notifications.recipients()[0])).toEqual(['id', 'name']); // Nothing reveals who is played.
    });
});
