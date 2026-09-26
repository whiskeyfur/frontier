// Upstream: game/views/assets/forms/rename.blade.php
import { html, type Html } from '../../../../core/html';
import type { ViewContext } from '../../../../core/View';
import type { Row } from '../../../../db/Db';
import nameInput from '../name-input';

/** Rename the anthro (recorded in its history). */
export default function renameForm(v: ViewContext, { anthro }: { anthro: Row }): Html {
    return html`<form method="post" action="/game/assets/${anthro.id}/rename" class="card card-body mb-3" style="max-width: 36rem">
    <input type="hidden" name="csrf" value="${v.csrf}">
    ${/* Lets the Random button suggest names that fit this anthro's gender. */ ''}
    <input type="hidden" name="gender_id" value="${anthro.gender_id}">
    <label class="form-label" for="name">Rename ${anthro.name}</label>
    <div class="d-flex gap-2">
        <div class="flex-grow-1">
            ${nameInput(v, { id: 'name', value: anthro.name, genderField: 'gender_id' })}
        </div>
        <button class="btn btn-outline-primary">Rename</button>
    </div>
</form>`;
}
