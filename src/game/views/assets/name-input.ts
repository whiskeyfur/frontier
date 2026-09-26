// Upstream: game/views/assets/name-input.blade.php
import { empty } from '../../../core/php';
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { Anthros } from '../../Anthros';

/**
 * Name field with a button that fills in a random name (script in the game layout).
 * genderField names the gender field (gender_id) to follow; without it, names are gender-neutral.
 */
export default function nameInput(_v: ViewContext, { id, value, genderField = null, autofocus = null }: {
    id: string; value: string; genderField?: string | null; autofocus?: unknown;
}): Html {
    return html`<div class="input-group">
    <input class="form-control" id="${id}" name="name" value="${value}"
           maxlength="${Anthros.MAX_NAME}" required ${!empty(autofocus) ? html`autofocus` : ''}>
    <button class="btn btn-outline-secondary" type="button" data-random-name="${id}"
            ${!empty(genderField) ? html`data-gender-field="${genderField}"` : ''} title="Fill in a random name">
        🎲 Random
    </button>
</div>`;
}
