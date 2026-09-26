// Upstream: game/views/list-search.blade.php
import { html, type Html } from '../../core/html';
import { number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';

/** A name search for a long list shown a page at a time (shown of total, searching q; see App.LIST_LIMIT). */
export default function listSearch(_v: ViewContext, { action, q, shown, total }: { action: string; q: string; shown: number; total: number }): Html {
    return html`<form method="get" action="${action}" class="d-flex flex-wrap align-items-center gap-2 mb-2">
    <input class="form-control form-control-sm w-auto" type="search" name="q" value="${q}" placeholder="Name starts with"
           aria-label="Search by name">
    <button class="btn btn-sm btn-outline-secondary">Search</button>
    ${q !== '' ? html`
        <a class="btn btn-sm btn-link" href="${action}">Show all</a>` : ''}
    <span class="small text-body-secondary">
        ${total > shown
            ? html`Showing the first ${number_format(shown)} of ${number_format(total)}${q !== '' ? ' matching' : ''}: search by name to find others.`
            : html`${number_format(total)} ${q !== '' ? 'matching' : 'in all'}.`}
    </span>
</form>`;
}
