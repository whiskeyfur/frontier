import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import siteLayout from '../layouts/site';

/** The first visit: the name you play under (upstream's registration, without the password). */
export default function welcome(v: ViewContext, { error, username }: { error: string | null; username: string }): Html {
    return siteLayout(v, {
        title: 'Welcome to Frontier',
        content: html`
    <div class="mx-auto" style="max-width: 36rem">
        <h1 class="h3 mb-3">Welcome to Frontier</h1>
        <p>An anthro-breeding and feudal-life game. It runs entirely in this browser: the game is kept here, on this
            device, and nothing is sent anywhere. You can export it to a file from your settings, to keep it safe or move
            it to another browser.</p>
        <p class="text-body-secondary">You play the game and run it too: the ⚙ Admin button opens the game master's
            tools (supplying anthros, setting prices, moving time ahead...).</p>
        ${error ? html`<div class="alert alert-danger">${error}</div>` : ''}
        <form method="post" action="/welcome" class="card card-body">
            <label class="form-label" for="username">Your name, as the game's player and admin</label>
            <input class="form-control mb-3" id="username" name="username" value="${username}" maxlength="32" required autofocus>
            <div><button class="btn btn-primary">Start</button></div>
        </form>
    </div>`,
    });
}
