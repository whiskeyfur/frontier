// Upstream: game/views/court/grant.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { Ranks } from '../../Ranks';

/**
 * Granting titles: ranks (the titles that may be granted), as ('crown' or 'admin'; also keeps ids unique when
 * both forms are on the page). Names are suggested as you type.
 */
export default function grant(v: ViewContext, { ranks, as }: { ranks: number[]; as: 'crown' | 'admin' }): Html {
    return html`<form method="post" action="/game/court" class="card card-body mb-3" style="max-width: 36rem">
    <input type="hidden" name="csrf" value="${v.csrf}">
    <input type="hidden" name="action" value="grant">
    <h2 class="h6">Grant a title <span class="text-body-secondary small">(${as === 'admin' ? 'admin' : 'as the crown'})</span></h2>
    <div class="mb-2">
        <label class="form-label" for="anthro-${as}">Anthro</label>
        <input class="form-control" id="anthro-${as}" name="anthro" list="anthro-names-${as}" data-anthro-search placeholder="Start typing an anthro's name"
               autocomplete="off" required>
        <datalist id="anthro-names-${as}"></datalist>
    </div>
    <div class="mb-3">
        <label class="form-label" for="rank-${as}">Title</label>
        <select class="form-select" id="rank-${as}" name="rank">
            ${ranks.map((grant) => html`
                <option value="${grant}">${Ranks.name(grant)} / ${Ranks.name(grant, 'female')}</option>`)}
            <option value="">No title (commoner)</option>
        </select>
    </div>
    <div><button class="btn btn-warning">Grant</button></div>
    <div class="form-text">Only a free anthro can hold a title. There is one King and one Queen.</div>
</form>
`;
}
