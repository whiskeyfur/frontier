// Upstream: game/views/assets/forms/transfer.blade.php
import { html, type Html } from '../../../../core/html';
import { json_encode } from '../../../../core/php';
import type { ViewContext } from '../../../../core/View';
import type { Row } from '../../../../db/Db';
import { Anthros } from '../../../Anthros';

/** Give the anthro to another anthro to own (names are suggested as you type). */
export default function transferForm(v: ViewContext, { anthro, isYou }: { anthro: Row; isYou: boolean }): Html {
    return html`<form method="post" action="/game/assets/${anthro.id}/transfer" class="card card-body mb-4" style="max-width: 36rem">
    <input type="hidden" name="csrf" value="${v.csrf}">
    <label class="form-label" for="transfer-to">Give ${isYou ? 'yourself' : anthro.name} to another anthro</label>
    <div class="d-flex gap-2">
        <input class="form-control" id="transfer-to" name="to" list="transfer-anthros" data-anthro-search placeholder="Start typing an anthro's name"
               autocomplete="off" required>
        <datalist id="transfer-anthros"></datalist>
        <button class="btn btn-outline-danger text-nowrap"
                onclick="return confirm(${json_encode('Give ' + (isYou ? 'yourself' : anthro.name) + ' to the chosen anthro? Only its new owner can give ' + (isYou ? 'you' : 'them') + ' back.')})">Give</button>
    </div>
    <div class="form-text">
        The anthro you choose owns ${isYou ? 'you' : 'it'} from then on, and its player decides everything, including breeding.
        ${Anthros.isFree(anthro) ? html`
            Giving away a free anthro takes its freedom: its title and job end, and its land and anthros go to its new owner.` : ''}
    </div>
</form>`;
}
