// Upstream: game/src/Market.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { ctype_digit, int, mb_strlen, number_format, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Goods } from './Goods';
import { Wallets } from './Wallets';

/** PHP 8's strtolower(): ASCII letters only. */
function strtolower(s: string): string {
    return s.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

/**
 * The goods market: goods bought from and sold to the game at set prices (game_market_goods), which admins manage.
 * Each good has a buy price (what a player pays the market for one) and a sell price (what the market pays for one);
 * either can be empty, and the market doesn't trade it that way. A good sells for no more than it costs, so nobody
 * profits from buying and selling straight back.
 *
 * Prices reach the rest of the game: meals are bought at food's buy price when a keeper's store runs out (see Goods),
 * and a vassal's taxes value what its household makes at the sell prices (see Fiefs). Goods are kept in each anthro's
 * store (game_goods); food and lumber are always goods, as the game uses them.
 */
export class Market {
    static readonly MAX_NAME = 40;
    static readonly MAX_QUANTITY = 10000;
    // The goods the game starts with: {key: [name, buy price, sell price]}.
    static readonly SEED: Record<string, [string, number, number]> = { food: ['Food', 5, 2], lumber: ['Lumber', 5, 2] };

    // game_market_goods by key, loaded once per request (see goods()).
    private static goodsByKey: Record<string, Row> | null = null; // (upstream: $goods)

    /**
     * Every good, in order: {key: {good, name, buy_price, sell_price (null: not traded that way), sort_order}}.
     * (Keys are strings made from names, so an object keeps their order.)
     */
    static goods(): Record<string, Row> {
        if (Market.goodsByKey === null) {
            Market.goodsByKey = Object.create(null) as Record<string, Row>; // (no prototype: keys come from forms)
            for (const row of Auth.db().all('SELECT * FROM game_market_goods ORDER BY sort_order, name')) {
                Market.goodsByKey[row.good] = row;
            }
        }
        return Market.goodsByKey;
    }

    static forget(): void {
        Market.goodsByKey = null;
    }

    /**
     * The goods' names: {key: name}, the game's own goods included.
     */
    static names(): Record<string, string> {
        const names = Object.create(null) as Record<string, string>;
        for (const row of Object.values(Market.goods())) {
            names[row.good] = row.name;
        }
        for (const [key, seed] of Object.entries(Market.SEED)) {
            if (!(key in names)) names[key] = seed[0];
        }
        return names;
    }

    /**
     * What one of the good costs at the market, or null if the market doesn't sell it.
     */
    static buyPrice(good: string): number | null {
        const price = Market.goods()[good]?.buy_price ?? null;
        return price === null ? null : int(price);
    }

    /**
     * What the market pays for one of the good, or null if it doesn't buy it.
     */
    static sellPrice(good: string): number | null {
        const price = Market.goods()[good]?.sell_price ?? null;
        return price === null ? null : int(price);
    }

    /**
     * The anthro the user plays buys goods from the market, paying from its wallet. Returns an error message, or null.
     */
    static buy(user: Row, good: string, quantity: number): string | null {
        let [anthro, error] = Market.trader(user, good, quantity);
        const price = Market.buyPrice(good);
        if ((error ??= price === null ? "The market doesn't sell " + strtolower(Market.names()[good]) + '.' : null)) {
            return error;
        }
        const cost = price! * quantity;
        const what = `${quantity} ` + strtolower(Market.names()[good]);
        if (!Wallets.change(anthro!.id, -cost, `Bought ${what} at the market`, null, user.id)) {
            return `${what} costs ` + Wallets.format(cost) + ', and you have ' + Wallets.format(Wallets.balance(anthro!.id)) + '.';
        }
        Goods.add(anthro!.id, good, quantity);
        return null;
    }

    /**
     * The anthro the user plays sells goods from its store to the market. Returns an error message, or null.
     */
    static sell(user: Row, good: string, quantity: number): string | null {
        let [anthro, error] = Market.trader(user, good, quantity);
        const price = Market.sellPrice(good);
        if ((error ??= price === null ? "The market doesn't buy " + strtolower(Market.names()[good]) + '.' : null)) {
            return error;
        }
        const what = `${quantity} ` + strtolower(Market.names()[good]);
        if (!Goods.take(anthro!.id, good, quantity)) {
            return 'You have only ' + Goods.amount(anthro!.id, good) + ' ' + strtolower(Market.names()[good]) + '.';
        }
        Wallets.change(anthro!.id, price! * quantity, `Sold ${what} at the market`, null, user.id);
        return null;
    }

    /**
     * Admin: adds a good (key null: its key is made from its name) or changes one. Empty prices mean the market
     * doesn't trade it that way. Returns an error message, or null.
     */
    static save(key: string | null, name: string, buy: string, sell: string, order: number): string | null {
        name = trim(name);
        const prices: { buy?: number | null; sell?: number | null } = {};
        for (const [which, raw] of [['buy', buy], ['sell', sell]] as const) {
            const price = trim(raw);
            if (price !== '' && (!ctype_digit(price) || int(price) < 1)) {
                return 'Prices are whole coins (at least 1), or empty for none.';
            }
            prices[which] = price === '' ? null : int(price);
        }
        if (name === '' || mb_strlen(name) > Market.MAX_NAME) {
            return 'Name it (up to ' + Market.MAX_NAME + ' characters).';
        }
        if (prices.buy !== null && prices.sell !== null && prices.sell! > prices.buy!) {
            return 'It can\'t sell for more than it costs.';
        }
        const db = Auth.db();
        if (key === null) {
            key = strtolower(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (key === '' || Market.goods()[key] !== undefined) {
                return `There's already a good called ${name}.`;
            }
            db.run('INSERT INTO game_market_goods (good, name, buy_price, sell_price, sort_order) VALUES (?, ?, ?, ?, ?)',
                [key.slice(0, 20), name, prices.buy, prices.sell, order]);
        } else if (Market.goods()[key] === undefined) {
            return 'No such good.';
        } else {
            db.run('UPDATE game_market_goods SET name = ?, buy_price = ?, sell_price = ?, sort_order = ? WHERE good = ?',
                [name, prices.buy, prices.sell, order, key]);
        }
        Market.forget();
        return null;
    }

    /**
     * Admin: removes a good nobody has in store (the game's own can't be removed). Returns an error message, or null.
     */
    static delete(key: string): string | null {
        const good = Market.goods()[key] ?? null;
        if (!good) {
            return 'No such good.';
        }
        if (Object.hasOwn(Market.SEED, key)) {
            return `${good.name} is one of the game's own goods: it can't be removed (empty its prices to stop trading it).`;
        }
        if (int(Auth.db().value('SELECT COALESCE(SUM(quantity), 0) FROM game_goods WHERE good = ?', [key])) > 0) {
            return `Anthros have ${good.name} in store: it can't be removed (empty its prices to stop trading it).`;
        }
        Auth.db().run('DELETE FROM game_goods WHERE good = ?', [key]);
        Auth.db().run('DELETE FROM game_market_goods WHERE good = ?', [key]);
        Market.forget();
        return null;
    }

    /**
     * [the anthro the user plays, null] if it can trade that many of the good, or [null|anthro, error message].
     */
    private static trader(user: Row, good: string, quantity: number): [Row | null, string | null] {
        const anthro = Anthros.player(user.id);
        let error: string | null;
        switch (true) {
            case !anthro:
                error = 'Create or become an anthro first: goods belong to the anthro you play.';
                break;
            case Market.goods()[good] === undefined:
                error = 'Choose a good.';
                break;
            case quantity < 1 || quantity > Market.MAX_QUANTITY:
                error = 'Trade 1 to ' + number_format(Market.MAX_QUANTITY) + ' at a time.';
                break;
            default:
                error = null;
        }
        return [anthro, error];
    }
}

onReset(() => {
    Market.forget();
});
