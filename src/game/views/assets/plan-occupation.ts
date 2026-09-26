// Upstream: game/views/assets/plan-occupation.blade.php
import { html, selected, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Crafts, type Recipe } from '../../Crafts';

/*
 * An occupation as work to plan (occupation, recipes and detail from plan-fields; label after its title): a
 * service job is one choice; a producer or craftsman, one for each recipe, saying what it makes from what.
 */
export default function planOccupation(_v: ViewContext, { occupation, recipes, detail, label }: {
    occupation: Row; recipes: Map<number, Recipe[]>; detail: string; label: string;
}): Html {
    const list = recipes.get(occupation.id) ?? [];
    return list.length ? html`${list.map((recipe) => html`
    <option value="o:${occupation.id}:${recipe.id}" ${selected(detail === 'o:' + occupation.id + ':' + recipe.id)}>
        ${occupation.title}: ${recipe.name} (${label}; ${Crafts.describe(recipe)})
    </option>`)}` : html`
    <option value="o:${occupation.id}" ${selected(detail === 'o:' + occupation.id)}>${occupation.title} (${label}; paid in coins)</option>`;
}
