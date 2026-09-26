// Upstream: tests/Game/MarketTest.php
import { describe, expect, test } from 'vitest';
import { Fiefs } from '../../src/game/Fiefs';
import { Goods } from '../../src/game/Goods';
import { Market } from '../../src/game/Market';
import { Wallets } from '../../src/game/Wallets';
import { coins, db, player, playerAnthro, setCoins } from '../TestCase';

describe('Market', () => {
    test('buying and selling', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        setCoins(me.id, 12);
        expect([Market.buyPrice('food'), Market.sellPrice('food')]).toEqual([5, 2]);
        expect(Market.buy(alice, 'food', 3)).toBe('3 food costs 15 coins, and you have 12 coins.');
        expect(Market.buy(alice, 'food', 2)).toBeNull();
        expect([coins(me.id), Goods.amount(me.id)], 'A week\'s food to start, and 2 more.').toEqual([2, 7 + 2]);
        expect(Market.sell(alice, 'food', 10)).toBe('You have only 9 food.');
        expect(Market.sell(alice, 'food', 9)).toBeNull();
        expect([coins(me.id), Goods.amount(me.id)]).toEqual([20, 0]);
        expect(Market.buy(alice, 'food', 0)).toBe('Trade 1 to 10,000 at a time.');
        expect(Market.buy(alice, 'gold', 1)).toBe('Choose a good.');
        expect(Market.buy(player('bobby'), 'food', 1)).toBe('Create or become an anthro first: goods belong to the anthro you play.');
    });

    test('admins set the goods and prices', () => {
        expect(Market.save(null, 'Ale', 'cheap', '', 0)).toBe('Prices are whole coins (at least 1), or empty for none.');
        expect(Market.save(null, 'Ale', '3', '4', 0)).toBe("It can't sell for more than it costs.");
        expect(Market.save(null, 'Fine ale', '6', '', 30)).toBeNull();
        expect({ good: 'fine-ale', buy_price: Market.buyPrice('fine-ale'), sell_price: Market.sellPrice('fine-ale') })
            .toEqual({ good: 'fine-ale', buy_price: 6, sell_price: null });
        expect(Market.save(null, 'Fine ale', '6', '', 30)).toBe("There's already a good called Fine ale.");
        expect(Market.names()['fine-ale']).toBe('Fine ale');

        const alice = player('alice');
        playerAnthro(alice);
        expect(Market.sell(alice, 'fine-ale', 1)).toBe("The market doesn't buy fine ale.");
        setCoins(Wallets.anthroFor(alice.id)!, 6);
        Market.buy(alice, 'fine-ale', 1);
        expect(Market.delete('fine-ale')).toBe("Anthros have Fine ale in store: it can't be removed (empty its prices to stop trading it).");
        expect(Market.delete('food')).toBe("Food is one of the game's own goods: it can't be removed (empty its prices to stop trading it).");
    });

    test('prices reach meals and taxes', () => {
        Market.save('food', 'Food', '8', '3', 10);
        expect(Goods.mealPrice()).toBe(8);
        expect([Fiefs.value('coins'), Fiefs.value('food'), Fiefs.value('lumber')]).toEqual([1, 3, 2]);

        // No food for sale: no meals to buy.
        Market.save('food', 'Food', '', '3', 10);
        expect(Goods.mealPrice()).toBeNull();
        const alice = player('alice');
        const me = playerAnthro(alice);
        setCoins(me.id, 50);
        db().run("UPDATE game_goods SET quantity = 0 WHERE good = 'food'");
        Goods.feedToday();
        expect(coins(me.id)).toBe(50);
        expect(Goods.meals()!.hungry).toContain(me.id);
    });
});
