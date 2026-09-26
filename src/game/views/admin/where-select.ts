// Upstream: game/views/admin/where-select.blade.php
import { html, selected as isSelected, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';

// Choosing where land lies: a barony, or a town, village or expanse in it ("barony id" or "barony id:part id").
/** baronies: Baronies.all(). */
export default function whereSelect(_v: ViewContext, { baronies, class: extra, id, selected }: {
    baronies: Map<number, Row>; class?: string; id?: string; selected?: string | null;
}): Html {
    return html`<select class="form-select ${extra ?? ''}" name="where" ${id !== undefined && id !== null ? html`id="${id}"` : ''} aria-label="Where the land lies" required>
    ${selected === undefined || selected === null ? html`
        <option value="">Choose a barony</option>` : ''}
    ${[...baronies.values()].map((barony) => html`
        <optgroup label="Barony of ${barony.name}">
            <option value="${barony.id}" ${isSelected((selected ?? null) === String(barony.id))}>${barony.name} (the barony)</option>
            ${barony.parts.map((part: Row) => {
                const value = barony.id + ':' + part.id;
                return html`
                <option value="${value}" ${isSelected((selected ?? null) === value)}>
                    ${barony.name} &middot; ${Baronies.KINDS[part.kind]} ${part.name}
                </option>`;
            })}
        </optgroup>`)}
</select>`;
}
