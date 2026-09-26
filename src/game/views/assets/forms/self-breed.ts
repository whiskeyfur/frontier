// Upstream: game/views/assets/forms/self-breed.blade.php
import { html, type Html } from '../../../../core/html';
import { range } from '../../../../core/php';
import type { ViewContext } from '../../../../core/View';
import type { Row } from '../../../../db/Db';
import { Litters } from '../../../Litters';

/**
 * Herms only: the anthro breeds itself (see Anthros.selfBreed), posting to action (the game home page, or the
 * anthro's own /self-breed).
 */
export default function selfBreedForm(v: ViewContext, { anthro, action }: { anthro: Row; action: string }): Html {
    return html`<form method="post" action="${action}">
    <input type="hidden" name="csrf" value="${v.csrf}">
    <input type="hidden" name="action" value="self_breed">
    <h3 class="h6">Breed thyself</h3>
    <p class="text-body-secondary small mb-2">
        As a herm, ${anthro.name} can sire its own litter. The usual rules apply: it must be fertile, it only
        conceives on its day of the week, and it stops once its litter is full.
    </p>
    <div class="d-flex flex-wrap align-items-center gap-2">
        <label class="small" for="self-cubs">Litter of</label>
        <select class="form-select form-select-sm w-auto" id="self-cubs" name="cubs">
            ${range(1, Litters.MAX_CUBS).map((cubs) => html`
                <option value="${cubs}">${cubs} ${cubs === 1 ? 'cub' : 'cubs'}</option>`)}
        </select>
        <button class="btn btn-sm btn-success">Breed thyself</button>
    </div>
</form>`;
}
