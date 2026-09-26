// Upstream: game/views/market/time-left.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { Auctions } from '../../Auctions';

export default function timeLeft(_v: ViewContext, { endsAt }: { endsAt: string }): Html {
    return html`<span title="${endsAt} UTC">${Auctions.timeLeft(endsAt)}</span>`;
}
