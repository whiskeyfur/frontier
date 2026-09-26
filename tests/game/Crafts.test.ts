// Upstream: tests/Game/CraftsTest.php
import { describe, expect, test } from 'vitest';
import type { User } from '../../src/core/Auth';
import { gmdate } from '../../src/core/php';
import type { Row } from '../../src/db/Db';
import { Crafts } from '../../src/game/Crafts';
import { Goods } from '../../src/game/Goods';
import { Market } from '../../src/game/Market';
import { Schedules } from '../../src/game/Schedules';
import { anthro, coins, db, player, playerAnthro, refresh, scalar, setCoins } from '../TestCase';

/**
 * Work that makes goods (see Crafts): producers from nothing (a farmer from land), craftsmen from materials, service jobs
 * for coins; and every edible good feeding anthros.
 */
describe('Crafts', () => {
    const occupation = (title: string): number =>
        Number(scalar('SELECT id FROM game_occupations WHERE title = ? ORDER BY id LIMIT 1', [title]));

    const recipe = (title: string, name: string): number =>
        Number(scalar('SELECT r.id FROM game_recipes r JOIN game_occupations o ON o.id = r.occupation_id WHERE o.title = ? AND r.name = ?', [title, name]));

    const skilled = (a: Row, skill: string, practice: number): void => {
        db().run('INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) SELECT ?, id, ? FROM game_skills WHERE name = ?',
            [a.id, practice, skill]);
    };

    const workToday = (user: User, a: Row, detail: string): string => {
        db().exec('DELETE FROM game_schedule_log');
        db().exec("DELETE FROM game_daily WHERE task = 'schedules'");
        db().exec('DELETE FROM game_schedule_days');
        expect(Schedules.planDay(user, refresh(a), gmdate('Y-m-d'), 'work', detail)).toBeNull();
        Schedules.runToday();
        return Schedules.log(a.id)[0].outcome;
    };

    test('kinds of work', () => {
        expect(Crafts.kindOf(occupation('Farmer'))).toBe('producer');
        expect(Crafts.kindOf(occupation('Brewer'))).toBe('craft');
        expect(Crafts.kindOf(occupation('Scribe'))).toBe('service');
        expect(Crafts.recipesOf(occupation('Farmer')).map((r) => r.name)).toEqual(['Grain', 'Hops', 'Flax', 'Vegetables']);
        expect(Crafts.describe(Crafts.recipesOf(occupation('Brewer'))[0])).toBe('1 grain, 1 hops → 1 ale');
        expect(Crafts.describe(Crafts.recipeFor(occupation('Farmer'), recipe('Farmer', 'Hops'))!)).toBe('3 hops (on 10 acres of land)');
        expect(Crafts.recipeFor(occupation('Farmer'), null)!.name, 'Unplanned: the first.').toBe('Grain');
    });

    test('a farmer needs land and grows by level', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Lord' });
        const farmer = anthro({ owner: alice, name: 'Hob' });
        skilled(farmer, 'Agriculture', 28);
        const hops = 'o:' + occupation('Farmer') + ':' + recipe('Farmer', 'Hops');
        expect(workToday(alice, farmer, hops)).toBe('Meant to work as Farmer (Hops), but Lord has too little land (it takes 10 acres): rested.');
        expect(Number(scalar('SELECT practice FROM game_anthro_skills WHERE anthro_id = ?', [farmer.id])), 'No practice either.').toBe(28);
        db().run('INSERT INTO game_parcels (anthro_id, acres) VALUES (?, 12)', [me.id]);
        expect(workToday(alice, farmer, hops), 'A Journeyman: 3 units of 3 hops.').toBe('Worked as Farmer, making 9 hops for Lord.');
        expect(Goods.amount(me.id, 'hops')).toBe(9);
        expect(coins(me.id), 'Goods are the pay: no coins.').toBe(0);
        expect({ hops: Schedules.today().gathered.get(me.id)!.hops }, 'Made for the master (taxes count it).').toEqual({ hops: 9 });
    });

    test('a craftsman uses materials', () => {
        const alice = player('alice');
        const me = playerAnthro(alice, { name: 'Lord' });
        const brewer = anthro({ owner: alice, name: 'Brewster' });
        skilled(brewer, 'Brewing', 90);
        const ale = 'o:' + occupation('Brewer');
        expect(workToday(alice, brewer, ale)).toBe("Meant to work as Brewer (Ale), but there was no grain or hops in Lord's store to work with: rested.");
        // A Master makes 5 a day, fewer if the materials run short.
        Goods.add(me.id, 'grain', 10);
        Goods.add(me.id, 'hops', 3);
        expect(workToday(alice, brewer, ale)).toBe('Worked as Brewer, making 3 ale from 3 grain, 3 hops for Lord.');
        expect([Goods.amount(me.id, 'grain'), Goods.amount(me.id, 'hops'), Goods.amount(me.id, 'ale')]).toEqual([7, 0, 3]);
        // A service job makes nothing, and is paid.
        skilled(brewer, 'Letters', 1);
        expect(workToday(alice, brewer, 'o:' + occupation('Scribe'))).toBe('Worked as Scribe (Letters: Novice), earning 2 coins for Lord.');
        // A recipe of another occupation isn't this one's.
        expect(Schedules.planDay(alice, refresh(brewer), gmdate('Y-m-d'), 'work', 'o:' + occupation('Brewer') + ':' + recipe('Farmer', 'Hops')))
            .toBe('Choose what to work at: an occupation, clearing land, building or foraging.');
    });

    test('every food good feeds anthros cheapest first', () => {
        const alice = player('alice');
        const me = playerAnthro(alice);
        db().run("UPDATE game_goods SET quantity = 0 WHERE anthro_id = ? AND good = 'food'", [me.id]);
        Goods.add(me.id, 'meat', 1);
        Goods.add(me.id, 'vegetables', 1);
        Goods.add(me.id, 'grain', 5);
        expect(Goods.food(me.id), 'Grain is no food; vegetables and meat are.').toBe(2);
        expect(Goods.eat(me.id, 1)).toBe(1);
        expect([Goods.amount(me.id, 'vegetables'), Goods.amount(me.id, 'meat')], 'Vegetables sell for less: eaten first.').toEqual([0, 1]);
    });

    test('an anthro that keeps itself buys materials and sells what it makes', () => {
        db().exec("DELETE FROM game_daily WHERE task = 'defaults'");
        const cooper = anthro({ name: 'Cask', trade_occupation_id: occupation('Cooper') });
        skilled(cooper, 'Carpentry', 28);
        setCoins(cooper.id, 10);
        Schedules.runDefaults();
        const outcome = Schedules.log(cooper.id)[0].outcome;
        // A Journeyman makes 3 barrels from 3 lumber, but at 5 coins it can afford only 2; it sells the barrels at 5 each.
        expect(outcome).toBe('Bought 2 lumber. Worked as Cooper, making 2 barrels from 2 lumber. Sold 2 barrels.');
        expect([coins(cooper.id), Goods.amount(cooper.id, 'lumber'), Goods.amount(cooper.id, 'barrels')]).toEqual([10, 0, 0]);
    });

    test('the recipes admin', () => {
        const cooper = occupation('Cooper');
        expect(Crafts.save(null, cooper, 'Casks', '', '1 mithril', '1 barrels')).toBe('Inputs: there\'s no good called "mithril" (add it under Goods first).');
        expect(Crafts.save(null, cooper, 'Casks', '', '1 lumber', '')).toBe('A recipe makes something: list its outputs.');
        expect(Crafts.save(null, cooper, 'Casks', '', '2 Lumber, 1 iron ore', '2 barrels')).toBeNull();
        const casks = Crafts.recipesOf(cooper)[1];
        expect([casks.name, casks.in, casks.out]).toEqual(['Casks', { iron: 1, lumber: 2 }, { barrels: 2 }]);
        expect(Market.delete('barrels')).toBe('Recipes use or make Barrels: change them first (Admin → Recipes).');
        Crafts.delete(casks.id);
        expect(Crafts.recipesOf(cooper)).toHaveLength(1);
    });
});
