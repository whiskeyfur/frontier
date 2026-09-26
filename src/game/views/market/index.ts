// Upstream: game/views/market/index.blade.php
import { html, type Html } from '../../../core/html';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Wallets } from '../../Wallets';
import gender from '../assets/gender';
import pregnantBadge from '../assets/pregnant-badge';
import gameLayout from '../layouts/game';
import subnav from '../subnav';
import seller from './seller';
import status from './status';
import timeLeft from './time-left';

export default function index(v: ViewContext, { auctions, mine, balance }: { auctions: Row[]; mine: Row[]; balance: number | null }): Html {
    const user = v.user!;
    return gameLayout(v, {
        title: 'Market - Game',
        content: html`
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 class="h3 mb-0">Market</h1>
        <a class="btn btn-outline-secondary btn-sm" href="/game/wallet">Wallet: ${balance === null ? 'none yet' : Wallets.format(balance)}</a>
    </div>
    ${subnav(v, { section: '/game/market' })}
    <p class="text-body-secondary">
        Anthros up for auction. To sell one of yours, open it from <a href="/game/assets">Assets</a>.
        A bid takes the coins from your wallet at once; you get them back if someone outbids you.
    </p>
    ${!auctions.length ? html`
        <p>Nothing is up for auction right now.</p>` : html`
        <form method="post" action="/game/market/group" data-select-group>
        <input type="hidden" name="csrf" value="${v.csrf}">
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr>
                    <th data-nosort><input class="form-check-input" type="checkbox" data-select-all title="Select all" aria-label="Select all auctions"></th>
                    <th>Anthro</th><th>Species</th><th>Age</th><th>Seller</th>
                    <th class="text-end">Current bid</th><th class="text-end">Buy now</th><th>Ends in</th>
                </tr>
                </thead>
                <tbody>
                ${auctions.map((auction) => {
                    const anthro: Row | null = auction.anthro;
                    return html`
                    <tr>
                        <td>
                            ${auction.seller_id !== user.id ? html`
                                <input class="form-check-input" type="checkbox" name="ids[]" value="${auction.id}"
                                       aria-label="Select ${auction.anthro_name}">` : ''}
                        </td>
                        <td>
                            <a href="/game/market/auctions/${auction.id}">${auction.anthro_name}</a>
                            ${anthro ? html`
                                ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}` : ''}
                            ${pregnantBadge(v, { anthro })}
                        </td>
                        <td>${anthro?.species ?? '—'}</td>
                        <td class="text-nowrap" title="Born ${anthro?.birthdate ?? 'unknown'}">${Anthros.age(anthro?.birthdate ?? null)}</td>
                        <td>${seller(v, { auction })}</td>
                        <td class="text-end" data-sort="${auction.current_bid ?? auction.starting_bid}">
                            ${auction.current_bid !== null ? html`
                                ${Wallets.format(int(auction.current_bid))}
                                <span class="text-body-secondary small">(${auction.bid_count})</span>
                                ${auction.current_bidder_id === user.id ? html`
                                    <span class="badge text-bg-success">yours</span>` : ''}` : html`
                                <span class="text-body-secondary">from ${Wallets.format(int(auction.starting_bid))}</span>`}
                        </td>
                        <td class="text-end">${auction.buy_now !== null ? Wallets.format(int(auction.buy_now)) : '—'}</td>
                        <td data-sort="${auction.ends_at}">${timeLeft(v, { endsAt: auction.ends_at })}</td>
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>
        <div class="card card-body">
            <h2 class="h6">With selected <span class="text-body-secondary small" data-selected-count></span></h2>
            <div class="d-flex flex-wrap align-items-center gap-2">
                <input class="form-control w-auto" style="max-width: 11rem" name="amount" type="number" min="1"
                       placeholder="Minimum bid" aria-label="Bid amount (empty: each auction's minimum)">
                <button class="btn btn-primary" name="action" value="bid">Bid</button>
                <button class="btn btn-success" name="action" value="buy_now"
                        onclick="return confirm('Buy the selected anthros now at their buy-now prices? Ones without a buy-now price are skipped.')">
                    Buy now
                </button>
            </div>
            <div class="form-text">
                Leave the amount empty to bid each auction's minimum; with an amount, it's bid on each and too-low bids
                are skipped.
                ${balance === null ? html`
                    You need to <a href="/game/home">create or become an anthro</a> first: you bid with its wallet.` : html`
                    You have ${Wallets.format(balance)}.`}
            </div>
        </div>
        </form>`}

    ${mine.length ? html`
        <h2 class="h5 mt-4">Your auctions and bids</h2>
        <ul class="list-group">
            ${mine.map((auction) => html`
                <li class="list-group-item d-flex flex-wrap justify-content-between gap-2">
                    <span>
                        <a href="/game/market/auctions/${auction.id}">${auction.anthro_name}</a>
                        <span class="text-body-secondary small">${auction.seller_id === user.id ? 'selling' : 'bidding'}</span>
                    </span>
                    <span>${status(v, { auction })}</span>
                </li>`)}
        </ul>` : ''}`,
    });
}
