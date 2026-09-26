// Upstream: game/views/admin/supply.blade.php
import { html, selected, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { int, range } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import { Auctions } from '../../Auctions';
import { Jobs } from '../../Jobs';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';

/** skills: Schedules.skills() (id => name); post: the form sent ($_POST). */
export default function supply(v: ViewContext, { error, skills, post }: { error: string | null; skills: Map<number, string>; post: InputArray }): Html {
    return gameLayout(v, {
        title: 'Supply anthros - Game admin',
        content: html`
    <div class="mx-auto" style="max-width: 36rem">
        <h1 class="h3 mb-1">Supply anthros</h1>
        <p class="text-body-secondary">
            Creates random, fertile anthros (random species, gender and name, grown) and puts them up for
            auction by the game. Coins paid for them leave the game; unsold ones go free (and look for work).
        </p>
        ${error ? html`
            <div class="alert alert-danger">${error}</div>` : ''}
        <form method="post" action="/game/admin/supply" class="card card-body">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <div class="row g-2 mb-3">
                <div class="col-sm-6">
                    <label class="form-label" for="count">How many</label>
                    <input class="form-control" id="count" name="count" type="number" min="1" max="50" value="${post.count ?? 5}" required>
                </div>
                <div class="col-sm-6">
                    <label class="form-label" for="days">Auction length</label>
                    <select class="form-select" id="days" name="days">
                        ${Auctions.DURATIONS.map((days) => html`
                            <option value="${days}" ${selected(int(post.days ?? 3) === days)}>${days} ${days === 1 ? 'day' : 'days'}</option>`)}
                    </select>
                </div>
                <div class="col-sm-6">
                    <label class="form-label" for="starting_bid">Starting bid</label>
                    <input class="form-control" id="starting_bid" name="starting_bid" type="number" min="1" value="${post.starting_bid ?? 100}" required>
                </div>
                <div class="col-sm-6">
                    <label class="form-label" for="buy_now">Buy now <span class="text-body-secondary small">(optional)</span></label>
                    <input class="form-control" id="buy_now" name="buy_now" type="number" min="1" value="${post.buy_now ?? ''}">
                </div>
            </div>
            <button class="btn btn-warning">Put up for auction</button>
        </form>

        <h2 class="h4 mt-5 mb-1">Supply workers</h2>
        <p class="text-body-secondary">
            Creates free, grown anthros looking for work on the <a href="/game/market/jobs">job market</a>, each practised
            at a trade (Novice to Journeyman), asking what their trade pays at their level, or a wage you choose.
        </p>
        <form method="post" action="/game/admin/supply" class="card card-body">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <input type="hidden" name="action" value="workers">
            <div class="row g-2 mb-3">
                <div class="col-sm-6">
                    <label class="form-label" for="worker-count">How many</label>
                    <input class="form-control" id="worker-count" name="count" type="number" min="1" max="${Jobs.MAX_SUPPLY}" value="5" required>
                </div>
                <div class="col-sm-6">
                    <label class="form-label" for="worker-skill">Trade</label>
                    <select class="form-select" id="worker-skill" name="skill_id">
                        <option value="random">By their trade</option>
                        ${[...skills].map(([skillId, skillName]) => html`
                            <option value="${skillId}">${skillName}</option>`)}
                    </select>
                </div>
                <div class="col-sm-6">
                    <label class="form-label" for="worker-wage">Wage a day</label>
                    <select class="form-select" id="worker-wage" name="wage">
                        <option value="random">By their trade</option>
                        ${(Jobs.WAGE_MAX >= Jobs.WAGE_MIN ? range(Jobs.WAGE_MIN, Jobs.WAGE_MAX) : []).map((wage) => html`
                            <option value="${wage}">${Wallets.format(wage)}</option>`)}
                    </select>
                </div>
            </div>
            <button class="btn btn-warning">Put on the job market</button>
        </form>
    </div>`,
    });
}
