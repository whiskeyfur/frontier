// Upstream: game/views/admin/time.blade.php
import { html, type Html } from '../../../core/html';
import { json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import { Board } from '../../Board';
import clock from '../clock';
import gameLayout from '../layouts/game';

export default function time(v: ViewContext, { error }: { error: string | null }): Html {
    return gameLayout(v, {
        title: 'Advance time - Game admin',
        content: html`
    <div class="mx-auto" style="max-width: 40rem">
        <h1 class="h3 mb-1">Advance time</h1>
        <p class="text-body-secondary">
            Moves the game's clock ahead (see <a href="/game/docs/knowledge-base#time-and-the-day">the Knowledge Base</a>):
            each day's business then happens in turn, just as if the days had passed: litters are born, the young grow up,
            the old die, everyone eats, schedules are carried out, taxes are assessed and wages paid. Auctions keep real
            time. Saved games and site accounts aren't touched.
        </p>
        ${clock(v)}
        ${error ? html`
            <div class="alert alert-danger">${error}</div>` : ''}
        <form method="post" action="/game/admin/time" class="card card-body">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" name="save_first" value="1" id="save_first" checked>
                <label class="form-check-label" for="save_first">Save the game first (to undo it from <a href="/game/admin/saves">Saved games</a>)</label>
            </div>
            <div class="d-flex flex-wrap gap-2 mb-3">
                ${([[1, '1 day'], [7, '1 week'], [30, '1 month (30 days)']] as const).map(([days, label]) => html`
                    <button class="btn btn-warning" name="days" value="${days}"
                            onclick="return confirm(${json_encode('Move the game ' + label + ' ahead?')})">Advance ${label}</button>`)}
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2">
                <label class="small" for="custom-days">Or</label>
                <input class="form-control form-control-sm w-auto" id="custom-days" type="number" min="1" max="${Board.MAX_ADVANCE}"
                       value="3" aria-label="Days">
                <button class="btn btn-sm btn-outline-warning" name="days" value="3"
                        onclick="this.value = document.getElementById('custom-days').value; return confirm('Move the game ' + this.value + ' days ahead?')">days ahead</button>
            </div>
        </form>
    </div>`,
    });
}
