// Upstream: game/views/market/seller.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';

export default function seller(v: ViewContext, { auction }: { auction: Row }): Html {
    if (auction.seller_id === null) {
        return html`<span class="text-body-secondary">the game</span>`;
    }
    if (auction.seller_id === v.user!.id) {
        return html`you`;
    }
    return html`${auction.seller_name ?? 'an anthro no longer in the game'}`;
}
