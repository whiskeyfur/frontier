// Upstream: game/src/Fiefs.php
import { Auth, type User } from '../core/Auth';
import { onReset } from '../core/caches';
import { float, gmdate, int, number_format, round, spaceship, str, strtotimeOrThrow, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Buildings } from './Buildings';
import { Clock } from './Clock';
import { Goods } from './Goods';
import { Land } from './Land';
import { Market } from './Market';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';
import { Schedules } from './Schedules';
import { Wallets } from './Wallets';

/** Taxes assessed for a vassal (see Fiefs.assessToday). */
export type Assessment = { owed: number; lord: number };

/**
 * Fiefs: land a lord grants a vassal in exchange for its fealty. The vassal holds the lot of the lord (game_parcels
 * held_of; tenure keeps the chain of lords it's held of, so land granted onward goes back up in turn). Accepting a
 * grant swears the vassal to the lord. The fief still counts toward the lord's rank, as the vassal's land (see
 * Ranks::acresHeld), and a vassal holding a fief can't rise above its lord's rank.
 *
 * A fief goes back to its lord when the tie breaks: the vassal swears to someone else or is released, or loses its
 * freedom; or dies, unless it has a free child, the eldest of whom takes the fief (and its terms and balance) and is
 * sworn to the lord. A fief can't be sold. When the lord dies its heir in title holds the lordship; with none, the
 * vassals keep their fiefs outright.
 *
 * Taxes: a vassal owes its lord its tax_rate percent (set with the grant; the lord can offer a new one, which the
 * vassal accepts or not) of what its household produces each day, valued in coins (see value: goods at what the
 * market pays for them), added to its balance. On the tax day each week, after everyone has eaten, the game
 * collects what's owed: coins first, then food beyond a week's for the household, then lumber. What can't be paid
 * stays owed; a vassal can pay it off, or pay ahead (a balance below zero is credit, used up before anything is
 * collected). Arrears left unpaid GRACE_DAYS after a tax day that couldn't be met in full give the lord cause to
 * seize the vassal's fiefs.
 */
export class Fiefs {
    static readonly MAX_RATE = 50;
    static readonly GRACE_DAYS = 14;
    // The day of the week (ISO: 1 = Monday) taxes are collected.
    static readonly TAX_WEEKDAY = 1;
    // Days of food a household keeps back from the tax collector.
    static readonly RESERVE_DAYS = 7;
    // An anthro nobody plays accepts a grant, or a new rate, up to this rate.
    static readonly NPC_RATE = 20;

    // Taxes assessed in this request (see assessToday): Map of vassal id => {owed: coins, lord: lord id}. (Upstream's
    // $assessed: renamed, as a TS class can't have a property and a method of the same name.)
    private static assessedTaxes = new Map<number, Assessment>();

    static assessed(): Map<number, Assessment> {
        return Fiefs.assessedTaxes;
    }

    /**
     * What one of a good is worth, in coins, for taxes: a coin is a coin, and goods are worth what the market pays for
     * them (see Market::sellPrice; nothing, if it doesn't buy them).
     */
    static value(good: string): number {
        return good === 'coins' ? 1 : int(Market.sellPrice(good));
    }

    /**
     * The fiefs the anthro holds: its lots held of a lord, with 'lord_name'.
     */
    static heldBy(anthroId: number): Row[] {
        return Auth.db().all(
            'SELECT p.*, l.name AS lord_name FROM game_parcels p JOIN game_anthros l ON l.id = p.held_of WHERE p.anthro_id = ? ORDER BY p.id',
            [anthroId],
        );
    }

    /**
     * The lord's vassals holding fiefs of it, by name: each anthro with 'fief_acres' and 'fiefs' (how many lots).
     */
    static vassalsOf(lordId: number): Row[] {
        const rows = Auth.db().all(
            'SELECT anthro_id, SUM(acres) AS acres, COUNT(*) AS lots FROM game_parcels WHERE held_of = ? AND anthro_id IS NOT NULL GROUP BY anthro_id',
            [lordId],
        );
        const vassals: Row[] = [];
        for (const row of rows) {
            vassals.push({ ...Anthros.findAny(int(row.anthro_id))!, fief_acres: float(row.acres), fiefs: int(row.lots) });
        }
        vassals.sort((a, b) => spaceship(a.name, b.name) || spaceship(a.id, b.id));
        return vassals;
    }

    /**
     * Whether the anthro holds any fief (of its liege).
     */
    static holdsFief(anthroId: number): boolean {
        return !!int(Auth.db().value('SELECT COUNT(*) FROM game_parcels WHERE anthro_id = ? AND held_of IS NOT NULL', [anthroId]));
    }

    /**
     * Open offers: {received: offers to the anthro, sent: offers it made}, each with 'lord', 'vassal' and
     * (for a grant) 'parcel'.
     */
    static offers(anthroId: number): { received: Row[]; sent: Row[] } {
        const rows = Auth.db().all('SELECT * FROM game_fief_offers WHERE lord_id = ? OR vassal_id = ? ORDER BY created_at, id', [anthroId, anthroId]);
        const offers: { received: Row[]; sent: Row[] } = { received: [], sent: [] };
        for (let offer of rows) {
            offer = {
                ...offer,
                lord: Anthros.findAny(int(offer.lord_id)),
                vassal: Anthros.findAny(int(offer.vassal_id)),
                parcel: offer.parcel_id === null ? null : Land.parcel(int(offer.parcel_id)),
            };
            offers[int(offer.lord_id) === anthroId ? 'sent' : 'received'].push(offer);
        }
        return offers;
    }

    /**
     * The anthro the user plays offers one of its lots (or acres of it, split off on acceptance; empty for all of it)
     * as a fief to another anthro, at a tax rate. An anthro nobody plays answers at once (yes up to NPC_RATE).
     * Returns [what happened, null] or [null, error message].
     */
    static offerGrant(user: User, parcelId: number, acres: string, vassalId: number, rate: number): [string | null, string | null] {
        const lord = Anthros.player(user.id);
        const parcel = Land.parcel(parcelId);
        const vassal = Anthros.findAny(vassalId);
        const size = parcel ? int(round(float(parcel.acres) * 100)) : 0;
        const part = trim(acres) === '' ? size : Land.hundredths(acres);
        const error = ((): string | null => {
            if (!lord || !Anthros.isFree(lord)) return 'Only an anthro that owns itself can grant land.';
            if (!parcel || parcel.anthro_id !== lord.id) return 'Choose a lot of yours to grant.';
            if (Fiefs.listingOf(parcelId)) return 'That lot is for sale: take it off the market first.';
            if (part === null || part > size || part < 1) return 'Grant ' + Land.acres(Land.MIN_ACRES) + ' to ' + Land.acres(size / 100) + ' of it.';
            if (part < size && part > size - Buildings.usedHundredths(parcelId)) {
                return 'Only ' + Land.acres((size - Buildings.usedHundredths(parcelId)) / 100) + ' of it is free: buildings stand on the rest.';
            }
            if (rate < 0 || rate > Fiefs.MAX_RATE) return 'The tax is 0 to ' + Fiefs.MAX_RATE + '% of what they produce.';
            return Fiefs.recipientBlocker(lord, vassal);
        })();
        if (error) {
            return [null, error];
        }
        // (The checks above leave a lord, a lot, a part of it and a vassal.)
        const me = lord!, to = vassal!, hundredths = part!;
        const db = Auth.db();
        db.run("INSERT INTO game_fief_offers (kind, lord_id, vassal_id, parcel_id, acres, rate) VALUES ('grant', ?, ?, ?, ?, ?)",
            [me.id, to.id, parcelId, hundredths / 100, rate]);
        const id = db.lastInsertId();
        const what = Land.acres(hundredths / 100) + ` at ${rate}% tax`;
        if (to.player_id === null) {
            const yes = rate <= Fiefs.NPC_RATE;
            yes ? Fiefs.accept(id) : Fiefs.drop(id);
            return [yes ? `${to.name} accepted ${what}, and is sworn to you.` : `${to.name} turned down ${what}.`, null];
        }
        Notifications.toAnthro(to.id, `${me.name} offers you ${what} as a fief, if you swear fealty to them.`, '/game/court/fiefs');
        return [`You offered ${to.name} ${what}.`, null];
    }

    /**
     * The lord the user plays offers a vassal holding its fiefs a new tax rate. Returns [what happened, null] or
     * [null, error message].
     */
    static offerRate(user: User, vassalId: number, rate: number): [string | null, string | null] {
        const lord = Anthros.player(user.id);
        const vassal = Anthros.findAny(vassalId);
        const holds = !!lord && !!vassal && Fiefs.vassalsOf(lord.id).map((v) => v.id).includes(vassal.id);
        const error = ((): string | null => {
            if (!holds) return 'That anthro holds no fief of yours.';
            if (rate < 0 || rate > Fiefs.MAX_RATE) return 'The tax is 0 to ' + Fiefs.MAX_RATE + '% of what they produce.';
            if (rate === int(vassal!.tax_rate)) return `Their tax is ${rate}% already.`;
            return null;
        })();
        if (error) {
            return [null, error];
        }
        const me = lord!, them = vassal!;
        const db = Auth.db();
        db.run("DELETE FROM game_fief_offers WHERE kind = 'rate' AND lord_id = ? AND vassal_id = ?", [me.id, them.id]);
        db.run("INSERT INTO game_fief_offers (kind, lord_id, vassal_id, rate) VALUES ('rate', ?, ?, ?)", [me.id, them.id, rate]);
        const id = db.lastInsertId();
        if (them.player_id === null) {
            const yes = rate <= Math.max(Fiefs.NPC_RATE, int(them.tax_rate));
            yes ? Fiefs.accept(id) : Fiefs.drop(id);
            return [yes ? `${them.name} agreed to ${rate}% tax.` : `${them.name} refused ${rate}% tax.`, null];
        }
        Notifications.toAnthro(them.id, `${me.name} proposes your tax be ${rate}% (it's ${str(them.tax_rate)}% now).`, '/game/court/fiefs');
        return [`You proposed ${rate}% tax to ${them.name}.`, null];
    }

    /**
     * The user answers an offer made to the anthro they play. Returns an error message, or null.
     */
    static answer(user: User, offerId: number, yes: boolean): string | null {
        const offer = Fiefs.offer(offerId);
        const me = Anthros.player(user.id);
        if (!offer || !me || int(offer.vassal_id) !== me.id) {
            return 'That offer is no longer open.';
        }
        if (yes && offer.kind === 'grant') {
            const lord = Anthros.findAny(int(offer.lord_id))!;
            const parcel = Land.parcel(int(offer.parcel_id));
            const error = !parcel || parcel.anthro_id !== lord.id || float(parcel.acres) < float(offer.acres) || Fiefs.listingOf(int(parcel.id))
                ? `${lord.name} doesn't have that land to grant any more.` : Fiefs.recipientBlocker(lord, me);
            if (error) {
                return error;
            }
        }
        yes ? Fiefs.accept(offerId) : Fiefs.drop(offerId);
        const what = offer.kind === 'grant' ? 'your offer of land' : `${offer.rate}% tax`;
        Notifications.toAnthro(int(offer.lord_id), `${me.name} ` + (yes ? 'accepted ' : 'turned down ') + what + '.', '/game/court/fiefs');
        return null;
    }

    /**
     * The lord the user plays takes back an offer. Returns an error message, or null.
     */
    static withdraw(user: User, offerId: number): string | null {
        const offer = Fiefs.offer(offerId);
        const me = Anthros.player(user.id);
        if (!offer || !me || int(offer.lord_id) !== me.id) {
            return 'That offer is no longer open.';
        }
        Fiefs.drop(offerId);
        return null;
    }

    /**
     * The vassal the user plays pays its lord coins: toward its arrears, or ahead (credit). Returns an error, or null.
     */
    static pay(user: User, coins: number): string | null {
        const me = Anthros.player(user.id);
        if (!me || me.tax_rate === null || me.liege_id === null || !Fiefs.holdsFief(me.id)) {
            return 'You hold no fief to pay tax on.';
        }
        if (coins < 1) {
            return 'Pay at least 1 coin.';
        }
        if (!Wallets.change(me.id, -coins, `Tax paid to ${me.liege_name}`, null, user.id)) {
            return 'You have ' + Wallets.format(Wallets.balance(me.id)) + '.';
        }
        Wallets.change(int(me.liege_id), coins, `Tax from ${me.name}`);
        Fiefs.settleBalance(me.id, -coins, false);
        Notifications.toAnthro(int(me.liege_id), `${me.name} paid you ` + Wallets.format(coins) + ' in tax.', '/game/court/fiefs');
        return null;
    }

    /**
     * Whether the vassal's lord has cause to seize its fiefs: arrears still owed GRACE_DAYS after a tax day it couldn't
     * meet in full.
     */
    static mayBeSeized(vassal: Row): boolean {
        return float(vassal.tax_balance) > 0 && vassal.tax_overdue_since !== null
            && vassal.tax_overdue_since <= gmdate('Y-m-d', strtotimeOrThrow('-' + Fiefs.GRACE_DAYS + ' days'));
    }

    /**
     * The lord the user plays seizes a vassal's fiefs for unpaid tax (see mayBeSeized): they go back to the lord, the
     * arrears are written off, and the vassal leaves its service. Returns an error message, or null.
     */
    static seize(user: User, vassalId: number): string | null {
        const lord = Anthros.player(user.id);
        const vassal = Anthros.findAny(vassalId);
        if (!lord || !vassal || !Fiefs.vassalsOf(lord.id).map((v) => v.id).includes(vassal.id)) {
            return 'That anthro holds no fief of yours.';
        }
        if (!Fiefs.mayBeSeized(vassal)) {
            return `${vassal.name} isn't ` + Fiefs.GRACE_DAYS + ' days behind on their tax: you have no cause.';
        }
        const acres = Fiefs.revert(vassal.id, lord.id);
        Auth.db().run('UPDATE game_anthros SET liege_id = NULL WHERE id = ?', [vassal.id]);
        Fiefs.clearTerms(vassal.id);
        Notifications.toAnthro(vassal.id, `${lord.name} seized your fiefs (` + Land.acres(acres) + ') for unpaid tax, and you are no longer sworn to them.', '/game/court/fiefs');
        Ranks.holdByLand();
        return null;
    }

    /**
     * Called as an anthro loses its freedom or dies (dying), after its title passed to successor (if any). As a
     * vassal: a dying one's fiefs go to its eldest free child, sworn to the lord on the same terms; otherwise they go
     * back to the lord (see reconcile). As a lord: its heir in title holds its vassals' fiefs; with none, they keep
     * them outright.
     */
    static onLoss(anthro: Row, successor: Row | null, dying: boolean): void {
        const db = Auth.db();
        const lordId = anthro.liege_id === null ? null : int(anthro.liege_id);
        let child: Row | null;
        if (dying && lordId !== null && (child = Fiefs.heirOf(anthro, Anthros.findAny(lordId)))) {
            db.run('UPDATE game_parcels SET anthro_id = ? WHERE anthro_id = ? AND held_of = ?', [child.id, anthro.id, lordId]);
            db.run(
                'UPDATE game_anthros SET liege_id = ?, tax_rate = ?, tax_balance = tax_balance + ?, tax_overdue_since = COALESCE(tax_overdue_since, ?) WHERE id = ?',
                [lordId, anthro.tax_rate, anthro.tax_balance, anthro.tax_overdue_since, child.id],
            );
            Notifications.toAnthro(child.id, `You inherited ${anthro.name}'s fiefs, held of ${anthro.liege_name}, and are sworn to them.`, '/game/court/fiefs');
        }
        Fiefs.clearTerms(anthro.id);
        if (successor) {
            db.run('UPDATE game_parcels SET held_of = ? WHERE held_of = ?', [successor.id, anthro.id]);
            Fiefs.retenure(successor.id);
        } else {
            Fiefs.freeHold(anthro.id);
        }
        Fiefs.reconcile();
    }

    /**
     * Keeps fiefs in order (the game runs this each day, and whenever fealty changes): a fief held of its own holder
     * is simply its land; one whose holder is no longer sworn to its lord (or isn't free) goes back to the lord, or,
     * if the lord is gone, is kept outright. Vassals with no fief left have no tax terms. Returns how many lots moved.
     */
    static reconcile(): number {
        const db = Auth.db();
        let moved = 0;
        for (const id of db.column('SELECT id FROM game_parcels WHERE held_of IS NOT NULL AND held_of = anthro_id')) {
            Fiefs.popTenure(int(id));
        }
        const broken = db.all(
            `SELECT p.anthro_id, p.held_of FROM game_parcels p JOIN game_anthros v ON v.id = p.anthro_id
             WHERE p.held_of IS NOT NULL AND (NOT (v.liege_id IS p.held_of) OR NOT ` + Anthros.freeSql('v') + `)
             GROUP BY p.anthro_id, p.held_of`,
        );
        for (const row of broken) {
            const lord = Anthros.findAny(int(row.held_of));
            if (lord && Anthros.isFree(lord)) {
                const acres = Fiefs.revert(int(row.anthro_id), lord.id);
                const vassal = Anthros.findAny(int(row.anthro_id))!;
                Notifications.toAnthro(lord.id, `${vassal.name}'s fiefs (` + Land.acres(acres) + ') came back to you: they are no longer sworn to you.', '/game/court/fiefs');
                Notifications.toAnthro(vassal.id, 'Your fiefs (' + Land.acres(acres) + `) went back to ${lord.name}.`, '/game/court/fiefs');
            } else {
                Fiefs.freeHold(int(row.held_of));
            }
            moved++;
        }
        db.run(
            `UPDATE game_anthros AS a SET tax_rate = NULL, tax_balance = 0, tax_overdue_since = NULL
             WHERE a.tax_rate IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game_parcels p WHERE p.anthro_id = a.id AND p.held_of IS NOT NULL)`,
        );
        return moved;
    }

    /**
     * Once a day, after everyone's work (the game runs this on each request): each vassal owes its lord its tax rate's
     * share of what its household produced today (see Schedules::today), valued in coins (see value), and on the tax
     * day the game collects what's owed (see collect). Returns how many vassals were taxed.
     */
    static assessToday(): number {
        const db = Auth.db();
        if (!db.run("INSERT OR IGNORE INTO game_daily (day, task) VALUES (UTC_DATE(), 'taxes')")) {
            return 0;
        }
        Fiefs.assessedTaxes = new Map();
        const gathered = Schedules.today().gathered;
        const vassals = db.all(
            `SELECT a.id, a.tax_rate, a.liege_id FROM game_anthros a
             WHERE a.tax_rate IS NOT NULL AND a.liege_id IS NOT NULL AND ` + Anthros.freeSql('a'),
        );
        for (const vassal of vassals) {
            let value = 0;
            for (const [good, quantity] of Object.entries(gathered.get(int(vassal.id)) ?? {})) {
                value += quantity * Fiefs.value(good);
            }
            const owed = round(value * int(vassal.tax_rate) / 100, 2);
            if (owed > 0) {
                db.run('UPDATE game_anthros SET tax_balance = tax_balance + ? WHERE id = ?', [owed, vassal.id]);
                Fiefs.assessedTaxes.set(int(vassal.id), { owed, lord: int(vassal.liege_id) });
            }
        }
        if (Clock.weekday() === Fiefs.TAX_WEEKDAY) {
            Fiefs.collectDue();
        }
        return Fiefs.assessedTaxes.size;
    }

    /**
     * The tax day: collects from every vassal that owes its lord (see collect). Returns how many owed.
     */
    static collectDue(): number {
        const ids = Auth.db().column(
            'SELECT a.id FROM game_anthros a WHERE a.tax_rate IS NOT NULL AND a.tax_balance > 0 AND a.liege_id IS NOT NULL AND ' + Anthros.freeSql('a'),
        );
        for (const id of ids) {
            Fiefs.collect(Anthros.findAny(int(id))!);
        }
        return ids.length;
    }

    /**
     * The tax day's collection from a vassal: what it owes, paid in coins, then food beyond RESERVE_DAYS' for its
     * household, then lumber, each good at its value (see value). What's left owed stays owed (and it's overdue from today, if it
     * wasn't already); paid in full, it isn't overdue.
     */
    private static collect(vassal: Row): void {
        let owed = float(vassal.tax_balance);
        const lordId = int(vassal.liege_id);
        if (owed <= 0) {
            return;
        }
        const paid: string[] = [];
        const coins = Math.min(Math.max(0, Wallets.balance(vassal.id)), Math.ceil(owed));
        if (coins > 0 && Wallets.change(vassal.id, -coins, `Tax paid to ${vassal.liege_name}`)) {
            Wallets.change(lordId, coins, `Tax from ${vassal.name}`);
            owed -= coins;
            paid.push(Wallets.format(coins));
        }
        for (const good of ['food', 'lumber']) {
            if (owed <= 0) {
                break;
            }
            let spare = Goods.amount(vassal.id, good);
            if (good === 'food') {
                spare -= Goods.household(vassal.id).length * Goods.FOOD_PER_DAY * Fiefs.RESERVE_DAYS;
            }
            if (!Fiefs.value(good)) {
                continue;
            }
            const units = Math.min(Math.max(0, spare), Math.ceil(owed / Fiefs.value(good)));
            if (units > 0 && Goods.take(vassal.id, good, units)) {
                Goods.add(lordId, good, units);
                owed -= units * Fiefs.value(good);
                paid.push(`${units} ${good}`);
            }
        }
        Fiefs.settleBalance(vassal.id, owed - float(vassal.tax_balance), true);
        const left = round(owed, 2);
        const still = left > 0 ? ' Still owed: ' + Fiefs.coins(left) + '.' : '';
        Notifications.toAnthro(vassal.id, (paid.length ? 'Tax day: you paid ' + paid.join(', ') + ` to ${vassal.liege_name}.` : `Tax day: you couldn't pay ${vassal.liege_name} anything.`) + still, '/game/court/fiefs');
        Notifications.toAnthro(lordId, (paid.length ? `Tax day: ${vassal.name} paid you ` + paid.join(', ') + '.' : `Tax day: ${vassal.name} couldn't pay you anything.`) + still, '/game/court/fiefs');
    }

    /**
     * An amount of coins (to two places) in words.
     */
    static coins(amount: number): string {
        const text = number_format(Math.abs(amount), 2).replace(/0+$/, '').replace(/\.+$/, '');
        return text + (float(text) == 1 ? ' coin' : ' coins');
    }

    /**
     * Why the anthro can't take a fief of the lord, or null: it must be free and grown, not the lord, and of the
     * lord's rank or lower (see Ranks::maySwearTo); and the lord mustn't be sworn to it.
     */
    private static recipientBlocker(lord: Row, vassal: Row | null): string | null {
        if (!vassal) return 'Choose who to grant it to.';
        if (vassal.id === lord.id) return "You can't grant land to yourself.";
        if (!Anthros.isFree(vassal) || Anthros.isYoung(vassal)) return `${vassal.name} can't hold land: only a free, grown anthro can.`;
        if (!Ranks.maySwearTo(vassal, lord)) return `${vassal.name} outranks you, so can't be your vassal.`;
        if (Ranks.fealtyOf(vassal.id).includes(lord.id)) return `You're sworn to ${vassal.name}.`;
        return null;
    }

    /**
     * Carries out an accepted offer: a grant moves the land (split off if part of a lot) to the vassal, held of the
     * lord, swears the vassal to the lord and sets its tax rate; a new rate is set.
     */
    private static accept(offerId: number): void {
        const offer = Fiefs.offer(offerId)!;
        const db = Auth.db();
        Fiefs.drop(offerId);
        if (offer.kind === 'rate') {
            db.run('UPDATE game_anthros SET tax_rate = ? WHERE id = ?', [offer.rate, offer.vassal_id]);
            return;
        }
        const parcel = Land.parcel(int(offer.parcel_id))!;
        const part = int(round(float(offer.acres) * 100));
        const lotId = part < int(round(float(parcel.acres) * 100)) ? Land.splitOff(parcel, part) : int(parcel.id);
        // (MariaDB's TRIM(BOTH ',' FROM x) is SQLite's TRIM(x, ','.)
        db.run("UPDATE game_parcels SET anthro_id = ?, held_of = ?, tenure = TRIM(CONCAT(tenure, ',', ?), ',') WHERE id = ?",
            [offer.vassal_id, offer.lord_id, offer.lord_id, lotId]);
        db.run('UPDATE game_anthros SET liege_id = ?, tax_rate = ? WHERE id = ?', [offer.lord_id, offer.rate, offer.vassal_id]);
        // Fiefs held of another lord go back to it; the old lord may lose rank with them.
        Fiefs.reconcile();
        Ranks.holdByLand();
    }

    private static drop(offerId: number): void {
        Auth.db().run('DELETE FROM game_fief_offers WHERE id = ?', [offerId]);
    }

    private static offer(id: number): Row | null {
        return Auth.db().row('SELECT * FROM game_fief_offers WHERE id = ?', [id]);
    }

    private static listingOf(parcelId: number): boolean {
        return !!int(Auth.db().value("SELECT COUNT(*) FROM game_land_listings WHERE parcel_id = ? AND status = 'open'", [parcelId]));
    }

    /**
     * Adds change to the vassal's balance: once paid off it isn't overdue; still owing after a tax day's collection
     * (collected), it's overdue from today if it wasn't already.
     */
    private static settleBalance(vassalId: number, change: number, collected: boolean): void {
        // (MariaDB runs the assignments in order, so upstream's second one reads the new tax_balance; SQLite's all read
        // the old row, so the second adds the change itself.)
        change = round(change, 2);
        Auth.db().run(
            `UPDATE game_anthros SET tax_balance = tax_balance + ?,
                                     tax_overdue_since = IF(tax_balance + ? > 0, IF(?, COALESCE(tax_overdue_since, UTC_DATE()), tax_overdue_since), NULL)
             WHERE id = ?`,
            [change, change, int(collected), vassalId],
        );
    }

    /**
     * The vassal's fiefs held of the lord go back to it, each held of the lord above it in turn (see tenure).
     * Returns how many acres went back.
     */
    private static revert(vassalId: number, lordId: number): number {
        const lots = Auth.db().all('SELECT id, acres FROM game_parcels WHERE anthro_id = ? AND held_of = ?', [vassalId, lordId]);
        let acres = 0.0;
        for (const lot of lots) {
            Auth.db().run("UPDATE game_land_listings SET status = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE parcel_id = ? AND status = 'open'",
                [lot.id]);
            Auth.db().run('UPDATE game_parcels SET anthro_id = ? WHERE id = ?', [lordId, lot.id]);
            Fiefs.popTenure(int(lot.id));
            acres += float(lot.acres);
        }
        return acres;
    }

    /**
     * Takes the latest lord off a lot's tenure: it's held of the one before (or of no one).
     */
    private static popTenure(parcelId: number): void {
        const lot = Land.parcel(parcelId)!;
        const chain = str(lot.tenure).split(',').filter((s) => s !== '' && s !== '0');
        chain.pop();
        const heldOf = chain.length ? int(chain[chain.length - 1]) : null;
        Auth.db().run('UPDATE game_parcels SET held_of = ?, tenure = ? WHERE id = ?', [heldOf, chain.join(','), parcelId]);
    }

    /**
     * Rewrites the tenure of lots now held of lordId so their chain ends with it.
     */
    private static retenure(lordId: number): void {
        const lots = Auth.db().all('SELECT id, tenure FROM game_parcels WHERE held_of = ?', [lordId]);
        for (const lot of lots) {
            const chain = str(lot.tenure).split(',').filter((s) => s !== '' && s !== '0');
            chain[chain.length ? chain.length - 1 : 0] = String(lordId);
            Auth.db().run('UPDATE game_parcels SET tenure = ? WHERE id = ?', [chain.join(','), lot.id]);
        }
    }

    /**
     * The lots held of a lord who is gone are kept by their holders outright.
     */
    private static freeHold(lordId: number): void {
        Auth.db().run("UPDATE game_parcels SET held_of = NULL, tenure = '' WHERE held_of = ?", [lordId]);
    }

    private static clearTerms(anthroId: number): void {
        Auth.db().run('UPDATE game_anthros SET tax_rate = NULL, tax_balance = 0, tax_overdue_since = NULL WHERE id = ?', [anthroId]);
    }

    /**
     * The eldest free, grown child of the anthro that can be the lord's vassal, or null.
     */
    private static heirOf(anthro: Row, lord: Row | null): Row | null {
        if (!lord || !Anthros.isFree(lord)) {
            return null;
        }
        const ids = Auth.db().column(
            'SELECT a.id FROM game_anthros a WHERE (a.sire_id = ? OR a.dam_id = ?) AND a.id <> ? AND ' + Anthros.freeSql('a')
            + ' ORDER BY a.birthdate IS NULL, a.birthdate, a.id',
            [anthro.id, anthro.id, anthro.id],
        );
        for (const id of ids) {
            const child = Anthros.findAny(int(id));
            if (child && child.id !== lord.id && Ranks.maySwearTo(child, lord)) {
                return child;
            }
        }
        return null;
    }

    static {
        // A request's assessments are forgotten with its other caches (see caches.ts).
        onReset(() => {
            Fiefs.assessedTaxes = new Map();
        });
    }
}
