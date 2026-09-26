import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import siteLayout from '../layouts/site';

/**
 * Your settings: your name, and the game file. The file buttons (data-frontier) are handled by the page itself
 * (src/shell/main.ts), as they read and write files on this device.
 */
export default function settings(v: ViewContext, { error, username }: { error: string | null; username: string }): Html {
    return siteLayout(v, {
        title: 'Settings - Frontier',
        content: html`
    <div class="mx-auto" style="max-width: 40rem">
        <h1 class="h3 mb-3">Settings</h1>
        ${error ? html`<div class="alert alert-danger">${error}</div>` : ''}
        <form method="post" action="/user" class="card card-body mb-4">
            <h2 class="h5">Your name</h2>
            <p class="text-body-secondary small">The name you play and run the game under (it's never shown to other anthros).</p>
            <div class="input-group">
                <input class="form-control" name="username" value="${username}" maxlength="32" required aria-label="Your name">
                <button class="btn btn-primary">Save</button>
            </div>
        </form>
        <div class="card card-body">
            <h2 class="h5">The game file</h2>
            <p class="text-body-secondary small">The game is kept in this browser, on this device, and saved as you play.
                Clearing the browser's site data deletes it. Export it to keep a copy, or to move it to another browser;
                import a copy to carry on from it. (Admins can also keep saved games inside the game: ⚙ Admin, Saved games.)</p>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-primary" type="button" data-frontier="export">Export the game…</button>
                <button class="btn btn-outline-secondary" type="button" data-frontier="import">Import a game…</button>
                <button class="btn btn-outline-danger ms-auto" type="button" data-frontier="wipe">Start over…</button>
            </div>
        </div>
    </div>`,
    });
}
