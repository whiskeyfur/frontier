// Upstream: game/views/market/auction.blade.php
import { Auth } from '../../../core/Auth';
import { html, type Html } from '../../../core/html';
import { int, json_encode, spaceship } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Wallets } from '../../Wallets';
import anthroLink from '../assets/anthro-link';
import gender from '../assets/gender';
import gameLayout from '../layouts/game';
import seller from './seller';
import status from './status';

export default function auctionPage(v: ViewContext, { auction, bids, minimum, balance, error }: {
    auction: Row; bids: Row[]; minimum: number; balance: number | null; error: string | null;
}): Html {
    const user = v.user!;
    const anthro: Row | null = auction.anthro;
    const isSeller = auction.seller_id === user.id;
    const isOpen = auction.status === 'open';
    // collect($bids)->unique('bidder_number')->sortBy('bidder_number'): each bidder's first (highest) bid, by number.
    const seen = new Set<unknown>();
    const bidders = bids.filter((bid) => !seen.has(bid.bidder_number) && !!seen.add(bid.bidder_number))
        .sort((a, b) => spaceship(a.bidder_number, b.bidder_number));
    return gameLayout(v, {
        title: auction.anthro_name + ' - Market',
        content: html`
    <p><a href="/game/market">&larr; Market</a></p>
    <h1 class="h3 mb-3">
        ${auction.anthro_name}
        ${anthro ? html`
            ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}` : ''}
        <span class="fs-6 text-body-secondary">up for auction</span>
        ${anthro && anthro.player_id !== user.id ? html`
            <a class="btn btn-sm btn-outline-secondary align-middle ms-2" href="/game/notifications?to=${anthro.id}#compose">Message</a>` : ''}
    </h1>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <div class="row g-4">
        <div class="col-md-6">
            ${anthro ? html`
                <dl class="row mb-0">
                    <dt class="col-5">Gender</dt><dd class="col-7">${anthro.gender}</dd>
                    <dt class="col-5">Species</dt><dd class="col-7">${anthro.species ?? 'not set'}</dd>
                    <dt class="col-5">Born</dt><dd class="col-7">${anthro.birthdate ?? 'unknown'}</dd>
                    <dt class="col-5">Age</dt><dd class="col-7">${Anthros.age(anthro.birthdate)}</dd>
                    <dt class="col-5">Fertile</dt>
                    <dd class="col-7">${Anthros.fertility(anthro)}</dd>
                    ${anthro.pregnant_due_on !== null ? html`
                        <dt class="col-5">Pregnant</dt>
                        <dd class="col-7">litter of ${anthro.pregnant_cubs} due ${anthro.pregnant_due_on}</dd>` : ''}
                    <dt class="col-5">Sire</dt>
                    <dd class="col-7">${anthroLink(v, { id: anthro.sire_id, name: anthro.sire_name, ownerPlayerId: anthro.sire_owner_player_id, ownerName: anthro.sire_owner_name, playerId: anthro.sire_player_id })}</dd>
                    <dt class="col-5">Dam</dt>
                    <dd class="col-7">${anthroLink(v, { id: anthro.dam_id, name: anthro.dam_name, ownerPlayerId: anthro.dam_owner_player_id, ownerName: anthro.dam_owner_name, playerId: anthro.dam_player_id })}</dd>
                    <dt class="col-5">Seller</dt><dd class="col-7">${seller(v, { auction })}</dd>
                </dl>` : html`
                <p class="text-body-secondary">This anthro no longer exists.</p>`}
        </div>
        <div class="col-md-6">
            <div class="card card-body">
                <p class="mb-2">${status(v, { auction })}</p>
                ${isOpen ? html`
                    <p class="small text-body-secondary mb-3">
                        Started at ${Wallets.format(int(auction.starting_bid))}.
                        Ends ${auction.ends_at} UTC.
                        ${balance === null ? html`
                            To bid, first <a href="/game/home">create or become an anthro</a>; you bid with its wallet.` : html`
                            You have ${Wallets.format(balance)}.`}
                    </p>
                    ${!isSeller ? html`
                        ${auction.current_bidder_id !== user.id ? html`
                            <form method="post" action="/game/market/auctions/${auction.id}" class="d-flex gap-2 mb-2">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="action" value="bid">
                                <label class="visually-hidden" for="amount">Your bid</label>
                                <input class="form-control" id="amount" name="amount" type="number" min="${minimum}" step="1"
                                       value="${minimum}" required>
                                <button class="btn btn-primary text-nowrap">Bid</button>
                            </form>
                            <div class="form-text mb-3">At least ${Wallets.format(minimum)}.</div>` : ''}
                        ${auction.buy_now !== null && (auction.current_bid === null || auction.current_bid < auction.buy_now) ? html`
                            <form method="post" action="/game/market/auctions/${auction.id}">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="action" value="buy_now">
                                <button class="btn btn-success"
                                        onclick="return confirm(${json_encode('Buy ' + auction.anthro_name + ' now for ' + Wallets.format(int(auction.buy_now)) + '?')})">
                                    Buy now for ${Wallets.format(int(auction.buy_now))}
                                </button>
                            </form>` : ''}` : html`
                        <form method="post" action="/game/market/auctions/${auction.id}" class="d-flex flex-wrap gap-2">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            ${auction.current_bid === null ? html`
                                <button class="btn btn-outline-danger" name="action" value="cancel">Cancel auction</button>` : ''}
                            <button class="btn btn-outline-warning" name="action" value="close"
                                    onclick="return confirm(${json_encode(auction.current_bid === null
                                        ? 'Close the auction now? Nobody has bid, so ' + auction.anthro_name + ' stays yours.'
                                        : 'Close the auction now and sell ' + auction.anthro_name + ' for ' + Wallets.format(int(auction.current_bid)) + '?')})">
                                Close now
                            </button>
                        </form>
                        ${auction.current_bid !== null ? html`
                            <p class="small mt-2 mb-0">Auctions can't be cancelled once someone has bid, but you can close early and sell.</p>` : ''}`}` : ''}
            </div>
        </div>
    </div>

    <h2 class="h5 mt-4">Bids</h2>
    ${!bids.length ? html`
        <p class="text-body-secondary">No bids yet.</p>` : html`
        <ul class="list-group">
            ${bids.map((bid) => html`
                <li class="list-group-item d-flex justify-content-between">
                    <span>
                        ${bid.bidder_id !== null && bid.bidder_id === user.id ? html`
                            you` : html`
                            Bidder ${bid.bidder_number}`}
                    </span>
                    <span>
                        ${Wallets.format(int(bid.amount))}
                        <span class="text-body-secondary small ms-2">${String(bid.created_at).substring(0, 16)}</span>
                    </span>
                </li>`)}
        </ul>`}
    ${/* Who the bidders are is for admins only, in the admin panel. */ ''}
    ${Auth.isAdmin(user) && bids.length ? v.push('admin', html`
            <p class="small text-body-secondary mb-1">Bidders on ${auction.anthro_name}</p>
            <ul class="small ps-3 mb-3">
                ${bidders.map((bid) => html`
                    <li>Bidder ${bid.bidder_number}: ${bid.bidder_name ?? 'a deleted user'}</li>`)}
            </ul>`) : ''}
    ${/* Admin controls, in the admin panel: end any open auction (sellers have these above). */ ''}
    ${Auth.isAdmin(user) && auction.status === 'open' && !isSeller ? v.push('admin', html`
            <p class="small text-body-secondary mb-2">Auction for ${auction.anthro_name}</p>
            <form method="post" action="/game/market/auctions/${auction.id}" class="d-flex flex-wrap gap-2 mb-3">
                <input type="hidden" name="csrf" value="${v.csrf}">
                ${auction.current_bid === null ? html`
                    <button class="btn btn-sm btn-outline-danger" name="action" value="cancel">Cancel auction</button>` : ''}
                <button class="btn btn-sm btn-outline-warning" name="action" value="close"
                        onclick="return confirm(${json_encode('Close the auction now' + (auction.current_bid === null ? '? Nobody has bid.' : ' and sell to the highest bidder?'))})">
                    Close now
                </button>
            </form>`) : ''}`,
    });
}
