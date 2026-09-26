// Upstream: game/src/Finances.php
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { array_sum, gmdate, int, float, round, strtotimeOrThrow } from '../core/php';
import { Anthros } from './Anthros';
import { Buildings } from './Buildings';
import { Clock } from './Clock';
import { Fiefs } from './Fiefs';
import { Goods } from './Goods';
import { Market } from './Market';
import { Notifications } from './Notifications';
import { Schedules } from './Schedules';
import { Wallets } from './Wallets';

/** Goods by name => quantity (+ or -). */
export type GoodsAmounts = Record<string, number>;

/** A line of the report: coins is + for income, - for an expense. */
export type FinanceLine = { label: string; detail: string; coins: number; goods: GoodsAmounts };

/**
 * The finances report: what the anthro a player plays can expect to earn and spend over the coming days, from what's
 * planned now. It's an estimate: work pays by today's skill levels, foraging brings its average, and plans can change.
 *
 * Income: its household's and employees' work (coins, food, lumber: see production), its wage if it's employed, and
 * its vassals' taxes (see Fiefs). Expenses: its employees' wages, food for its household (meals bought at the market
 * once the store runs out: see Goods), lumber for building, and its own tax to its lord, with any arrears.
 */
export class Finances {
    static readonly DAYS = 7;

    /**
     * The report for the anthro: {days, from, to (dates), balance, lines: [{label, detail, coins
     * (+ income, - expense), goods: {good: + or - quantity}}, ...], income, expenses (coins), projected
     * (coin balance after), food: {store, in, eaten, bought}, taxDay (date or null)}.
     */
    static report(anthro: Row, days: number = Finances.DAYS) {
        const from = gmdate('Y-m-d', strtotimeOrThrow('+1 day'));
        const lines: FinanceLine[] = [];
        const production = Finances.production(anthro.id, days, from);
        for (const row of production.by) {
            lines.push({ label: row.label, detail: row.detail, coins: row.coins, goods: row.goods });
        }

        // Wages: to its employees, and its own if it's employed.
        for (const employee of Anthros.employedBy(int(anthro.player_id))) {
            lines.push({ label: `Wages for ${employee.name}`, detail: Wallets.format(int(employee.employed_wage)) + ' a day',
                coins: -int(employee.employed_wage) * days, goods: {} });
        }
        if (anthro.employer_id !== null) {
            lines.push({ label: `Wage from ${anthro.employer_name}`, detail: Wallets.format(int(anthro.employed_wage)) + ' a day',
                coins: int(anthro.employed_wage) * days, goods: {} });
        }

        // Food: the household eats from the store, and meals are bought once it's gone.
        const mouths = Goods.household(anthro.id).length;
        const eaten = mouths * Goods.FOOD_PER_DAY * days;
        const store = Goods.amount(anthro.id);
        const foodIn = production.goods.food ?? 0;
        const bought = Math.max(0, eaten - store - foodIn);
        const price = Goods.mealPrice();
        if (eaten) {
            lines.push({ label: 'Food for your household', detail: `${mouths} ` + (mouths === 1 ? 'mouth' : 'mouths') + ', ' + Goods.FOOD_PER_DAY + ' food a day each',
                coins: 0, goods: { food: -Math.min(eaten, store + foodIn) } });
        }
        if (bought) {
            lines.push({ label: 'Meals bought at the market', detail: price ? `${bought} × ` + Wallets.format(price) : 'the market sells no food: they go hungry',
                coins: price ? -bought * price : 0, goods: {} });
        }

        // Taxes: its own to its lord, and its vassals' to it.
        let taxDay: string | null = null;
        if (anthro.tax_rate !== null && anthro.liege_id !== null && Fiefs.holdsFief(anthro.id)) {
            const owed = round(Finances.value(production.coins, production.goods) * int(anthro.tax_rate) / 100, 2);
            lines.push({ label: `Tax to ${anthro.liege_name}`, detail: `${anthro.tax_rate}% of what your household makes`,
                coins: -owed, goods: {} });
            const balance = float(anthro.tax_balance);
            if (balance > 0) {
                lines.push({ label: `Tax still owed to ${anthro.liege_name}`, detail: 'arrears, collected on the tax day', coins: -balance, goods: {} });
            } else if (balance < 0) {
                lines.push({ label: `Tax paid ahead to ${anthro.liege_name}`, detail: 'credit, used before anything is collected', coins: Math.min(-balance, owed), goods: {} });
            }
            taxDay = Finances.nextTaxDay();
        }
        for (const vassal of Fiefs.vassalsOf(anthro.id)) {
            const made = Finances.production(vassal.id, days, from);
            const tax = round(Finances.value(made.coins, made.goods) * int(vassal.tax_rate) / 100, 2);
            const arrears = Math.max(0, float(vassal.tax_balance));
            lines.push({ label: `Tax from ${vassal.name}`, detail: `${vassal.tax_rate}% of what their household makes`
                + (arrears ? ', and ' + Fiefs.coins(arrears) + ' they owe' : ''), coins: tax + arrears, goods: {} });
            taxDay = Finances.nextTaxDay();
        }

        const income = array_sum(lines.map((l) => l.coins).filter((c) => c > 0));
        const expenses = -array_sum(lines.map((l) => l.coins).filter((c) => c < 0));
        const balance = Wallets.balance(anthro.id);
        return {
            days, from, to: gmdate('Y-m-d', strtotimeOrThrow(from + ' UTC +' + (days - 1) + ' days')),
            balance, lines, income: round(income, 2), expenses: round(expenses, 2),
            projected: round(balance + income - expenses, 2), taxDay,
            food: { store, in: foodIn, eaten, bought },
        };
    }

    /**
     * What the anthros working for masterId (see Schedules::masterOf) are planned to make over days days from from:
     * {coins, goods: {good: quantity}, by: lines per anthro (see report)}. Work at an occupation pays by
     * today's level (nothing if its skill isn't learned); foraging brings its average; clearing brings lumber, and
     * building uses it.
     */
    static production(masterId: number, days: number, from: string): { coins: number; goods: GoodsAmounts; by: FinanceLine[] } {
        const ids = Auth.db().column(
            'SELECT id FROM game_anthros WHERE died_at IS NULL AND COALESCE(employer_id, owner_id) = ? ORDER BY id <> ?, name, id',
            [masterId, masterId],
        );
        const forage = array_sum(Schedules.FORAGE_FOOD) / 2;
        const total: { coins: number; goods: GoodsAmounts; by: FinanceLine[] } = { coins: 0, goods: {}, by: [] };
        for (const id of ids) {
            const anthro = Anthros.findAny(int(id))!;
            const learned: number[] = Schedules.learned(anthro.id);
            // skill id => level
            const levels = new Map<number, string>();
            for (const [skill, practice] of Auth.db().pairs('SELECT skill_id, practice FROM game_anthro_skills WHERE anthro_id = ?', [anthro.id])) {
                levels.set(skill, Schedules.level(int(practice)));
            }
            let coins = 0;
            const goods: GoodsAmounts = {};
            // what they do => how many days (in the order first planned)
            const what = new Map<string, number>();
            for (const plan of Object.values(Schedules.upcoming(anthro, days, from))) {
                switch (plan.activity) {
                    case 'work': {
                        const skill = int(plan.occupation_skill_id ?? 0);
                        if (learned.includes(skill)) {
                            coins += (Schedules.PAY as Record<string, number>)[levels.get(skill)!] ?? 0;
                            what.set(plan.occupation_title, (what.get(plan.occupation_title) ?? 0) + 1);
                        }
                        break;
                    }
                    case 'forage':
                        goods.food = (goods.food ?? 0) + forage;
                        what.set('foraging', (what.get('foraging') ?? 0) + 1);
                        break;
                    case 'clear':
                        goods.lumber = (goods.lumber ?? 0) + Schedules.CLEAR_LUMBER;
                        what.set('clearing land', (what.get('clearing land') ?? 0) + 1);
                        break;
                    case 'build':
                        goods.lumber = (goods.lumber ?? 0) - Buildings.LUMBER_PER_DAY;
                        what.set('building', (what.get('building') ?? 0) + 1);
                        break;
                }
            }
            if (!what.size) {
                continue;
            }
            total.coins += coins;
            for (const [good, quantity] of Object.entries(goods)) {
                total.goods[good] = (total.goods[good] ?? 0) + quantity;
            }
            total.by.push({
                label: int(id) === masterId ? `${anthro.name} (you)` : anthro.name,
                detail: [...what].map(([w, n]) => `${w} ${n} ` + (n === 1 ? 'day' : 'days')).join(', '),
                coins, goods,
            });
        }
        return total;
    }

    /**
     * The anthro the user plays gives another coins (resource 'coins') or goods from its store. Coins go to the
     * recipient's wallet; goods to the store it's fed from (its keeper's: an owned anthro's owner, see Goods::keeperOf).
     * Returns an error message, or null.
     */
    static donate(user: Row, toId: number, resource: string, amount: number): string | null {
        const from = Anthros.player(user.id);
        const to = Anthros.findAny(toId);
        const names: Record<string, string> = Market.names();
        const error =
            !from ? 'Create or become an anthro first: gifts come from the anthro you play.'
            : !to || Anthros.isDead(to) ? 'Choose a living anthro to give to.'
            : to.id === from.id ? "You can't give to yourself."
            : resource !== 'coins' && (names[resource] === undefined || names[resource] === null) ? 'Choose what to give.'
            : amount < 1 ? 'Give at least 1.'
            : null;
        if (error) {
            return error;
        }
        if (resource === 'coins') {
            const what = Wallets.format(amount);
            if (!Wallets.change(from!.id, -amount, `Gave ${what} to ${to!.name}`, null, user.id)) {
                return 'You have ' + Wallets.format(Wallets.balance(from!.id)) + '.';
            }
            Wallets.change(to!.id, amount, `A gift from ${from!.name}`);
            Notifications.toAnthro(to!.id, `${from!.name} gave you ${what}.`, '/game/wallet');
            return null;
        }
        const what = `${amount} ` + names[resource].toLowerCase();
        if (!Goods.take(from!.id, resource, amount)) {
            return 'You have only ' + Goods.amount(from!.id, resource) + ' ' + names[resource].toLowerCase() + '.';
        }
        const keeper = Goods.keeperOf(to!) ?? to!.id;
        Goods.add(keeper, resource, amount);
        Notifications.toAnthro(to!.id, `${from!.name} gave you ${what}` + (keeper !== to!.id ? `, kept in ${to!.owner_name}'s store.` : '.'), '/game/assets/goods');
        if (keeper !== to!.id) {
            Notifications.toAnthro(keeper, `${from!.name} gave ${to!.name} ${what}, for your store.`, '/game/assets/goods');
        }
        return null;
    }

    /**
     * Coins and goods in coins, as taxes value them (see Fiefs::value).
     */
    private static value(coins: number, goods: GoodsAmounts): number {
        let value = coins;
        for (const [good, quantity] of Object.entries(goods)) {
            value += Math.max(0, quantity) * Fiefs.value(good);
        }
        return value;
    }

    private static nextTaxDay(): string {
        const days = (Fiefs.TAX_WEEKDAY - Clock.weekday() + 7) % 7 || 7;
        return gmdate('Y-m-d', strtotimeOrThrow(`+${days} days`));
    }
}
