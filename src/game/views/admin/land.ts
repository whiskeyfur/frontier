// Upstream: game/views/admin/land.blade.php
import { disabled, html, selected, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { float, int, json_encode, number_format, round } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';
import { Land } from '../../Land';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import where from '../market/where';
import whereSelect from './where-select';

/**
 * parcels: Land.all(baronyId); baronies: Baronies.all(); baronyId: the barony shown (null: the land office's lots);
 * post: the form sent ($_POST).
 */
export default function land(v: ViewContext, { parcels, baronies, baronyId, error, post }: {
    parcels: Row[]; baronies: Map<number, Row>; baronyId: number | null; error: string | null; post: InputArray;
}): Html {
    return gameLayout(v, {
        title: 'Land office - Game admin',
        content: html`
    <h1 class="h3 mb-1">Land office</h1>
    <p class="text-body-secondary">
        New land enters the game here: the land office puts lots up for sale on the
        <a href="/game/market/land">real estate market</a> at a fixed price, and the coins paid for them leave the game.
        A lot is a piece of land of any size, in acres.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <form method="post" action="/game/admin/land" class="card card-body mb-4" style="max-width: 36rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <h2 class="h6">Supply lots</h2>
        <div class="row g-2 mb-3">
            <div class="col-sm-4">
                <label class="form-label" for="count">How many</label>
                <input class="form-control" id="count" name="count" type="number" min="1" max="${Land.MAX_SUPPLY}"
                       value="${post.count ?? 5}" required>
            </div>
            <div class="col-sm-4">
                <label class="form-label" for="acres">Acres each</label>
                <input class="form-control" id="acres" name="acres" type="number" step="0.01" min="0.01" max="${Land.MAX_ACRES}"
                       value="${post.acres ?? 1}" required>
            </div>
            <div class="col-sm-4">
                <label class="form-label" for="price">Price each</label>
                <input class="form-control" id="price" name="price" type="number" min="1"
                       value="${post.price ?? Land.DEFAULT_PRICE_PER_ACRE}" required>
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="where">Where it lies</label>
            ${!baronies.size ? html`
                <p class="form-text m-0">Found a barony on the <a href="/game/admin/baronies">Baronies</a> page first: all land lies in one.</p>` : html`
                ${whereSelect(v, { baronies, id: 'where' })}`}
        </div>
        <button class="btn btn-warning" name="action" value="supply" ${disabled(!baronies.size)}>Put up for sale</button>
    </form>

    <h2 class="h5">Lots</h2>
    ${/* One barony at a time (or the land office's own lots): the realm has thousands. */ ''}
    <form method="get" action="/game/admin/land" class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <select class="form-select form-select-sm w-auto" name="barony" aria-label="Which lots">
            <option value="">The land office's lots, in every barony</option>
            ${[...baronies.values()].map((barony) => html`
                <option value="${barony.id}" ${selected(baronyId === barony.id)}>Barony of ${barony.name}</option>`)}
        </select>
        <button class="btn btn-sm btn-outline-secondary">Show</button>
    </form>
    ${!parcels.length ? html`
        <p>${baronyId ? 'No land lies in this barony yet.' : 'The land office holds no land.'}</p>` : html`
        <form method="post" action="/game/admin/land" id="merge-parcels" class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <button class="btn btn-sm btn-outline-primary" name="action" value="merge">Merge ticked lots</button>
            ${whereSelect(v, { baronies, class: 'form-select-sm w-auto' })}
            <button class="btn btn-sm btn-outline-secondary" name="action" value="move">Move ticked lots</button>
            <span class="form-text m-0">Merging needs the same owner, barony and part, and none for sale. A row's Split takes that many acres off into a new lot.</span>
        </form>
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr><th data-nosort></th><th>Lot</th><th>Where</th><th>Size</th><th>Held by</th><th>Played by</th><th>For sale</th><th data-nosort></th></tr>
                </thead>
                <tbody>
                ${parcels.map((parcel) => {
                    const acres = float(parcel.acres);
                    return html`
                    <tr>
                        <td><input class="form-check-input" type="checkbox" name="ids[]" value="${parcel.id}" form="merge-parcels"
                                   aria-label="Merge lot #${parcel.id}"></td>
                        <td data-sort="${parcel.id}">#${parcel.id}</td>
                        <td>${where(v, { row: parcel })}</td>
                        <td data-sort="${number_format(acres, 2, '.', '')}">${Land.acres(parcel.acres)}</td>
                        <td>
                            ${parcel.anthro_id ? html`
                                <a href="/game/assets/${parcel.anthro_id}">${parcel.holder_name}</a>` : html`
                                Land office`}
                        </td>
                        <td>${parcel.player_name ?? '—'}</td>
                        <td data-sort="${parcel.price ?? -1}">
                            ${parcel.listing_id ? Wallets.format(int(parcel.price)) : '—'}
                        </td>
                        <td>
                            <form method="post" action="/game/admin/land" class="d-flex flex-wrap gap-2 m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="parcel_id" value="${parcel.id}">
                                ${parcel.listing_id ? html`
                                    <input type="hidden" name="listing_id" value="${parcel.listing_id}">
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="cancel">Take off market</button>` : !parcel.anthro_id ? html`
                                    <input class="form-control form-control-sm" style="width: 9rem" name="price" type="number" min="1"
                                           value="${int(round(acres * Land.DEFAULT_PRICE_PER_ACRE))}" aria-label="Price in coins">
                                    <button class="btn btn-sm btn-outline-warning" name="action" value="relist">Sell</button>` : ''}
                                ${!parcel.listing_id && acres > Land.MIN_ACRES ? html`
                                    <input class="form-control form-control-sm" style="width: 6rem" name="acres" type="number" step="0.01" min="0.01"
                                           max="${acres - Land.MIN_ACRES}" value="${Math.min(Baronies.VILLAGER_ACRES, acres / 2)}" aria-label="Acres to split off">
                                    <button class="btn btn-sm btn-outline-secondary" name="action" value="split">Split</button>` : ''}
                                ${parcel.anthro_id ? html`
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="seize"
                                            onclick="return confirm(${json_encode('Forfeit lot #' + parcel.id + ' to the crown? It goes to ' + parcel.holder_name + "'s liege, or the next rank up.")})">
                                        Forfeit to crown
                                    </button>` : ''}
                            </form>
                        </td>
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>`}`,
    });
}
