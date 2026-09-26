// Upstream: views/layouts/admin-panel.blade.php
//
// The site's own admin pages (users, roles, cache) don't exist here: its "Admin pages" list has the settings page.
import { Auth } from '../../../core/Auth';
import { html, raw, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { App } from '../../../game/App';
import { Played } from '../../../game/Played';

/**
 * Admins' panel (opened by the Admin button at the top right): the admin controls for the page you're on (pages add
 * them with v.push('admin', ...)), then every admin page. Players never see it.
 */
export default function adminPanel(v: ViewContext): Html {
    if (!v.user || !Auth.isAdmin(v.user)) return html``;
    const pageControls = v.stack('admin').value.trim();
    const played = Played.onPage();
    return html`
    <div class="offcanvas offcanvas-start" tabindex="-1" id="admin-panel" aria-labelledby="admin-panel-title">
        <div class="offcanvas-header border-bottom">
            <h2 class="offcanvas-title h5" id="admin-panel-title">Admin</h2>
            <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body">
            ${pageControls !== '' ? html`
                <h3 class="h6 text-uppercase text-body-secondary small">This page</h3>
                <div class="mb-4">${raw(pageControls)}</div>` : ''}
            ${played.length ? html`
                <h3 class="h6 text-uppercase text-body-secondary small">Played anthros on this page</h3>
                <ul class="small ps-3 mb-4">
                    ${played.map((anthro) => html`
                        <li><a href="/game/assets/${anthro.id}">${anthro.name}</a>: ${anthro.player ?? 'a deleted user'}</li>`)}
                </ul>` : ''}
            <h3 class="h6 text-uppercase text-body-secondary small">Admin pages</h3>
            <div class="list-group list-group-flush small mb-3">
                <a class="list-group-item list-group-item-action" href="/user">Settings and the game file</a>
            </div>
            <h3 class="h6 text-uppercase text-body-secondary small">Game</h3>
            <div class="list-group list-group-flush small">
                ${Object.entries(App.ADMIN_PAGES).map(([href, [label, about]]) => html`
                    <a class="list-group-item list-group-item-action" href="${href}" title="${about}">${label}</a>`)}
            </div>
        </div>
    </div>
    ${pageControls.includes('data-admin-open') ? html`
        <script>
            document.addEventListener('DOMContentLoaded', () => bootstrap.Offcanvas.getOrCreateInstance('#admin-panel').show());
        </script>` : ''}`;
}
