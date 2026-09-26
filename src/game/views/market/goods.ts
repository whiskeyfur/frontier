// Upstream: game/views/market/goods.blade.php
import { html, type Html } from '../../../core/html';
import { int, number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Goods } from '../../Goods';
import { Market } from '../../Market';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

export default function goods(v: ViewContext, { player, error, balance, goods }: {
    player: Row | null; error: string | null; balance: number | null; goods: Record<string, Row>;
}): Html {
    const edibles = Goods.edibles();
    return gameLayout(v, {
        title: 'Goods - Game',
        content: html`
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 class="h3 mb-0">Market</h1>
        <a class="btn btn-outline-secondary btn-sm" href="/game/wallet">Wallet: ${balance === null ? 'none yet' : Wallets.format(balance)}</a>
    </div>
    ${subnav(v, { section: '/game/market' })}
    <p class="text-body-secondary">
        Goods bought from, and sold to, the market at its prices: the price to buy one, and what the market pays for one.
        They go into, or come out of, ${player ? player.name + "'s" : 'your anthro\'s'} store (see
        <a href="/game/assets/goods">Goods</a>). When your food runs out, meals are bought here too.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${!player ? html`
        <p><a href="/game/home">Create or become an anthro</a> first: goods belong to the anthro you play.</p>`
    : !Object.keys(goods).length ? html`
        <p>The market has nothing to trade yet.</p>` : html`
        <form method="post" action="/game/market/goods">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <div class="table-responsive">
                ${/* Sortable, with a filter under each heading (see js/tables.js). */ ''}
                <table data-sortable class="table table-striped align-middle w-auto">
                    <thead>
                    <tr><th>Good</th><th>Food</th><th class="text-end">You have</th><th class="text-end">Buy for</th><th class="text-end">Sell for</th><th data-nosort>How many</th><th data-nosort></th></tr>
                    </thead>
                    <tbody>
                    ${Object.values(goods).map((good) => {
                        const have = Goods.amount(player.id, good.good);
                        return html`
                        <tr>
                            <td>${good.name}</td>
                            <td>${edibles.includes(good.good) ? 'food' : ''}</td>
                            <td class="text-end" data-sort="${have}">${number_format(have)}</td>
                            <td class="text-end" data-sort="${good.buy_price ?? ''}">${good.buy_price !== null ? Wallets.format(int(good.buy_price)) : '—'}</td>
                            <td class="text-end" data-sort="${good.sell_price ?? ''}">${good.sell_price !== null ? Wallets.format(int(good.sell_price)) : '—'}</td>
                            <td>
                                <input class="form-control form-control-sm" style="width: 6rem" name="quantity[${good.good}]" type="number" min="1"
                                       max="${Market.MAX_QUANTITY}" value="1" aria-label="How many ${String(good.name).toLowerCase()}">
                            </td>
                            <td class="text-nowrap">
                                ${/* Each button says what to do and with which good; the quantity is that row's. */ ''}
                                ${good.buy_price !== null ? html`
                                    <button class="btn btn-sm btn-outline-primary" name="trade" value="buy:${good.good}">Buy</button>` : ''}
                                ${good.sell_price !== null ? html`
                                    <button class="btn btn-sm btn-outline-secondary" name="trade" value="sell:${good.good}">Sell</button>` : ''}
                            </td>
                        </tr>`;
                    })}
                    </tbody>
                </table>
            </div>
        </form>`}`,
    });
}
