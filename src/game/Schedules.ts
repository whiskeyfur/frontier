// Upstream: game/src/Schedules.php
import { Auth, type User } from '../core/Auth';
import { onReset } from '../core/caches';
import {
    array_rand, empty, float, gmdate, int, intdiv, mb_strlen, pick, random_int, shuffle, str, strtotime, trim,
} from '../core/php';
import type { Db, Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Buildings } from './Buildings';
import { Clock } from './Clock';
import { Crafts, type Recipe } from './Crafts';
import { Goods } from './Goods';
import { Groups } from './Groups';
import { Land } from './Land';
import { Litters } from './Litters';
import { Market } from './Market';
import { Preferences } from './Preferences';
import { Wallets } from './Wallets';

/**
 * What a user can plan for an anthro (see Schedules.options, groupOptions): partners (anthro rows), groups (Map of
 * group id => name), skills (Map of id => name), occupations (Map of id => occupation), recipes (Map of occupation id
 * => recipes: see Crafts.byOccupation), places (Map of part id => "Barony: Expanse"), sites (building rows), learned
 * (skill ids, or null).
 */
export type PlanOptions = {
    partners: Row[];
    groups: Map<number, string>;
    skills: Map<number, string>;
    occupations: Map<number, Row>;
    recipes: Map<number, Recipe[]>;
    places: Map<number, string>;
    sites: Row[];
    learned: number[] | null;
};

/**
 * What runToday did in this request: outcomes (Map of anthro id => what came of its day) and gathered (Map of
 * master id => {good: how much}).
 */
export type TodaysWork = { outcomes: Map<number, string>; gathered: Map<number, Record<string, number>> };

/**
 * Schedules: what an anthro does each day. Each has a weekly routine (Monday to Sunday; a day left out is rest), and
 * days can be planned ahead to break it. The day a litter is due, a dam is birthing and does nothing else.
 *
 * Instead of its own routine, an anthro can follow a standard schedule: a weekly routine a player names and keeps
 * (see standards), so one change to it reaches every anthro following it. It keeps its own routine for when it stops.
 * A standard only applies while its player still plans the anthro (see standardFor): one that's sold or freed goes
 * back to its own routine.
 *
 * The anthro's player, or whoever owns or employs it, plans it (see canPlan); admins can too. Each day the game
 * carries out the day's plan (see runToday):
 *  - breeding with the chosen partner (or a random other member of the chosen breeding group; the pair take the
 *    roles they can, and rule breaking is recorded with no litter, as always);
 *  - training at a skill, or working at an occupation (each has a skill: a Baker's is Cooking): a day's practice at
 *    the skill (see LEVELS), but work only once the anthro has learned the skill (trained or worked at it for
 *    WORK_MIN_PRACTICE days: see learned). A producer or craftsman makes its recipe's goods, by level, from the
 *    materials it needs (see Crafts); a service job makes nothing, and earns PAY coins by level instead;
 *  - work that takes no skill: clearing land (CLEAR_ACRES a day, in the wilds or an expanse, added to the master's land
 *    there, and CLEAR_LUMBER lumber), building (a day's work on a building on the master's land, using a lumber from
 *    the master's store: see Buildings) or foraging (FORAGE_FOOD food);
 *  - or rest.
 * What work makes (coins, goods, land) goes to whoever the anthro works for, and its materials come from there: its
 * master (see masterOf; a slave's owner). A hungry anthro (see Goods) can only rest or forage that day.
 *
 * An anthro nobody has planned has a default day by age (see defaultPlan, runDefaults): a newborn rests (its days
 * can't be planned: see isResting); a youngster learns a trade from its father (a boy) or mother (a girl) until it's a
 * Journeyman at it, then works it. One that keeps itself (see isIndependent) lives by a trade, a random one if it has
 * none, as a Journeyman (see tradeOf), foraging when it has neither food nor the coins for a meal. It buys the
 * materials its trade needs, sells what it makes (keeping what it can eat), and buys food with what it has, up to a
 * week's.
 */
export class Schedules {
    // The activities to choose from; work covers working at an occupation, clearing land, building and foraging.
    static readonly ACTIVITIES: Record<string, string> = { rest: 'Rest', breed: 'Breed', work: 'Work', train: 'Train' };
    // Days of practice needed for each level of a skill, highest first. (A Map: its order matters, and an object's
    // integer keys would come lowest first.)
    static readonly LEVELS = new Map<number, string>([[84, 'Master'], [28, 'Journeyman'], [7, 'Apprentice'], [1, 'Novice']]);
    // How far ahead days can be planned (past a whole pregnancy, see Litters::GESTATION_DAYS).
    static readonly PLAN_AHEAD_DAYS = 70;
    // A day's clearing, in acres (and the lumber it yields), and a day's foraging, in food.
    static readonly CLEAR_ACRES = 0.25;
    static readonly CLEAR_LUMBER = 2;
    static readonly FORAGE_FOOD = [1, 3];
    // Coins a day's service work (an occupation with no recipe: see Crafts) earns, by the worker's level at its skill.
    static readonly PAY: Record<string, number> = { Novice: 2, Apprentice: 4, Journeyman: 8, Master: 15 };
    // A new player's anthro starts this practised at the skill its player chooses (a Journeyman, as the world's commoners
    // are: see spreadTrades), so it can work at once.
    static readonly START_PRACTICE = 28;
    // Days of practice at a skill before an anthro can work at its occupations: training first, then work.
    static readonly WORK_MIN_PRACTICE = 1;
    // The skills a new game starts with, and the occupations (titles) that go with each: the trades of medieval
    // Europe, and a couple of less respectable ones.
    static readonly SEED_SKILLS: Record<string, string[]> = {
        'Administration': ['Steward', 'Reeve', 'Bailiff'],
        'Agriculture': ['Farmer', 'Ploughman'],
        'Animal husbandry': ['Shepherd', 'Swineherd', 'Stablehand'],
        'Archery': ['Hunter', 'Archer'],
        'Brewing': ['Brewer', 'Alewife'],
        'Carpentry': ['Carpenter', 'Cooper', 'Wheelwright'],
        'Cooking': ['Baker', 'Chef'],
        'Falconry': ['Hunter', 'Falconer'],
        'Fishing': ['Fisher'],
        'Fletching': ['Fletcher', 'Bowyer'],
        'Healing': ['Physician', 'Barber-surgeon', 'Midwife'],
        'Herbalism': ['Herbalist', 'Apothecary'],
        'Leatherworking': ['Tanner', 'Cobbler', 'Saddler'],
        'Letters': ['Scribe', 'Clerk'],
        'Masonry': ['Mason', 'Thatcher'],
        'Metalworking': ['Blacksmith', 'Armourer', 'Goldsmith'],
        'Milling': ['Miller'],
        'Mining': ['Miner'],
        'Music': ['Minstrel'],
        'Needlework': ['Tailor', 'Seamstress'],
        'Pottery': ['Potter'],
        'Prostitution': ['Courtesan', 'Harlot'],
        'Service': ['Servant', 'Innkeeper', 'Chandler'],
        'Swordsmanship': ['Soldier', 'Guard'],
        'Theology': ['Priest', 'Monk'],
        'Trade': ['Merchant', 'Pedlar'],
        'Weaving': ['Weaver', 'Rope maker'],
        'Witchcraft': ['Witch', 'Cunning folk'],
    };
    // Skills the Renaissance adds (see Preferences), with their occupations, and occupations it adds to older skills.
    static readonly RENAISSANCE_SKILLS: Record<string, string[]> = {
        'Painting': ['Painter', 'Illuminator'],
        'Sculpture': ['Sculptor', 'Stonecarver'],
        'Poetry': ['Poet', 'Playwright'],
        'Architecture': ['Architect'],
        'Printing': ['Printer', 'Engraver'],
        'Theatre': ['Actor', 'Jester'],
    };
    static readonly RENAISSANCE_TITLES: Record<string, string[]> = { 'Music': ['Composer'] };
    // What each kind of day is called.
    static readonly LABELS: Record<string, string> = {
        rest: 'Rest', breed: 'Breed', work: 'Work', train: 'Train', clear: 'Clear land',
        build: 'Build', forage: 'Forage', birthing: 'Birthing',
    };

    /**
     * Every skill (or, with era, those known in that era), in order: Map of id => name.
     */
    static skills(era: string | null = null): Map<number, string> {
        return Auth.db().pairs('SELECT id, name FROM game_skills WHERE ? IS NULL OR era IS NULL OR era = ? ORDER BY sort_order, name', [era, era]);
    }

    /**
     * Every occupation (or, with era, those known in that era), by title: Map of id => {id, title, skill_id, skill}.
     */
    static occupations(era: string | null = null): Map<number, Row> {
        const rows = Auth.db().all(
            `SELECT o.id, o.title, o.skill_id, s.name AS skill, COALESCE(o.era, s.era) AS era FROM game_occupations o JOIN game_skills s ON s.id = o.skill_id
             WHERE ? IS NULL OR (o.era IS NULL OR o.era = ?) AND (s.era IS NULL OR s.era = ?) ORDER BY o.title, s.name`,
            [era, era, era],
        );
        const occupations = new Map<number, Row>();
        for (const row of rows) {
            occupations.set(int(row.id), row);
        }
        return occupations;
    }

    /**
     * The level for this many days of practice ("Untrained" for none).
     */
    static level(practice: number): string {
        for (const [days, level] of Schedules.LEVELS) {
            if (practice >= days) {
                return level;
            }
        }
        return 'Untrained';
    }

    /**
     * The skills the anthro has practised, most practised first: [{name, practice, level, titles}, ...], where
     * titles are the occupations that go with the skill.
     */
    static skillsOf(anthroId: number): { name: string; practice: number; level: string; titles: string }[] {
        const rows = Auth.db().all(
            `SELECT s.name, a.practice,
                    (SELECT GROUP_CONCAT(o.title, ', ' ORDER BY o.sort_order, o.title) FROM game_occupations o WHERE o.skill_id = s.id) AS titles
             FROM game_anthro_skills a JOIN game_skills s ON s.id = a.skill_id
             WHERE a.anthro_id = ? AND a.practice > 0 ORDER BY a.practice DESC, s.name`,
            [anthroId],
        );
        return rows.map((row) => ({
            name: row.name, practice: int(row.practice), level: Schedules.level(int(row.practice)), titles: row.titles ?? '',
        }));
    }

    // Days of food an anthro that keeps itself buys toward (see runDefaults).
    static readonly INDEPENDENT_FOOD_DAYS = 7;
    // The practice an anthro that keeps itself has at its trade, at least: a Journeyman's (see LEVELS).
    static readonly INDEPENDENT_PRACTICE = 28;
    // A newborn only rests until it's this many weeks old: its days can't be planned (see isResting).
    static readonly REST_WEEKS = 5;
    // Days a youngster learns its trade from a parent before it works at it: until it's a Journeyman (see LEVELS).
    static readonly MENTOR_PRACTICE = 28;

    /**
     * Whether the anthro is too young to do anything but rest (under REST_WEEKS old): its days can't be planned.
     */
    static isResting(anthro: Row): boolean {
        const weeks = Anthros.ageWeeks(anthro.birthdate);
        return weeks !== null && weeks < Schedules.REST_WEEKS && !Anthros.isDead(anthro);
    }

    /**
     * Whether the anthro keeps itself with nobody planning its days: free, unplayed, grown, not employed or up for
     * auction, and with no schedule of its own (a routine, or a standard one). It works its trade (see tradeOf).
     */
    static isIndependent(anthro: Row): boolean {
        return Anthros.isFree(anthro) && anthro.player_id == null && !Anthros.isYoung(anthro)
            && anthro.employer_id == null && anthro.auction_id == null && anthro.standard_schedule_id == null
            && !Schedules.hasRoutine(anthro.id);
    }

    /**
     * Whether the anthro has a weekly routine of its own (see setWeekly).
     */
    static hasRoutine(anthroId: number): boolean {
        return !!Auth.db().value('SELECT COUNT(*) FROM game_schedule_weekly WHERE anthro_id = ?', [anthroId]);
    }

    /**
     * The trade of an anthro that keeps itself: its occupation (see trade), given one at random (of those every era
     * has) if it has none, practised at least INDEPENDENT_PRACTICE days (a Journeyman). Returns the occupation (see
     * occupations), or null if there are none.
     */
    static tradeOf(anthro: Row): Row | null {
        const trade = Schedules.trade(anthro) ?? Schedules.assignTrade(anthro, Schedules.randomTrade());
        if (trade) {
            Auth.db().run(
                `INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) VALUES (?, ?, ?)
                 ON CONFLICT (anthro_id, skill_id) DO UPDATE SET practice = GREATEST(practice, excluded.practice)`,
                [anthro.id, trade.skill_id, Schedules.INDEPENDENT_PRACTICE],
            );
        }
        return trade;
    }

    /**
     * The anthro's trade (its occupation: see occupations), or null if it has none yet.
     */
    static trade(anthro: Row): Row | null {
        return Schedules.occupations().get(int(anthro.trade_occupation_id ?? 0)) ?? null;
    }

    /**
     * The parent a youngster learns its trade from: its father if it presents as male, its mother otherwise; the
     * other if that one is unknown, dead, or has no trade to teach (see jobOf). Null if neither can teach.
     */
    static mentorOf(anthro: Row): Row | null {
        const order = (anthro.presents_as ?? null) === 'male' ? ['sire_id', 'dam_id'] : ['dam_id', 'sire_id'];
        for (const column of order) {
            const parent = anthro[column] == null ? null : Anthros.findAny(int(anthro[column]));
            if (parent && !Anthros.isDead(parent) && Schedules.jobOf(parent)) {
                return parent;
            }
        }
        return null;
    }

    /**
     * The job an anthro can teach: its trade, or else the occupation of the skill it's practised most. Null if none.
     */
    static jobOf(anthro: Row): Row | null {
        const trade = Schedules.trade(anthro);
        if (trade) {
            return trade;
        }
        const id = Auth.db().value(
            `SELECT o.id FROM game_anthro_skills k JOIN game_occupations o ON o.skill_id = k.skill_id
             WHERE k.anthro_id = ? AND k.practice > 0 ORDER BY k.practice DESC, o.sort_order, o.id LIMIT 1`,
            [anthro.id],
        );
        return id === null ? null : (Schedules.occupations().get(int(id)) ?? null);
    }

    /**
     * What the anthro does on a day nobody has planned (see weekly): by age, resting under REST_WEEKS (locked); then,
     * while young, learning a trade (a parent's: see mentorOf) until MENTOR_PRACTICE days in it; then working it. A
     * grown anthro that keeps itself works a trade of its own (see tradeOf); one that has none rests. The plan has
     * 'default' set, and 'mentor_id' and 'mentor_name' while it learns from a parent.
     */
    static defaultPlan(anthro: Row): Row {
        const rest = { ...Schedules.noDetails(), activity: 'rest', default: true };
        if (Anthros.isDead(anthro) || Schedules.isResting(anthro)) {
            return rest;
        }
        let trade = Schedules.trade(anthro);
        if (!trade && Anthros.isYoung(anthro)) {
            const mentor = Schedules.mentorOf(anthro);
            trade = Schedules.assignTrade(anthro, mentor ? Schedules.jobOf(mentor) : Schedules.randomTrade());
        } else if (Schedules.isIndependent(anthro)) {
            trade = Schedules.tradeOf(anthro);
        }
        if (!trade) {
            return rest;
        }
        const practice = Auth.db().value('SELECT practice FROM game_anthro_skills WHERE anthro_id = ? AND skill_id = ?', [anthro.id, trade.skill_id]);
        if (int(practice) >= Schedules.MENTOR_PRACTICE) {
            return { ...Schedules.noDetails(), default: true, recipe_id: anthro.trade_recipe_id != null ? int(anthro.trade_recipe_id) : null, ...Schedules.tradePlan(trade) };
        }
        const mentor = Schedules.mentorOf(anthro);
        return {
            ...Schedules.noDetails(), activity: 'train', skill_id: int(trade.skill_id), skill_name: trade.skill, default: true,
            mentor_id: mentor?.id ?? null, mentor_name: mentor?.name ?? null,
        };
    }

    // The trades that feed a new game (see spreadTrades), each with the recipe it works: {title: recipe name}.
    static readonly FOOD_TRADES: Record<string, string> = { Farmer: 'Vegetables', Fisher: 'Fish', Hunter: 'Game', Swineherd: 'Pork' };
    // How much more food than they eat the food trades make, together.
    static readonly FOOD_MARGIN = 1.2;

    /**
     * Gives the free commoners (untitled, unplayed, living) trades, each as a Journeyman (INDEPENDENT_PRACTICE days), in
     * random order: first enough of FOOD_TRADES, in turn, to feed them all (at a Journeyman's output, with FOOD_MARGIN
     * over), a farmer given the land farming takes if it has none (see giveFarmland; without the land office's to give,
     * it fishes instead); then one of each other occupation (of every era); then random ones (not needing land). A new
     * game does this (see Board::reset). Returns how many were given one.
     */
    static spreadTrades(): number {
        const db = Auth.db();
        const ids: number[] = db.column(
            'SELECT a.id FROM game_anthros a WHERE a.title_rank IS NULL AND a.player_id IS NULL AND ' + Anthros.freeSql('a') + ' ORDER BY RAND()',
        ).map(int);
        const occupations = [...Schedules.occupations().values()];
        if (!ids.length || !occupations.length) {
            return 0;
        }
        const byTitle: Record<string, Row> = {};
        for (const occupation of occupations) {
            byTitle[occupation.title] ??= occupation;
        }
        const edibles = Goods.edibles();
        const trade = 'UPDATE game_anthros SET trade_occupation_id = ?, trade_recipe_id = ? WHERE id = ?';
        const skill = 'INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) VALUES (?, ?, ?) ON CONFLICT (anthro_id, skill_id) DO UPDATE SET practice = GREATEST(practice, excluded.practice)';
        const give = (id: number, occupation: Row, recipeId: number | null): void => {
            db.run(trade, [occupation.id, recipeId, id]);
            db.run(skill, [id, occupation.skill_id, Schedules.INDEPENDENT_PRACTICE]);
        };

        // Food: the trades in turn, until they make enough for everyone.
        let foods: [Row, Recipe, number][] = [];
        for (const [title, recipeName] of Object.entries(Schedules.FOOD_TRADES)) {
            const recipe = Crafts.recipesOf(int(byTitle[title]?.id ?? 0)).filter((r) => r.name === recipeName)[0] ?? null;
            const food = recipe ? Object.entries(recipe.out).filter(([good]) => edibles.includes(good)).reduce((sum, [, n]) => sum + n, 0) * Crafts.OUTPUT.Journeyman : 0;
            if (food > 0) {
                foods.push([byTitle[title], recipe!, food]);
            }
        }
        const need = ids.length * Goods.FOOD_PER_DAY * Schedules.FOOD_MARGIN;
        let made = 0;
        const used = new Set<number>();
        for (let turn = 0; foods.length && made < need && ids.length; turn++) {
            const [occupation, recipe, food] = foods[turn % foods.length];
            if (recipe.needs_acres !== null && !Schedules.giveFarmland(ids[0], float(recipe.needs_acres))) {
                // No land to farm: the next food trade instead.
                foods = foods.filter((f) => f[1].needs_acres === null);
                continue;
            }
            give(ids.shift()!, occupation, recipe.id);
            used.add(int(occupation.id));
            made += food;
        }
        // Then one of each other occupation, and random ones (that need no land) for the rest.
        const others = occupations.filter((o) => !used.has(int(o.id))
            && !Crafts.recipesOf(int(o.id)).filter((r) => r.needs_acres !== null).length);
        shuffle(others);
        ids.forEach((id, i) => {
            give(id, others[i] ?? others[array_rand(others)], null);
        });
        return ids.length + used.size;
    }

    /**
     * Gives the anthro acres of the land office's land, if it holds less (its own lot, cut from the land office's
     * largest lot in a village, or anywhere): a farmer's farmland. Returns whether it has the land now.
     */
    private static giveFarmland(anthroId: number, acres: number): boolean {
        if (Land.totalAcres(anthroId) >= acres) {
            return true;
        }
        const db = Auth.db();
        const lot = db.row(
            `SELECT p.* FROM game_parcels p LEFT JOIN game_barony_parts bp ON bp.id = p.part_id
             WHERE p.anthro_id IS NULL AND p.acres >= ` + (acres * 2) + `
               AND NOT EXISTS (SELECT 1 FROM game_land_listings l WHERE l.parcel_id = p.id AND l.status = 'open')
             ORDER BY bp.kind = 'village' DESC, p.acres DESC LIMIT 1`,
        );
        if (!lot) {
            return false;
        }
        db.run('UPDATE game_parcels SET acres = acres - ? WHERE id = ?', [acres, lot.id]);
        db.run('INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (?, ?, ?, ?)', [anthroId, acres, lot.barony_id, lot.part_id]);
        return true;
    }

    /**
     * The anthro's job, in words ("Brewer (Brewing: Journeyman)"): its trade, or the occupation of the skill it's
     * practised most (see jobOf), with its level; null if it has none.
     */
    static jobLabel(anthro: Row): string | null {
        const job = Schedules.jobOf(anthro);
        if (!job) {
            return null;
        }
        const practice = int(Auth.db().value('SELECT practice FROM game_anthro_skills WHERE anthro_id = ? AND skill_id = ?', [anthro.id, job.skill_id]));
        return job.title + ' (' + job.skill + (practice ? ': ' + Schedules.level(practice) : ': untrained') + ')';
    }

    private static randomTrade(): Row | null {
        // Of every era, and not one that needs land to work (a farmer: see Crafts), which it may not have.
        const base = [...Schedules.occupations().values()].filter((o) => (o.era === undefined || o.era === null)
            && !Crafts.recipesOf(int(o.id)).some((r) => r.needs_acres !== null));
        return base.length ? pick(base) : null;
    }

    private static assignTrade(anthro: Row, trade: Row | null): Row | null {
        if (trade) {
            Auth.db().run('UPDATE game_anthros SET trade_occupation_id = ? WHERE id = ?', [trade.id, anthro.id]);
        }
        return trade;
    }

    /**
     * Once a day, after the planned days (the game runs this on each request): every anthro nobody has planned (no
     * routine or standard schedule, no day planned today; not employed or up for auction) does its default day (see
     * defaultPlan), or rests if hungry. One that keeps itself forages instead of working when it has no food and can't
     * afford a meal (or is hungry), then buys food at the market, up to INDEPENDENT_FOOD_DAYS' worth, with the coins it
     * has. Returns how many days it carried out.
     */
    static runDefaults(): number {
        const db = Auth.db();
        const claim = db.run('INSERT OR IGNORE INTO game_daily (day, task) VALUES (' + Clock.sqlToday() + ", 'defaults')");
        if (!claim) {
            return 0;
        }
        const today = Clock.today();
        const ids = db.column(
            `SELECT a.id FROM game_anthros a
             WHERE a.owner_id IS NOT NULL AND a.died_at IS NULL AND a.employer_id IS NULL AND a.standard_schedule_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM game_schedule_weekly w WHERE w.anthro_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM game_schedule_days d WHERE d.anthro_id = a.id AND d.day = ` + Clock.sqlToday() + `)
               AND NOT EXISTS (SELECT 1 FROM game_schedule_log l WHERE l.anthro_id = a.id AND l.day = ` + Clock.sqlToday() + `)
               AND NOT EXISTS (SELECT 1 FROM game_auctions au WHERE au.anthro_id = a.id AND au.status = 'open')
             ORDER BY a.id`,
        );
        const claimDay = "INSERT OR IGNORE INTO game_schedule_log (anthro_id, day, activity) VALUES (?, ?, 'rest')";
        const log = 'UPDATE game_schedule_log SET activity = ?, outcome = ? WHERE anthro_id = ? AND day = ?';
        let done = 0;
        for (const id of ids) {
            const anthro = Anthros.findAny(int(id))!;
            let plan: Row = Schedules.defaultPlan(anthro);
            const independent = Schedules.isIndependent(anthro);
            if (plan.activity === 'rest' && !independent) {
                continue;
            }
            // Claim the day first.
            if (!db.run(claimDay, [id, today])) {
                continue;
            }
            const price = Goods.mealPrice();
            const broke = Goods.food(anthro.id) < Goods.FOOD_PER_DAY && (price === null || Wallets.balance(anthro.id) < price);
            if (independent && (plan.activity === 'rest' || broke || Goods.isHungry(anthro))) {
                plan = { activity: 'forage' };
            }
            let outcome: string;
            if (Goods.isHungry(anthro) && !['rest', 'forage'].includes(plan.activity)) {
                outcome = 'Too hungry to ' + Schedules.LABELS[plan.activity].toLowerCase() + ': rested.';
                plan = { activity: 'rest' };
            } else {
                outcome = Schedules.carryOut(anthro, plan, independent);
            }
            if (independent) {
                outcome += Schedules.sellMade(anthro, plan);
            }
            if (independent && price) {
                // Food for the week ahead, with what it has.
                const short = Schedules.INDEPENDENT_FOOD_DAYS * Goods.FOOD_PER_DAY - Goods.food(anthro.id);
                const buy = short > 0 ? Math.min(short, intdiv(Math.max(0, Wallets.balance(anthro.id)), price)) : 0;
                if (buy > 0 && Wallets.change(anthro.id, -buy * price, `Bought ${buy} food at the market`)) {
                    Goods.add(anthro.id, 'food', buy);
                    outcome += ` Bought ${buy} food.`;
                }
            }
            db.run(log, [plan.activity, outcome, id, today]);
            Schedules.todaysWork.outcomes.set(int(id), outcome);
            done++;
        }
        return done;
    }

    /**
     * The skills the anthro has learned well enough to work at (see WORK_MIN_PRACTICE): [skill id, ...].
     */
    static learned(anthroId: number): number[] {
        return Auth.db().column('SELECT skill_id FROM game_anthro_skills WHERE anthro_id = ? AND practice >= ?', [anthroId, Schedules.WORK_MIN_PRACTICE]).map(int);
    }

    /**
     * Who the anthro works for (clearing, building and foraging are for them): its employer, else its owner (a free
     * anthro works for itself). Null for the game's anthros.
     */
    static masterOf(anthro: Row): Row | null {
        const id = anthro.employer_id ?? anthro.owner_id;
        return id == null ? null : Anthros.findAny(int(id));
    }

    /**
     * Whether the user plans the anthro's days: they play it, own or employ it, or (unless !asAdmin: as a player
     * only) are an admin. Not for the dead.
     */
    static canPlan(user: User, anthro: Row, asAdmin = true): boolean {
        return !Anthros.isDead(anthro) && (anthro.player_id === user.id || Anthros.isOwner(user, anthro)
            || Anthros.isEmployer(user, anthro) || (asAdmin && Auth.isAdmin(user)));
    }

    /**
     * Everything the user can plan for the anthro, beyond rest: {partners (anthros the user can breed it with: ones
     * they have, see Anthros::breedable; only if they decide its breeding), groups (Map of id => name, its
     * breeding groups; likewise), skills, occupations, places (expanses to clear, Map of part id => "Barony: Expanse"),
     * sites (unfinished buildings on its master's land)}.
     */
    static options(user: User, anthro: Row): PlanOptions {
        const decides = Auth.isAdmin(user) || !!Anthros.findControlled(user.id, anthro.id);
        let groups = new Map<number, string>();
        if (decides) {
            groups = Auth.db().pairs(
                'SELECT g.id, g.name FROM game_breeding_groups g JOIN game_group_members m ON m.group_id = g.id WHERE m.anthro_id = ? ORDER BY g.name',
                [anthro.id],
            );
        }
        const places = Auth.db().pairs(
            `SELECT p.id, CONCAT(b.name, ': ', p.name) FROM game_barony_parts p JOIN game_baronies b ON b.id = p.barony_id
             WHERE p.kind = 'expanse' ORDER BY b.name, p.name`,
        );
        const master = Schedules.masterOf(anthro);
        return {
            partners: decides ? (Anthros.breedable(user.id) as Row[]).filter((a) => a.id !== anthro.id) : [],
            groups,
            // Skills and occupations of the user's era (see Preferences).
            skills: Schedules.skills(Preferences.era(user.id)),
            occupations: Schedules.occupations(Preferences.era(user.id)),
            // What each producing or crafting occupation can make (see Crafts): Map of occupation id => recipes.
            recipes: Crafts.byOccupation(),
            places,
            sites: master ? (Buildings.heldBy(master.id) as Row[]).filter((b) => b.finished_at == null) : [],
            // The skills it can work at already; the other occupations need training first (see learned).
            learned: Schedules.learned(anthro.id),
        };
    }

    /**
     * The choices for planning several of the user's anthros at once (see options): every anthro they can breed as a
     * partner, the breeding groups those anthros are in, and building on their own land. Each anthro's plan is still
     * checked on its own (it can't breed with itself, or in a group it isn't in).
     */
    static groupOptions(user: User): PlanOptions {
        const mine: Row[] = Anthros.breedable(user.id);
        let groups = new Map<number, string>();
        if (mine.length) {
            const ids = mine.map((a) => a.id);
            groups = Auth.db().pairs(
                `SELECT DISTINCT g.id, g.name FROM game_breeding_groups g JOIN game_group_members m ON m.group_id = g.id
                 WHERE m.anthro_id IN (` + ids.map(() => '?').join(', ') + ') ORDER BY g.name',
                ids,
            );
        }
        const player = Anthros.player(user.id);
        const era = Preferences.era(user.id);
        // No 'learned': each anthro's own skills decide whether it can work on the day (see carryOut).
        return {
            ...(player ? Schedules.options(user, player) : {
                skills: Schedules.skills(era), occupations: Schedules.occupations(era), recipes: Crafts.byOccupation(), places: new Map<number, string>(), sites: [],
            }),
            partners: mine, groups, learned: null,
        };
    }

    /**
     * The anthro's weekly routine: {weekday (1-7): plan}, with rest for the days left out. That's the standard
     * schedule it follows (see standardFor), or with own (or none to follow), its own routine; with no routine of its
     * own, its default day every day (see defaultPlan), until someone gives it one. A newborn only rests (see isResting).
     * (Weekdays are keyed 1 to 7, so an object keeps them in order.)
     */
    static weekly(anthroId: number, own = false): Record<number, Row> {
        const standard = own ? null : Schedules.standardFor(anthroId);
        if (standard && !Schedules.isResting(Anthros.findAny(anthroId)!)) {
            return standard.week;
        }
        const anthro = Anthros.findAny(anthroId);
        // Too young to do anything but rest, whatever was planned; with no routine of its own, its default (by age).
        if (anthro && (Schedules.isResting(anthro) || !Schedules.hasRoutine(anthroId))) {
            const plan = Schedules.defaultPlan(anthro);
            const week: Record<number, Row> = {};
            for (let day = 1; day <= 7; day++) {
                week[day] = { ...plan };
            }
            return week;
        }
        return Schedules.week('game_schedule_weekly', 'anthro_id', anthroId);
    }

    /**
     * A day working at the trade (see tradeOf), as a plan.
     */
    private static tradePlan(trade: Row): Row {
        return {
            activity: 'work', occupation_id: trade.id, occupation_title: trade.title,
            occupation_skill: trade.skill, occupation_skill_id: trade.skill_id,
        };
    }

    /**
     * A weekly routine from table (an anthro's, or a standard schedule's): {weekday: plan}, rest for days left out.
     */
    private static week(table: string, key: string, id: number): Record<number, Row> {
        const rows = new Map<number, Row>();
        for (const row of Auth.db().all(Schedules.PLAN_SELECT + ` FROM ${table} p` + Schedules.PLAN_JOINS + ` WHERE p.${key} = ?`, [id])) {
            rows.set(int(row.weekday), row);
        }
        const week: Record<number, Row> = {};
        for (let day = 1; day <= 7; day++) {
            week[day] = rows.get(day) ?? { ...Schedules.noDetails(), activity: 'rest' };
        }
        return week;
    }

    /**
     * The days planned ahead (today on), by date: {date: plan}.
     */
    static planned(anthroId: number): Record<string, Row> {
        const rows = Auth.db().all(
            Schedules.PLAN_SELECT + ' FROM game_schedule_days p' + Schedules.PLAN_JOINS + ' WHERE p.anthro_id = ? AND p.day >= ' + Clock.sqlToday() + ' ORDER BY p.day',
            [anthroId],
        );
        const days: Record<string, Row> = {};
        for (const row of rows) {
            days[row.day] = row;
        }
        return days;
    }

    /**
     * What the anthro does on date: the plan's columns and names, and 'source': 'birthing' (its litter is due),
     * 'planned' (a day planned ahead) or 'routine'.
     */
    static planFor(anthro: Row, date: string): Row {
        return Schedules.upcoming(anthro, 1, date)[date];
    }

    /**
     * The anthro's plans for days days from from (today): {date: plan (see planFor)}.
     */
    static upcoming(anthro: Row, days = 14, from: string | null = null): Record<string, Row> {
        const week = Schedules.weekly(anthro.id);
        const planned = Schedules.planned(anthro.id);
        const start = Clock.parse(from ?? Clock.today());
        const plans: Record<string, Row> = {};
        for (let i = 0; i < days; i++) {
            const date = gmdate('Y-m-d', start + i * 86400);
            if (anthro.pregnant_due_on === date) {
                plans[date] = { ...Schedules.noDetails(), activity: 'birthing', source: 'birthing' };
            } else if (planned[date] !== undefined) {
                plans[date] = { source: 'planned', ...planned[date] };
            } else {
                plans[date] = { source: 'routine', ...week[Clock.weekday(date)] };
            }
        }
        return plans;
    }

    /**
     * Sets the anthro's weekly routine: days = {weekday: {activity, detail}} (see checked()). Every day is
     * checked before anything is saved. Returns an error message, or null.
     */
    static setWeekly(user: User, anthro: Row, days: Record<number, Row>): string | null {
        if (!Schedules.canPlan(user, anthro)) {
            return `You don't plan ${anthro.name}'s days.`;
        }
        if (Schedules.isResting(anthro)) {
            return `${anthro.name} is too young: under ` + Schedules.REST_WEEKS + ' weeks old, it only rests.';
        }
        const [rows, error] = Schedules.checkedWeek(Schedules.options(user, anthro), anthro.name, days);
        if (error) {
            return error;
        }
        const db = Auth.db();
        db.run('DELETE FROM game_schedule_weekly WHERE anthro_id = ?', [anthro.id]);
        for (const [weekday, row] of rows!) {
            if (row.activity !== 'rest') {
                Schedules.store('game_schedule_weekly', { anthro_id: anthro.id, weekday }, row, user.id);
            }
        }
        return null;
    }

    /**
     * Checks a week of plans (days = {weekday: {activity, detail}}, see checked()): [Map of weekday => row, null] or
     * [null, error message].
     */
    private static checkedWeek(options: PlanOptions, who: string, days: Record<number, Row>): [Map<number, Row> | null, string | null] {
        const rows = new Map<number, Row>();
        for (let weekday = 1; weekday <= 7; weekday++) {
            const [row, error] = Schedules.checked(options, who, str(days[weekday]?.activity ?? 'rest'), str(days[weekday]?.detail ?? ''));
            if (error) {
                return [null, Anthros.weekday(weekday) + `: ${error}`];
            }
            rows.set(weekday, row!);
        }
        return [rows, null];
    }

    static readonly MAX_STANDARD_NAME = 40;

    /**
     * The user's standard schedules, by name: [{id, name, followers (how many anthros follow it)}, ...].
     */
    static standards(userId: number): Row[] {
        return Auth.db().all(
            `SELECT s.id, s.name, (SELECT COUNT(*) FROM game_anthros a WHERE a.standard_schedule_id = s.id AND a.died_at IS NULL) AS followers
             FROM game_standard_schedules s WHERE s.user_id = ? ORDER BY s.name`,
            [userId],
        );
    }

    /**
     * One standard schedule: its row (id, user_id, name), with week (see weekly) and followers (the living
     * anthros following it, by name), or null.
     */
    static standard(id: number): Row | null {
        const standard = Auth.db().row('SELECT id, user_id, name FROM game_standard_schedules WHERE id = ?', [id]);
        if (!standard) {
            return null;
        }
        const followers = Auth.db().column('SELECT id FROM game_anthros WHERE standard_schedule_id = ? AND died_at IS NULL ORDER BY name, id', [id]);
        return {
            ...standard,
            week: Schedules.week('game_standard_days', 'schedule_id', id),
            followers: followers.map((a) => Anthros.findAny(int(a))),
        };
    }

    /**
     * Whether the user can change (and assign) the standard schedule: it's theirs, or they're an admin.
     */
    static ownsStandard(user: User, standard: Row): boolean {
        return int(standard.user_id) === user.id || Auth.isAdmin(user);
    }

    /**
     * The standard schedule the anthro follows (see standard), while the player who keeps it still plans the anthro
     * (see canPlan); otherwise null, and it's back on its own routine.
     */
    static standardFor(anthroId: number): Row | null {
        const id = Auth.db().value('SELECT standard_schedule_id FROM game_anthros WHERE id = ?', [anthroId]);
        const standard = id ? Schedules.standard(int(id)) : null;
        const keeper = standard ? Auth.find(int(standard.user_id)) : null;
        const anthro = keeper ? Anthros.findAny(anthroId) : null;
        return anthro && Schedules.canPlan(keeper!, anthro, false) ? standard : null;
    }

    /**
     * Starts a standard schedule, all rest. Returns [its id, null] or [null, error message].
     */
    static createStandard(user: User, name: string): [number | null, string | null] {
        const error = Schedules.standardNameError(user.id, name);
        if (error) {
            return [null, error];
        }
        Auth.db().run('INSERT INTO game_standard_schedules (user_id, name) VALUES (?, ?)', [user.id, trim(name)]);
        return [Auth.db().lastInsertId(), null];
    }

    static renameStandard(user: User, standard: Row, name: string): string | null {
        if (!Schedules.ownsStandard(user, standard)) {
            return "That schedule isn't yours.";
        }
        const error = Schedules.standardNameError(int(standard.user_id), name, int(standard.id));
        if (error) {
            return error;
        }
        Auth.db().run('UPDATE game_standard_schedules SET name = ? WHERE id = ?', [trim(name), standard.id]);
        return null;
    }

    /**
     * Removes a standard schedule: the anthros following it go back to their own routines. Returns an error, or null.
     */
    static deleteStandard(user: User, standard: Row): string | null {
        if (!Schedules.ownsStandard(user, standard)) {
            return "That schedule isn't yours.";
        }
        Auth.db().run('DELETE FROM game_standard_schedules WHERE id = ?', [standard.id]);
        return null;
    }

    /**
     * Sets a standard schedule's week (days as for setWeekly), checked against what its player can plan for their
     * anthros (see groupOptions); each follower's day is still checked when it comes (it can't breed with itself, say).
     * Returns an error message, or null.
     */
    static setStandardWeek(user: User, standard: Row, days: Record<number, Row>): string | null {
        if (!Schedules.ownsStandard(user, standard)) {
            return "That schedule isn't yours.";
        }
        const keeper = int(standard.user_id) === user.id ? user : Auth.find(int(standard.user_id))!;
        const [rows, error] = Schedules.checkedWeek(Schedules.groupOptions(keeper), standard.name, days);
        if (error) {
            return error;
        }
        Auth.db().run('DELETE FROM game_standard_days WHERE schedule_id = ?', [standard.id]);
        for (const [weekday, row] of rows!) {
            if (row.activity !== 'rest') {
                Schedules.store('game_standard_days', { schedule_id: standard.id, weekday }, row, keeper.id);
            }
        }
        return null;
    }

    /**
     * Has the anthro follow one of the user's standard schedules (standardId), or its own routine again (null).
     * Returns an error message, or null.
     */
    static follow(user: User, anthro: Row, standardId: number | null): string | null {
        if (!Schedules.canPlan(user, anthro)) {
            return `You don't plan ${anthro.name}'s days.`;
        }
        const standard = standardId === null ? null : Schedules.standard(standardId);
        if (standardId !== null && (!standard || !Schedules.ownsStandard(user, standard))) {
            return 'Choose one of your standard schedules.';
        }
        if (standard && !Schedules.canPlan(Auth.find(int(standard.user_id))!, anthro, false)) {
            return `${standard.name} is kept by a player who doesn't plan ${anthro.name}'s days.`;
        }
        Auth.db().run('UPDATE game_anthros SET standard_schedule_id = ? WHERE id = ?', [standardId, anthro.id]);
        return null;
    }

    private static standardNameError(userId: number, name: string, id = 0): string | null {
        name = trim(name);
        if (name === '' || mb_strlen(name) > Schedules.MAX_STANDARD_NAME) {
            return 'Name the schedule (up to ' + Schedules.MAX_STANDARD_NAME + ' characters).';
        }
        const same = Auth.db().value('SELECT COUNT(*) FROM game_standard_schedules WHERE user_id = ? AND name = ? AND id <> ?', [userId, name, id]);
        return same ? `You already have a schedule called ${name}.` : null;
    }

    /**
     * Plans one day (today to PLAN_AHEAD_DAYS ahead), breaking the routine. Not the day a litter is due: then it's
     * birthing. Returns an error message, or null.
     */
    static planDay(user: User, anthro: Row, date: string, activity: string, detail: string): string | null {
        if (!Schedules.canPlan(user, anthro)) {
            return `You don't plan ${anthro.name}'s days.`;
        }
        if (Schedules.isResting(anthro)) {
            return `${anthro.name} is too young: under ` + Schedules.REST_WEEKS + ' weeks old, it only rests.';
        }
        if (anthro.pregnant_due_on === date) {
            return `${anthro.name} is due to give birth that day, and can do nothing else.`;
        }
        // Upstream: DateTimeImmutable::createFromFormat('!Y-m-d', $date), and the date must read back the same.
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? strtotime(date + ' UTC') : false;
        const last = Clock.today(Schedules.PLAN_AHEAD_DAYS);
        if (parsed === false || gmdate('Y-m-d', parsed) !== date || date < Clock.today() || date > last) {
            return 'Choose a day from today to ' + last + '.';
        }
        const [row, error] = Schedules.checked(Schedules.options(user, anthro), anthro.name, activity, detail);
        if (error) {
            return error;
        }
        Auth.db().run('DELETE FROM game_schedule_days WHERE anthro_id = ? AND day = ?', [anthro.id, date]);
        Schedules.store('game_schedule_days', { anthro_id: anthro.id, day: date }, row!, user.id);
        return null;
    }

    /**
     * Takes a planned day back off (the routine applies again). Returns an error message, or null.
     */
    static unplanDay(user: User, anthro: Row, date: string): string | null {
        if (!Schedules.canPlan(user, anthro)) {
            return `You don't plan ${anthro.name}'s days.`;
        }
        Auth.db().run('DELETE FROM game_schedule_days WHERE anthro_id = ? AND day = ?', [anthro.id, date]);
        return null;
    }

    /**
     * What the anthro did lately, newest first: [{day, activity, outcome}, ...].
     */
    static log(anthroId: number, limit = 14): Row[] {
        return Auth.db().all('SELECT day, activity, outcome FROM game_schedule_log WHERE anthro_id = ? ORDER BY day DESC LIMIT ' + Math.max(1, limit), [anthroId]);
    }

    // What runToday did in this request (see TodaysWork). Upstream's $today, renamed: a static property can't share
    // the name of the method today() here.
    private static todaysWork: TodaysWork = { outcomes: new Map(), gathered: new Map() };

    /**
     * What runToday did in this request (see todaysWork).
     */
    static today(): TodaysWork {
        return Schedules.todaysWork;
    }

    /**
     * Carries out today's plans, once a day for the whole game (the game runs this on each request; the first of the
     * day does it): every living anthro with a routine (its own or a standard one) or a plan for today, and every dam
     * whose litter was due today. Plans made after that wait for tomorrow's. Returns how many were carried out.
     */
    static runToday(): number {
        const db = Auth.db();
        // The day's work happens once, with the rest of the day's business: not for each anthro as its plans appear.
        if (!db.run('INSERT OR IGNORE INTO game_daily (day, task) VALUES (' + Clock.sqlToday() + ", 'schedules')")) {
            return 0;
        }
        const today = Clock.today();
        const ids = db.column(
            `SELECT anthro_id FROM game_schedule_weekly WHERE weekday = ?
             UNION SELECT a.id FROM game_anthros a JOIN game_standard_days d ON d.schedule_id = a.standard_schedule_id WHERE d.weekday = ?
             UNION SELECT anthro_id FROM game_schedule_days WHERE day = ?
             UNION SELECT dam_id FROM game_litters WHERE due_on = ?`,
            [Clock.weekday(), Clock.weekday(), today, today],
        );
        Schedules.todaysWork = { outcomes: new Map(), gathered: new Map() };
        let done = 0;
        for (const id of ids) {
            // Claim the day first, so two requests can't both carry it out.
            if (!db.run("INSERT OR IGNORE INTO game_schedule_log (anthro_id, day, activity) VALUES (?, ?, 'rest')", [id, today])) {
                continue;
            }
            const anthro = Anthros.findAny(int(id));
            if (!anthro || Anthros.isDead(anthro)) {
                continue;
            }
            // A litter born today (see Litters::deliverDue) makes it a birthing day.
            const born = db.value('SELECT COUNT(*) FROM game_litters WHERE dam_id = ? AND due_on = ? AND born_at IS NOT NULL', [id, today]);
            const plan: Row = born ? { activity: 'birthing' } : (Schedules.isResting(anthro) ? { activity: 'rest' } : Schedules.planFor(anthro, today));
            let outcome: string;
            if (Goods.isHungry(anthro) && !['rest', 'forage', 'birthing'].includes(plan.activity)) {
                outcome = 'Too hungry to ' + Schedules.LABELS[plan.activity].toLowerCase() + ': rested.';
                plan.activity = 'rest';
            } else {
                outcome = Schedules.carryOut(anthro, plan);
            }
            db.run('UPDATE game_schedule_log SET activity = ?, outcome = ? WHERE anthro_id = ? AND day = ?', [plan.activity, outcome, id, today]);
            Schedules.todaysWork.outcomes.set(int(id), outcome);
            done++;
        }
        return done;
    }

    /**
     * An anthro that keeps itself sells what it has made, at the market's sell prices: everything but what it eats and
     * what its trade uses. Returns what it sold, as a sentence (or '').
     */
    private static sellMade(anthro: Row, plan: Row): string {
        let keep = Goods.edibles();
        let recipe: Recipe | null;
        if ((plan.occupation_id ?? null) !== null && (recipe = Crafts.recipeFor(int(plan.occupation_id), plan.recipe_id ?? null))) {
            keep = [...keep, ...Object.keys(recipe.in)];
        }
        const sold: string[] = [];
        for (const [good, row] of Object.entries(Market.goods())) {
            const quantity = Goods.amount(anthro.id, good);
            if (quantity < 1 || keep.includes(good) || row.sell_price === null) {
                continue;
            }
            if (Goods.take(anthro.id, good, quantity)) {
                Wallets.change(anthro.id, quantity * int(row.sell_price), `Sold ${quantity} ` + Crafts.goodName(good) + ' at the market');
                sold.push(quantity + ' ' + Crafts.goodName(good));
            }
        }
        return sold.length ? ' Sold ' + sold.join(', ') + '.' : '';
    }

    /**
     * Does the day's plan (an anthro that keeps itself, buys, buys the materials its work needs: see Crafts::work).
     * Returns what came of it, for the anthro's log.
     */
    private static carryOut(anthro: Row, plan: Row, buys = false): string {
        switch (plan.activity) {
            case 'birthing':
                return 'Gave birth.';
            case 'train': {
                if (plan.skill_id == null) {
                    return 'Meant to train, but the skill is gone.';
                }
                const level = Schedules.practise(anthro, int(plan.skill_id));
                return plan.mentor_name != null ? `Learned ${plan.skill_name} from ${plan.mentor_name} (${level}).` : `Trained: ${plan.skill_name} (${level}).`;
            }
            case 'work': {
                if (plan.occupation_id == null) {
                    return 'Meant to work, but the occupation is gone.';
                }
                if (!Schedules.learned(anthro.id).includes(int(plan.occupation_skill_id))) {
                    return `Meant to work as ${plan.occupation_title}, but hasn't trained at ${plan.occupation_skill} yet: rested.`;
                }
                const master = Schedules.masterOf(anthro);
                // A producer or craftsman makes goods (see Crafts): its pay. Short of materials or land, it rests.
                const recipe = Crafts.recipeFor(int(plan.occupation_id), plan.recipe_id ?? null);
                if (recipe) {
                    const practice = Auth.db().value('SELECT practice FROM game_anthro_skills WHERE anthro_id = ? AND skill_id = ?', [anthro.id, plan.occupation_skill_id]);
                    const [outcome, made] = Crafts.work(anthro, plan, recipe, Schedules.level(int(practice)), master, buys);
                    if (made === null) {
                        return outcome;
                    }
                    Schedules.practise(anthro, int(plan.occupation_skill_id));
                    for (const [good, quantity] of Object.entries(made)) {
                        Schedules.gathered(master!.id, good, quantity);
                    }
                    return outcome;
                }
                const level = Schedules.practise(anthro, int(plan.occupation_skill_id));
                const pay = Schedules.PAY[level];
                if (master) {
                    Wallets.change(master.id, pay, `${anthro.name} worked as ${plan.occupation_title}`);
                    Schedules.gathered(master.id, 'coins', pay);
                }
                return `Worked as ${plan.occupation_title} (${plan.occupation_skill}: ${level}), earning ` + Wallets.format(pay)
                    + (master && master.id !== anthro.id ? ` for ${master.name}` : '') + '.';
            }
            case 'clear':
                return Schedules.clear(anthro, plan);
            case 'build': {
                const building = plan.building_id == null ? null : Buildings.find(int(plan.building_id));
                const master = Schedules.masterOf(anthro);
                if (!building || !master || building.holder_id !== master.id) {
                    return 'Meant to build, but the building is no longer there to work on.';
                }
                return Buildings.work(building, anthro);
            }
            case 'forage': {
                const master = Schedules.masterOf(anthro);
                if (!master) {
                    return 'Foraged, but had no one to forage for.';
                }
                const food = random_int(Schedules.FORAGE_FOOD[0], Schedules.FORAGE_FOOD[1]);
                Goods.add(master.id, 'food', food);
                Schedules.gathered(master.id, 'food', food);
                return `Foraged ${food} food` + (master.id === anthro.id ? '' : ` for ${master.name}`) + '.';
            }
            case 'breed':
                return Schedules.breed(anthro, plan);
            default:
                return 'Rested.';
        }
    }

    private static gathered(masterId: number, good: string, quantity: number): void {
        let goods = Schedules.todaysWork.gathered.get(masterId);
        if (!goods) {
            goods = {};
            Schedules.todaysWork.gathered.set(masterId, goods);
        }
        goods[good] = (goods[good] ?? 0) + quantity;
    }

    /**
     * A day's practice at a skill. Returns the anthro's level at it now.
     */
    private static practise(anthro: Row, skillId: number): string {
        Auth.db().run(
            `INSERT INTO game_anthro_skills (anthro_id, skill_id, practice) VALUES (?, ?, 1)
             ON CONFLICT (anthro_id, skill_id) DO UPDATE SET practice = practice + 1`,
            [anthro.id, skillId],
        );
        const practice = Auth.db().value('SELECT practice FROM game_anthro_skills WHERE anthro_id = ? AND skill_id = ?', [anthro.id, skillId]);
        return Schedules.level(int(practice));
    }

    /**
     * A day's clearing: CLEAR_ACRES of the wilds (or the planned expanse) become land of the anthro's master, added
     * to its lot there (a new one if it has none). Returns what came of it.
     */
    private static clear(anthro: Row, plan: Row): string {
        const master = Schedules.masterOf(anthro);
        if (!master || !Anthros.isFree(master)) {
            return 'Cleared land, but had no one free to hold it.';
        }
        const db: Db = Auth.db();
        const partId = plan.part_id == null ? null : int(plan.part_id);
        let baronyId: number | null = null;
        if (partId !== null) {
            baronyId = int(db.value('SELECT barony_id FROM game_barony_parts WHERE id = ?', [partId]));
        }
        // Its own land there (never a fief: land held of a lord isn't the clearer's to grow). MariaDB's null-safe <=> is
        // SQLite's IS.
        let lotId = db.value(
            'SELECT id FROM game_parcels WHERE anthro_id = ? AND held_of IS NULL AND barony_id IS ? AND part_id IS ? ORDER BY acres DESC, id LIMIT 1',
            [master.id, baronyId, partId],
        );
        if (lotId) {
            db.run('UPDATE game_parcels SET acres = acres + ? WHERE id = ?', [Schedules.CLEAR_ACRES, lotId]);
        } else {
            db.run('INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (?, ?, ?, ?)', [master.id, Schedules.CLEAR_ACRES, baronyId, partId]);
            lotId = db.lastInsertId();
        }
        Goods.add(master.id, 'lumber', Schedules.CLEAR_LUMBER);
        Schedules.gathered(master.id, 'lumber', Schedules.CLEAR_LUMBER);
        const total = Land.acres(Land.parcel(int(lotId))!.acres);
        return 'Cleared ' + Land.acres(Schedules.CLEAR_ACRES) + ' in ' + (partId === null ? 'the wilds' : plan.part_name)
            + (master.id === anthro.id ? '' : ` for ${master.name}`) + ` (lot #${lotId} is ${total} now), and `
            + Schedules.CLEAR_LUMBER + ' lumber.';
    }

    /**
     * A breeding day: with the planned partner (if whoever planned it still has both), or a random other member of
     * the planned group (if it's still in it). Returns what came of it.
     */
    private static breed(anthro: Row, plan: Row): string {
        const planner = plan.set_by == null ? null : Auth.find(int(plan.set_by));
        let partner: Row | null;
        let groupId: number | null;
        if (plan.group_id != null) {
            const group = Groups.find(int(plan.group_id));
            const others: Row[] = group ? group.members.filter((m: Row) => m.id !== anthro.id) : [];
            if (!group || others.length === group.members.length) {
                return 'Meant to breed in a group it is no longer in.';
            }
            if (!others.length) {
                return `Meant to breed in ${group.name}, but no one else is in it.`;
            }
            partner = pick(others);
            groupId = int(group.id);
        } else {
            partner = plan.partner_anthro_id == null ? null : Anthros.findAny(int(plan.partner_anthro_id));
            const decides = planner && (Auth.isAdmin(planner)
                || (Anthros.findControlled(planner.id, anthro.id) && partner && Anthros.findControlled(planner.id, partner.id)));
            if (partner && partner.id === anthro.id) {
                return `Meant to breed with ${anthro.name}: itself.`;
            }
            if (!partner || Anthros.isDead(partner) || !decides) {
                return 'Meant to breed, but the partner is no longer there to breed with.';
            }
            groupId = null;
        }
        if (anthro.auction_id != null || partner!.auction_id != null) {
            return `Meant to breed with ${partner!.name}, but one of them is up for auction.`;
        }
        const refusal = Preferences.breedingRefusal(planner?.id ?? null, anthro, partner);
        if (refusal) {
            return `Didn't breed with ${partner!.name}: ${refusal}`;
        }
        // Take the roles the pair can fill; a pair that can't is still recorded, with no litter.
        const [sire, dam] = !anthro.is_male && partner!.is_male ? [partner!, anthro] : [anthro, partner!];
        const outcome = Litters.attempt(sire, dam, planner?.id ?? null, false, groupId);
        return `Bred with ${partner!.name}: ` + (outcome.litter
            ? `${dam.name} is expecting a litter of ${outcome.litter.cubs}.`
            : `no litter (${outcome.barren}).`);
    }

    /**
     * Checks one day's plan against the choices there are (options: see options, or groupOptions for a standard
     * schedule; who is whose plan it is, for messages): [row (activity and DETAILS), null] or [null, error message].
     * detail names who or what:
     * to breed, "p:<anthro id>" or "g:<group id>"; to train, "s:<skill id>"; to work, "o:<occupation id>" (at an
     * occupation; "o:<occupation id>:<recipe id>" for one of its recipes: see Crafts), "c:<part id>" or "c:wilds" (clearing an expanse or the wilds), "b:<building id>" (building) or "f"
     * (foraging).
     */
    private static checked(options: PlanOptions, who: string, activity: string, detail: string): [Row | null, string | null] {
        if (!(activity in Schedules.ACTIVITIES)) {
            return [null, 'Choose rest, breed, work or train.'];
        }
        // explode(':', $detail, 2), padded to two parts.
        const colon = detail.indexOf(':');
        const [kind, id] = colon < 0 ? [detail, ''] : [detail.slice(0, colon), detail.slice(colon + 1)];
        const row: Row = { activity, ...Schedules.noDetails() };
        if (activity === 'rest') {
            return [row, null];
        }
        if (activity === 'breed') {
            if (kind === 'p' && options.partners.map((a) => a.id).includes(int(id))) {
                return [{ ...row, partner_anthro_id: int(id) }, null];
            }
            if (kind === 'g' && options.groups.has(int(id))) {
                return [{ ...row, group_id: int(id) }, null];
            }
            return [null, !empty(options.partners) || !empty(options.groups)
                ? 'Choose who to breed with, or which breeding group.'
                : `${who} has no one you can breed with.`];
        }
        if (activity === 'train') {
            return kind === 's' && options.skills.has(int(id))
                ? [{ ...row, skill_id: int(id) }, null]
                : [null, 'Choose a skill to train.'];
        }
        if (kind === 'o') {
            // array_pad(array_map('intval', explode(':', $id, 2)), 2, 0)
            const at = id.indexOf(':');
            const [occupationId, recipeId] = at < 0 ? [int(id), 0] : [int(id.slice(0, at)), int(id.slice(at + 1))];
            const recipes = (options.recipes?.get(occupationId) ?? Crafts.recipesOf(occupationId)).map((r) => r.id);
            if (options.occupations.has(occupationId) && (!recipeId || recipes.includes(recipeId))) {
                return [{ ...row, occupation_id: occupationId, recipe_id: recipeId || null }, null];
            }
        }
        if (kind === 'c' && id === 'wilds') {
            return [{ ...row, activity: 'clear' }, null];
        }
        if (kind === 'c' && options.places.has(int(id))) {
            return [{ ...row, activity: 'clear', part_id: int(id) }, null];
        }
        if (kind === 'b' && options.sites.map((s) => int(s.id)).includes(int(id))) {
            return [{ ...row, activity: 'build', building_id: int(id) }, null];
        }
        if (kind === 'f') {
            return [{ ...row, activity: 'forage' }, null];
        }
        return [null, 'Choose what to work at: an occupation, clearing land, building or foraging.'];
    }

    /**
     * Saves a checked plan (a routine day, a standard schedule's day or a planned day) under its key ({column: value}).
     */
    private static store(table: string, key: Row, row: Row, userId: number): void {
        const columns = [...Object.keys(key), 'activity', ...Schedules.DETAILS, 'set_by'];
        Auth.db().run(
            `INSERT INTO ${table} (` + columns.join(', ') + ') VALUES (' + columns.map(() => '?').join(', ') + ')',
            [...Object.values(key), row.activity, ...Schedules.DETAILS.map((c) => row[c]), userId],
        );
    }

    /** array_fill_keys(self::DETAILS, null). */
    private static noDetails(): Row {
        return Object.fromEntries(Schedules.DETAILS.map((c) => [c, null]));
    }

    // A plan's who and what.
    private static readonly DETAILS = ['partner_anthro_id', 'group_id', 'skill_id', 'occupation_id', 'recipe_id', 'part_id', 'building_id'];
    // A plan's columns, with the names of its partner, group, skill, occupation, place and building.
    private static readonly PLAN_SELECT = `SELECT p.*, pa.name AS partner_name, g.name AS group_name, s.name AS skill_name,
                                        o.title AS occupation_title, os.name AS occupation_skill, o.skill_id AS occupation_skill_id, r.name AS recipe_name,
                                        pt.name AS part_name, bt.name AS building_name, bl.parcel_id AS building_lot`;
    private static readonly PLAN_JOINS = ` LEFT JOIN game_anthros pa ON pa.id = p.partner_anthro_id
                                 LEFT JOIN game_breeding_groups g ON g.id = p.group_id
                                 LEFT JOIN game_skills s ON s.id = p.skill_id
                                 LEFT JOIN game_occupations o ON o.id = p.occupation_id
                                 LEFT JOIN game_skills os ON os.id = o.skill_id
                                 LEFT JOIN game_recipes r ON r.id = p.recipe_id
                                 LEFT JOIN game_barony_parts pt ON pt.id = p.part_id
                                 LEFT JOIN game_buildings bl ON bl.id = p.building_id
                                 LEFT JOIN game_building_types bt ON bt.id = bl.type_id`;
}

onReset(() => {
    Schedules['todaysWork'] = { outcomes: new Map(), gathered: new Map() };
});
