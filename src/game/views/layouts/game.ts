// Upstream: game/views/layouts/game.blade.php
//
// The page's <head> (Bootstrap's styles) and the site's scripts (bootstrap.bundle, tables.js, select-groups.js,
// tooltips) are the shell's (src/shell/main.ts), which runs them again for each page; so are the layout's scripts for
// "Random" name buttons and anthro name suggestions (src/shell/layout-scripts.ts).
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import nav from '../../../site/views/layouts/nav';
import adminPanel from '../../../site/views/layouts/admin-panel';
import footer from '../../../site/views/layouts/footer';

/**
 * The game's layout (Blade's @extends('game::layouts.game')). title is @section('title'), content @section('content').
 * Render the content first (it's an argument, so it is), so what it pushes to the stacks is there for the layout.
 */
export default function gameLayout(v: ViewContext, { title = 'Game', content }: { title?: string; content: Html }): Html {
    v.title = title;
    const flash = v.flash;
    return html`
${v.stack('styles')}
<nav class="navbar navbar-expand-lg border-bottom mb-4 sticky-top bg-body site-header">
    <div class="container">
        ${nav(v, { bell: true })}
    </div>
</nav>
${v.stack('subnav')}
${adminPanel(v)}
<main class="container">
    ${flash !== null && flash !== '' && !(Array.isArray(flash) && flash.length === 0) ? html`
        <div class="alert alert-info">
            ${Array.isArray(flash) ? html`
                ${flash[0]}
                ${flash.length > 1 ? html`
                    <ul class="mb-0 mt-1">
                        ${flash.slice(1).map((line) => html`<li>${line}</li>`)}
                    </ul>` : ''}` : flash}
        </div>` : ''}
    ${content}
</main>
${footer()}
${v.stack('scripts')}`;
}
