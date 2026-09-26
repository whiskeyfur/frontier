// Upstream: views/layouts/app.blade.php (the site's layout, for its own pages: here, the welcome and settings pages)
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import nav from './nav';
import adminPanel from './admin-panel';
import footer from './footer';

export default function siteLayout(v: ViewContext, { title, content }: { title: string; content: Html }): Html {
    v.title = title;
    return html`
<nav class="navbar navbar-expand-lg border-bottom mb-4 sticky-top bg-body site-header">
    <div class="container">
        ${v.user ? nav(v, { bell: true }) : html`<span class="navbar-brand">Frontier</span>`}
    </div>
</nav>
${adminPanel(v)}
<main class="container">
    ${v.flash ? html`<div class="alert alert-info">${Array.isArray(v.flash) ? v.flash[0] : v.flash}</div>` : ''}
    ${content}
</main>
${footer()}`;
}
