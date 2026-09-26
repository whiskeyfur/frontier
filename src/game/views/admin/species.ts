// Upstream: game/views/admin/species.blade.php
import { disabled, html, selected, type Html } from '../../../core/html';
import { json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Species } from '../../Species';
import gameLayout from '../layouts/game';

/** groups: Species.groupsWithSpecies(). */
export default function species(v: ViewContext, { groups, error }: { groups: Row[]; error: string | null }): Html {
    const orders = groups.map((g) => g.sort_order);
    return gameLayout(v, {
        title: 'Species - Game admin',
        content: html`
    <h1 class="h3 mb-1">Species</h1>
    <p class="text-body-secondary">
        Species appear in the Add anthro list, grouped and ordered here. Species in use and groups with species can't be deleted.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <div class="row g-3 mb-4">
        <div class="col-md-7">
            <form method="post" action="/game/admin/species" class="card card-body h-100">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="add_species">
                <h2 class="h6">Add species</h2>
                <div class="d-flex flex-wrap gap-2">
                    <input class="form-control w-auto flex-grow-1" name="name" placeholder="Species name"
                           maxlength="${Species.MAX_NAME}" required>
                    <select class="form-select w-auto" name="group_id" required aria-label="Group">
                        ${groups.map((group) => html`
                            <option value="${group.id}">${group.name}</option>`)}
                    </select>
                    <button class="btn btn-primary">Add</button>
                </div>
            </form>
        </div>
        <div class="col-md-5">
            <form method="post" action="/game/admin/species" class="card card-body h-100">
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="add_group">
                <h2 class="h6">Add group</h2>
                <div class="d-flex flex-wrap gap-2">
                    <input class="form-control w-auto flex-grow-1" name="name" placeholder="Group name"
                           maxlength="${Species.MAX_NAME}" required>
                    <input class="form-control" style="width: 6rem" name="sort_order" type="number" title="Order"
                           value="${(orders.length ? Math.max(...orders) : 0) + 10}">
                    <button class="btn btn-primary">Add</button>
                </div>
            </form>
        </div>
    </div>

    ${groups.map((group) => html`
        <div class="card mb-3">
            <div class="card-header">
                <form method="post" action="/game/admin/species" class="d-flex flex-wrap align-items-center gap-2">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="id" value="${group.id}">
                    <input class="form-control form-control-sm fw-semibold w-auto flex-grow-1" name="name"
                           value="${group.name}" maxlength="${Species.MAX_NAME}" required aria-label="Group name">
                    <label class="small text-body-secondary" for="order-${group.id}">Order</label>
                    <input class="form-control form-control-sm" style="width: 5rem" id="order-${group.id}"
                           name="sort_order" type="number" value="${group.sort_order}">
                    <button class="btn btn-sm btn-outline-primary" name="action" value="update_group">Save</button>
                    <button class="btn btn-sm btn-outline-danger" name="action" value="delete_group"
                            onclick="return confirm(${json_encode('Delete the ' + group.name + ' group?')})"
                            ${disabled(group.species.length)} title="${group.species.length ? 'Only empty groups can be deleted' : 'Delete group'}">Delete</button>
                </form>
            </div>
            <ul class="list-group list-group-flush">
                ${group.species.length ? group.species.map((species: Row) => html`
                    <li class="list-group-item">
                        <form method="post" action="/game/admin/species" class="d-flex flex-wrap align-items-center gap-2">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="id" value="${species.id}">
                            <input class="form-control form-control-sm w-auto flex-grow-1" name="name" value="${species.name}"
                                   maxlength="${Species.MAX_NAME}" required aria-label="Species name">
                            <select class="form-select form-select-sm w-auto" name="group_id" aria-label="Group">
                                ${groups.map((option) => html`
                                    <option value="${option.id}" ${selected(option.id === group.id)}>${option.name}</option>`)}
                            </select>
                            <span class="small text-body-secondary" style="min-width: 6rem">
                                ${species.anthros} ${species.anthros === 1 ? 'anthro' : 'anthros'}
                            </span>
                            <button class="btn btn-sm btn-outline-primary" name="action" value="update_species">Save</button>
                            <button class="btn btn-sm btn-outline-danger" name="action" value="delete_species"
                                    onclick="return confirm(${json_encode('Delete ' + species.name + '?')})"
                                    ${disabled(species.anthros)} title="${species.anthros ? 'In use' : 'Delete species'}">Delete</button>
                        </form>
                    </li>`) : html`
                    <li class="list-group-item text-body-secondary">No species in this group.</li>`}
            </ul>
        </div>`)}`,
    });
}
