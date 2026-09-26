// Upstream: game/src/Crafts.php
import { Auth } from '../core/Auth';
import { onReset } from '../core/caches';
import { float, int, intdiv, is_numeric, mb_strlen, trim } from '../core/php';
import type { Db, Row } from '../db/Db';
import { Goods } from './Goods';
import { Land } from './Land';
import { Market } from './Market';
import { Wallets } from './Wallets';

/** PHP 8's strtolower(): ASCII letters only. */
function strtolower(s: string): string {
    return s.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

/** Goods by key, and how many of each (a unit's inputs or outputs, or what a day made). */
export type GoodsList = Record<string, number>;

/** A recipe (see Crafts.byOccupation). */
export type Recipe = {
    id: number;
    occupation_id: number;
    name: string;
    needs_acres: number | null;
    in: GoodsList;
    out: GoodsList;
};

/**
 * What work at an occupation makes (game_recipes, game_recipe_goods). An occupation is one of three kinds:
 *  - a producer's recipes use nothing up: a farmer grows a crop, a miner digs ore; some need land (a farmer needs
 *    FARM_ACRES of its master's land to farm);
 *  - a craftsman's recipes turn goods into goods: a brewer makes ale from grain and hops;
 *  - a service job has no recipe: it needs no materials and makes no goods, and is paid in coins (Schedules::PAY).
 * A day's work makes OUTPUT units of the recipe by the worker's level (a unit is the recipe's outputs, from its
 * inputs), fewer if the materials run short; its materials come from, and what it makes goes to, the worker's master
 * (see Schedules::masterOf). Producers and craftsmen earn nothing else: the goods are their pay, to keep or sell at the
 * market. An occupation with several recipes (a farmer's crops) works whichever its plan names, else its first.
 * Admins change the recipes (see save); a new game starts with SEED_RECIPES and the goods in SEED_GOODS.
 */
export class Crafts {
    // Units of its recipe a day's work makes, by the worker's level (see Schedules::LEVELS).
    static readonly OUTPUT: Record<string, number> = { Novice: 1, Apprentice: 2, Journeyman: 3, Master: 5 };
    // The land a farmer's master must hold to farm.
    static readonly FARM_ACRES = 10;
    static readonly MAX_NAME = 40;
    static readonly MAX_GOODS = 4;

    // The goods the recipes use, beyond food and lumber (see Market::SEED): {key: [name, buy price, sell price,
    // edible]}. Priced so a unit of work is worth about 3 coins at the sell price, and a craft adds about that to its
    // materials; edible goods feed anthros (see Goods).
    static readonly SEED_GOODS: Record<string, [string, number, number, boolean]> = {
        'grain': ['Grain', 2, 1, false], 'hops': ['Hops', 2, 1, false], 'flax': ['Flax', 2, 1, false],
        'vegetables': ['Vegetables', 3, 1, true], 'wool': ['Wool', 4, 2, false], 'meat': ['Meat', 5, 2, true],
        'tallow': ['Tallow', 2, 1, false], 'hides': ['Hides', 2, 1, false], 'fish': ['Fish', 3, 1, true],
        'herbs': ['Herbs', 2, 1, false], 'iron': ['Iron ore', 2, 1, false], 'stone': ['Stone', 2, 1, false],
        'clay': ['Clay', 2, 1, false], 'gold': ['Gold', 6, 3, false],
        'flour': ['Flour', 4, 2, false], 'bread': ['Bread', 4, 2, true], 'meals': ['Hot meals', 6, 3, true],
        'ale': ['Ale', 9, 5, false], 'furniture': ['Furniture', 14, 7, false], 'barrels': ['Barrels', 10, 5, false],
        'wheels': ['Wheels', 10, 5, false], 'arrows': ['Arrows', 2, 1, false], 'bows': ['Bows', 10, 5, false],
        'leather': ['Leather', 10, 5, false], 'shoes': ['Shoes', 16, 8, false], 'saddles': ['Saddles', 26, 13, false],
        'tools': ['Tools', 14, 7, false], 'armour': ['Armour', 12, 6, false], 'jewellery': ['Jewellery', 12, 6, false],
        'cloth': ['Cloth', 14, 7, false], 'rope': ['Rope', 10, 5, false], 'clothes': ['Clothes', 20, 10, false],
        'pottery': ['Pottery', 10, 5, false], 'dressed-stone': ['Dressed stone', 10, 5, false],
        'medicine': ['Medicine', 10, 5, false], 'candles': ['Candles', 4, 2, false],
        'paintings': ['Paintings', 22, 11, false], 'manuscripts': ['Illuminated manuscripts', 18, 9, false],
        'books': ['Books', 20, 10, false], 'engravings': ['Engravings', 10, 5, false],
        'sculptures': ['Sculptures', 12, 6, false], 'carvings': ['Carvings', 10, 5, false],
    };

    // Each producing or crafting occupation's recipes, by title: [[name, acres of land needed (or null), inputs {good:
    // per unit}, outputs {good: per unit}], ...]. Every other occupation is a service job.
    static readonly SEED_RECIPES: Record<string, [string, number | null, GoodsList, GoodsList][]> = {
        'Farmer': [
            ['Grain', Crafts.FARM_ACRES, {}, { grain: 3 }], ['Hops', Crafts.FARM_ACRES, {}, { hops: 3 }],
            ['Flax', Crafts.FARM_ACRES, {}, { flax: 3 }], ['Vegetables', Crafts.FARM_ACRES, {}, { vegetables: 3 }],
        ],
        'Shepherd': [['Wool', null, {}, { wool: 2 }]],
        'Swineherd': [['Pork', null, {}, { meat: 1, tallow: 1 }]],
        'Hunter': [['Game', null, {}, { meat: 1, hides: 1 }]],
        'Fisher': [['Fish', null, {}, { fish: 3 }]],
        'Herbalist': [['Herbs', null, {}, { herbs: 3 }]],
        'Miner': [
            ['Iron ore', null, {}, { iron: 3 }], ['Stone', null, {}, { stone: 3 }], ['Clay', null, {}, { clay: 3 }],
            ['Gold', null, {}, { gold: 1 }],
        ],
        'Miller': [['Flour', null, { grain: 3 }, { flour: 3 }]],
        'Baker': [['Bread', null, { flour: 2 }, { bread: 3 }]],
        'Chef': [['Hot meals', null, { meat: 1, vegetables: 1 }, { meals: 2 }]],
        'Brewer': [['Ale', null, { grain: 1, hops: 1 }, { ale: 1 }]],
        'Alewife': [['Ale', null, { grain: 1, hops: 1 }, { ale: 1 }]],
        'Carpenter': [['Furniture', null, { lumber: 2 }, { furniture: 1 }]],
        'Cooper': [['Barrels', null, { lumber: 1 }, { barrels: 1 }]],
        'Wheelwright': [['Wheels', null, { lumber: 1 }, { wheels: 1 }]],
        'Fletcher': [['Arrows', null, { lumber: 1 }, { arrows: 5 }]],
        'Bowyer': [['Bows', null, { lumber: 1 }, { bows: 1 }]],
        'Tanner': [['Leather', null, { hides: 2 }, { leather: 1 }]],
        'Cobbler': [['Shoes', null, { leather: 1 }, { shoes: 1 }]],
        'Saddler': [['Saddles', null, { leather: 2 }, { saddles: 1 }]],
        'Blacksmith': [['Tools', null, { iron: 2, lumber: 1 }, { tools: 1 }]],
        'Armourer': [['Armour', null, { iron: 3 }, { armour: 1 }]],
        'Goldsmith': [['Jewellery', null, { gold: 1 }, { jewellery: 1 }]],
        'Weaver': [['Woollen cloth', null, { wool: 2 }, { cloth: 1 }], ['Linen', null, { flax: 3 }, { cloth: 1 }]],
        'Rope maker': [['Rope', null, { flax: 2 }, { rope: 1 }]],
        'Tailor': [['Clothes', null, { cloth: 1 }, { clothes: 1 }]],
        'Seamstress': [['Clothes', null, { cloth: 1 }, { clothes: 1 }]],
        'Potter': [['Pottery', null, { clay: 2 }, { pottery: 1 }]],
        'Mason': [['Dressed stone', null, { stone: 2 }, { 'dressed-stone': 1 }]],
        'Apothecary': [['Medicine', null, { herbs: 2 }, { medicine: 1 }]],
        'Chandler': [['Candles', null, { tallow: 1 }, { candles: 2 }]],
        'Painter': [['Paintings', null, { cloth: 1, herbs: 1 }, { paintings: 1 }]],
        'Illuminator': [['Illuminated manuscripts', null, { leather: 1, herbs: 1 }, { manuscripts: 1 }]],
        'Printer': [['Books', null, { cloth: 1 }, { books: 1 }]],
        'Engraver': [['Engravings', null, { iron: 2 }, { engravings: 1 }]],
        'Sculptor': [['Sculptures', null, { stone: 3 }, { sculptures: 1 }]],
        'Stonecarver': [['Carvings', null, { stone: 2 }, { carvings: 1 }]],
    };

    // Recipes by occupation, loaded once per request (see byOccupation).
    private static recipes: Map<number, Recipe[]> | null = null;

    /**
     * Every recipe, by occupation: a Map of occupation id => [{id, name, needs_acres (number or null), in: {good: per
     * unit}, out: {good: per unit}}, ...], each occupation's in order. Occupations with none are service jobs.
     */
    static byOccupation(): Map<number, Recipe[]> {
        if (Crafts.recipes === null) {
            const db = Auth.db();
            const goods = new Map<number, { in?: GoodsList; out?: GoodsList }>();
            for (const row of db.all('SELECT recipe_id, good, quantity, role FROM game_recipe_goods ORDER BY good')) {
                const id = int(row.recipe_id);
                if (!goods.has(id)) goods.set(id, {});
                const roles = goods.get(id)! as Record<string, GoodsList>;
                (roles[row.role] ??= {})[row.good] = int(row.quantity);
            }
            Crafts.recipes = new Map();
            for (const row of db.all('SELECT * FROM game_recipes ORDER BY occupation_id, sort_order, id')) {
                const id = int(row.id);
                const occupationId = int(row.occupation_id);
                if (!Crafts.recipes.has(occupationId)) Crafts.recipes.set(occupationId, []);
                Crafts.recipes.get(occupationId)!.push({
                    id, occupation_id: occupationId, name: row.name,
                    needs_acres: row.needs_acres === null ? null : float(row.needs_acres),
                    in: goods.get(id)?.in ?? {}, out: goods.get(id)?.out ?? {},
                });
            }
        }
        return Crafts.recipes;
    }

    static forget(): void {
        Crafts.recipes = null;
    }

    /**
     * The occupation's recipes (see byOccupation); none for a service job.
     */
    static recipesOf(occupationId: number): Recipe[] {
        return Crafts.byOccupation().get(occupationId) ?? [];
    }

    /**
     * The recipe work at the occupation follows: the one planned (recipeId, if it's the occupation's), else its first.
     * Null for a service job.
     */
    static recipeFor(occupationId: number, recipeId: number | null): Recipe | null {
        const recipes = Crafts.recipesOf(occupationId);
        for (const recipe of recipes) {
            if (recipe.id === recipeId) {
                return recipe;
            }
        }
        return recipes[0] ?? null;
    }

    /**
     * What kind of occupation it is: 'service' (no recipe), 'producer' (makes goods from nothing) or 'craft'.
     */
    static kindOf(occupationId: number): string {
        const recipes = Crafts.recipesOf(occupationId);
        if (!recipes.length) {
            return 'service';
        }
        return recipes.some((r) => Object.keys(r.in).length > 0) ? 'craft' : 'producer';
    }

    /**
     * A recipe in words: "3 grain" (a producer's), or "1 grain, 1 hops → 1 ale", per unit.
     */
    static describe(recipe: Recipe): string {
        const list = (goods: GoodsList) => Object.entries(goods).map(([good, n]) => n + ' ' + Crafts.goodName(good)).join(', ');
        return (Object.keys(recipe.in).length ? list(recipe.in) + ' → ' : '') + list(recipe.out)
            + (recipe.needs_acres ? ' (on ' + Land.acres(recipe.needs_acres) + ' of land)' : '');
    }

    /**
     * A day's work at a producing or crafting occupation (see Schedules::carryOut, which has checked the skill is
     * learned): OUTPUT[level] units of the recipe, fewer if the master's store runs short of materials (an anthro that
     * keeps itself, buys, buys what it lacks at the market first, as far as its coins go). The materials come from the
     * master's store, and what's made goes to it; with no master (the game's own anthros) nothing is made. Returns
     * [what came of it, the goods made {good: quantity}] or, if nothing could be made, [why, null]: the day is rested.
     */
    static work(anthro: Row, plan: Row, recipe: Recipe, level: string, master: Row | null, buys = false): [string, GoodsList | null] {
        const title = plan.occupation_title;
        if (!master) {
            return [`Worked as ${title}, but had no one to work for.`, {}];
        }
        if (recipe.needs_acres !== null && Land.totalAcres(master.id) < recipe.needs_acres) {
            return [`Meant to work as ${title} (${recipe.name}), but ` + (master.id === anthro.id ? 'has' : `${master.name} has`)
                + ' too little land (it takes ' + Land.acres(recipe.needs_acres) + '): rested.', null];
        }
        let units = Crafts.OUTPUT[level] ?? 1;
        const bought: string[] = [];
        if (buys) {
            for (const [good, each] of Object.entries(recipe.in)) {
                const short = units * each - Goods.amount(master.id, good);
                const price = Market.buyPrice(good);
                const afford = short > 0 && price ? Math.min(short, intdiv(Math.max(0, Wallets.balance(master.id)), price)) : 0;
                if (afford > 0 && Wallets.change(master.id, -afford * price!, `Bought ${afford} ` + Crafts.goodName(good) + ' at the market')) {
                    Goods.add(master.id, good, afford);
                    bought.push(afford + ' ' + Crafts.goodName(good));
                }
            }
        }
        for (const [good, each] of Object.entries(recipe.in)) {
            units = Math.min(units, intdiv(Goods.amount(master.id, good), each));
        }
        if (units < 1) {
            const whose = master.id === anthro.id ? '' : ` in ${master.name}'s store`;
            return [`Meant to work as ${title} (${recipe.name}), but there was no ` + Object.keys(recipe.in).map((g) => Crafts.goodName(g)).join(' or ')
                + `${whose} to work with: rested.`, null];
        }
        const used: string[] = [];
        for (const [good, each] of Object.entries(recipe.in)) {
            Goods.take(master.id, good, units * each);
            used.push(units * each + ' ' + Crafts.goodName(good));
        }
        const made: GoodsList = {};
        for (const [good, each] of Object.entries(recipe.out)) {
            Goods.add(master.id, good, units * each);
            made[good] = units * each;
        }
        const text = Object.entries(made).map(([good, n]) => n + ' ' + Crafts.goodName(good)).join(', ');
        return [(bought.length ? 'Bought ' + bought.join(', ') + '. ' : '') + `Worked as ${title}, making ${text}`
            + (used.length ? ' from ' + used.join(', ') : '') + (master.id === anthro.id ? '' : ` for ${master.name}`) + '.', made];
    }

    /**
     * A good's name, in lower case for sentences ("iron ore").
     */
    static goodName(good: string): string {
        return strtolower(Market.names()[good] ?? good);
    }

    /**
     * Admin: saves a recipe (a new one for occupationId when id is null): its name, the land it needs (blank for
     * none), and its inputs and outputs as "2 flax, 1 hops" (goods by name or key). Returns an error message, or null.
     */
    static save(id: number | null, occupationId: number, name: string, acres: string, inputs: string, outputs: string): string | null {
        name = trim(name);
        acres = trim(acres);
        if (name === '' || mb_strlen(name) > Crafts.MAX_NAME) {
            return 'Name the recipe (up to ' + Crafts.MAX_NAME + ' characters).';
        }
        if (acres !== '' && (!is_numeric(acres) || float(acres) <= 0)) {
            return 'The land it needs is a number of acres, or blank for none.';
        }
        let [inGoods, error] = Crafts.parseGoods(inputs);
        if (error) {
            return `Inputs: ${error}`;
        }
        let outGoods: GoodsList | null;
        [outGoods, error] = Crafts.parseGoods(outputs);
        if (error) {
            return `Outputs: ${error}`;
        }
        if (!Object.keys(outGoods!).length) {
            return 'A recipe makes something: list its outputs.';
        }
        const db = Auth.db();
        if (!db.value('SELECT 1 FROM game_occupations WHERE id = ' + occupationId)) {
            return 'No such occupation.';
        }
        if (id === null) {
            db.run('INSERT INTO game_recipes (occupation_id, name, needs_acres, sort_order) VALUES (?, ?, ?, ?)',
                [occupationId, name, acres === '' ? null : float(acres), Crafts.recipesOf(occupationId).length * 10 + 10]);
            id = db.lastInsertId();
        } else {
            db.run('UPDATE game_recipes SET name = ?, needs_acres = ? WHERE id = ? AND occupation_id = ?',
                [name, acres === '' ? null : float(acres), id, occupationId]);
            db.run('DELETE FROM game_recipe_goods WHERE recipe_id = ?', [id]);
        }
        const add = 'INSERT INTO game_recipe_goods (recipe_id, good, quantity, role) VALUES (?, ?, ?, ?)';
        for (const [role, goods] of [['in', inGoods!], ['out', outGoods!]] as const) {
            for (const [good, quantity] of Object.entries(goods)) {
                db.run(add, [id, good, quantity, role]);
            }
        }
        Crafts.forget();
        return null;
    }

    /**
     * Admin: removes a recipe (plans that named it work the occupation's first, or become service work if none are left).
     */
    static delete(id: number): void {
        Auth.db().run('DELETE FROM game_recipes WHERE id = ?', [id]);
        Crafts.forget();
    }

    /**
     * "2 flax, 1 hops" as [{good: quantity}, null], or [null, error]. Goods by key or name; at most MAX_GOODS.
     */
    private static parseGoods(text: string): [GoodsList | null, string | null] {
        const byName: Record<string, string> = Object.create(null);
        for (const [key, name] of Object.entries(Market.names())) {
            byName[strtolower(name)] = key;
            byName[strtolower(key)] = key;
        }
        const goods: GoodsList = {};
        for (const part of text.split(',').map((p) => trim(p)).filter((p) => p.length > 0)) {
            const m = part.match(/^(\d+)\s+(.+)$/);
            if (!m || int(m[1]) < 1 || int(m[1]) > 100) {
                return [null, `"${part}" isn't a quantity (1 to 100) and a good.`];
            }
            const key = byName[strtolower(trim(m[2]))] ?? null;
            if (key === null) {
                return [null, `there's no good called "${m[2]}" (add it under Goods first).`];
            }
            goods[key] = (goods[key] ?? 0) + int(m[1]);
        }
        if (Object.keys(goods).length > Crafts.MAX_GOODS) {
            return [null, 'at most ' + Crafts.MAX_GOODS + ' goods.'];
        }
        return [goods, null];
    }

    /**
     * Seeds the goods and recipes a new game starts with (see Schema): the goods if they're missing, and the recipes
     * once, for whichever of SEED_RECIPES's occupations exist. (Here a new game's are in seed.sql; this brings a game
     * saved before recipes up to date: see migrations.ts.)
     */
    static seed(db: Db): void {
        let order = int(db.value('SELECT COALESCE(MAX(sort_order), 0) FROM game_market_goods'));
        const good = 'INSERT OR IGNORE INTO game_market_goods (good, name, buy_price, sell_price, sort_order, edible) VALUES (?, ?, ?, ?, ?, ?)';
        for (const [key, [name, buy, sell, edible]] of Object.entries(Crafts.SEED_GOODS)) {
            db.run(good, [key, name, buy, sell, order += 10, int(edible)]);
        }
        if (int(db.value('SELECT COUNT(*) FROM game_recipes'))) {
            return;
        }
        // (No ORDER BY upstream: MariaDB, like SQLite, reads the titles' unique index, so it's by title. Said here, so a
        // new game's recipe ids and a migrated one's agree whatever the query planner does.)
        const occupations = db.all('SELECT id, title FROM game_occupations ORDER BY title');
        const recipe = 'INSERT INTO game_recipes (occupation_id, name, needs_acres, sort_order) VALUES (?, ?, ?, ?)';
        const goods = 'INSERT INTO game_recipe_goods (recipe_id, good, quantity, role) VALUES (?, ?, ?, ?)';
        for (const occupation of occupations) {
            (Crafts.SEED_RECIPES[occupation.title] ?? []).forEach(([name, acres, inGoods, outGoods], i) => {
                db.run(recipe, [occupation.id, name, acres, (i + 1) * 10]);
                const id = db.lastInsertId();
                for (const [role, list] of [['in', inGoods], ['out', outGoods]] as const) {
                    for (const [key, quantity] of Object.entries(list)) {
                        db.run(goods, [id, key, quantity, role]);
                    }
                }
            });
        }
    }
}

onReset(() => {
    Crafts.forget();
});
