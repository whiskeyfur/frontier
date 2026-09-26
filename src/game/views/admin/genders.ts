// Upstream: game/views/admin/genders.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { array_sum, json_encode, round } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import gameLayout from '../layouts/game';
import genderSymbol from '../assets/gender';
import genderFields from './gender-fields';

/** genders: Genders.all(). */
export default function genders(v: ViewContext, { genders, error }: { genders: Row[]; error: string | null }): Html {
    const totalWeight = array_sum(genders.map((g) => g.birth_weight));
    const orders = genders.map((g) => g.sort_order);
    const nextOrder = (orders.length ? Math.max(...orders) : 0) + 10;
    return gameLayout(v, {
        title: 'Genders - Game admin',
        content: html`
    <h1 class="h3 mb-1">Genders</h1>
    <p class="text-body-secondary mb-1">
        <strong>is_male</strong> genders can sire and <strong>is_female</strong> genders can be dams (both for herms).
        <strong>Presents as</strong> sets the symbol (♂ ♀ ⚥) and name suggestions.
    </p>
    <p class="text-body-secondary">
        <strong>Birth weight</strong> is how likely a newborn is to have the gender, relative to the others
        ${totalWeight ? html`
            (now: ${genders.filter((g) => g.birth_weight > 0).map((g) => g.name + ' ' + round(g.birth_weight * 100 / totalWeight) + '%').join(', ')}).` : html`
            (all 0 now, so every gender is equally likely).`}
        Genders in use can't be deleted.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <form method="post" action="/game/admin/genders" class="card card-body mb-4">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="add">
        <h2 class="h6">Add gender</h2>
        <div class="d-flex flex-wrap align-items-center gap-2">
            ${genderFields(v, { gender: null, key: 'new', nextOrder })}
            <button class="btn btn-sm btn-primary">Add</button>
        </div>
    </form>

    <ul class="list-group">
        ${genders.map((gender) => html`
            <li class="list-group-item">
                <form method="post" action="/game/admin/genders" class="d-flex flex-wrap align-items-center gap-2">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="id" value="${gender.id}">
                    <span class="fs-5" style="width: 1.5rem">${genderSymbol(v, { gender: gender.name, presentsAs: gender.presents_as })}</span>
                    ${genderFields(v, { gender, key: gender.id, nextOrder })}
                    <span class="small text-body-secondary" style="min-width: 5.5rem">
                        ${gender.anthros} ${gender.anthros === 1 ? 'anthro' : 'anthros'}
                    </span>
                    <button class="btn btn-sm btn-outline-primary" name="action" value="update">Save</button>
                    <button class="btn btn-sm btn-outline-danger" name="action" value="delete" ${disabled(gender.anthros)}
                            onclick="return confirm(${json_encode('Delete ' + gender.name + '?')})">Delete</button>
                </form>
            </li>`)}
    </ul>`,
    });
}
