// Upstream: game/views/assets/index.blade.php
import { html, selected, type Html } from '../../../core/html';
import { gmdate, int, strtotimeOrThrow } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Auctions } from '../../Auctions';
import { Groups } from '../../Groups';
import { Litters } from '../../Litters';
import { Schedules, type PlanOptions } from '../../Schedules';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import timeLeft from '../market/time-left';
import subnav from '../subnav';
import anthroLink from './anthro-link';
import gender from './gender';
import planFields from './plan-fields';
import planScript from './plan-script';
import pregnantBadge from './pregnant-badge';

export default function index(v: ViewContext, { heading = null, anthros, listed, employees, planOptions, standards }: {
    heading?: string | null; anthros: Row[]; listed: Row[]; employees: Row[]; planOptions: PlanOptions; standards: Row[];
}): Html {
    const user = v.user!;
    // array_column($standards, 'name', 'id')
    const standardNames = new Map<number, string>(standards.map((s) => [s.id, s.name]));
    const times: Html[] = [];
    for (let n = 1; n <= Litters.MAX_CUBS; n++) {
        times.push(html`
                                <option value="${n}">${n}&times;</option>`);
    }
    const weekRows: Html[] = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
        weekRows.push(html`
                                    <div class="row g-2 align-items-center mb-2">
                                        <div class="col-3 small">${Anthros.weekday(weekday)}</div>
                                        <div class="col-9">
                                            ${planFields(v, { plan: { activity: 'rest' }, options: planOptions,
                                                names: [`week[${weekday}][activity]`, `week[${weekday}][detail]`] })}
                                        </div>
                                    </div>`);
    }
    return gameLayout(v, {
        title: (heading ?? 'Assets') + ' - Game',
        content: html`
    <h1 class="h3 mb-3">${heading ?? 'Assets'}</h1>
    ${subnav(v, { section: '/game/assets' })}
    <h2 class="h5">In house</h2>
    ${!anthros.length ? html`
        <p class="text-body-secondary">
            ${listed.length ? 'All your anthros are up for auction.' : "You don't have any anthros yet. Buy some on the market."}
        </p>` : html`
        <form method="post" action="/game/assets/group" id="group" data-select-group>
            <input type="hidden" name="back" value="${(heading ?? '') === 'Slaves' ? '/game/assets/slaves' : '/game/assets'}">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr>
                    <th data-nosort><input class="form-check-input" type="checkbox" id="select-all" data-select-all title="Select all" aria-label="Select all"></th>
                    <th>Name</th>
                    <th>Gender</th>
                    <th>Species</th>
                    <th>Born</th>
                    <th>Age</th>
                    <th>Sire</th>
                    <th>Dam</th>
                    <th>Status</th>
                    <th>Schedule</th>
                    <th data-nosort></th>
                </tr>
                </thead>
                <tbody>
                ${anthros.map((anthro) => html`
                    <tr>
                        <td><input class="form-check-input" type="checkbox" name="ids[]" value="${anthro.id}"
                                   aria-label="Select ${anthro.name}"></td>
                        <td>
                            <a href="/game/assets/${anthro.id}">${anthro.name}</a>
                            ${anthro.player_id === user.id ? html`
                                <span class="badge text-bg-secondary">you</span>` : ''}
                        </td>
                        <td>${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })} ${anthro.gender}</td>
                        <td>${anthro.species ?? '—'}</td>
                        <td>${anthro.birthdate ?? 'unknown'}</td>
                        <td class="text-nowrap">${Anthros.age(anthro.birthdate)}</td>
                        <td>${anthroLink(v, { id: anthro.sire_id, name: anthro.sire_name, ownerPlayerId: anthro.sire_owner_player_id, ownerName: anthro.sire_owner_name, playerId: anthro.sire_player_id })}</td>
                        <td>${anthroLink(v, { id: anthro.dam_id, name: anthro.dam_name, ownerPlayerId: anthro.dam_owner_player_id, ownerName: anthro.dam_owner_name, playerId: anthro.dam_player_id })}</td>
                        <td class="small">
                            ${anthro.pregnant_due_on != null ? html`
                                <span class="badge text-bg-info">pregnant</span> ${anthro.pregnant_cubs} due ${anthro.pregnant_due_on}` : Anthros.fertility(anthro) !== 'yes' ? html`
                                <span class="text-body-secondary">fertile: ${Anthros.fertility(anthro)}</span>` : html`
                                fertile`}
                        </td>
                        ${/* The standard schedule it follows (see Schedules), or its own routine. */ ''}
                        <td class="small">
                            ${anthro.standard_schedule_id != null && standardNames.has(int(anthro.standard_schedule_id)) ? html`
                                <a href="/game/assets/schedules/${anthro.standard_schedule_id}">${standardNames.get(int(anthro.standard_schedule_id))}</a>` : html`
                                <a class="text-body-secondary" href="/game/assets/${anthro.id}/schedule">own routine</a>`}
                        </td>
                        <td><a class="btn btn-sm btn-outline-success" href="/game/assets/${anthro.id}/breed">Breed</a></td>
                    </tr>`)}
                </tbody>
            </table>
        </div>
        <div class="card card-body">
            <h2 class="h6">With selected <span class="text-body-secondary small" id="selected-count" data-selected-count></span></h2>
            <div class="row g-4">
                <div class="col-lg-5">
                    <label class="form-label small" for="times">Breed</label>
                    <div class="d-flex gap-2">
                        <select class="form-select w-auto" id="times" name="times">
                            ${times}
                        </select>
                        <button class="btn btn-success" name="action" value="breed" formnovalidate>Breed</button>
                    </div>
                    <div class="form-text">
                        Each time, every selected anthro that can sire breeds with one random selected anthro that can be a dam. Pairs that aren't fertile, a dam already pregnant from another day, or one bred off her (secret) day of the week, give no litter; it's recorded in their history.
                    </div>
                </div>
                <div class="col-lg-7">
                    <span class="form-label small d-block">Sell at auction</span>
                    <div class="d-flex flex-wrap gap-2">
                        <input class="form-control w-auto" style="max-width: 9rem" name="starting_bid" type="number" min="1"
                               placeholder="Starting bid" aria-label="Starting bid">
                        <input class="form-control w-auto" style="max-width: 9rem" name="buy_now" type="number" min="1"
                               placeholder="Buy now (optional)" aria-label="Buy now (optional)">
                        <select class="form-select w-auto" name="days" aria-label="Runs for">
                            ${Auctions.DURATIONS.map((days) => html`
                                <option value="${days}" ${selected(days === 3)}>${days} ${days === 1 ? 'day' : 'days'}</option>`)}
                        </select>
                        <button class="btn btn-outline-primary" name="action" value="sell"
                                onclick="return confirm('Put the selected anthros up for auction?')">Sell</button>
                    </div>
                </div>
                <div class="col-12">
                    ${/* The same schedule for every selected anthro (each is checked on its own: see Schedules). */ ''}
                    <details>
                        <summary class="form-label small">Schedule</summary>
                        <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
                            <label class="small" for="group-standard">Have them follow</label>
                            <select class="form-select form-select-sm w-auto" id="group-standard" name="standard_id">
                                <option value="">their own routines</option>
                                ${standards.map((standard) => html`
                                    <option value="${standard.id}">${standard.name}</option>`)}
                            </select>
                            <button class="btn btn-outline-primary btn-sm" name="action" value="schedule_standard" formnovalidate>Follow</button>
                            <a class="small" href="/game/assets/schedules">Standard schedules</a>
                        </div>
                        <div class="row g-4 mt-1">
                            <div class="col-lg-7">
                                <span class="form-label small d-block">Set their weekly routine</span>
                                ${weekRows}
                                <button class="btn btn-outline-primary btn-sm" name="action" value="schedule_week" formnovalidate
                                        onclick="return confirm('Replace the weekly routine of every selected anthro? Any following a standard schedule stop.')">Set routine</button>
                            </div>
                            <div class="col-lg-5">
                                <span class="form-label small d-block">Plan a day</span>
                                <div class="d-flex flex-wrap gap-2 mb-2">
                                    <input class="form-control form-control-sm w-auto" type="date" name="plan_date" aria-label="Day"
                                           min="${gmdate('Y-m-d')}" max="${gmdate('Y-m-d', strtotimeOrThrow('+' + Schedules.PLAN_AHEAD_DAYS + ' days'))}">
                                    ${planFields(v, { plan: { activity: 'work' }, options: planOptions,
                                        names: ['plan_activity', 'plan_detail'] })}
                                </div>
                                <button class="btn btn-outline-primary btn-sm" name="action" value="schedule_day" formnovalidate>Plan the day</button>
                                <div class="form-text">That day, this replaces their routine.</div>
                            </div>
                        </div>
                    </details>
                </div>
                <div class="col-12">
                    <label class="form-label small" for="group_name">Form a breeding group</label>
                    <div class="d-flex flex-wrap gap-2">
                        <input class="form-control w-auto" id="group_name" name="group_name" maxlength="${Groups.MAX_NAME}" placeholder="Group name">
                        <button class="btn btn-outline-success" name="action" value="group">Form group</button>
                    </div>
                    <div class="form-text">
                        Its members breed each other on their own now and then: a dam who goes looking for a mate turns to her
                        groups first. Manage groups under <a href="/game/groups">Breeding groups</a>.
                    </div>
                </div>
            </div>
        </div>
        </form>`}

    ${listed.length ? html`
        <h2 class="h5 mt-4">Up for auction</h2>
        <form method="post" action="/game/assets/group" data-select-group>
        <input type="hidden" name="csrf" value="${v.csrf}">
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr>
                    <th data-nosort><input class="form-check-input" type="checkbox" data-select-all title="Select all" aria-label="Select all up for auction"></th>
                    <th>Name</th><th>Gender</th><th>Species</th><th>Age</th>
                    <th class="text-end">Current bid</th><th class="text-end">Buy now</th><th>Ends in</th>
                </tr>
                </thead>
                <tbody>
                ${listed.map((anthro) => {
                    const auction: Row = anthro.auction;
                    return html`
                    <tr>
                        <td><input class="form-check-input" type="checkbox" name="ids[]" value="${anthro.id}"
                                   aria-label="Select ${anthro.name}"></td>
                        <td>
                            <a href="/game/assets/${anthro.id}">${anthro.name}</a>
                            ${pregnantBadge(v, { anthro })}
                        </td>
                        <td>${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })} ${anthro.gender}</td>
                        <td>${anthro.species ?? '—'}</td>
                        <td class="text-nowrap">${Anthros.age(anthro.birthdate)}</td>
                        <td class="text-end" data-sort="${auction.current_bid ?? ''}">
                            ${auction.current_bid !== null ? html`
                                ${Wallets.format(int(auction.current_bid))}
                                <span class="text-body-secondary small">(${auction.bid_count})</span>` : html`
                                <span class="text-body-secondary">no bids (from ${Wallets.format(int(auction.starting_bid))})</span>`}
                        </td>
                        <td class="text-end">${auction.buy_now !== null ? Wallets.format(int(auction.buy_now)) : '—'}</td>
                        <td data-sort="${auction.ends_at}">
                            <a href="/game/market/auctions/${auction.id}">${timeLeft(v, { endsAt: auction.ends_at })}</a>
                        </td>
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>
        <div class="card card-body">
            <h2 class="h6">With selected <span class="text-body-secondary small" data-selected-count></span></h2>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-danger" name="action" value="cancel_auction"
                        onclick="return confirm('Cancel the selected auctions? Auctions with bids can\\'t be cancelled and will be skipped.')">
                    Cancel auction
                </button>
                <button class="btn btn-outline-warning" name="action" value="close_auction"
                        onclick="return confirm('Close the selected auctions now? Each sells to its highest bidder, or comes back if nobody has bid.')">
                    Close now
                </button>
            </div>
            <div class="form-text">
                Cancelling only works before anyone bids. Closing now sells to the highest bidder, or brings the anthro back if there are no bids.
            </div>
        </div>
        </form>` : ''}

    ${employees.length ? html`
        <h2 class="h5 mt-4">Employees</h2>
        <p class="text-body-secondary small">
            Free anthros you've hired; you can breed them. Manage them on the <a href="/game/market/jobs">job market</a>.
        </p>
        <ul class="list-group">
            ${employees.map((anthro) => html`
                <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span>
                        <a href="/game/assets/${anthro.id}">${anthro.name}</a>
                        ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}
                        ${pregnantBadge(v, { anthro })}
                        <span class="text-body-secondary small">${anthro.species ?? ''} &middot; ${Wallets.format(int(anthro.employed_wage))} a day</span>
                    </span>
                    <a class="btn btn-sm btn-outline-success" href="/game/assets/${anthro.id}/breed">Breed</a>
                </li>`)}
        </ul>` : ''}
    ${planScript(v)}`,
    });
}
