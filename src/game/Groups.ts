// Upstream: game/src/Groups.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { array_unique, int, mb_strlen, trim } from '../core/php';
import { Anthros } from './Anthros';
import { Notifications } from './Notifications';
import { Wallets } from './Wallets';

/**
 * Breeding groups: anthros who are, in effect, married. An anthro can belong to several. A dam whose urge comes up
 * seeks a mate in her groups first (see Urges); like any breeding, one that breaks the rules is recorded with no litter.
 *
 * A group is owned by an anthro (owner_anthro_id: the one its creator plays). Its player manages the group (see
 * manages): its access, members, invites and requests; admins can manage any group. Access (ACCESS) decides how other
 * anthros join: open (join at once), request (the owner approves), invite (the owner invites), closed (no new members,
 * the default) or private (closed, and not listed for anyone not involved). Anthros join, leave, and answer invites
 * through whoever controls them (see controls); a played anthro that's owned can't leave on its own, and asks its
 * owner instead (askToLeave). A group can have a single member; it's dissolved when its last member leaves.
 */
export class Groups {
    static readonly MIN_MEMBERS = 1;
    // Breeding on their own needs a partner.
    static readonly BREEDING_MIN = 2;
    static readonly MAX_NAME = 64;
    static readonly ACCESS: Record<string, string> = {
        'open': 'Open: anyone can join',
        'request': 'By request: you approve who joins',
        'invite': 'Invite only: you invite who joins',
        'closed': 'Closed: not taking new members',
        'private': 'Private: closed, and not listed',
    };

    /**
     * The groups the user is involved in (see involved), or every group for admins, by name.
     */
    static forUser(user: Row): Row[] {
        return Groups.allGroups().filter((g) => Groups.involved(user, g, false));
    }

    /**
     * Every group, private ones included (for admins).
     */
    static all(): Row[] {
        return Groups.allGroups();
    }

    /**
     * Groups anyone can see (everything but private ones), by name, for finding one to join.
     */
    static directory(): Row[] {
        return Groups.allGroups().filter((g) => g.access !== 'private');
    }

    /**
     * A group with its owner, its members (as anthros) and its pending requests and invites, or null.
     */
    static find(id: number): Row | null {
        const group = Auth.db().row(
            `SELECT g.*, o.name AS owner_name, o.player_id AS owner_player_id
             FROM game_breeding_groups g LEFT JOIN game_anthros o ON o.id = g.owner_anthro_id WHERE g.id = ?`,
            [id],
        );
        if (!group) {
            return null;
        }
        const memberIds = Auth.db().column('SELECT anthro_id FROM game_group_members WHERE group_id = ? ORDER BY joined_at, anthro_id', [id]);
        group.members = memberIds.map((a) => Anthros.findAny(int(a))).filter((a) => a);
        const requests = Auth.db().all('SELECT id, anthro_id, kind, created_at FROM game_group_requests WHERE group_id = ? ORDER BY id', [id]);
        group.pending = requests.map((r) => {
            const anthro = Anthros.findAny(int(r.anthro_id));
            return anthro ? { ...r, anthro } : null;
        }).filter((r) => r);
        return group;
    }

    /**
     * The groups the user could invite the anthro into from its page: ones the anthro they play owns and is in, that
     * the anthro isn't in or invited to (or asking to join), by name. 'closed' is set on one that won't take the
     * invite while closed (the user doesn't control the anthro, which it would add straight away).
     */
    static invitableFor(user: Row, anthro: Row): Row[] {
        const player = Anthros.player(user.id);
        if (!player || player.id === anthro.id || Anthros.isDead(anthro)) {
            return [];
        }
        const ids = Auth.db().column(
            `SELECT g.id FROM game_breeding_groups g JOIN game_group_members m ON m.group_id = g.id AND m.anthro_id = g.owner_anthro_id
             WHERE g.owner_anthro_id = ? ORDER BY g.name`,
            [player.id],
        );
        const controls = Groups.controls(user, anthro, false);
        const groups: Row[] = [];
        for (const id of ids) {
            const group = Groups.find(int(id))!;
            if (!Groups.memberOrPending(group, anthro)) {
                groups.push({ ...group, closed: !controls && group.access === 'closed' });
            }
        }
        return groups;
    }

    /**
     * The groups the anthro belongs to, as a Map of id => name (by name), leaving out private ones the viewer isn't
     * involved in.
     */
    static namesFor(anthroId: number, viewer: Row | null = null): Map<number, string> {
        const ids = Auth.db().column(
            `SELECT g.id FROM game_breeding_groups g JOIN game_group_members m ON m.group_id = g.id
             WHERE m.anthro_id = ? ORDER BY g.name`,
            [anthroId],
        );
        const names = new Map<number, string>();
        for (const id of ids) {
            const group = Groups.find(int(id))!;
            if (group.access !== 'private' || viewer === null || Auth.isAdmin(viewer) || Groups.involved(viewer, group)) {
                names.set(group.id, group.name);
            }
        }
        return names;
    }

    /**
     * Whether the user decides about the anthro's groups: they have it or employ it (see Anthros::isOwner), or
     * they're an admin (unless asAdmin is false: what the page shows, where admins act from the admin panel).
     */
    static controls(user: Row, anthro: Row, asAdmin = true): boolean {
        return Anthros.mayBreed(user, anthro) || (asAdmin && Auth.isAdmin(user));
    }

    /**
     * Whether the user manages the group: they play the anthro that owns it, or they're an admin (unless asAdmin is
     * false).
     */
    static manages(user: Row, group: Row, asAdmin = true): boolean {
        return (asAdmin && Auth.isAdmin(user)) || (group.owner_player_id !== null && group.owner_player_id === user.id);
    }

    /**
     * Whether the group concerns the user: they manage it, or one of its members (or an anthro with a pending request
     * or invite) is theirs or is them.
     */
    static involved(user: Row, group: Row, asAdmin = true): boolean {
        if (Groups.manages(user, group, asAdmin)) {
            return true;
        }
        for (const anthro of [...group.members, ...group.pending.map((p: Row) => p.anthro)]) {
            if (Groups.controls(user, anthro, asAdmin) || anthro.player_id === user.id) {
                return true;
            }
        }
        return false;
    }

    /**
     * Forms a group, owned by the anthro the user plays, with anthros they control. Returns [group id, null] or
     * [null, error message].
     */
    static create(user: Row, name: string, ids: unknown[]): [number | null, string | null] {
        name = trim(name);
        const error = Groups.validateName(name);
        if (error) {
            return [null, error];
        }
        const members: Row[] = [];
        for (const id of array_unique(ids.map((i) => int(i)))) {
            const anthro = Anthros.findAny(id);
            if (!anthro || !Groups.controls(user, anthro)) {
                return [null, 'You can only group anthros you own or employ.'];
            }
            members.push(anthro);
        }
        if (members.length < Groups.MIN_MEMBERS) {
            return [null, 'Choose at least one anthro for the group.'];
        }
        const db = Auth.db();
        db.beginTransaction();
        // Rolling starts with the day it's formed.
        db.run(
            'INSERT INTO game_breeding_groups (name, owner_anthro_id, created_by, rolled_through) VALUES (?, ?, ?, SUBDATE(UTC_DATE(), 1))',
            [name, Wallets.anthroFor(user.id), user.id],
        );
        const groupId = db.lastInsertId();
        for (const member of members) {
            Groups.addMember(groupId, member, name);
        }
        db.commit();
        return [groupId, null];
    }

    /**
     * Sets who can join. Returns an error message, or null.
     */
    static setAccess(user: Row, groupId: number, access: string): string | null {
        const group = Groups.find(groupId);
        if (!group || !Groups.manages(user, group)) {
            return 'Only the group\'s owner can change that.';
        }
        if (!Object.hasOwn(Groups.ACCESS, access)) {
            return 'Choose who can join.';
        }
        Auth.db().run('UPDATE game_breeding_groups SET access = ? WHERE id = ?', [access, groupId]);
        return null;
    }

    /**
     * The user's anthro joins the group, or asks to, as its access allows (or accepts an invite it has).
     * Returns ['joined' or 'requested', null] or [null, error message].
     */
    static join(user: Row, groupId: number, anthroId: number): [string | null, string | null] {
        const group = Groups.find(groupId);
        const anthro = Anthros.findAny(anthroId);
        if (!group || (group.access === 'private' && !Groups.involved(user, group))) {
            return [null, 'That group no longer exists.'];
        }
        if (!anthro || !Groups.controls(user, anthro)) {
            return [null, 'You can only join with an anthro you own or employ.'];
        }
        let error = Groups.memberOrPending(group, anthro);
        if (error) {
            const invite = Groups.pendingFor(groupId, anthro.id);
            if (invite && invite.kind === 'invite') {
                error = Groups.respond(user, int(invite.id), true);
                return error ? [null, error] : ['joined', null];
            }
            return [null, error];
        }
        if (Groups.manages(user, group)) {
            Groups.addMember(groupId, anthro, group.name);
            return ['joined', null];
        }
        if (group.access === 'open') {
            Groups.addMember(groupId, anthro, group.name);
            Notifications.toAnthro(group.owner_anthro_id, `${anthro.name} joined ${group.name}.`, '/game/groups');
            return ['joined', null];
        }
        if (group.access !== 'request') {
            return [null, group.access === 'invite' ? 'That group is invite only.' : "That group isn't taking new members."];
        }
        Groups.addPending(groupId, anthro.id, 'request', user.id);
        Notifications.toAnthro(group.owner_anthro_id, `${anthro.name} asks to join ${group.name}.`, '/game/groups');
        return ['requested', null];
    }

    /**
     * The group's owner invites an anthro, or adds it straight away if they control it (or it asked to join).
     * Returns ['added' or 'invited', null] or [null, error message].
     */
    static invite(user: Row, groupId: number, anthroId: number): [string | null, string | null] {
        const group = Groups.find(groupId);
        const anthro = Anthros.findAny(anthroId);
        if (!group || !Groups.manages(user, group)) {
            return [null, 'Only the group\'s owner can invite anthros.'];
        }
        if (!anthro) {
            return [null, 'Choose an anthro.'];
        }
        const request = Groups.pendingFor(groupId, anthro.id);
        if (request && request.kind === 'request') {
            const error = Groups.respond(user, int(request.id), true);
            return error ? [null, error] : ['added', null];
        }
        const error = Groups.memberOrPending(group, anthro);
        if (error) {
            return [null, error];
        }
        if (Groups.controls(user, anthro)) {
            Groups.addMember(groupId, anthro, group.name);
            return ['added', null];
        }
        if (group.access === 'closed') {
            return [null, 'The group is closed. Change who can join to invite anthros.'];
        }
        Groups.addPending(groupId, anthro.id, 'invite', user.id);
        const body = `${anthro.name} is invited to join the breeding group ${group.name}.`;
        Notifications.toAnthro(anthro.id, body, '/game/groups');
        if (!Anthros.isFree(anthro) && anthro.owner_id !== null) {
            Notifications.toAnthro(anthro.owner_id, body, '/game/groups');
        }
        return ['invited', null];
    }

    /**
     * Accepts or declines a pending request (the group's owner decides) or invite (the invited anthro's controller
     * decides); either side can withdraw one. Returns an error message, or null.
     */
    static respond(user: Row, pendingId: number, accept: boolean): string | null {
        const pending = Auth.db().row('SELECT * FROM game_group_requests WHERE id = ?', [pendingId]);
        const group = pending ? Groups.find(int(pending.group_id)) : null;
        const anthro = pending ? Anthros.findAny(int(pending.anthro_id)) : null;
        if (!group || !anthro) {
            return 'That request has already been answered.';
        }
        const decider = pending!.kind === 'request' ? Groups.manages(user, group) : Groups.controls(user, anthro);
        const otherSide = pending!.kind === 'request' ? Groups.controls(user, anthro) : Groups.manages(user, group);
        if (!decider && !(otherSide && !accept)) {
            return "That isn't yours to answer.";
        }
        Auth.db().run('DELETE FROM game_group_requests WHERE id = ?', [pendingId]);
        if (accept) {
            Groups.addMember(int(group.id), anthro, group.name);
        }
        const what = pending!.kind === 'request' ? `${anthro.name}'s request to join ${group.name}` : `${anthro.name}'s invitation to ${group.name}`;
        const result = accept ? 'was accepted.' : (decider ? 'was declined.' : 'was withdrawn.');
        Notifications.toAnthro(pending!.kind === 'request' ? anthro.id : group.owner_anthro_id, `${what} ${result}`, '/game/groups');
        return null;
    }

    /**
     * Takes an anthro out of a group: the group's owner, or whoever controls the anthro. A played anthro that's
     * owned can't leave on its own (see askToLeave). The group is dissolved when its last member leaves.
     * Returns an error message, or null.
     */
    static remove(user: Row, groupId: number, anthroId: number): string | null {
        const group = Groups.find(groupId);
        const anthro: Row | undefined = group ? group.members.find((m: Row) => m.id === anthroId) : undefined;
        const allowed = !!anthro && (Groups.manages(user, group!) || Groups.controls(user, anthro));
        if (anthro && !allowed && anthro.player_id === user.id) {
            return 'Only your owner can take you out of a breeding group. Ask them to.';
        }
        if (!allowed) {
            return "That anthro isn't in a group of yours.";
        }
        Auth.db().run('DELETE FROM game_group_members WHERE group_id = ? AND anthro_id = ?', [groupId, anthroId]);
        Groups.tellPlayer(anthro!, `You left the breeding group ${group!.name}.`);
        if (group!.members.length - 1 < Groups.MIN_MEMBERS) {
            Auth.db().run('DELETE FROM game_breeding_groups WHERE id = ?', [groupId]);
        }
        return null;
    }

    /**
     * The player of an owned member asks its owner to take it out of the group. Returns an error message, or null.
     */
    static askToLeave(user: Row, groupId: number): string | null {
        const group = Groups.find(groupId);
        const anthro: Row | undefined = group ? group.members.find((m: Row) => m.player_id === user.id) : undefined;
        if (!anthro) {
            return "You aren't in that group.";
        }
        if (Groups.controls(user, anthro) || Groups.manages(user, group!)) {
            return 'You can leave it yourself.';
        }
        Notifications.toAnthro(anthro.owner_id ?? anthro.employer_id,
            `${anthro.name} asks to be taken out of the breeding group ${group!.name}.`, '/game/groups');
        return null;
    }

    /**
     * Renames a group its owner manages. Returns an error message, or null.
     */
    static rename(user: Row, groupId: number, name: string): string | null {
        const group = Groups.find(groupId);
        name = trim(name);
        if (!group || !Groups.manages(user, group)) {
            return 'Only the group\'s owner can rename it.';
        }
        const error = Groups.validateName(name);
        if (error) {
            return error;
        }
        Auth.db().run('UPDATE game_breeding_groups SET name = ? WHERE id = ?', [name, groupId]);
        return null;
    }

    /**
     * Dissolves a group its owner manages. Returns an error message, or null.
     */
    static dissolve(user: Row, groupId: number): string | null {
        const group = Groups.find(groupId);
        if (!group || !Groups.manages(user, group)) {
            return 'Only the group\'s owner can dissolve it.';
        }
        Auth.db().run('DELETE FROM game_breeding_groups WHERE id = ?', [groupId]);
        for (const member of group.members) {
            Groups.tellPlayer(member, `The breeding group ${group.name} was dissolved.`);
        }
        return null;
    }

    /**
     * Called when an anthro dies: it leaves its groups (dissolving any left too small) and any requests or invitations,
     * and a group it owned passes to the member who has been in it longest.
     */
    static bury(anthro: Row): void {
        const db = Auth.db();
        const memberOf = db.column('SELECT group_id FROM game_group_members WHERE anthro_id = ?', [anthro.id]);
        db.run('DELETE FROM game_group_members WHERE anthro_id = ?', [anthro.id]);
        db.run('DELETE FROM game_group_requests WHERE anthro_id = ?', [anthro.id]);
        const owned = db.column('SELECT id FROM game_breeding_groups WHERE owner_anthro_id = ?', [anthro.id]);
        for (const groupId of array_unique([...memberOf, ...owned])) {
            const group = Groups.find(int(groupId));
            if (!group) {
                continue;
            }
            if (group.members.length < Groups.MIN_MEMBERS) {
                db.run('DELETE FROM game_breeding_groups WHERE id = ?', [group.id]);
                continue;
            }
            if (group.owner_anthro_id === anthro.id) {
                const heir = group.members[0];
                db.run('UPDATE game_breeding_groups SET owner_anthro_id = ? WHERE id = ?', [heir.id, group.id]);
                Notifications.toAnthro(heir.id, `${anthro.name} died, and the breeding group ${group.name} is yours now.`, '/game/groups');
            }
            for (const member of group.members) {
                Groups.tellPlayer(member, `${anthro.name} died, and is no longer in the breeding group ${group.name}.`);
            }
        }
    }

    private static allGroups(): Row[] {
        const ids = Auth.db().column('SELECT id FROM game_breeding_groups ORDER BY name, id');
        return ids.map((id) => Groups.find(int(id))).filter((g): g is Row => g !== null);
    }

    private static addMember(groupId: number, anthro: Row, groupName: string): void {
        Auth.db().run('INSERT OR IGNORE INTO game_group_members (group_id, anthro_id) VALUES (?, ?)', [groupId, anthro.id]);
        Auth.db().run('DELETE FROM game_group_requests WHERE group_id = ? AND anthro_id = ?', [groupId, anthro.id]);
        Groups.tellPlayer(anthro, `You're now in the breeding group ${groupName}.`);
    }

    private static addPending(groupId: number, anthroId: number, kind: string, userId: number): void {
        Auth.db().run('INSERT INTO game_group_requests (group_id, anthro_id, kind, created_by) VALUES (?, ?, ?, ?)',
            [groupId, anthroId, kind, userId]);
    }

    private static pendingFor(groupId: number, anthroId: number): Row | null {
        return Auth.db().row('SELECT * FROM game_group_requests WHERE group_id = ? AND anthro_id = ?', [groupId, anthroId]);
    }

    /**
     * Why the anthro can't be asked or invited to join: it's already a member, or already asked or invited.
     */
    private static memberOrPending(group: Row, anthro: Row): string | null {
        if (Anthros.isDead(anthro)) {
            return `${anthro.name} has died.`;
        }
        if (group.members.map((m: Row) => m.id).includes(anthro.id)) {
            return `${anthro.name} is already in ${group.name}.`;
        }
        const pending = Groups.pendingFor(int(group.id), anthro.id);
        if (pending) {
            return pending.kind === 'invite' ? `${anthro.name} is already invited.` : `${anthro.name} has already asked to join.`;
        }
        return null;
    }

    private static validateName(name: string): string | null {
        return name === '' || mb_strlen(name) > Groups.MAX_NAME ? 'Name the group (up to ' + Groups.MAX_NAME + ' characters).' : null;
    }

    private static tellPlayer(anthro: Row, body: string): void {
        if (anthro.player_id !== null) {
            Notifications.toAnthro(anthro.id, body, '/game/groups');
        }
    }
}
