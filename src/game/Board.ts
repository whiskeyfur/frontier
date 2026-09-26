// Upstream: game/src/Board.php
import { Auth } from '../core/Auth';
import { array_sum, ctype_digit, int, number_format, randomHex, str, trim } from '../core/php';
import type { Row } from '../db/Db';
import { dateColumns } from '../db/meta';
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

    // Here, not upstream: how far (in days, about 2,700 years) Board.advance parks dates on their way back a day.
    private static readonly PARKING_DAYS = 1000000;

    /**
     * The day's business, due whenever the game is used (the game runs this on each request; each part only does what
     * hasn't been done): litters born, the young grown up, the old dead, everyone fed, schedules carried out, auctions
     * closed, wages paid (and anthros nobody plans doing their default days), dams' urges rolled, titles held by land kept to the land, lieges and holdings kept in order.
     */
    static runDaily(): void {
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
     * Admin: moves the game $days days ahead, a day at a time: every date and time in the game's state moves a day
     * earlier (so today is a day later, as far as the game can tell), and then that day's business is done (see
     * runDaily). Saved games and site accounts aren't touched. Returns an error message, or null.
     */
    static advance(admin: Row, days: number): string | null {
        if (days < 1 || days > Board.MAX_ADVANCE) {
            return 'Advance the game 1 to ' + Board.MAX_ADVANCE + ' days.';
        }
        const db = Auth.db();
        // Upstream reads these from information_schema (in table name order).
        const columns = new Map<string, string[]>();
        for (const table of [...Board.TABLES].sort()) {
            const names = dateColumns(table);
            if (names.length) {
                columns.set(table, names);
            }
        }
        for (let day = 0; day < days; day++) {
            db.beginTransaction();
            for (const [table, names] of columns) {
                // A day that's part of a row's key moves oldest first, so no two rows share one on the way. (Upstream:
                // UPDATE ... ORDER BY `day`. SQLite has no ORDER BY on UPDATE and checks keys row by row, so those
                // tables' dates go far into the future first, where no row has one, and then come back a day earlier.)
                if (names.includes('day')) {
                    const park = names.map((c) => `\`${c}\` = ADDDATE(\`${c}\`, ${Board.PARKING_DAYS})`).join(', ');
                    db.exec(`UPDATE \`${table}\` SET ${park}`);
                    const back = names.map((c) => `\`${c}\` = SUBDATE(\`${c}\`, ${Board.PARKING_DAYS + 1})`).join(', ');
                    db.exec(`UPDATE \`${table}\` SET ${back}`);
                    continue;
                }
                const set = names.map((c) => `\`${c}\` = SUBDATE(\`${c}\`, 1)`).join(', ');
                db.exec(`UPDATE \`${table}\` SET ${set}`);
            }
            // Today is the next day of the game: its weekday moves on too.
            Clock.advance();
            db.commit();
            Board.runDaily();
        }
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
     * and commoners if $settle, and tells the admins who did it. The site's database account can only change rows (not
     * TRUNCATE), so ids carry on from where they were. Returns an error message, or null.
     *
     * counts: rank => how many (form values: strings or numbers). Here the ids carry on too: the tables are
     * AUTOINCREMENT, so SQLite never reuses an id, even after DELETE.
     */
    static reset(admin: Row, confirm: string, counts: Record<number, unknown> = {}, consort = true, settle = true): string | null {
        if (confirm !== Board.CONFIRM_WORD) {
            return 'Type ' + Board.CONFIRM_WORD + ' to confirm.';
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
        const anthros = Board.counts().game_anthros;
        const db = Auth.db();
        db.beginTransaction();
        // Anthros point at each other (parents, lieges) and at breedings; unlink them so they delete in any order.
        db.exec('UPDATE game_anthros SET sire_id = NULL, dam_id = NULL, liege_id = NULL, breeding_id = NULL, spouse_of = NULL');
        for (const table of Board.TABLES) {
            db.exec(`DELETE FROM ${table}`);
        }
        Clock.forget();
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
        db.commit();
        if (court) {
            Ranks.assignLieges();
        }
        Notifications.toAdmins(`${admin.username} reset the game, removing ${anthros} ` + (anthros === 1 ? 'anthro' : 'anthros') + (court
            ? `, and seated a court of ${court} title holders` + (commoners ? ` and ${commoners} commoners.` : '.')
            : '. The game is empty: the first player to create an anthro can start with a slave to breed with.')
            + (barony ? ` An empty barony of ${barony} awaits a holder.` : ''), '/game/home');
        return null;
    }
}
