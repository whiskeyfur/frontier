// Upstream: game/views/admin/baronies.blade.php
import { disabled, html, selected, type Html } from '../../../core/html';
import { int, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';
import gameLayout from '../layouts/game';

/** baronies: Baronies.all(); lords: titled anthros who can hold or manage (Ranks.titled()). */
export default function baronies(v: ViewContext, { baronies, lords, error }: { baronies: Map<number, Row>; lords: Row[]; error: string | null }): Html {
    const lordField = (anthro: Row | null) => (anthro ? anthro.name + ' (#' + anthro.id + ')' : '');
    const list = [...baronies.values()];
    return gameLayout(v, {
        title: 'Baronies - Game admin',
        content: html`
    <h1 class="h3 mb-1">Baronies</h1>
    <p class="text-body-secondary">
        All land lies in a barony. A barony is held by a ${Ranks.name(Baronies.HOLDER_RANK)} or a higher
        lord (the crown can hold its own), and through them by the lords above; its villages, manors and expanses are
        managed by a ${Ranks.name(Ranks.KNIGHT)} or higher, and its towns and cities by a
        ${Ranks.name(3)} or higher. Leave a holder or manager empty for
        nobody. A holder that loses its title passes its baronies to its successor (hereditary titles) or up to its
        liege. Move lots between baronies in the <a href="/game/admin/land">land office</a>; a barony with land in
        it can't be removed. See them all on <a href="/game/court/lands">Court &rarr; Lands</a>.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <datalist id="barony-lords">
        ${lords.map((lord) => html`
            <option value="${lord.name} (#${lord.id})">${Ranks.name(int(lord.rank), lord.presents_as)}</option>`)}
    </datalist>

    <form method="post" action="/game/admin/baronies" class="card card-body mb-4" style="max-width: 40rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="create">
        <h2 class="h6">Found a barony</h2>
        <div class="d-flex flex-wrap gap-2">
            <input class="form-control form-control-sm w-auto" name="name" maxlength="${Baronies.MAX_NAME}" placeholder="Name"
                   value="${Baronies.placeName(list.map((b) => b.name))}" required aria-label="Name">
            <input class="form-control form-control-sm w-auto" name="holder" list="barony-lords" placeholder="Held by (optional)"
                   autocomplete="off" aria-label="Held by">
            <button class="btn btn-sm btn-warning">Found</button>
        </div>
    </form>

    ${list.length ? list.map((barony) => html`
        <div class="card mb-3">
            <div class="card-body">
                <form method="post" action="/game/admin/baronies" class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="barony_id" value="${barony.id}">
                    <span class="badge text-bg-secondary">Barony</span>
                    <input class="form-control form-control-sm w-auto fw-semibold" name="name" value="${barony.name}"
                           maxlength="${Baronies.MAX_NAME}" required aria-label="Name">
                    <label class="small text-body-secondary" for="holder-${barony.id}">held by</label>
                    <input class="form-control form-control-sm w-auto" id="holder-${barony.id}" name="holder" list="barony-lords"
                           value="${lordField(barony.holder)}" placeholder="nobody" autocomplete="off">
                    <button class="btn btn-sm btn-outline-primary" name="action" value="update">Save</button>
                    <button class="btn btn-sm btn-outline-danger" name="action" value="delete" ${disabled(barony.parcels)}
                            onclick="return confirm(${json_encode('Remove the barony of ' + barony.name + '?')})">Remove</button>
                    <span class="small text-body-secondary ms-auto">
                        <a href="/game/court/lands/${barony.id}">${Land.acres(barony.acres)}</a>
                        in ${barony.parcels} ${barony.parcels === 1 ? 'lot' : 'lots'}
                    </span>
                </form>
                <ul class="list-unstyled ms-3 mb-0">
                    ${[...barony.parts, null].map((part: Row | null) => html`
                        <li class="mb-1">
                            <form method="post" action="/game/admin/baronies" class="d-flex flex-wrap align-items-center gap-2 m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="barony_id" value="${barony.id}">
                                ${part ? html`
                                    <input type="hidden" name="part_id" value="${part.id}">` : ''}
                                <select class="form-select form-select-sm w-auto" name="kind" aria-label="Kind">
                                    ${Object.entries(Baronies.KINDS).map(([kind, label]) => html`
                                        <option value="${kind}" ${selected((part?.kind ?? 'village') === kind)}>${label}</option>`)}
                                </select>
                                <input class="form-control form-control-sm w-auto" name="name" value="${part?.name ?? ''}"
                                       maxlength="${Baronies.MAX_NAME}" placeholder="${part ? 'Name' : 'New town, village or expanse'}" required aria-label="Name">
                                <label class="small text-body-secondary">managed by
                                    <input class="form-control form-control-sm d-inline-block w-auto" name="manager" list="barony-lords"
                                           value="${part ? lordField(part.manager) : ''}" placeholder="the holder" autocomplete="off">
                                </label>
                                ${part ? html`
                                    <button class="btn btn-sm btn-outline-primary" name="action" value="save_part">Save</button>
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="delete_part"
                                            onclick="return confirm(${json_encode('Remove ' + part.name + '? Its land stays in the barony.')})">Remove</button>
                                    <span class="small text-body-secondary">${Land.acres(part.acres)}</span>` : html`
                                    <button class="btn btn-sm btn-outline-secondary" name="action" value="save_part">Add</button>`}
                            </form>
                        </li>`)}
                </ul>
            </div>
        </div>`) : html`
        <p>There are no baronies yet. A game reset founds one for each ${Ranks.name(Baronies.HOLDER_RANK)} and one for the crown.</p>`}`,
    });
}
