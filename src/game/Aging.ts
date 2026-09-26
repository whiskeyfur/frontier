// Upstream: game/src/Aging.php
import { Auth } from '../core/Auth';
import { int } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Auctions } from './Auctions';
import { Goods } from './Goods';
import { Groups } from './Groups';
import { Jobs } from './Jobs';
import { Land } from './Land';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';
import { Wallets } from './Wallets';

/**
 * Aging: every anthro lives lifespan_weeks (a random LIFESPAN_MIN-LIFESPAN_MAX weeks, see Anthros), which players
 * never see. On the day it reaches that age it dies of old age. Anthros with no birthdate don't age.
 *
 * A dead anthro stays in the game (its family and history still show) but owns itself and holds nothing: its coins,
 * goods, land and anthros go to its heir (see heir), a hereditary title passes on (see Ranks::strip), its job ends, it leaves
 * its breeding groups, an unborn litter is lost, and its player is released to create or become another anthro.
 */
export class Aging {
    /**
     * Every living anthro whose lifespan has run out dies. The game runs this on each request, after litters are
     * delivered. Returns how many died.
     */
    static buryDue(): number {
        const ids = Auth.db().column(
            `SELECT id FROM game_anthros
             WHERE died_at IS NULL AND birthdate IS NOT NULL AND lifespan_weeks IS NOT NULL
               AND ADDDATE(birthdate, lifespan_weeks * 7) <= UTC_DATE()
             ORDER BY birthdate, id`,
        );
        let died = 0;
        for (const id of ids) {
            died += int(Aging.die(int(id)));
        }
        return died;
    }

    /**
     * Who inherits the anthro's estate: an owned anthro's owner, or else a free anthro's eldest living free child,
     * or else its liege. Null if there's no one (its land goes to the land office, its anthros go free, and its
     * coins leave the game).
     */
    static heir(anthro: Row): Row | null {
        if (anthro.owner_id != null && anthro.owner_id !== anthro.id) {
            const owner = Anthros.findAny(int(anthro.owner_id));
            if (owner && !Anthros.isDead(owner)) {
                return owner;
            }
        }
        const child = Auth.db().value(
            'SELECT a.id FROM game_anthros a WHERE (a.sire_id = ? OR a.dam_id = ?) AND a.id <> ? AND ' + Anthros.freeSql('a')
            + ' ORDER BY a.birthdate IS NULL, a.birthdate, a.id LIMIT 1',
            [anthro.id, anthro.id, anthro.id],
        );
        if (child) {
            return Anthros.findAny(int(child));
        }
        let liege: Row | null;
        if (anthro.liege_id != null && (liege = Anthros.findAny(int(anthro.liege_id))) && !Anthros.isDead(liege)) {
            return liege;
        }
        return null;
    }

    /**
     * The anthro dies (of old age, unless cause says otherwise). Returns false if it had already died.
     */
    static die(anthroId: number, cause = 'of old age'): boolean {
        const db = Auth.db();
        db.beginTransaction();
        try {
            // (Upstream locks the anthro here with SELECT ... FOR UPDATE: nothing to do in SQLite.)
            const anthro = Anthros.findAny(anthroId);
            if (!anthro || Anthros.isDead(anthro)) {
                db.rollBack();
                return false;
            }
            const age = Anthros.age(anthro.birthdate);
            const name = anthro.name;

            // Off the market: an open auction of it ends, and the highest bid (taken when it was made) goes back.
            const open = db.column("SELECT id FROM game_auctions WHERE anthro_id = ? AND status = 'open'", [anthro.id]);
            for (const auctionId of open) {
                const auction = Auctions.find(int(auctionId));
                db.run("UPDATE game_auctions SET status = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE id = ?", [auctionId]);
                if (auction && auction.current_bidder_anthro_id !== null) {
                    Wallets.change(int(auction.current_bidder_anthro_id), int(auction.current_bid),
                        `${name} died: bid returned`, int(auctionId));
                    Notifications.toAnthro(int(auction.current_bidder_anthro_id),
                        `${name} died before the auction ended; your ` + Wallets.format(int(auction.current_bid)) + ' came back.',
                        '/game/market/auctions/' + auctionId);
                }
            }

            const heir = Aging.heir(anthro);
            Ranks.strip(anthro, 'died');
            Jobs.end(anthro, null, `${name} died, so their job with you ended.`);
            const employees = db.column('SELECT id FROM game_anthros WHERE employer_id = ?', [anthro.id]);
            for (const employeeId of employees) {
                Jobs.end(Anthros.findAny(int(employeeId))!, `Your employer ${name} died, so your job ended.`, null);
            }
            Land.bequeath(anthro, heir?.id ?? null);
            const coins = Wallets.balance(anthro.id);
            if (coins > 0) {
                Wallets.change(anthro.id, -coins, heir ? `Left to ${heir.name}` : 'Returned to the game: no heir');
                if (heir) {
                    Wallets.change(heir.id, coins, `Inherited from ${name}`);
                }
            }
            // Its goods go to its heir's store too (or with no heir, nowhere).
            const goods = db.pairs('SELECT good, quantity FROM game_goods WHERE anthro_id = ? AND quantity > 0', [anthro.id]);
            const inherited: string[] = [];
            for (const [good, quantity] of goods) {
                if (heir) {
                    Goods.add(heir.id, String(good), int(quantity));
                    inherited.push(quantity + ' ' + good);
                }
            }
            db.run('UPDATE game_goods SET quantity = 0 WHERE anthro_id = ?', [anthro.id]);
            Groups.bury(anthro);
            const lostLitter = db.run('DELETE FROM game_litters WHERE dam_id = ? AND born_at IS NULL', [anthro.id]);
            db.run(
                `UPDATE game_flirts SET status = 'withdrawn', answered_at = UTC_TIMESTAMP()
                 WHERE status = 'pending' AND (from_anthro_id = ? OR to_anthro_id = ?)`,
                [anthro.id, anthro.id],
            );

            // What's left: the dead own themselves, hold nothing, and nobody plays them.
            db.run(
                `UPDATE game_anthros SET died_at = UTC_TIMESTAMP(), owner_id = id, player_id = NULL, liege_id = NULL,
                        title_rank = NULL, title_since = NULL, wage = NULL, debt = NULL, debt_rate = 0, debt_since = NULL
                 WHERE id = ?`,
                [anthro.id],
            );
            db.run('UPDATE game_anthros SET liege_id = NULL FROM game_anthros l WHERE l.id = game_anthros.liege_id AND l.died_at IS NOT NULL');

            let news = `${name} died ${cause}, aged ${age}.`;
            if (lostLitter) {
                news += ' Their unborn litter was lost.';
            }
            if (anthro.player_id != null) {
                Notifications.toUser(int(anthro.player_id), `${news} You can create or become another anthro.`, '/game/home');
            }
            if (heir) {
                const things = [...(coins > 0 ? [Wallets.format(coins)] : []), ...inherited];
                const inherits = things.length ? ' You inherited their ' + things.join(', ') + '.' : '';
                Notifications.toAnthro(heir.id, news + inherits, '/game/assets/' + anthro.id);
            }
            db.commit();
        } catch (e) {
            if (db.inTransaction()) {
                db.rollBack();
            }
            throw e;
        }
        return true;
    }
}
