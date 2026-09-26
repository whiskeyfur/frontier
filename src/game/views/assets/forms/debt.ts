// Upstream: game/views/assets/forms/debt.blade.php
import { html, type Html } from '../../../../core/html';
import { int } from '../../../../core/php';
import type { ViewContext } from '../../../../core/View';
import type { Row } from '../../../../db/Db';

/** The debt an owned anthro owes its owner (see Anthros.setDebt). */
export default function debtForm(v: ViewContext, { anthro }: { anthro: Row }): Html {
    return html`<form method="post" action="/game/assets/${anthro.id}/debt" class="card card-body mb-3" style="max-width: 36rem">
    <input type="hidden" name="csrf" value="${v.csrf}">
    <h2 class="h6">Debt</h2>
    <div class="row g-2 mb-2">
        <div class="col-sm-6">
            <label class="form-label small" for="debt">Owes</label>
            <input class="form-control" id="debt" name="debt" type="number" min="1" placeholder="No debt"
                   value="${anthro.debt ?? ''}">
        </div>
        <div class="col-sm-6">
            <label class="form-label small" for="debt_rate">Grows by (coins a day)</label>
            <input class="form-control" id="debt_rate" name="debt_rate" type="number" min="0" value="${int(anthro.debt_rate)}">
        </div>
    </div>
    <div class="form-text mb-2">
        If ${anthro.name} can gather this much in their wallet, they can pay it to you and own themselves.
        Leave it empty and they can't buy their freedom. Saving restarts the daily growth from today's amount.
    </div>
    <div><button class="btn btn-outline-primary">Save debt</button></div>
</form>`;
}
