// Upstream: game/views/admin/goods.blade.php
import { disabled, html, type Html } from '../../../core/html';
import { int, json_encode, number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Market } from '../../Market';
import gameLayout from '../layouts/game';

/** goods: Market.goods() (key => good); stock: good => how many anthros hold in store. */
export default function goods(v: ViewContext, { goods, stock, error }: { goods: Record<string, Row>; stock: Map<string, unknown>; error: string | null }): Html {
    const list = Object.values(goods);
    const orders = list.map((g) => g.sort_order);
    return gameLayout(v, {
        title: 'Goods - Game admin',
        content: html`
    <h1 class="h3 mb-1">Goods</h1>
    <p class="text-body-secondary">
        The goods the market trades. <strong>Buy</strong> is what a player pays the market for one, <strong>sell</strong>
        what the market pays for one; leave either empty and the market doesn't trade it that way. A good can't sell for
        more than it costs. Food's buy price is also what a meal costs when a store runs out, and sell prices value the goods
        a vassal's taxes are paid in. Food and lumber are the game's own and can't be removed; others can once nobody has
        any in store.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <ul class="list-group">
        ${[...list, null].map((good: Row | null) => html`
            <li class="list-group-item">
                <form method="post" action="/game/admin/goods" class="d-flex flex-wrap align-items-center gap-2 m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="good" value="${good?.good ?? ''}">
                    <input class="form-control form-control-sm w-auto" name="name" value="${good?.name ?? ''}" maxlength="${Market.MAX_NAME}"
                           placeholder="New good" required aria-label="Name">
                    <label class="small text-body-secondary">buy
                        <input class="form-control form-control-sm d-inline-block" style="width: 5.5rem" name="buy_price" type="number" min="1"
                               value="${good?.buy_price ?? ''}">
                    </label>
                    <label class="small text-body-secondary">sell
                        <input class="form-control form-control-sm d-inline-block" style="width: 5.5rem" name="sell_price" type="number" min="1"
                               value="${good?.sell_price ?? ''}">
                    </label>
                    <label class="small text-body-secondary">order
                        <input class="form-control form-control-sm d-inline-block" style="width: 5rem" name="sort_order" type="number"
                               value="${good?.sort_order ?? ((orders.length ? Math.max(...orders) : 0) + 10)}">
                    </label>
                    ${good ? html`
                        <button class="btn btn-sm btn-outline-primary" name="action" value="save">Save</button>
                        <button class="btn btn-sm btn-outline-danger" name="action" value="delete"
                                ${disabled(Object.hasOwn(Market.SEED, good.good) || int(stock.get(good.good) ?? 0) > 0)}
                                onclick="return confirm(${json_encode('Remove ' + good.name + '?')})">Remove</button>
                        <span class="small text-body-secondary">${number_format(int(stock.get(good.good) ?? 0))} in anthros' stores</span>` : html`
                        <button class="btn btn-sm btn-primary" name="action" value="save">Add</button>`}
                </form>
            </li>`)}
    </ul>`,
    });
}
