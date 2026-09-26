// Upstream: game/views/market/where.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';

/**
 * Where a lot lies: its barony (to its page) and, if any, the village, town, city or expanse in it; or the wilds
 * (land cleared outside any barony).
 */
export default function where(_v: ViewContext, { row }: { row: Row }): Html {
    if (row.barony_id ?? null) {
        return html`<a href="/game/court/lands/${row.barony_id}">${row.barony_name}</a>${row.part_name ? html`<span class="text-body-secondary"> &middot; ${row.part_name}</span>` : ''}`;
    }
    return html`<span class="text-body-secondary">The wilds</span>`;
}
