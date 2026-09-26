// Upstream: game/views/court/barony-line.blade.php
import { html, type Html } from '../../../core/html';
import { number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Baronies } from '../../Baronies';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';

/** One barony in a list: its name (to its page), size, and its parts with their managers. */
export default function baronyLine(_v: ViewContext, { barony }: { barony: Row }): Html {
    return html`<span class="badge text-bg-secondary">Barony</span>
<a class="fw-semibold" href="/game/court/lands/${barony.id}">${barony.name}</a>
<span class="text-body-secondary small">
    &middot; ${Land.acres(barony.acres)}
    ${barony.people ? html`
        &middot; ${number_format(barony.people)} ${barony.people === 1 ? 'person' : 'people'}` : ''}
    ${barony.office ? html`
        (${Land.acres(barony.office)} with the land office)` : ''}
</span>
${barony.parts && barony.parts.length ? html`
    <ul class="list-unstyled ms-4 small">
        ${barony.parts.map((part: Row) => html`
            <li>
                <span class="text-body-secondary">${(Baronies.KINDS as Record<string, string>)[part.kind]}</span> ${part.name}
                &middot; ${Land.acres(part.acres)}
                ${part.people ? html`
                    &middot; ${number_format(part.people)} ${part.people === 1 ? 'person' : 'people'}` : ''}
                ${part.manager ? html`
                    &middot; managed by ${Ranks.title(part.manager)}
                    <a href="/game/assets/${part.manager.id}">${part.manager.name}</a>` : ''}
            </li>`)}
    </ul>` : ''}`;
}
