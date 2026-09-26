// Upstream: game/views/court/fiefs.blade.php
import { html, type Html } from '../../../core/html';
import { array_sum, float, gmdate, json_encode, strtotimeOrThrow } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Fiefs } from '../../Fiefs';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

export type FiefsData = {
    player: Row | null;
    held: Row[];
    vassals: Row[];
    offers: { received: Row[]; sent: Row[] };
    lots: Row[];
    error: string | null;
};

export default function fiefs(v: ViewContext, { player, held, vassals, offers, lots, error }: FiefsData): Html {
    const balance = player ? float(player.tax_balance) : 0;
    return gameLayout(v, {
        title: 'Fiefs - Game',
        content: html`
    <h1 class="h3 mb-3">Fiefs</h1>
    ${subnav(v, { section: '/game/court' })}
    <p class="text-body-secondary">
        A lord grants land as a fief to a vassal, who swears fealty for it. The fief still counts toward the lord's rank,
        and a vassal holding one can't rise above its lord. The vassal owes a share of what its household produces
        (goods at what the <a href="/game/market/goods">market</a> pays for them),
        collected each ${Anthros.weekday(Fiefs.TAX_WEEKDAY)} after everyone eats: coins first, then food beyond a week's, then
        lumber. What can't be paid stays owed; pay it off, or pay ahead. ${Fiefs.GRACE_DAYS} days behind gives the lord cause to
        seize the fiefs. A fief goes back to its lord if its vassal swears elsewhere, loses their freedom, or dies without a
        free child to take it; it can't be sold.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${!player ? html`
        <p><a href="/game/home">Create or become an anthro</a> first.</p>` : html`
        ${offers.received.length ? html`
            <h2 class="h5">Offers to you</h2>
            <ul class="list-group mb-4">
                ${offers.received.map((offer) => html`
                    <li class="list-group-item">
                        <form method="post" action="/game/court/fiefs" class="d-flex flex-wrap align-items-center gap-2 m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="offer_id" value="${offer.id}">
                            <span>
                                <a href="/game/assets/${offer.lord.id}">${Ranks.title(offer.lord)} ${offer.lord.name}</a>
                                ${offer.kind === 'grant' ? html`
                                    offers you ${Land.acres(offer.acres)} as a fief, at ${offer.rate}% tax, if you swear fealty to them.
                                    ${player.liege_id && player.liege_id !== offer.lord.id && Fiefs.holdsFief(player.id) ? html`
                                        <span class="text-warning">Your fiefs held of ${player.liege_name} would go back to them.</span>` : ''}` : html`
                                    proposes your tax be ${offer.rate}% (it's ${player.tax_rate}% now).`}
                            </span>
                            <button class="btn btn-sm btn-outline-success" name="action" value="accept">Accept</button>
                            <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Decline</button>
                        </form>
                    </li>`)}
            </ul>` : ''}

        <h2 class="h5">Fiefs you hold</h2>
        ${!held.length ? html`
            <p class="text-body-secondary">None.</p>` : html`
            <p class="mb-2">
                Held of <a href="/game/assets/${player.liege_id}">${player.liege_name}</a>:
                ${Land.acres(array_sum(held.map((p) => p.acres)))} in ${held.length} ${held.length === 1 ? 'lot' : 'lots'}
                (${held.map((p) => '#' + p.id).join(', ')}), at ${player.tax_rate}% tax.
                ${balance > 0 ? html`
                    <strong>You owe ${Fiefs.coins(balance)}</strong>${player.tax_overdue_since ? html`, overdue since ${player.tax_overdue_since}${Fiefs.mayBeSeized(player) ? html`: <span class="text-danger">your lord can seize your fiefs</span>` : html` (your lord can seize your fiefs from ${gmdate('Y-m-d', strtotimeOrThrow(player.tax_overdue_since + ' UTC +' + Fiefs.GRACE_DAYS + ' days'))})`} ` : ''}.` : balance < 0 ? html`
                    You've paid ${Fiefs.coins(-balance)} ahead.` : html`
                    You owe nothing.`}
            </p>
            <form method="post" action="/game/court/fiefs" class="d-flex flex-wrap align-items-center gap-2 mb-4">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="pay">
                <input class="form-control form-control-sm" style="width: 7rem" name="coins" type="number" min="1" required
                       value="${Math.max(1, Math.ceil(balance))}" aria-label="Coins to pay">
                <button class="btn btn-sm btn-outline-primary">Pay your lord</button>
                <span class="form-text m-0">Paying more than you owe is credit toward later taxes.</span>
            </form>`}

        <h2 class="h5">Your vassals' fiefs</h2>
        ${!vassals.length ? html`
            <p class="text-body-secondary">None.</p>` : html`
            <div class="table-responsive">
                <table class="table table-striped align-middle">
                    <thead><tr><th>Vassal</th><th>Fiefs</th><th>Tax</th><th>Owes</th><th></th></tr></thead>
                    <tbody>
                    ${vassals.map((vassal) => html`
                        <tr>
                            <td><a href="/game/assets/${vassal.id}">${vassal.name}</a> <span class="small text-body-secondary">${Ranks.title(vassal)}</span></td>
                            <td>${Land.acres(vassal.fief_acres)}</td>
                            <td>
                                <form method="post" action="/game/court/fiefs" class="d-flex align-items-center gap-1 m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="action" value="rate">
                                    <input type="hidden" name="vassal_id" value="${vassal.id}">
                                    <input class="form-control form-control-sm" style="width: 4.5rem" name="rate" type="number" min="0" max="${Fiefs.MAX_RATE}"
                                           value="${vassal.tax_rate}" aria-label="Tax rate for ${vassal.name}">
                                    <span class="small">%</span>
                                    <button class="btn btn-sm btn-outline-secondary text-nowrap">Propose</button>
                                </form>
                            </td>
                            <td class="small">
                                ${float(vassal.tax_balance) > 0 ? html`
                                    ${Fiefs.coins(float(vassal.tax_balance))}${vassal.tax_overdue_since ? html`, overdue since ${vassal.tax_overdue_since}` : ''}` : float(vassal.tax_balance) < 0 ? html`
                                    paid ${Fiefs.coins(-float(vassal.tax_balance))} ahead` : html`
                                    nothing`}
                            </td>
                            <td>
                                ${Fiefs.mayBeSeized(vassal) ? html`
                                    <form method="post" action="/game/court/fiefs" class="m-0">
                                        <input type="hidden" name="csrf" value="${v.csrf}">
                                        <input type="hidden" name="action" value="seize">
                                        <input type="hidden" name="vassal_id" value="${vassal.id}">
                                        <button class="btn btn-sm btn-outline-danger"
                                                onclick="return confirm(${json_encode('Seize ' + vassal.name + "'s fiefs? They leave your service, and their own land no longer counts toward your rank.")})">Seize</button>
                                    </form>` : ''}
                            </td>
                        </tr>`)}
                    </tbody>
                </table>
            </div>`}

        ${offers.sent.length ? html`
            <h2 class="h5">Offers you made</h2>
            <ul class="list-unstyled mb-4">
                ${offers.sent.map((offer) => html`
                    <li class="mb-1">
                        <form method="post" action="/game/court/fiefs" class="d-flex flex-wrap align-items-center gap-2 m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="action" value="withdraw">
                            <input type="hidden" name="offer_id" value="${offer.id}">
                            <span class="small">
                                ${offer.kind === 'grant' ? Land.acres(offer.acres) + ' of lot #' + offer.parcel_id + ' to ' : 'A tax of ' + offer.rate + '% for '}${offer.vassal.name}${offer.kind === 'grant' ? ', at ' + offer.rate + '% tax' : ''}: waiting for an answer.
                            </span>
                            <button class="btn btn-sm btn-outline-secondary">Take it back</button>
                        </form>
                    </li>`)}
            </ul>` : ''}

        <h2 class="h5">Grant a fief</h2>
        ${!Anthros.isFree(player) ? html`
            <p class="text-body-secondary">Only an anthro that owns itself can grant land.</p>` : !lots.length ? html`
            <p class="text-body-secondary">You have no land to grant (land for sale can't be granted).</p>` : html`
            <form method="post" action="/game/court/fiefs" class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="grant">
                <select class="form-select form-select-sm w-auto" name="parcel_id" aria-label="Lot">
                    ${lots.map((lot) => html`
                        <option value="${lot.id}">Lot #${lot.id} (${Land.acres(lot.acres)}, ${lot.barony_name ?? 'the wilds'}${lot.held_of ? ', a fief' : ''})</option>`)}
                </select>
                <input class="form-control form-control-sm" style="width: 7rem" name="acres" type="number" step="0.01" min="0.01" placeholder="All of it"
                       aria-label="Acres to grant">
                <input class="form-control form-control-sm w-auto" name="anthro" list="vassal-names" data-anthro-search placeholder="To: Name (#id)"
                       aria-label="Who to grant it to" required>
                <datalist id="vassal-names"></datalist>
                <input class="form-control form-control-sm" style="width: 4.5rem" name="rate" type="number" min="0" max="${Fiefs.MAX_RATE}" value="10" aria-label="Tax rate">
                <span class="small">% tax</span>
                <button class="btn btn-sm btn-primary">Offer</button>
            </form>
            <div class="form-text">
                They must be of your rank or lower. Leave the acres empty to grant the whole lot. An anthro that isn't played
                answers for itself, and accepts a tax of ${Fiefs.NPC_RATE}% or less.
            </div>`}`}`,
    });
}
