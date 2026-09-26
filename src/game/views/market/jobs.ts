// Upstream: game/views/market/jobs.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { array_sum, int, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Jobs } from '../../Jobs';
import { Schedules } from '../../Schedules';
import { Wallets } from '../../Wallets';
import gender from '../assets/gender';
import pregnantBadge from '../assets/pregnant-badge';
import gameLayout from '../layouts/game';
import listSearch from '../list-search';
import subnav from '../subnav';

export default function jobs(v: ViewContext, { seekers, seekersTotal, q, employees, balance }: {
    seekers: Row[]; seekersTotal: number; q: string; employees: Row[]; balance: number | null;
}): Html {
    return gameLayout(v, {
        title: 'Jobs - Game',
        content: html`
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 class="h3 mb-0">Market</h1>
        <a class="btn btn-outline-secondary btn-sm" href="/game/wallet">Wallet: ${balance === null ? 'none yet' : Wallets.format(balance)}</a>
    </div>
    ${subnav(v, { section: '/game/market' })}
    <p class="text-body-secondary">
        Free anthros can't be bought, but they can be hired. Wages (${Jobs.WAGE_MIN} to ${Jobs.WAGE_MAX}
        coins a day) are paid a day at a time from your wallet, the first day when you hire; if you can't pay, the job
        ends. What your workers make (their pay for a trade, food they forage, land they clear) is yours; they feed
        themselves. You may breed a worker only if it was hired on those terms (such workers ask a coin more).
    </p>

    <h2 class="h5">Looking for work</h2>
    ${listSearch(v, { action: '/game/market/jobs', q, shown: seekers.length, total: seekersTotal })}
    ${!seekers.length ? html`
        <p>${q !== '' ? 'No one by that name.' : 'No one is looking for work right now.'}</p>` : html`
        <form method="post" action="/game/market/jobs" data-select-group>
            <input type="hidden" name="csrf" value="${v.csrf}">
            <input type="hidden" name="action" value="hire">
            <div class="table-responsive">
                <table data-sortable class="table table-striped align-middle">
                    <thead>
                    <tr>
                        <th data-nosort><input class="form-check-input" type="checkbox" data-select-all title="Select all" aria-label="Select all anthros"></th>
                        <th>Anthro</th><th>Trade</th><th>May be bred</th><th>Species</th><th>Age</th><th>Fertile</th>
                        <th class="text-end">Wage a day</th><th data-nosort></th>
                    </tr>
                    </thead>
                    <tbody>
                    ${seekers.map((anthro) => {
                        const trade = Schedules.skillsOf(anthro.id)[0] ?? null;
                        const offered = Jobs.offered(anthro);
                        return html`
                        <tr>
                            <td>
                                <input class="form-check-input" type="checkbox" name="ids[]" value="${anthro.id}" aria-label="Select ${anthro.name}">
                            </td>
                            <td>
                                ${anthro.name}
                                ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}
                                ${pregnantBadge(v, { anthro })}
                            </td>
                            <td data-sort="${offered?.practice ?? trade?.practice ?? 0}">
                                ${offered ? html`
                                    ${offered.title} <span class="text-body-secondary small">(${offered.skill}: ${offered.level})</span>`
                                : trade ? html`
                                    ${trade.name} <span class="text-body-secondary small">(${trade.level}${trade.titles ? ': ' + trade.titles : ''})</span>` : html`
                                    <span class="text-body-secondary">&mdash;</span>`}
                            </td>
                            <td>${anthro.hire_breedable ? 'Yes' : 'No'}</td>
                            <td>${anthro.species ?? '—'}</td>
                            <td class="text-nowrap" data-sort="${anthro.birthdate}" title="Born ${anthro.birthdate ?? 'unknown'}">${Anthros.age(anthro.birthdate)}</td>
                            <td class="text-nowrap" data-sort="${anthro.fertile_on}">
                                ${Anthros.fertility(anthro)}
                            </td>
                            <td class="text-end" data-sort="${anthro.wage}">${Wallets.format(int(anthro.wage))}</td>
                            <td class="text-end">
                                <button class="btn btn-sm btn-success" name="only" value="${anthro.id}" ${disabled(balance === null)}>Hire</button>
                            </td>
                        </tr>`;
                    })}
                    </tbody>
                </table>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2">
                <button class="btn btn-primary" ${disabled(balance === null)}>Hire selected <span class="small" data-selected-count></span></button>
                <span class="form-text m-0">
                    ${balance === null ? html`
                        You need to <a href="/game/home">create or become an anthro</a> first: wages come from its wallet.` : html`
                        Each hire pays the first day's wage now. You have ${Wallets.format(balance)}.`}
                </span>
            </div>
        </form>`}

    <h2 class="h5 mt-4">Your employees</h2>
    ${!employees.length ? html`
        <p class="text-body-secondary">You haven't hired anyone.</p>` : html`
        <p class="text-body-secondary small mb-2">
            Wages due each day: ${Wallets.format(array_sum(employees.map((e) => int(e.employed_wage))))}.
        </p>
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr><th>Anthro</th><th class="text-end">Wage a day</th><th>May be bred</th><th>Hired</th><th>Paid through</th><th data-nosort></th></tr>
                </thead>
                <tbody>
                ${employees.map((anthro) => html`
                    <tr>
                        <td>
                            <a href="/game/assets/${anthro.id}">${anthro.name}</a>
                            ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}
                        </td>
                        <td class="text-end" data-sort="${anthro.employed_wage}">${Wallets.format(int(anthro.employed_wage))}</td>
                        <td>${anthro.hire_breedable ? 'Yes' : 'No'}</td>
                        <td class="text-nowrap" data-sort="${anthro.employed_since}">${String(anthro.employed_since ?? '').substring(0, 10)}</td>
                        <td class="text-nowrap">${anthro.paid_until}</td>
                        <td class="text-end">
                            <form method="post" action="/game/market/jobs" class="d-inline-flex gap-2 m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="anthro_id" value="${anthro.id}">
                                ${anthro.hire_breedable ? html`
                                    <a class="btn btn-sm btn-outline-success" href="/game/assets/${anthro.id}/breed">Breed</a>` : ''}
                                <button class="btn btn-sm btn-outline-danger" name="action" value="dismiss"
                                        onclick="return confirm(${json_encode('Let ' + anthro.name + ' go? Wages already paid are not returned.')})">
                                    Let go
                                </button>
                            </form>
                        </td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`}`,
    });
}
