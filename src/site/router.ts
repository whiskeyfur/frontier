/**
 * Every request from the page comes here (upstream's router.php and game/index.php). The game is /game/...; the
 * rest of upstream's site (accounts, admin, pages) isn't here. Instead:
 *   /        → the game (or, the first time, /welcome)
 *   /welcome → the first visit: choose the name you play under (your "account")
 *   /user    → settings: your name, and the game file (export, import, start over)
 */
import { Auth, Roles, type User } from '../core/Auth';
import { resetCaches } from '../core/caches';
import { field, type Request, type Response } from '../core/http';
import { html, type Html } from '../core/html';
import { mb_strlen, trim } from '../core/php';
import { Session } from '../core/Session';
import { ViewContext } from '../core/View';
import { App } from '../game/App';
import { Notifications } from '../game/Notifications';
import siteLayout from './views/layouts/site';
import welcomeView from './views/user/welcome';
import settingsView from './views/user/settings';

export const MAX_USERNAME = 32;

export function route(request: Request): Response {
    // Each PHP request starts with no static caches (Ranks, Clock, Market...): so does each request here.
    resetCaches();
    const users = Auth.allUsers();
    const path = request.path || '/';

    // The first visit: nobody plays yet.
    if (users.length === 0) {
        if (path !== '/welcome') return { kind: 'redirect', location: '/welcome' };
        let error: string | null = null;
        if (request.isPost) {
            const name = trim(field(request.post, 'username'));
            error = checkName(name);
            if (error === null) {
                const user = Auth.create(name, [Roles.ADMIN, Roles.PLAYER]);
                Session.data.user_id = user.id;
                return { kind: 'redirect', location: '/game/home' };
            }
        }
        return page(null, path, welcomeView, { error, username: field(request.post, 'username') });
    }

    // There's no logging in: the page is the person playing, the first account (tests and saved games from upstream
    // may have more; the admins' player is preferred).
    let user = typeof Session.data.user_id === 'number' ? Auth.find(Session.data.user_id) : null;
    if (!user) {
        user = users.find((u) => Auth.isAdmin(u)) ?? users[0];
        Session.data.user_id = user.id;
    }

    if (path === '/' || path === '/welcome') {
        return { kind: 'redirect', location: '/game/home' };
    }
    if (path === '/game' || path.startsWith('/game/')) {
        return new App(request).run();
    }
    if (path === '/user') {
        let error: string | null = null;
        if (request.isPost) {
            const name = trim(field(request.post, 'username'));
            error = checkName(name, user.id);
            if (error === null) {
                Auth.db().run('UPDATE users SET username = ? WHERE id = ?', [name, user.id]);
                Session.data.flash = 'Your name is saved.';
                return { kind: 'redirect', location: '/user' };
            }
        }
        return page(user, path, settingsView, { error, username: request.isPost ? field(request.post, 'username') : user.username });
    }
    return page(user, path, (v) => siteLayout(v, {
        title: 'Not found',
        content: html`<h1 class="h3">Not found</h1><p>The page you requested does not exist.</p><a href="/game/home">Back to the game</a>`,
    }), {}, 404);
}

function checkName(name: string, except: number | null = null): string | null {
    if (name === '' || mb_strlen(name) > MAX_USERNAME) {
        return `Names must be 1-${MAX_USERNAME} characters.`;
    }
    if (Auth.db().value('SELECT id FROM users WHERE username = ? AND id IS NOT ?', [name, except])) {
        return 'That name is taken.';
    }
    return null;
}

function page<T>(user: User | null, path: string, view: (v: ViewContext, data: T) => Html, data: T, status = 200): Response {
    const v = new ViewContext(user, path, Session.takeFlash(), user ? Notifications.unreadCount(user) : 0);
    const body = view(v, data);
    return { kind: 'html', status, html: body.value, title: v.title };
}
