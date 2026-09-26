// Upstream: game/views/assets/pregnant-badge.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';

export default function pregnantBadge(_v: ViewContext, { anthro }: { anthro: Row | null }): Html {
    if (anthro && anthro.pregnant_due_on !== null && anthro.pregnant_due_on !== undefined) {
        return html`<span class="badge text-bg-info" title="Bred ${anthro.pregnant_bred_on}">pregnant: ${anthro.pregnant_cubs} due ${anthro.pregnant_due_on}</span>`;
    }
    return html``;
}
