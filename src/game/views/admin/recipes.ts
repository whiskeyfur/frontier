// Upstream: game/views/admin/recipes.blade.php
import { cls, html, type Html } from '../../../core/html';
import { json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Crafts, type GoodsList, type Recipe } from '../../Crafts';
import gameLayout from '../layouts/game';

/** occupations: Schedules.occupations() (id => occupation); recipes: Crafts.byOccupation() (occupation id => recipes). */
export default function recipes(v: ViewContext, { occupations, recipes, error }: {
    occupations: Map<number, Row>; recipes: Map<number, Recipe[]>; error: string | null;
}): Html {
    const list = (goods: GoodsList) => Object.entries(goods).map(([good, n]) => n + ' ' + Crafts.goodName(good)).join(', ');
    return gameLayout(v, {
        title: 'Recipes - Game admin',
        content: html`
    <h1 class="h3 mb-1">Recipes</h1>
    <p class="text-body-secondary">
        What a day's work at each occupation makes (see <a href="/game/docs/knowledge-base#work-and-goods">the Knowledge Base</a>).
        A <strong>producer</strong>'s recipes use nothing up (a farmer's crops, a miner's ore); a <strong>craftsman</strong>'s
        turn goods into goods; an occupation with no recipe is a <strong>service</strong> job, paid in coins. A recipe is
        per unit: a day's work makes ${Object.entries(Crafts.OUTPUT).map(([level, units]) => `${units} (${level})`).join(', ')}
        units by the worker's level. Goods are listed as "2 flax, 1 hops" (up to ${Crafts.MAX_GOODS}, by name);
        add new goods under <a href="/game/admin/goods">Goods</a>. Land is the acres the worker's master must hold.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${[...occupations.values()].map((occupation) => {
        const kind = Crafts.kindOf(occupation.id);
        return html`
        <div class="card mb-2" id="occupation-${occupation.id}">
            <div class="card-header py-1 d-flex align-items-center gap-2">
                <strong>${occupation.title}</strong>
                <span class="small text-body-secondary">${occupation.skill}</span>
                <span class="${cls('badge', { 'text-bg-success': kind === 'producer', 'text-bg-primary': kind === 'craft', 'text-bg-secondary': kind === 'service' })}">${({ producer: 'producer', craft: 'craftsman', service: 'service' } as Record<string, string>)[kind]}</span>
            </div>
            <ul class="list-group list-group-flush">
                ${[...(recipes.get(occupation.id) ?? []), null].map((recipe: Recipe | null) => html`
                    <li class="list-group-item">
                        <form method="post" action="/game/admin/recipes" class="d-flex flex-wrap align-items-center gap-2 m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="occupation_id" value="${occupation.id}">
                            <input type="hidden" name="recipe_id" value="${recipe?.id ?? ''}">
                            <input class="form-control form-control-sm w-auto" name="name" value="${recipe?.name ?? ''}" maxlength="${Crafts.MAX_NAME}"
                                   placeholder="${recipe ? '' : 'New recipe'}" required aria-label="Name">
                            <input class="form-control form-control-sm" style="width: 12rem" name="inputs" value="${recipe ? list(recipe.in) : ''}"
                                   placeholder="Inputs (none: a producer)" aria-label="Inputs">
                            <span aria-hidden="true">→</span>
                            <input class="form-control form-control-sm" style="width: 12rem" name="outputs" value="${recipe ? list(recipe.out) : ''}"
                                   placeholder="Outputs" required aria-label="Outputs">
                            <label class="small text-body-secondary">land
                                <input class="form-control form-control-sm d-inline-block" style="width: 5rem" name="acres" type="number" min="0.01" step="0.01"
                                       value="${recipe?.needs_acres ?? ''}">
                            </label>
                            ${recipe ? html`
                                <button class="btn btn-sm btn-outline-primary" name="action" value="save">Save</button>
                                <button class="btn btn-sm btn-outline-danger" name="action" value="delete" formnovalidate
                                        onclick="return confirm(${json_encode('Remove the ' + recipe.name + ' recipe?')})">Remove</button>` : html`
                                <button class="btn btn-sm btn-outline-secondary" name="action" value="save">Add</button>`}
                        </form>
                    </li>`)}
            </ul>
        </div>`;
    })}`,
    });
}
