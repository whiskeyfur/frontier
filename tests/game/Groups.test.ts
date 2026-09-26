// Upstream: tests/Game/GroupsTest.php
import { describe, expect, test } from 'vitest';
import type { Row } from '../../src/db/Db';
import { gmdate, strtotimeOrThrow } from '../../src/core/php';
import { Groups } from '../../src/game/Groups';
import { admin, anthro, anthroOf, notificationsFor, player, playerAnthro } from '../TestCase';

/**
 * A group owned by owner's anthro, with one other anthro of theirs, at the given access.
 */
function group(owner: Row, access = 'closed', name = 'Hearth'): number {
    const [id, error] = Groups.create(owner, name, [anthro({ owner }).id]);
    expect(error).toBeNull();
    expect(Groups.setAccess(owner, id!, access)).toBeNull();
    return id!;
}

function names(groups: Row[]): string[] {
    return groups.map((g) => g.name);
}

describe('Groups', () => {
    test('create', () => {
        const alice = player('alice');
        const a = anthro({ owner: alice });
        const stranger = anthro();

        expect(Groups.create(alice, ' ', [a.id])).toEqual([null, 'Name the group (up to 64 characters).']);
        expect(Groups.create(alice, 'Empty', [])).toEqual([null, 'Choose at least one anthro for the group.']);
        expect(Groups.create(alice, 'Grab', [a.id, stranger.id])).toEqual([null, 'You can only group anthros you own or employ.']);
        const [id, error] = Groups.create(alice, ' Hearth ', [a.id]);
        expect(error).toBeNull(); // One member is enough.
        const g = Groups.find(id!)!;
        expect(g.name).toBe('Hearth');
        expect(g.members.map((m: Row) => m.id)).toEqual([a.id]);
        expect(g.owner_anthro_id).toBe(anthroOf(alice)); // Owned by the creator's anthro.
        expect(g.access).toBe('closed'); // Closed by default.
        expect(Groups.manages(alice, g)).toBe(true);
        expect(g.rolled_through).toBe(gmdate('Y-m-d', strtotimeOrThrow('-1 day')));
        expect(Groups.namesFor(a.id)).toEqual(new Map([[id, 'Hearth']]));
        expect(Groups.find(999999)).toBeNull();
    });

    test('set access', () => {
        const alice = player('alice');
        const id = group(alice);
        expect(Groups.setAccess(alice, id, 'secret')).toBe('Choose who can join.');
        expect(Groups.setAccess(player('bobby'), id, 'open')).toBe("Only the group's owner can change that.");
        expect(Groups.setAccess(admin(), id, 'request')).toBeNull();
        expect(Groups.find(id)!.access).toBe('request');
    });

    test('joining an open group', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const id = group(alice, 'open');
        const bobAnthro = playerAnthro(bob, { name: 'Wren' });
        expect(Groups.join(bob, id, anthro({ owner: alice }).id)).toEqual([null, 'You can only join with an anthro you own or employ.']);
        expect(Groups.join(bob, id, bobAnthro.id)).toEqual(['joined', null]);
        expect(Groups.find(id)!.members).toHaveLength(2);
        expect(Groups.join(bob, id, bobAnthro.id)).toEqual([null, 'Wren is already in Hearth.']);
        expect(notificationsFor(anthroOf(alice))).toContain('Wren joined Hearth.');
        expect(names(Groups.forUser(bob))).toContain('Hearth');
    });

    test('requesting to join', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const carol = player('carol');
        const id = group(alice, 'request');
        const wren = playerAnthro(bob, { name: 'Wren' });

        expect(Groups.join(bob, id, wren.id)).toEqual(['requested', null]);
        expect(Groups.join(bob, id, wren.id)).toEqual([null, 'Wren has already asked to join.']);
        expect(notificationsFor(anthroOf(alice))).toContain('Wren asks to join Hearth.');
        const pending = Groups.find(id)!.pending[0];
        expect(pending.kind).toBe('request');
        expect(names(Groups.forUser(bob))).toContain('Hearth'); // The requester sees it.

        expect(Groups.respond(carol, Number(pending.id), true)).toBe("That isn't yours to answer.");
        expect(Groups.respond(bob, Number(pending.id), true)).toBe("That isn't yours to answer."); // Bob can't approve himself.
        expect(Groups.respond(alice, Number(pending.id), true)).toBeNull();
        expect(Groups.find(id)!.members).toHaveLength(2);
        expect(Groups.find(id)!.pending).toEqual([]);
        expect(notificationsFor(wren.id)).toContain("Wren's request to join Hearth was accepted.");
        expect(Groups.respond(alice, Number(pending.id), true)).toBe('That request has already been answered.');
    });

    test('requests can be declined or withdrawn', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const id = group(alice, 'request');
        const wren = playerAnthro(bob, { name: 'Wren' });
        Groups.join(bob, id, wren.id);
        expect(Groups.respond(alice, Number(Groups.find(id)!.pending[0].id), false)).toBeNull();
        expect(notificationsFor(wren.id)).toContain("Wren's request to join Hearth was declined.");
        Groups.join(bob, id, wren.id);
        expect(Groups.respond(bob, Number(Groups.find(id)!.pending[0].id), false)).toBeNull(); // Withdrawn.
        expect(Groups.find(id)!.pending).toEqual([]);
        expect(Groups.find(id)!.members).toHaveLength(1);
    });

    test("closed invite only and private groups can't be joined", () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob);
        const closed = group(alice, 'closed', 'Shut');
        const invite = group(alice, 'invite', 'Invited');
        const hidden = group(alice, 'private', 'Hidden');
        expect(Groups.join(bob, closed, wren.id)).toEqual([null, "That group isn't taking new members."]);
        expect(Groups.join(bob, invite, wren.id)).toEqual([null, 'That group is invite only.']);
        expect(Groups.join(bob, hidden, wren.id)).toEqual([null, 'That group no longer exists.']);
        expect(names(Groups.directory())).toEqual(['Invited', 'Shut']); // Private groups aren't listed.
    });

    test('invitations', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob, { name: 'Wren' });
        const id = group(alice, 'invite');

        expect(Groups.invite(bob, id, wren.id)).toEqual([null, "Only the group's owner can invite anthros."]);
        expect(Groups.invite(alice, id, wren.id)).toEqual(['invited', null]);
        expect(Groups.invite(alice, id, wren.id)).toEqual([null, 'Wren is already invited.']);
        expect(notificationsFor(wren.id)).toContain('Wren is invited to join the breeding group Hearth.');
        expect(names(Groups.forUser(bob))).toContain('Hearth');
        const pending = Groups.find(id)!.pending[0];
        expect(Groups.respond(alice, Number(pending.id), true)).toBe("That isn't yours to answer."); // Only Wren's side accepts.
        expect(Groups.respond(bob, Number(pending.id), true)).toBeNull();
        expect(Groups.find(id)!.members.map((m: Row) => m.id)).toContain(wren.id);
        expect(notificationsFor(anthroOf(alice))).toContain("Wren's invitation to Hearth was accepted.");
    });

    test('joining accepts an invite', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob);
        const id = group(alice, 'invite');
        Groups.invite(alice, id, wren.id);
        expect(Groups.join(bob, id, wren.id)).toEqual(['joined', null]);
        expect(Groups.find(id)!.members).toHaveLength(2);
    });

    test('inviting someone who asked approves them', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob);
        const id = group(alice, 'request');
        Groups.join(bob, id, wren.id);
        expect(Groups.invite(alice, id, wren.id)).toEqual(['added', null]);
        expect(Groups.find(id)!.members).toHaveLength(2);
    });

    test('owners add their own anthros at any time', () => {
        const alice = player('alice');
        const id = group(alice, 'closed');
        expect(Groups.invite(alice, id, anthro({ owner: alice }).id)).toEqual(['added', null]);
        expect(Groups.join(alice, id, anthro({ owner: alice }).id)).toEqual(['joined', null]);
        expect(Groups.invite(alice, id, playerAnthro(player('bobby')).id))
            .toEqual([null, 'The group is closed. Change who can join to invite anthros.']);
        expect(Groups.find(id)!.members).toHaveLength(3);
    });

    test('inviting an owned anthro tells its owner too', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const owned = anthro({ owner: bob, name: 'Pet' });
        const id = group(alice, 'invite');
        Groups.invite(alice, id, owned.id);
        expect(notificationsFor(anthroOf(bob))).toContain('Pet is invited to join the breeding group Hearth.');
    });

    test('visibility', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const id = group(alice, 'private');
        const member = Groups.find(id)!.members[0];
        expect(names(Groups.forUser(alice))).toEqual(['Hearth']);
        expect(Groups.forUser(bob)).toEqual([]);
        expect(Groups.forUser(admin())).toEqual([]); // Admins see every group in the admin panel, not the page.
        expect(names(Groups.all())).toEqual(['Hearth']);
        expect(Groups.namesFor(member.id, bob)).toEqual(new Map()); // Private groups are hidden from others.
        expect(Groups.namesFor(member.id, alice)).toEqual(new Map([[id, 'Hearth']]));
        Groups.setAccess(alice, id, 'closed');
        expect(Groups.namesFor(member.id, bob)).toEqual(new Map([[id, 'Hearth']]));
    });

    test('remove and dissolve when empty', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const id = group(alice, 'open');
        const wren = playerAnthro(bob);
        Groups.join(bob, id, wren.id);
        const first = Groups.find(id)!.members[0];

        expect(Groups.remove(bob, id, first.id)).toBe("That anthro isn't in a group of yours.");
        expect(Groups.remove(alice, id, wren.id)).toBeNull(); // The owner can take anyone out.
        expect(Groups.find(id)).not.toBeNull(); // One member left is fine.
        expect(Groups.remove(alice, id, first.id)).toBeNull();
        expect(Groups.find(id)).toBeNull(); // No members: dissolved.
    });

    test('owned anthros must ask their owner to leave', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const owned = playerAnthro(bob, { owner: alice, name: 'Owned' });
        const [id] = Groups.create(alice, 'Hearth', [owned.id, anthro({ owner: alice }).id]);

        expect(names(Groups.forUser(bob))).toContain('Hearth'); // Bob sees his group.
        expect(Groups.remove(bob, id!, owned.id)).toBe('Only your owner can take you out of a breeding group. Ask them to.');
        expect(Groups.askToLeave(bob, id!)).toBeNull();
        expect(notificationsFor(anthroOf(alice))).toContain('Owned asks to be taken out of the breeding group Hearth.');
        expect(Groups.askToLeave(player('carol'), id!)).toBe("You aren't in that group.");
        expect(Groups.remove(alice, id!, owned.id)).toBeNull(); // The owner can.
    });

    test('free players leave themselves', () => {
        const bob = player('bobby');
        const free = playerAnthro(bob);
        const [id] = Groups.create(admin(), 'Trio', [free.id, anthro().id]);
        expect(Groups.askToLeave(bob, id!)).toBe('You can leave it yourself.');
        expect(Groups.remove(bob, id!, free.id)).toBeNull();
        expect(Groups.find(id!)!.members).toHaveLength(1);
    });

    test('rename and dissolve are for the owner', () => {
        const alice = player('alice');
        const bob = player('bobby');
        const wren = playerAnthro(bob);
        const id = group(alice, 'open');
        Groups.join(bob, id, wren.id);
        expect(Groups.rename(alice, id, 'Home')).toBeNull();
        expect(Groups.find(id)!.name).toBe('Home');
        expect(Groups.rename(alice, id, '')).toBe('Name the group (up to 64 characters).');
        expect(Groups.rename(bob, id, 'Mine')).toBe("Only the group's owner can rename it.");
        expect(Groups.dissolve(bob, id)).toBe("Only the group's owner can dissolve it.");
        expect(Groups.dissolve(alice, id)).toBeNull();
        expect(Groups.find(id)).toBeNull();
        expect(notificationsFor(wren.id)).toContain('The breeding group Home was dissolved.');
    });

    test('controls', () => {
        const alice = player('alice');
        expect(Groups.controls(alice, anthro({ owner: alice }))).toBe(true);
        expect(Groups.controls(alice, anthro({ employer: alice }))).toBe(true);
        expect(Groups.controls(alice, anthro())).toBe(false);
        expect(Groups.controls(admin(), anthro())).toBe(true);
    });
});
