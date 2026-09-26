// Upstream: game/src/Goods.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { array_chunk, array_fill, empty, int, intdiv, spaceship } from '../core/php';
import type { Row } from '../db/Db';
import { Clock } from './Clock';
import { Market } from './Market';
import { Wallets } from './Wallets';

/**
 * What feedToday did: eaten (keeper id => food from its store), bought (keeper id => meals bought), hungry (ids).
 * The maps are in the order the keepers were fed (by id).
 */
export type Meals = { eaten: Map<number, number>; bought: Map<number, number>; hungry: number[] };

/**
 * Goods an anthro has in store (game_goods): food (from foraging), lumber (from clearing land, used by building), and
 * whatever work makes (see Crafts). What an anthro's work makes goes to whoever it works for (see
 * Schedules::masterOf); what it needs comes from whoever keeps it (see keeperOf): its owner (a free anthro keeps
 * itself; an employer doesn't feed its employees).
 *
 * Every day each living anthro eats FOOD_PER_DAY from its keeper's store (see feedToday): any edible good (food,
 * bread, meat and the like: see edibles), the cheapest first. A keeper out of them buys meals from the market at food's
 * price there (see mealPrice), while its coins last; one that gets no meal goes hungry that day, and can only rest or
 * forage (see isHungry).
 */
export class Goods {
    static readonly FOOD_PER_DAY = 1;
    // What a new anthro starts with: a week's food.
    static readonly STARTING_FOOD = 7;

    /**
     * What a meal costs, bought when a keeper's store runs out (the coins leave the game): food's price at the market
     * (see Market), or null if the market doesn't sell food.
     */
    static mealPrice(): number | null {
        return Market.buyPrice('food');
    }

    // Today's meals, once feedToday has fed everyone in this request: {eaten: Map(keeper id => food from its store),
    // bought: Map(keeper id => meals bought), hungry: [ids]}.
    private static mealsToday: Meals | null = null; // (upstream: $meals)

    /**
     * What feedToday did in this request (see mealsToday), or null if it didn't feed anyone (they'd eaten today already).
     */
    static meals(): Meals | null {
        return Goods.mealsToday;
    }

    /**
     * How much of a good the anthro has in store.
     */
    static amount(anthroId: number, good = 'food'): number {
        return int(Auth.db().value('SELECT quantity FROM game_goods WHERE anthro_id = ? AND good = ?', [anthroId, good]));
    }

    /**
     * The goods that feed anthros (Market's edible ones), cheapest first (by what the market pays): [key, ...].
     */
    static edibles(): string[] {
        const edible = Object.entries(Market.goods()).filter(([, g]) => !empty(g.edible));
        edible.sort(([, a], [, b]) => spaceship(int(a.sell_price ?? 0), int(b.sell_price ?? 0)) || spaceship(int(a.sort_order), int(b.sort_order)));
        const keys = edible.map(([key]) => key);
        return keys.length ? keys : ['food'];
    }

    /**
     * How much the anthro has in store that anthros can eat (every edible good: see edibles).
     */
    static food(anthroId: number): number {
        const edibles = Goods.edibles();
        return int(Auth.db().value('SELECT COALESCE(SUM(quantity), 0) FROM game_goods WHERE anthro_id = ? AND good IN ('
            + array_fill(edibles.length, '?').join(', ') + ')', [anthroId, ...edibles]));
    }

    /**
     * Takes units of food from the anthro's store: the edible goods, cheapest first (see edibles). Returns how many it
     * took (fewer if it ran out).
     */
    static eat(anthroId: number, units: number): number {
        let eaten = 0;
        for (const good of Goods.edibles()) {
            if (eaten >= units) {
                break;
            }
            const take = Math.min(units - eaten, Goods.amount(anthroId, good));
            if (take > 0 && Goods.take(anthroId, good, take)) {
                eaten += take;
            }
        }
        return eaten;
    }

    static add(anthroId: number, good: string, quantity: number): void {
        Auth.db().run(
            'INSERT INTO game_goods (anthro_id, good, quantity) VALUES (?, ?, ?) ON CONFLICT (anthro_id, good) DO UPDATE SET quantity = quantity + excluded.quantity',
            [anthroId, good, quantity],
        );
    }

    /**
     * Takes goods from the anthro's store, if it has that many. Returns whether it did.
     */
    static take(anthroId: number, good: string, quantity: number): boolean {
        return Auth.db().run(
            'UPDATE game_goods SET quantity = quantity - ? WHERE anthro_id = ? AND good = ? AND quantity >= ?',
            [quantity, anthroId, good, quantity],
        ) > 0;
    }

    /**
     * Who keeps the anthro (feeds it and supplies what it needs): its owner, or itself if it's free. Null for the
     * game's anthros.
     */
    static keeperOf(anthro: Row): number | null {
        return anthro.owner_id === null ? null : int(anthro.owner_id);
    }

    /**
     * The anthros the keeper feeds, keeper first: itself (if it's free) and the anthros it owns. Living ones only, and
     * not those on the market (see onMarketSql: they're fed).
     */
    static household(keeperId: number): number[] {
        return Auth.db().column(
            'SELECT a.id FROM game_anthros a WHERE a.owner_id = ? AND a.died_at IS NULL AND NOT ' + Goods.onMarketSql('a') + ' ORDER BY a.id <> ?, a.id',
            [keeperId, keeperId],
        ).map(int);
    }

    /**
     * Whether the anthro went hungry today: then it can only rest or forage. Anthros on the market (the game's, with no
     * owner, or up for auction) are fed, and never hungry.
     */
    static isHungry(anthro: Row): boolean {
        const onMarket = anthro.owner_id === null || (anthro.auction_id ?? null) !== null;
        return !onMarket && (anthro.hungry_on ?? null) === Clock.today();
    }

    /**
     * SQL for "the anthro (game_anthros alias) is on the market": up for auction. (The game's own anthros, with no
     * owner, have no keeper, so they're never in a household.)
     */
    private static onMarketSql(alias: string): string {
        return `EXISTS (SELECT 1 FROM game_auctions au WHERE au.anthro_id = ${alias}.id AND au.status = 'open')`;
    }

    /**
     * Feeds every living anthro today, once a day (the game runs this on each request): each eats FOOD_PER_DAY of the
     * edible goods (see eat) in its keeper's store (see household), the keeper first and then the rest by who came first. When the store runs out
     * the keeper buys meals at the market (see mealPrice) while its coins last; whoever's left goes hungry. Returns how many went
     * hungry.
     */
    static feedToday(): number {
        const db = Auth.db();
        Goods.mealsToday = null;
        const claimed = db.run('INSERT OR IGNORE INTO game_daily (day, task) VALUES (' + Clock.sqlToday() + ", 'feed')");
        if (!claimed) {
            return 0;
        }
        Goods.mealsToday = { eaten: new Map(), bought: new Map(), hungry: [] };
        const households = new Map<number, number[]>();
        // Anthros on the market (up for auction, or the game's) are fed there.
        for (const row of db.all(
            'SELECT a.id, a.owner_id FROM game_anthros a WHERE a.died_at IS NULL AND a.owner_id IS NOT NULL AND NOT ' + Goods.onMarketSql('a')
            + ' ORDER BY a.owner_id, a.id <> a.owner_id, a.id',
        )) {
            const ownerId = int(row.owner_id);
            if (!households.has(ownerId)) households.set(ownerId, []);
            households.get(ownerId)!.push(int(row.id));
        }
        const hungry: number[] = [];
        for (const [keeperId, members] of households) {
            const fed = intdiv(Goods.eat(keeperId, members.length * Goods.FOOD_PER_DAY), Goods.FOOD_PER_DAY);
            Goods.mealsToday.eaten.set(keeperId, fed * Goods.FOOD_PER_DAY);
            // Out of food: buy meals at the market, while the coins last.
            const short = members.length - fed;
            const price = Goods.mealPrice();
            const bought = short && price ? Math.min(short, intdiv(Math.max(0, Wallets.balance(keeperId)), price)) : 0;
            if (bought) {
                Wallets.change(keeperId, -bought * price!, 'Bought ' + (bought === 1 ? 'a meal' : `${bought} meals`) + ' at the market');
                Goods.mealsToday.bought.set(keeperId, bought);
            }
            hungry.push(...members.slice(fed + bought));
        }
        Goods.mealsToday.hungry = hungry;
        for (const chunk of array_chunk(hungry, 500)) {
            db.run('UPDATE game_anthros SET hungry_on = ' + Clock.sqlToday() + ' WHERE id IN (' + array_fill(chunk.length, '?').join(', ') + ')', chunk);
        }
        return hungry.length;
    }

    static {
        onReset(() => {
            Goods.mealsToday = null;
        });
    }
}
