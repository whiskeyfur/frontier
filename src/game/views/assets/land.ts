// Upstream: game/views/assets/land.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { array_sum, float, int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';
import { Wallets } from '../../Wallets';
import baronyLine from '../court/barony-line';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

/** A float as PHP's echo prints it (precision 14). */
function phpFloat(x: number): number {
    return parseFloat(x.toPrecision(14));
}

export default function land(v: ViewContext, { player, parcels, canTrade, error, holdings, buildings }: {
    player: Row | null; parcels: Row[]; canTrade: boolean; error: string | null;
    holdings: { held: Row[]; through: Row[]; managed: Row[] };
    /** Map of lot id => its buildings (see Buildings.onLots). */
    buildings: Map<number, Row[]>;
}): Html {
    // collect($parcels)->groupBy(fn ($p) => $p['barony_id'] ?? 0): by barony, in the order they first appear.
    const byBarony = new Map<number, Row[]>();
    for (const parcel of parcels) {
        const key = parcel.barony_id ?? 0;
        if (!byBarony.has(key)) byBarony.set(key, []);
        byBarony.get(key)!.push(parcel);
    }
    return gameLayout(v, {
        title: 'Land - Game',
        content: html`
    <h1 class="h3 mb-3">Land</h1>
    ${subnav(v, { section: '/game/assets' })}
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${!player ? html`
        <p><a href="/game/home">Create or become an anthro</a> first: land belongs to the anthro you play.</p>` : html`
        ${holdings.held.length || holdings.through.length || holdings.managed.length ? html`
            <h2 class="h5">${player.name}'s holdings</h2>
            <p class="text-body-secondary small">
                The baronies and their parts ${player.name} holds or manages (see <a href="/game/court/lands">Lands</a>).
                The land in them can belong to anyone.
            </p>
            <ul class="list-unstyled mb-4">
                ${holdings.held.map((barony) => html`
                    <li class="mb-1">${baronyLine(v, { barony })} <span class="small text-body-secondary">&middot; held directly</span></li>`)}
                ${holdings.through.map((barony) => html`
                    <li class="mb-1">
                        ${baronyLine(v, { barony })}
                        <span class="small text-body-secondary">&middot; held through ${Ranks.title(barony.via)}
                            <a href="/game/assets/${barony.via.id}">${barony.via.name}</a></span>
                    </li>`)}
                ${holdings.managed.map((part) => html`
                    <li class="mb-1">
                        <span class="badge text-bg-light border">${Baronies.KINDS[part.kind]}</span> ${part.name},
                        in the barony of <a href="/game/court/lands/${part.barony_id}">${part.barony_name}</a>
                        <span class="small text-body-secondary">&middot; managed</span>
                    </li>`)}
            </ul>` : ''}

        <h2 class="h5">Lots ${player.name} owns</h2>
        ${!parcels.length ? html`
            <p>${player.name} doesn't own any land yet. Buy some on the <a href="/game/market/land">real estate market</a>.</p>` : html`
            <p class="text-body-secondary">
                ${Land.acres(array_sum(parcels.map((p) => float(p.acres))))} in
                ${parcels.length} ${parcels.length === 1 ? 'lot' : 'lots'}, by barony.
                Sell it on the <a href="/game/market/land">real estate market</a>.
                ${canTrade ? html`
                    Split acres off a lot into a new one, or tick lots in the same place and merge them into one
                    (land for sale can't be split or merged).` : ''}
            </p>
            ${[...byBarony.values()].map((baronyParcels) => {
                const first = baronyParcels[0];
                return html`
                <h3 class="h6 mt-3">
                    ${first.barony_id ? html`
                        Barony of <a href="/game/court/lands/${first.barony_id}">${first.barony_name}</a>` : html`
                        The wilds`}
                    <span class="text-body-secondary small">&middot; ${Land.acres(array_sum(baronyParcels.map((p) => float(p.acres))))}</span>
                </h3>
                ${baronyParcels.map((parcel) => canTrade && !parcel.listing_id && float(parcel.acres) > Land.MIN_ACRES ? html`
                        <form method="post" action="/game/assets/land" id="split-${parcel.id}" hidden>
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="action" value="split">
                            <input type="hidden" name="parcel_id" value="${parcel.id}">
                        </form>` : '')}
                <form method="post" action="/game/assets/land" ${canTrade ? 'data-select-group' : ''}>
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <div class="table-responsive">
                        <table class="table table-striped align-middle">
                            <thead>
                            <tr>
                                ${canTrade ? html`
                                    <th><input class="form-check-input" type="checkbox" data-select-all title="Select all" aria-label="Select all lots"></th>` : ''}
                                <th>Lot</th><th>Where</th><th>Size</th><th>Buildings</th><th>Since</th><th>For sale</th>
                                ${canTrade ? html`
                                    <th>Split</th>` : ''}
                            </tr>
                            </thead>
                            <tbody>
                            ${baronyParcels.map((parcel) => {
                                const lotBuildings = buildings.get(parcel.id) ?? [];
                                return html`
                                <tr>
                                    ${canTrade ? html`
                                        <td>
                                            <input class="form-check-input" type="checkbox" name="ids[]" value="${parcel.id}"
                                                   aria-label="Select lot #${parcel.id}" ${disabled(parcel.listing_id)}>
                                        </td>` : ''}
                                    <td>
                                        #${parcel.id}
                                        ${parcel.held_of ? html`
                                            <a class="badge text-bg-light border text-decoration-none" href="/game/court/fiefs" title="Held of ${parcel.held_of_name}">fief of ${parcel.held_of_name}</a>` : ''}
                                    </td>
                                    <td>${parcel.part_name ? Baronies.KINDS[parcel.part_kind] + ' ' + parcel.part_name : (parcel.barony_id ? 'The barony' : 'The wilds')}</td>
                                    <td>${Land.acres(parcel.acres)}</td>
                                    <td class="small">
                                        ${lotBuildings.map((building, i) => html`
                                            ${building.name + (building.finished_at === null ? ` (${building.progress}/${building.days} days built)` : '') + (i === lotBuildings.length - 1 ? '' : ',')}`)}
                                    </td>
                                    <td class="text-nowrap">${String(parcel.created_at).substring(0, 10)}</td>
                                    <td>${parcel.listing_id ? Wallets.format(int(parcel.price)) : '—'}</td>
                                    ${canTrade ? html`
                                        <td>
                                            ${!parcel.listing_id && float(parcel.acres) > Land.MIN_ACRES ? html`
                                                <div class="d-flex align-items-center gap-2">
                                                    <input class="form-control form-control-sm" style="width: 6rem" form="split-${parcel.id}" name="acres"
                                                           type="number" step="0.01" min="0.01" max="${phpFloat(float(parcel.acres) - Land.MIN_ACRES)}" value="${phpFloat(Math.min(Baronies.VILLAGER_ACRES, float(parcel.acres) / 2))}" required aria-label="Acres to split off">
                                                    <span class="small">acres</span>
                                                    <button class="btn btn-sm btn-outline-secondary text-nowrap" form="split-${parcel.id}">Split off</button>
                                                </div>` : ''}
                                        </td>` : ''}
                                </tr>`;
                            })}
                            </tbody>
                        </table>
                    </div>
                    ${canTrade && baronyParcels.length > 1 ? html`
                        <button class="btn btn-sm btn-outline-primary mb-3" name="action" value="merge">
                            Merge selected <span class="small" data-selected-count></span>
                        </button>` : canTrade ? html`
                        <span hidden data-selected-count></span>` : ''}
                </form>`;
            })}`}`}`,
    });
}
