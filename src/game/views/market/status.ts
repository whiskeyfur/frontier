// Upstream: game/views/market/status.blade.php
import { html, type Html } from '../../../core/html';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Wallets } from '../../Wallets';
import timeLeft from './time-left';

// An auction's state from the viewer's point of view.
export default function status(v: ViewContext, { auction }: { auction: Row }): Html {
    const user = v.user!;
    if (auction.status === 'open') {
        return html`${auction.current_bid === null ? html`
    no bids yet` : html`
    ${Wallets.format(int(auction.current_bid))}
    ${auction.current_bidder_id === user.id ? html`
        <span class="badge text-bg-success">you're winning</span>` : auction.seller_id !== user.id ? html`
        <span class="badge text-bg-warning">outbid</span>` : ''}`}
    &middot; ends in ${timeLeft(v, { endsAt: auction.ends_at })}`;
    }
    if (auction.status === 'sold') {
        return html`
    sold for ${Wallets.format(int(auction.final_price))}
    ${auction.winner_id === user.id ? html`
        <span class="badge text-bg-success">you won</span>` : ''}`;
    }
    if (auction.status === 'unsold') {
        return html`
    ended with no bids`;
    }
    return html`
    cancelled`;
}
