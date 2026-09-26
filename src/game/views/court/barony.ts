// Upstream: game/views/court/barony.blade.php
import { html, type Html } from '../../../core/html';
import { int, number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

export default function barony(v: ViewContext, { barony }: { barony: Row }): Html {
    return gameLayout(v, {
        title: 'Barony of ' + barony.name + ' - Game',
        content: html`
    ${subnav(v, { section: '/game/court' })}
    <p><a href="/game/court/lands">&larr; Lands</a></p>
    <h1 class="h3 mb-1">Barony of ${barony.name}</h1>
    <p class="text-body-secondary">
        ${barony.holder ? html`
            Held by ${Ranks.title(barony.holder)}
            <a href="/game/assets/${barony.holder.id}">${barony.holder.name}</a>
            ${barony.through.length ? html`
                &middot; of
                ${barony.through.map((lord: Row, i: number) => html`
                    ${Ranks.title(lord)} <a href="/game/assets/${lord.id}">${lord.name}</a>${i !== barony.through.length - 1 ? html` &rarr; ` : ''}`)}` : ''}` : html`
            Held by no one.`}
        &middot; ${Land.acres(barony.acres)} in ${barony.parcels}
        ${barony.parcels === 1 ? 'lot' : 'lots'}${barony.people ? html` &middot; ${number_format(barony.people)} ${barony.people === 1 ? 'person lives' : 'people live'} here ` : ''}.
    </p>

    ${barony.parts.length ? html`
        <h2 class="h5">Towns, villages and expanses</h2>
        <div class="table-responsive">
            <table class="table align-middle">
                <thead><tr><th>Name</th><th>Kind</th><th>Managed by</th><th class="text-end">People</th><th class="text-end">Size</th></tr></thead>
                <tbody>
                ${barony.parts.map((part: Row) => html`
                    <tr>
                        <td>${part.name}</td>
                        <td>${Baronies.KINDS[part.kind]}</td>
                        <td>
                            ${part.manager ? html`
                                ${Ranks.title(part.manager)} <a href="/game/assets/${part.manager.id}">${part.manager.name}</a>` : html`
                                <span class="text-body-secondary">the barony's holder</span>`}
                        </td>
                        <td class="text-end">${number_format(part.people)}</td>
                        <td class="text-end">${Land.acres(part.acres)}</td>
                    </tr>`)}
                </tbody>
            </table>
        </div>` : ''}

    <h2 class="h5">Land</h2>
    ${!barony.parcels_list.length ? html`
        <p class="text-body-secondary">No land has been laid out here yet.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead><tr><th>Lot</th><th>Where</th><th>Size</th><th>Owner</th><th>For sale</th></tr></thead>
                <tbody>
                ${barony.parcels_list.map((parcel: Row) => html`
                    <tr>
                        <td data-sort="${parcel.id}">#${parcel.id}</td>
                        <td>${parcel.part_name ?? 'The barony'}</td>
                        <td data-sort="${parcel.acres}">${Land.acres(parcel.acres)}</td>
                        <td>
                            ${parcel.anthro_id ? html`
                                <a href="/game/assets/${parcel.anthro_id}">${parcel.owner_name}</a>` : html`
                                Land office`}
                        </td>
                        <td data-sort="${parcel.price ?? -1}">
                            ${parcel.listing_id ? html`
                                <a href="/game/market/land">${Wallets.format(int(parcel.price))}</a>` : html`
                                &mdash;`}
                        </td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`}`,
    });
}
