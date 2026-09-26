// Upstream: game/views/subnav.blade.php
import { cls, html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import { App } from '../App';

/**
 * A second navigation bar, under the site's header, for the pages of a menu section (section: its path in
 * App.SUBPAGES). It's pushed into the layout's 'subnav' slot, so it spans the page; on a wide screen it sticks
 * below the header (see layouts/footer), and on a phone it's hidden: the header's menu has the same pages.
 */
export default function subnav(v: ViewContext, { section }: { section: string }): Html {
    const current = v.path.replace(/\/+$/, '');
    // The page it's on: its own link, or on a page within one (an anthro's page, a barony, an auction), the link whose
    // address is the longest start of it (an anthro's page is under Overview, a barony under Lands).
    const hrefs = Object.keys(App.SUBPAGES[section]);
    const active = hrefs.includes(current) ? current
        : hrefs.filter((href) => current.startsWith(href + '/')).sort((a, b) => b.length - a.length)[0] ?? null;
    return v.push('subnav', html`
    <nav class="navbar navbar-expand bg-body-tertiary border-bottom shadow-sm py-0 mb-4 site-subnav d-none d-md-block" aria-label="${App.PAGES[section] ?? 'Section'} pages">
        <div class="container">
            <ul class="navbar-nav flex-wrap">
                ${Object.entries(App.SUBPAGES[section]).map(([href, label]) => html`
                    <li class="nav-item">
                        <a class="${cls('nav-link px-3 py-2', { active: active === href })}" href="${href}" ${active === href ? html`aria-current="page"` : ''}>${label}</a>
                    </li>`)}
            </ul>
        </div>
    </nav>`);
}
