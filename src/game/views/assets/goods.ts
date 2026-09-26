// Upstream: game/views/assets/goods.blade.php
import { html, type Html } from '../../../core/html';
import { intdiv, number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Goods } from '../../Goods';
import { Market } from '../../Market';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

/** goods: good => amount the player has; household: the anthros it feeds. */
export default function goods(v: ViewContext, { player, goods, household }: {
    player: Row | null; goods: Record<string, number>; household: number[];
}): Html {
    const eaten = household.length * Goods.FOOD_PER_DAY;
    const mealPrice = Goods.mealPrice();
    const edibles = Goods.edibles();
    const food = player && eaten ? Goods.food(player.id) : 0;
    return gameLayout(v, {
        title: 'Goods - Game',
        content: html`
    <h1 class="h3 mb-3">Goods</h1>
    ${subnav(v, { section: '/game/assets' })}
    ${!player ? html`
        <p><a href="/game/home">Create or become an anthro</a> first: goods belong to the anthro you play.</p>` : html`
        <p class="text-body-secondary">
            What ${player.name} has in store. What the anthros you own or employ make comes here too: foraging
            brings food, clearing land brings lumber for building, and work at an occupation brings its goods, using up
            the materials it needs from here (see their <a href="/game/assets/${player.id}/schedule">schedules</a>).
        </p>
        <table class="table w-auto">
            <tbody>
            ${Object.entries(Market.names()).map(([good, name]) =>
                // What's in store (and always food and lumber).
                !goods[good] && !['food', 'lumber'].includes(good) ? '' : html`
                <tr>
                    <th>${name}${edibles.includes(good) ? html` <span class="badge text-bg-success fw-normal">food</span>` : ''}</th>
                    <td class="text-end">${number_format(goods[good])}</td>
                </tr>`)}
            </tbody>
        </table>
        <p>
            Every day each anthro eats ${Goods.FOOD_PER_DAY} food (any good marked food, the cheapest first), and the anthros you own eat yours:
            ${household.length} ${household.length === 1 ? 'mouth' : 'mouths'} to feed, ${eaten} food a day.
            ${eaten ? html`
                That's ${intdiv(food, eaten)} ${intdiv(food, eaten) === 1 ? 'day' : 'days'} of food.` : ''}
            ${mealPrice ? html`
                When the food runs out, meals are bought at the <a href="/game/market/goods">market</a> for
                ${Wallets.format(mealPrice)} each while your coins last;` : html`
                The <a href="/game/market/goods">market</a> sells no food now, so when yours runs out there are no meals to buy;`} an anthro that goes without is hungry that day, and can only rest or forage.
        </p>`}`,
    });
}
