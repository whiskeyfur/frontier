// Upstream: game/views/finances-report.blade.php
import { html, type Html } from '../../core/html';
import { float, number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Fiefs } from '../Fiefs';
import { Finances } from '../Finances';
import { Market } from '../Market';
import gameLayout from './layouts/game';
import subnav from './subnav';

/** PHP's rtrim(rtrim(number_format(x, 1), '0'), '.'). */
function tenths(x: number): string {
    return number_format(x, 1).replace(/0+$/, '').replace(/\.+$/, '');
}

export default function financesReport(v: ViewContext, { player, report }: {
    player: Row | null; report: ReturnType<typeof Finances.report> | null;
}): Html {
    return gameLayout(v, {
        title: 'Finances report - Game',
        content: html`
    <h1 class="h3 mb-3">Report${player ? ': ' + player.name : ''}</h1>
    ${subnav(v, { section: '/game/wallet' })}
    ${!player || !report ? html`
        <p>Finances belong to anthros. <a href="/game/home">Create or become an anthro</a> first.</p>` : html`
        <p class="text-body-secondary">
            What ${player.name} can expect to earn and spend over the next ${report.days} days (${report.from} to
            ${report.to}), from what's planned now: work pays by today's skill levels, foraging brings its average, and plans can
            change. Goods are shown as they come and go; taxes value them at what the <a href="/game/market/goods">market</a> pays.
        </p>
        <div class="row g-3 mb-4">
            ${([['Balance now', report.balance], ['Expected income', report.income], ['Expected expenses', -report.expenses], ['Balance after', report.projected]] as [string, number][]).map(([label, amount]) => html`
                <div class="col-6 col-lg-3">
                    <div class="card card-body">
                        <div class="text-body-secondary small">${label}</div>
                        <div class="fs-4 ${amount < 0 ? 'text-danger' : ''}">${(amount < 0 ? '−' : '') + Fiefs.coins(Math.abs(float(amount)))}</div>
                    </div>
                </div>`)}
        </div>
        ${!report.lines.length ? html`
            <p>Nothing coming in or going out: no work, wages, food or taxes planned.</p>` : html`
            <div class="table-responsive">
                <table class="table table-striped align-middle">
                    <thead><tr><th>Source</th><th></th><th class="text-end">Coins</th><th>Goods</th></tr></thead>
                    <tbody>
                    ${report.lines.map((line) => {
                        const goods = Object.entries(line.goods);
                        return html`
                        <tr>
                            <td>${line.label}</td>
                            <td class="small text-body-secondary">${line.detail}</td>
                            <td class="text-end text-nowrap ${line.coins < 0 ? 'text-danger' : (line.coins > 0 ? 'text-success' : '')}">
                                ${line.coins ? (line.coins > 0 ? '+' : '−') + Fiefs.coins(Math.abs(float(line.coins))) : '—'}
                            </td>
                            <td class="small text-nowrap">
                                ${goods.map(([good, quantity], i) => quantity ? html`
                                        ${(quantity > 0 ? '+' : '−') + tenths(Math.abs(quantity))} ${(Market.names()[good] ?? good).toLowerCase()}${i === goods.length - 1 ? '' : ','}` : '')}
                            </td>
                        </tr>`;
                    })}
                    </tbody>
                </table>
            </div>
            <p class="small text-body-secondary">
                Food: ${number_format(report.food.store)} in store and about ${tenths(report.food.in)} coming in, for
                ${number_format(report.food.eaten)} eaten.
                ${report.food.bought ? html`
                    About ${report.food.bought} meals will have to be bought.` : ''}
                ${report.taxDay ? html`
                    Taxes are collected next on ${report.taxDay}.` : ''}
            </p>`}`}`,
    });
}
