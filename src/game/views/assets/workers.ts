// Upstream: game/views/assets/workers.blade.php
import { html, type Html } from '../../../core/html';
import { array_sum, int, json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import subnav from '../subnav';
import gender from './gender';
import pregnantBadge from './pregnant-badge';

export default function workers(v: ViewContext, { employees }: { employees: Row[] }): Html {
    return gameLayout(v, {
        title: 'Workers - Game',
        content: html`
    <h1 class="h3 mb-3">Workers</h1>
    ${subnav(v, { section: '/game/assets' })}
    <p class="text-body-secondary">
        Free anthros you've hired. Their wages are paid from your wallet each day, and you can breed them. Hire more on
        the <a href="/game/market/jobs">job market</a>.
    </p>
    ${!employees.length ? html`
        <p>You haven't hired anyone.</p>` : html`
        <p class="text-body-secondary small mb-2">
            Wages due each day: ${Wallets.format(array_sum(employees.map((e) => int(e.employed_wage))))}.
        </p>
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr><th>Anthro</th><th>Species</th><th>Age</th><th class="text-end">Wage a day</th><th>Hired</th><th>Paid through</th><th data-nosort></th></tr>
                </thead>
                <tbody>
                ${employees.map((anthro) => html`
                    <tr>
                        <td>
                            <a href="/game/assets/${anthro.id}">${anthro.name}</a>
                            ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}
                            ${pregnantBadge(v, { anthro })}
                        </td>
                        <td>${anthro.species ?? '—'}</td>
                        <td class="text-nowrap" data-sort="${anthro.birthdate}">${Anthros.age(anthro.birthdate)}</td>
                        <td class="text-end" data-sort="${anthro.employed_wage}">${Wallets.format(int(anthro.employed_wage))}</td>
                        <td class="text-nowrap" data-sort="${anthro.employed_since}">${String(anthro.employed_since ?? '').substring(0, 10)}</td>
                        <td class="text-nowrap">${anthro.paid_until}</td>
                        <td class="text-end">
                            <form method="post" action="/game/market/jobs" class="d-inline-flex gap-2 m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="anthro_id" value="${anthro.id}">
                                <input type="hidden" name="back" value="/game/assets/workers">
                                <a class="btn btn-sm btn-outline-success" href="/game/assets/${anthro.id}/breed">Breed</a>
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
