// Upstream: views/layouts/nav.blade.php
//
// Here there's one app (Frontier) and one account, so the brand isn't a menu of apps, and the account button opens
// the game's settings (/user: the game file, your name) instead of logging in and out.
import { Auth } from '../../../core/Auth';
import { cls, html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { App } from '../../../game/App';

/**
 * The top navigation bar's contents (the layouts wrap it in a navbar). Inside the game, its pages are menu items
 * (App.PAGES; SUBPAGES as dropdowns). Admins get an Admin button at the top left that opens the admin panel
 * (layouts/admin-panel). bell: show the game's notifications bell (with v.unread).
 */
export default function nav(v: ViewContext, { bell = false }: { bell?: boolean } = {}): Html {
    const currentPath = v.path.replace(/\/+$/, '') || '/';
    const user = v.user;
    const inGame = currentPath === '/game' || currentPath.startsWith('/game/');
    const menu: [Record<string, string>, Record<string, Record<string, string>>] =
        inGame && user && (Auth.isPlayer(user) || Auth.isAdmin(user)) ? [App.PAGES, App.SUBPAGES] : [{}, {}];
    return html`
${user && Auth.isAdmin(user) ? html`
    <button class="btn btn-sm btn-warning me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#admin-panel"
            aria-controls="admin-panel" title="Admin controls">⚙ Admin</button>` : ''}
<a class="navbar-brand" href="/game/home">Frontier</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#main-nav"
        aria-controls="main-nav" aria-expanded="false" aria-label="Menu">
    <span class="navbar-toggler-icon"></span>
</button>
<div class="collapse navbar-collapse" id="main-nav">
    <ul class="navbar-nav me-auto">
        ${Object.entries(menu[0]).map(([href, label]) => {
            const section = menu[1][href] ?? { [href]: label };
            const here = Object.keys(section).some((h) => currentPath === h || currentPath.startsWith(h + '/'));
            if (menu[1][href]) {
                // An item with a submenu (the app's SUBPAGES).
                return html`
        <li class="nav-item dropdown">
            <a class="${cls('nav-link dropdown-toggle', { active: here })}" href="${href}" role="button"
               data-bs-toggle="dropdown" aria-expanded="false">${label}</a>
            <ul class="dropdown-menu">
                ${Object.entries(menu[1][href]).map(([subHref, subLabel]) => html`
                <li>
                    <a class="${cls('dropdown-item', { active: currentPath === subHref })}" href="${subHref}"
                       ${currentPath === subHref ? html`aria-current="page"` : ''}>${subLabel}</a>
                </li>`)}
            </ul>
        </li>`;
            }
            return html`
        <li class="nav-item">
            <a class="${cls('nav-link', { active: here })}" href="${href}" ${here ? html`aria-current="page"` : ''}>${label}</a>
        </li>`;
        })}
    </ul>
    <div class="d-flex flex-wrap align-items-center gap-2 py-2 py-lg-0">
        ${user ? html`
            ${bell ? html`
                <a class="btn btn-sm btn-outline-secondary position-relative" href="/game/notifications"
                   title="Notifications" aria-label="Notifications${v.unread ? ', ' + v.unread + ' unread' : ''}">
                    🔔
                    ${v.unread ? html`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill text-bg-danger">${v.unread > 99 ? '99+' : v.unread}</span>` : ''}
                </a>` : ''}
            <a class="btn btn-sm btn-light" href="/user" title="Your game file and settings">${user.username}</a>` : ''}
    </div>
</div>`;
}
