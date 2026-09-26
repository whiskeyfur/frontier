// Upstream: game/views/changes.blade.php
import { html, raw, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import clock from './clock';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function changes(v: ViewContext, { html: body }: { html: string }): Html {
    return gameLayout(v, {
        title: 'Changes - Game',
        content: html`
    ${subnav(v, { section: '/game/docs' })}
    <div class="mx-auto" style="max-width: 48rem">
        <h1 class="h3 mb-3">What's changed in Frontier</h1>
        ${clock(v)}
        <div class="changes">${raw(body)}</div>
    </div>`,
    });
}
