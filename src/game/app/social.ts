// Upstream: game/src/App.php (socials, groups, notifications)
import { Auth, type User } from '../../core/Auth';
import { field, fieldList } from '../../core/http';
import { int } from '../../core/php';
import { Session } from '../../core/Session';
import type { App } from '../App';
import { Anthros } from '../Anthros';
import { Groups } from '../Groups';
import { Notifications } from '../Notifications';
import { Socials } from '../Socials';
import groupsView from '../views/groups';
import notificationsView from '../views/notifications';
import socialsView from '../views/socials';

export function socials(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const flirtId = int(field(app.post, 'flirt_id', '0'));
        let result: string | null = null;
        switch (action) {
            case 'flirt':
                [result, error] = Socials.flirt(user, app.anthroIdFrom(field(app.post, 'to')), field(app.post, 'message'),
                    int(field(app.post, 'times', '1')));
                break;
            case 'accept': case 'decline': [result, error] = [null, Socials.respond(user, flirtId, action === 'accept')]; break;
            case 'withdraw': [result, error] = [null, Socials.withdraw(user, flirtId)]; break;
            default: [result, error] = [null, 'Unknown action.'];
        }
        if (error === null) {
            switch (action) {
                case 'flirt':
                    switch (result) {
                        case 'accepted': Session.data.flash = 'They liked it, and you tried breeding. See your notifications for how it went.'; break;
                        case 'declined': Session.data.flash = 'They turned you down.'; break;
                        default: Session.data.flash = 'You flirted. They\'ll answer when they can.';
                    }
                    break;
                case 'accept': Session.data.flash = 'You accepted, and you tried breeding. See your notifications for how it went.'; break;
                case 'decline': Session.data.flash = 'You turned them down.'; break;
                case 'withdraw': Session.data.flash = 'You took it back.'; break;
            }
            app.redirect('/game/socials');
        }
    }
    const player = Anthros.player(user.id);
    const to = Anthros.findAny(int(field(app.query, 'to', '0')));
    app.echo(app.render(socialsView, user, {
        player,
        flirts: player ? Socials.forAnthro(player.id) : [],
        prefill: to ? `${to.name} (#${to.id})` : '',
        error,
    }));
}

export function groups(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const groupId = int(field(app.post, 'group_id', '0'));
        // Anthros are picked from a list, or typed as "Name (#id)" (inviting any anthro).
        const anthroId = int(field(app.post, 'anthro_id', '0')) || app.anthroIdFrom(field(app.post, 'anthro'));
        let result: string | null = null;
        switch (action) {
            case 'create':
                [, error] = Groups.create(user, field(app.post, 'name'), fieldList(app.post, 'ids'));
                break;
            case 'join':
                [result, error] = Groups.join(user, groupId, anthroId);
                break;
            case 'invite':
                [result, error] = Groups.invite(user, groupId, anthroId);
                break;
            case 'accept':
            case 'decline':
                error = Groups.respond(user, int(field(app.post, 'pending_id', '0')), action === 'accept');
                break;
            case 'access':
                error = Groups.setAccess(user, groupId, field(app.post, 'access'));
                break;
            case 'remove':
                error = Groups.remove(user, groupId, anthroId);
                break;
            case 'ask_to_leave':
                error = Groups.askToLeave(user, groupId);
                break;
            case 'rename':
                error = Groups.rename(user, groupId, field(app.post, 'name'));
                break;
            case 'dissolve':
                error = Groups.dissolve(user, groupId);
                break;
            default:
                error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                'create': 'The breeding group was formed.',
                'join': result === 'requested' ? 'You asked to join; the group\'s owner will decide.' : 'Joined the group.',
                'invite': result === 'invited' ? 'The invitation was sent.' : 'Added to the group.',
                'accept': 'Accepted.',
                'decline': 'Declined.',
                'access': 'Saved who can join.',
                'remove': 'Taken out of the group.',
                'ask_to_leave': 'Your owner was asked to take you out of the group.',
                'rename': 'The group was renamed.',
                'dissolve': 'The group was dissolved.',
            } as Record<string, string>)[action];
            // Invited from an anthro's page: back there.
            const back = field(app.post, 'back');
            app.redirect(/^\/game\/assets\/\d+$/.test(back) ? back : '/game/groups');
        }
    }
    const mine = Groups.forUser(user);
    const mineIds = mine.map((g) => g.id);
    app.echo(app.render(groupsView, user, {
        groups: mine,
        // Other groups that can be joined or asked to join, or seen.
        directory: Groups.directory().filter((g) => !mineIds.includes(g.id)),
        // Anthros the user can put in groups: ones they own or employ.
        candidates: Anthros.breedable(user.id),
        allGroups: Auth.isAdmin(user) ? Groups.all() : [],
        error,
    }));
}

export function notifications(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    // The recipient field reads "Name (#id)"; the id decides who it goes to.
    const toField = field(app.post, 'to');
    const match = toField.match(/#(\d+)\)?\s*$/);
    const to = match ? int(match[1]) : int(field(app.query, 'to', '0'));
    const body = field(app.post, 'body');
    if (post && field(app.post, 'action') === 'delete') {
        // A row's own Delete button sends "only"; "Delete selected" sends the ticked ids.
        const ids = app.post.only !== undefined ? [int(app.post.only)] : fieldList(app.post, 'ids');
        const deleted = Notifications.delete(user, ids);
        Session.data.flash = deleted ? `Deleted ${deleted} ` + (deleted === 1 ? 'notification' : 'notifications') + '.'
            : 'Select some notifications first.';
        app.redirect('/game/notifications');
    }
    if (post) {
        error = Notifications.send(user, to, body);
        if (error === null) {
            const recipient = Anthros.findAny(to)!;
            Session.data.flash = `Message sent to ${recipient.name}.`;
            app.redirect('/game/notifications');
        }
    }
    // Show which were unread, then mark everything read.
    const items = Notifications.forUser(user);
    Notifications.markAllRead(user);
    // Pre-fill the recipient ("Reply", or ?to=id from an anthro's page).
    let prefill = toField;
    let recipient;
    if (prefill === '' && to && (recipient = Anthros.findAny(to))) {
        prefill = `${recipient.name} (#${recipient.id})`;
    }
    app.echo(app.render(notificationsView, user, {
        items, player: Anthros.player(user.id),
        prefill, body, error,
    }));
}
