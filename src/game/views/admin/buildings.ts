// Upstream: game/views/admin/buildings.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { float, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Buildings } from '../../Buildings';
import gameLayout from '../layouts/game';

/** types: Buildings.types() (id => kind of building). */
export default function buildings(v: ViewContext, { types, error }: { types: Map<number, Row>; error: string | null }): Html {
    const orders = [...types.values()].map((t) => t.sort_order);
    return gameLayout(v, {
        title: 'Buildings - Game admin',
        content: html`
    <h1 class="h3 mb-1">Buildings</h1>
    <p class="text-body-secondary">
        The kinds of buildings players can build on their land: how many days of work each takes (a day for each anthro
        scheduled to build it), and how many acres of the lot it stands on. A kind that's been built or started can't be
        removed.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <ul class="list-group">
        ${[...types.values(), null].map((type: Row | null) => html`
            <li class="list-group-item">
                <form method="post" action="/game/admin/buildings" class="d-flex flex-wrap align-items-center gap-2 m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    ${type ? html`
                        <input type="hidden" name="id" value="${type.id}">` : ''}
                    <input class="form-control form-control-sm w-auto" name="name" value="${type?.name ?? ''}" maxlength="${Buildings.MAX_NAME}"
                           placeholder="New kind of building" required aria-label="Name">
                    <label class="small text-body-secondary">days
                        <input class="form-control form-control-sm d-inline-block" style="width: 5rem" name="days" type="number" min="1" max="1000"
                               value="${type?.days ?? 10}" required>
                    </label>
                    <label class="small text-body-secondary">acres
                        <input class="form-control form-control-sm d-inline-block" style="width: 6rem" name="acres" type="number" step="0.01" min="0.01"
                               value="${type ? float(type.acres) : 0.25}" required>
                    </label>
                    <label class="small text-body-secondary">order
                        <input class="form-control form-control-sm d-inline-block" style="width: 5rem" name="sort_order" type="number"
                               value="${type?.sort_order ?? ((orders.length ? Math.max(...orders) : 0) + 10)}">
                    </label>
                    ${type ? html`
                        <button class="btn btn-sm btn-outline-primary" name="action" value="save">Save</button>
                        <button class="btn btn-sm btn-outline-danger" name="action" value="delete" ${disabled(type.built)}
                                onclick="return confirm(${json_encode('Remove ' + type.name + '?')})">Remove</button>
                        <span class="small text-body-secondary">${type.built} built or started</span>` : html`
                        <button class="btn btn-sm btn-primary" name="action" value="save">Add</button>`}
                </form>
            </li>`)}
    </ul>`,
    });
}
