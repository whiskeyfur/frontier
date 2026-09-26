// Upstream: game/views/admin/gender-fields.blade.php
import { checked, html, selected, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Genders } from '../../Genders';

// Editable gender fields; gender is null for the "add" row.
export default function genderFields(_v: ViewContext, { gender, key, nextOrder }: { gender: Row | null; key: string | number; nextOrder: number }): Html {
    return html`<input class="form-control form-control-sm" style="min-width: 9rem" name="name" value="${gender?.name ?? ''}"
       maxlength="${Genders.MAX_NAME}" required aria-label="Name" placeholder="Gender name">
<div class="form-check form-check-inline m-0" title="Can sire">
    <input class="form-check-input" type="checkbox" name="is_male" id="male-${key}" ${checked(gender?.is_male ?? false)}>
    <label class="form-check-label small" for="male-${key}">is_male</label>
</div>
<div class="form-check form-check-inline m-0" title="Can be a dam">
    <input class="form-check-input" type="checkbox" name="is_female" id="female-${key}" ${checked(gender?.is_female ?? false)}>
    <label class="form-check-label small" for="female-${key}">is_female</label>
</div>
<select class="form-select form-select-sm w-auto" name="presents_as" aria-label="Presents as">
    ${Genders.PRESENTS_AS.map((option) => html`
        <option value="${option}" ${selected((gender?.presents_as ?? 'androgynous') === option)}>presents ${option}</option>`)}
</select>
<label class="small text-body-secondary" for="weight-${key}">Birth weight</label>
<input class="form-control form-control-sm" style="width: 5rem" id="weight-${key}" name="birth_weight" type="number" min="0"
       value="${gender?.birth_weight ?? 0}">
<label class="small text-body-secondary" for="order-${key}">Order</label>
<input class="form-control form-control-sm" style="width: 5rem" id="order-${key}" name="sort_order" type="number"
       value="${gender?.sort_order ?? nextOrder}">`;
}
