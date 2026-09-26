// Upstream: game/src/Board.php
import { Auth } from '../core/Auth';
import { array_sum, ctype_digit, gmdate, int, number_format, randomHex, str, strtotime, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Aging } from './Aging';
import { Anthros } from './Anthros';
import { Auctions } from './Auctions';
import { Baronies } from './Baronies';
import { Clock } from './Clock';
import { Crafts } from './Crafts';
import { Fiefs } from './Fiefs';
import { Goods } from './Goods';
import { Jobs } from './Jobs';
import { Litters } from './Litters';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';
import { Schedules } from './Schedules';
import { Urges } from './Urges';
import { Wallets } from './Wallets';

/**
 * Resetting the whole game: every anthro (players' included), all land and baronies, and everything that happened
 * are deleted, and every player starts over by creating an anthro. The admin chooses how many title holders of each
 * rank the new game starts with (none: it starts empty, and the first player can also start with a slave to breed
 * with: see Anthros::createStarterSlave), and whether they get baronies, settlements and commoners. There's always at
 * least one barony: without a court to seat one, an empty one (see Baronies::foundEmpty). Species, genders, names and
 * ranks are kept, as are site accounts.
 */
export class Board {
    static readonly CONFIRM_WORD = 'RESET';

    // Game state, children before parents, so rows are deleted before what they refer to.
    static readonly TABLES = [
        'game_daily', 'game_settings', 'game_fief_offers', 'game_proposals', 'game_standard_days', 'game_standard_schedules', 'game_schedule_log', 'game_schedule_days', 'game_schedule_weekly', 'game_anthro_skills', 'game_goods', 'game_buildings', 'game_bids', 'game_auctions', 'game_land_listings', 'game_parcels', 'game_barony_parts', 'game_baronies', 'game_ledger', 'game_wallets',
        'game_notifications', 'game_renames', 'game_transfers', 'game_reset_requests', 'game_flirts', 'game_group_requests', 'game_group_members',
        'game_breedings', 'game_breeding_groups', 'game_litters', 'game_anthros',
    ];

    // The most title holders of one rank a reset makes.
    static readonly MAX_PER_RANK = 1000;

    // The most days an admin can advance the game at once.
    static readonly MAX_ADVANCE = 365;

    /**
     * The game's business for every game day that has passed since it was last done, in order (see Clock; at most
     * Clock::MAX_CATCH_UP in one request), and then for today, as far as it's due: the game runs this on each request.
     */
    static runDaily(): void {
        Clock.sync();
        const today = Clock.today();
        const done = Clock.doneThrough();
        let day = done === null ? today : Clock.add(done, 1);
        for (let n = 0; day < today && n < Clock.MAX_CATCH_UP; n++, day = Clock.add(day, 1)) {
            Clock.processing(day);
            try {
                Board.runDay();
                Clock.done(day);
            } finally {
                Clock.processing(null);
            }
        }
        if (day === today) {
            // Today's business, as far as it's due yet (each part does only what hasn't been done).
            Board.runDay();
            Clock.done(Clock.add(today, -1));
        }
    }

    /**
     * One day's business (the day Clock says is today; each part only does what hasn't been done): litters born, the
     * young grown up, the old dead, everyone fed, schedules carried out, auctions closed, wages paid (and anthros nobody
     * plans doing their default days), dams' urges rolled, titles held by land kept to the land, lieges and holdings kept
     * in order.
     */
    private static runDay(): void {
        Litters.deliverDue();
        Anthros.comeOfAge();
        Aging.buryDue();
        Goods.feedToday();
        Schedules.runToday();
        Schedules.runDefaults();
        Fiefs.assessToday();
        Board.reportDay();
        Auctions.closeDue();
        Jobs.payDue();
        Urges.rollToday();
        Fiefs.reconcile();
        Ranks.holdByLand();
        Ranks.assignLieges();
        Baronies.settle();
    }

    /**
     * Once a day, after everyone has eaten and done their day's plans: each played keeper (see Goods::keeperOf) is told
     * how its household's day went, what each did, the food (and lumber) gathered and eaten and what's left in store,
     * the meals it bought, and who went hungry. An anthro kept by someone else, but played, is told how its own day went.
     */
    private static reportDay(): void {
        // meals: eaten and bought are Maps of keeper id => count, hungry a list of ids; today: outcomes a Map of
        // anthro id => text, gathered a Map of keeper id => {good: how much} (see Goods.meals, Schedules.today).
        const meals = Goods.meals();
        if (meals === null) {
            return;
        }
        const today = Schedules.today();
        const hungry = new Set<number>(meals.hungry);
        // $meals['eaten'] + $today['gathered']: eaten's keepers, then gathered's others.
        const keepers = [...new Set<number>([...meals.eaten.keys(), ...today.gathered.keys()])];
        for (const keeperId of keepers) {
            const keeper = Anthros.findAny(keeperId);
            if (!keeper || keeper.player_id === null || Anthros.isDead(keeper)) {
                continue;
            }
            const lines: string[] = [];
            const starved: string[] = [];
            for (const memberId of Goods.household(keeperId)) {
                const member = memberId === keeperId ? keeper : Anthros.findAny(memberId)!;
                if (today.outcomes.get(memberId) != null) {
                    lines.push(`${member.name}: ${today.outcomes.get(memberId)}`);
                }
                if (hungry.has(memberId)) {
                    starved.push(member.name);
                }
            }
            const gathered: Record<string, number> = today.gathered.get(keeperId) ?? {};
            const bought: number = meals.bought.get(keeperId) ?? 0;
            // Food is every edible good (see Goods::edibles); the rest of what was made or gathered is listed after.
            const edibles = Goods.edibles();
            lines.push('Food: ' + Object.entries(gathered).filter(([good]) => edibles.includes(good)).reduce((sum, [, n]) => sum + n, 0)
                + ' gathered, ' + (meals.eaten.get(keeperId) ?? 0) + ' eaten, '
                + Goods.food(keeperId) + ' in store.'
                + (bought ? ' Bought ' + (bought === 1 ? 'a meal' : `${bought} meals`) + ' at the market for ' + Wallets.format(bought * int(Goods.mealPrice())) + '.' : ''));
            const other = Object.entries(gathered).filter(([good]) => ![...edibles, 'coins'].includes(good));
            if (other.length) {
                lines.push('Made or gathered: ' + other.map(([good, n]) => n + ' ' + Crafts.goodName(good) + ' (' + Goods.amount(keeperId, good) + ' in store)').join(', ') + '.');
            }
            const tax = Fiefs.assessed().get(keeperId) ?? null;
            if (tax) {
                const balance = Number(Anthros.findAny(keeperId)!.tax_balance);
                lines.push('Tax: ' + Fiefs.coins(tax.owed) + "' worth owed to " + Anthros.findAny(tax.lord)!.name
                    + (balance > 0 ? ' (' + Fiefs.coins(balance) + ' owed in all).' : ' (paid from your credit: ' + Fiefs.coins(-balance) + ' left).'));
            }
            if (starved.length) {
                lines.push('Went hungry: ' + starved.join(', ') + '.');
            }
            // Its own key, so each day's report stands on its own (reports aren't squashed together).
            Notifications.toAnthro(keeperId, "The day's report. " + lines.join(' '), '/game/assets/goods', 'day:' + randomHex(6));
        }
        for (const [anthroId, outcome] of today.outcomes) {
            const anthro = Anthros.findAny(anthroId);
            const keeperId = anthro ? Goods.keeperOf(anthro) : null;
            const keeper = keeperId === null || keeperId === anthroId ? null : Anthros.findAny(keeperId);
            if (anthro && anthro.player_id !== null && keeper && keeper.player_id !== anthro.player_id) {
                Notifications.toAnthro(anthroId, `Your day: ${outcome}` + (hungry.has(anthroId) ? ' You went hungry.' : ''),
                    '/game/assets/' + anthroId + '/schedule', 'day:' + randomHex(6));
            }
        }
    }

    /**
     * Admin: moves the game $days days ahead: the clock moves on, and each day's business is done in turn (see
     * runDaily). Returns an error message, or null.
     */
    static advance(admin: Row, days: number): string | null {
        if (days < 1 || days > Board.MAX_ADVANCE) {
            return 'Advance the game 1 to ' + Board.MAX_ADVANCE + ' days.';
        }
        Clock.advance(days);
        Board.runDaily();
        Notifications.toAdmins(`${admin.username} moved the game ${days} ` + (days === 1 ? 'day' : 'days') + ' ahead.', '/game/admin/time');
        return null;
    }

    /**
     * Row counts of the game state, for the confirmation page.
     */
    static counts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const table of Board.TABLES) {
            counts[table] = int(Auth.db().value(`SELECT COUNT(*) FROM ${table}`));
        }
        return counts;
    }

    /**
     * Deletes all game state in one transaction, then seats the court asked for ($counts = [rank => how many], King
     * down to knight; the King with a Queen consort if $consort; see Ranks::createRanks), with its baronies, settlements
     * and commoners if $settle, the game's clock starting on $start ('Y-m-d': see Clock), and at least $places
     * ['commoners' => how many (see Ranks::fillCommoners), 'village'/'town'/'city' => how many (see
     * Baronies::addSettlements)], and tells the admins who did it.
     * The site's database account can only change rows (not TRUNCATE), so ids carry on from where they were. Returns an
     * error message, or null.
     *
     * counts: rank => how many (form values: strings or numbers). Here the ids carry on too: the tables are
     * AUTOINCREMENT, so SQLite never reuses an id, even after DELETE.
     */
    // The most villages, towns or cities a reset founds of each kind.
    static readonly MAX_SETTLEMENTS = 200;

    static reset(admin: Row, confirm: string, counts: Record<number, unknown> = {}, consort = true, settle = true,
                 start: string = Clock.START, places: Record<string, unknown> = {}): string | null {
        if (confirm !== Board.CONFIRM_WORD) {
            return 'Type ' + Board.CONFIRM_WORD + ' to confirm.';
        }
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(start) ? strtotime(start + ' UTC') : false;
        if (parsed === false || gmdate('Y-m-d', parsed) !== start || start < '1000-01-01') {
            return 'Start the game on a date (year 1000 or later), like ' + Clock.START + '.';
        }
        // rank => how many, King first.
        const wanted = new Map<number, number>();
        for (let rank = Ranks.KING; rank >= Ranks.KNIGHT; rank--) {
            const count = trim(str(counts[rank] ?? '0'));
            const max = rank === Ranks.KING ? 1 : Board.MAX_PER_RANK;
            if (!ctype_digit(count === '' ? '0' : count) || int(count) > max) {
                return Ranks.name(rank) + ': 0 to ' + max + (rank === Ranks.KING ? ' (there is one monarch).' : '.');
            }
            wanted.set(rank, int(count));
        }
        const want: Record<string, number> = { commoners: Ranks.MIN_COMMONERS };
        const ranges: [string, number, number][] = [['commoners', Ranks.MIN_COMMONERS, Ranks.MAX_COMMONERS], ['village', 0, Board.MAX_SETTLEMENTS],
            ['town', 0, Board.MAX_SETTLEMENTS], ['city', 0, Board.MAX_SETTLEMENTS]];
        for (const [what, min, max] of ranges) {
            const value = trim(str(places[what] ?? ''));
            if (value === '') {
                continue;
            }
            if (!ctype_digit(value) || int(value) < min || int(value) > max) {
                return ({ commoners: 'Commoners', village: 'Villages', town: 'Towns', city: 'Cities' } as Record<string, string>)[what] + `: ${min} to ` + number_format(max) + '.';
            }
            want[what] = int(value);
        }
        const anthros = Board.counts().game_anthros;
        const db = Auth.db();
        db.beginTransaction();
        // Anthros point at each other (parents, lieges) and at breedings; unlink them so they delete in any order.
        db.exec('UPDATE game_anthros SET sire_id = NULL, dam_id = NULL, liege_id = NULL, breeding_id = NULL, spouse_of = NULL');
        for (const table of Board.TABLES) {
            db.exec(`DELETE FROM ${table}`);
        }
        Clock.forget();
        Clock.start(start);
        // The court asked for, if any: its baronies and settlements, and its commoners (see Ranks::createCommoners).
        const court = array_sum(wanted.values()) ? Ranks.createRanks(wanted, consort) : 0;
        let commoners = 0;
        if (court && settle) {
            Baronies.createForCourt();
            commoners = Ranks.createCommoners();
            Baronies.layOut();
        }
        // There's always at least one barony: with none seated, an empty one, its land the land office's.
        let barony: string | null = null;
        if (!int(db.value('SELECT COUNT(*) FROM game_baronies'))) {
            const [, acres] = Baronies.foundEmpty(db);
            barony = number_format(acres) + ' acres';
        }
        // The villages, towns and cities asked for; and the commoners (at least Ranks::MIN_COMMONERS, more if they came
        // with the court), every trade among them.
        const founded = Baronies.addSettlements(want, db);
        commoners += Ranks.fillCommoners(want.commoners);
        Schedules.spreadTrades();
        db.commit();
        if (court) {
            Ranks.assignLieges();
        }
        Notifications.toAdmins(`${admin.username} reset the game (starting on ${start}), removing ${anthros} ` + (anthros === 1 ? 'anthro' : 'anthros') + (court
            ? `, and seated a court of ${court} title holders and ${commoners} commoners.`
            : `, and seated ${commoners} commoners, with no court.`)
            + ' Every trade is someone\'s.' + (founded ? ` ${founded} more ` + (founded === 1 ? 'settlement was' : 'settlements were') + ' founded.' : '')
            + (barony ? ` An empty barony of ${barony} awaits a holder.` : ''), '/game/home');
        return null;
    }
}
