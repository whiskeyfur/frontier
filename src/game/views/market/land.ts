// Upstream: game/views/market/land.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { array_sum, float, int, json_encode, round } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Land } from '../../Land';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import subnav from '../subnav';
import where from './where';

/** An acres column (DECIMAL(10,2)) as upstream printed it: "2.00". */
function decimal(acres: unknown): string {
    return acres === null || acres === undefined ? '' : float(acres).toFixed(2);
}

export default function land(v: ViewContext, { listings, recent, player, canTrade, parcels, balance, error }: {
    listings: Row[]; recent: Row[]; player: Row | null; canTrade: boolean; parcels: Row[]; balance: number | null; error: string | null;
}): Html {
    return gameLayout(v, {
        title: 'Real estate - Game',
        content: html`
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 class="h3 mb-0">Market</h1>
        <a class="btn btn-outline-secondary btn-sm" href="/game/wallet">Wallet: ${balance === null ? 'none yet' : Wallets.format(balance)}</a>
    </div>
    ${subnav(v, { section: '/game/market' })}
    <p class="text-body-secondary">
        Land for a home and business, sold by the lot at a fixed price. A lot is a piece of land of any size, in acres.
        Only an anthro that owns itself can buy and sell land. Every lot lies in a
        <a href="/game/court/lands">barony</a>, and maybe in one of its towns, villages or expanses.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${!player ? html`
        <div class="alert alert-secondary"><a href="/game/home">Create or become an anthro</a> first: land is bought with its wallet.</div>`
    : !canTrade ? html`
        <div class="alert alert-secondary">
            ${player.name} doesn't own itself, so it can't buy or sell land.
            ${player.debt !== null ? html`
                <a href="/game/home">Buy your freedom</a> first.` : ''}
        </div>` : ''}

    <h2 class="h5">For sale</h2>
    ${!listings.length ? html`
        <p>No land is for sale right now.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr>
                    <th>Lot</th><th>Where</th><th>Size</th><th>Seller</th><th class="text-end">Price</th>
                    <th class="text-end">Per acre</th><th>Listed</th><th data-nosort></th>
                </tr>
                </thead>
                <tbody>
                ${listings.map((listing) => {
                    const mine = !!player && listing.seller_anthro_id === player.id;
                    return html`
                    <tr>
                        <td data-sort="${listing.parcel_id}">#${listing.parcel_id}</td>
                        <td>${where(v, { row: listing })}</td>
                        <td data-sort="${decimal(listing.acres)}">${Land.acres(listing.acres)}</td>
                        <td>
                            ${listing.from_game ? 'Land office' : (listing.seller_name ?? '—')}
                            ${mine ? html`
                                <span class="badge text-bg-secondary">you</span>` : ''}
                        </td>
                        <td class="text-end" data-sort="${listing.price}">${Wallets.format(int(listing.price))}</td>
                        <td class="text-end" data-sort="${listing.price / listing.acres}">
                            ${Wallets.format(int(round(listing.price / listing.acres)))}
                        </td>
                        <td class="text-nowrap" data-sort="${listing.created_at}">${String(listing.created_at).substring(0, 10)}</td>
                        <td class="text-end">
                            <form method="post" action="/game/market/land" class="m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="listing_id" value="${listing.id}">
                                ${mine ? html`
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="cancel">Take off market</button>`
                                : canTrade ? html`
                                    <button class="btn btn-sm btn-success" name="action" value="buy" ${disabled((balance ?? 0) < int(listing.price))}
                                            onclick="return confirm(${json_encode('Buy lot #' + listing.parcel_id + ' (' + Land.acres(listing.acres) + ') for ' + Wallets.format(int(listing.price)) + '?')})">
                                        Buy
                                    </button>` : ''}
                            </form>
                        </td>
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>`}

    ${player ? html`
        <h2 class="h5 mt-4">
            ${player.name}'s land
            ${parcels.length ? html`
                <span class="text-body-secondary fs-6">
                    ${Land.acres(array_sum(parcels.map((p) => p.acres)))} in total
                </span>` : ''}
        </h2>
        ${!parcels.length ? html`
            <p class="text-body-secondary">${player.name} doesn't own any land yet.</p>` : html`
            <div class="table-responsive">
                <table data-sortable class="table table-striped align-middle">
                    <thead><tr><th>Lot</th><th>Where</th><th>Size</th><th data-nosort>Sell</th></tr></thead>
                    <tbody>
                    ${parcels.map((parcel) => html`
                        <tr>
                            <td data-sort="${parcel.id}">#${parcel.id}</td>
                            <td>${where(v, { row: parcel })}</td>
                            <td data-sort="${decimal(parcel.acres)}">${Land.acres(parcel.acres)}</td>
                            <td>
                                ${parcel.listing_id ? html`
                                    For sale at ${Wallets.format(int(parcel.price))}`
                                : canTrade ? html`
                                    <form method="post" action="/game/market/land" class="d-flex flex-wrap align-items-center gap-2 m-0">
                                        <input type="hidden" name="csrf" value="${v.csrf}">
                                        <input type="hidden" name="parcel_id" value="${parcel.id}">
                                        <input class="form-control form-control-sm" style="width: 7rem" name="acres" type="number" step="0.01"
                                               min="0.01" max="${decimal(parcel.acres)}" value="${decimal(parcel.acres)}" required aria-label="Acres to sell">
                                        <span class="small">acres for</span>
                                        <input class="form-control form-control-sm" style="width: 9rem" name="price" type="number" min="1"
                                               placeholder="Price" required aria-label="Price in coins">
                                        <button class="btn btn-sm btn-primary" name="action" value="sell">List for sale</button>
                                    </form>` : html`
                                    <span class="text-body-secondary small">Only an anthro that owns itself can sell land.</span>`}
                            </td>
                        </tr>`)}
                    </tbody>
                </table>
            </div>
            ${canTrade ? html`
                <p class="form-text">Selling less than the whole lot splits that much off into a new lot.</p>` : ''}`}` : ''}

    ${recent.length ? html`
        <h2 class="h5 mt-4">Recent sales</h2>
        <div class="table-responsive">
            <table data-sortable class="table table-sm align-middle">
                <thead><tr><th>Lot</th><th>Where</th><th>Size</th><th class="text-end">Price</th><th>Sold</th></tr></thead>
                <tbody>
                ${recent.map((sale) => html`
                    <tr>
                        <td data-sort="${sale.parcel_id}">#${sale.parcel_id}</td>
                        <td>${where(v, { row: sale })}</td>
                        <td data-sort="${decimal(sale.acres)}">${Land.acres(sale.acres)}</td>
                        <td class="text-end" data-sort="${sale.price}">${Wallets.format(int(sale.price))}</td>
                        <td class="text-nowrap" data-sort="${sale.closed_at}">${String(sale.closed_at).substring(0, 10)}</td>
                    </tr>`)}
                </tbody>
            </table>
        </div>` : ''}`,
    });
}
