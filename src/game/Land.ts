// Upstream: game/src/Land.php
import { Auth } from '../core/Auth';
import { array_fill, array_sum, array_unique, float, int, number_format, round, str, trim } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Baronies } from './Baronies';
import { Buildings } from './Buildings';
import { Jobs } from './Jobs';
import { Notifications } from './Notifications';
import { Ranks } from './Ranks';
import { Wallets } from './Wallets';

/**
 * Real estate. Land comes in lots (pieces of land, each with its own size in acres; game_parcels) held by free
 * anthros; only a played one can buy or sell land (for its home and business). If it loses its freedom its land goes
 * to its new owner (another anthro). Land can also be forfeit to the crown (see Ranks::heir). Lots are sold at a fixed
 * price: by the land office (admins supply them; the coins leave the game) or by the anthro holding them. Lots can be
 * split and merged. Sizes are kept to the hundredth of an acre.
 */
export class Land {
    static readonly DEFAULT_PRICE_PER_ACRE = 100000;
    static readonly MAX_SUPPLY = 50;
    static readonly MAX_ACRES = 1000;
    // The smallest piece of land: a hundredth of an acre.
    static readonly MIN_ACRES = 0.01;

    // Each listing with its parcel and who is selling it (an anthro's name, or the land office).
    private static readonly LISTING = `SELECT l.*, p.anthro_id AS holder_id, s.name AS seller_name, b.name AS buyer_name,
                                    p.barony_id, br.name AS barony_name, pt.name AS part_name, pt.kind AS part_kind
                             FROM game_land_listings l
                             JOIN game_parcels p ON p.id = l.parcel_id
                             LEFT JOIN game_baronies br ON br.id = p.barony_id
                             LEFT JOIN game_barony_parts pt ON pt.id = p.part_id
                             LEFT JOIN game_anthros s ON s.id = l.seller_anthro_id
                             LEFT JOIN game_anthros b ON b.id = l.buyer_anthro_id`;

    /**
     * A size for display: "1 acre", "2.5 acres", "1,200 acres".
     */
    static acres(acres: number | string | null): string {
        acres = round(float(acres), 2);
        return number_format(acres, 2).replace(/0+$/, '').replace(/\.+$/, '') + (acres == 1 ? ' acre' : ' acres');
    }

    /**
     * A size typed in acres, as a number of hundredths of an acre; null unless it's a positive number with at most two
     * decimals.
     */
    static hundredths(acres: string | number): number | null {
        acres = trim(str(acres));
        return /^\d+(\.\d{1,2})?$/.test(acres) && float(acres) > 0 ? int(round(float(acres) * 100)) : null;
    }

    /**
     * Whether the anthro may buy and sell land: it's played and free. (Any free anthro can hold land.)
     */
    static canTrade(anthro: Row | null): boolean {
        return anthro !== null && anthro.player_id !== null && Anthros.isFree(anthro);
    }

    /**
     * Open listings, cheapest per acre first.
     */
    static open(): Row[] {
        return Auth.db().all(Land.LISTING + " WHERE l.status = 'open' ORDER BY l.price / l.acres, l.id");
    }

    static listing(id: number): Row | null {
        return Auth.db().row(Land.LISTING + ' WHERE l.id = ?', [id]);
    }

    /**
     * The anthro's lots by barony and part (barony_name, part_name, part_kind), largest first, each with its open
     * listing (listing_id and price) if it's for sale, and the lord it's held of if it's a fief (held_of_name).
     */
    static parcels(anthroId: number): Row[] {
        return Auth.db().all(
            `SELECT p.*, l.id AS listing_id, l.price, br.name AS barony_name, pt.name AS part_name, pt.kind AS part_kind, hl.name AS held_of_name
             FROM game_parcels p LEFT JOIN game_land_listings l ON l.parcel_id = p.id AND l.status = 'open'
             LEFT JOIN game_anthros hl ON hl.id = p.held_of
             LEFT JOIN game_baronies br ON br.id = p.barony_id
             LEFT JOIN game_barony_parts pt ON pt.id = p.part_id
             WHERE p.anthro_id = ? ORDER BY br.name, pt.name IS NOT NULL, pt.name, p.acres DESC, p.id`,
            [anthroId],
        );
    }

    /**
     * How many acres the anthro holds.
     */
    static totalAcres(anthroId: number): number {
        return float(Auth.db().value('SELECT COALESCE(SUM(acres), 0) FROM game_parcels WHERE anthro_id = ?', [anthroId]));
    }

    /**
     * Admin view: the lots lying in a barony (or, with none, the land office's own lots), each with who holds it (and
     * who plays that anthro) and its open listing.
     */
    static all(baronyId: number | null = null): Row[] {
        return Auth.db().all(
            `SELECT p.*, a.name AS holder_name, pl.username AS player_name, l.id AS listing_id, l.price,
                    br.name AS barony_name, pt.name AS part_name
             FROM game_parcels p
             LEFT JOIN game_anthros a ON a.id = p.anthro_id
             LEFT JOIN game_baronies br ON br.id = p.barony_id
             LEFT JOIN game_barony_parts pt ON pt.id = p.part_id
             LEFT JOIN users pl ON pl.id = a.player_id
             LEFT JOIN game_land_listings l ON l.parcel_id = p.id AND l.status = 'open'
             WHERE ` + (baronyId === null ? 'p.anthro_id IS NULL' : 'p.barony_id = ?') + `
             ORDER BY br.name, pt.name IS NOT NULL, pt.name, p.id`,
            baronyId === null ? [] : [baronyId],
        );
    }

    /**
     * Recent sales, newest first.
     */
    static recent(limit = 20): Row[] {
        return Auth.db().all(Land.LISTING + " WHERE l.status = 'sold' ORDER BY l.closed_at DESC, l.id DESC LIMIT ?", [limit]);
    }

    /**
     * Buys a listed lot with the wallet of the anthro the user plays. Returns an error message, or null.
     */
    static buy(user: Row, listingId: number): string | null {
        const buyer = Anthros.player(user.id);
        if (!buyer) {
            return 'Create or become an anthro first: land is bought with its wallet.';
        }
        if (!Land.canTrade(buyer)) {
            return `Only an anthro that owns itself can buy land, and ${buyer.name} doesn't.`;
        }
        const db = Auth.db();
        db.beginTransaction();
        // Lock the listing so two buyers can't both get the lot. (Upstream: SELECT ... FOR UPDATE; the transaction
        // does it here.)
        const listing = db.row('SELECT * FROM game_land_listings WHERE id = ?', [listingId]);
        let error: string | null;
        switch (true) {
            case !listing || listing.status !== 'open':
                error = 'That land is no longer for sale.';
                break;
            case listing!.seller_anthro_id === buyer.id:
                error = "That's your own listing.";
                break;
            default:
                error = null;
        }
        if (error) {
            db.rollBack();
            return error;
        }
        const parcel = Land.parcel(int(listing!.parcel_id))!;
        const price = int(listing!.price);
        const what = `lot #${parcel.id} (` + Land.acres(listing!.acres) + ')';
        if (!Wallets.change(buyer.id, -price, `Bought ${what}`)) {
            db.rollBack();
            return 'You need ' + Wallets.format(price) + ' but have ' + Wallets.format(Wallets.balance(buyer.id)) + '.';
        }
        // The land office's coins leave the game; a seller whose anthro was deleted isn't paid either.
        const sellerId: number | null = listing!.from_game ? null : listing!.seller_anthro_id;
        if (sellerId !== null) {
            Wallets.change(sellerId, price, `Sold ${what}`);
        }
        db.run('UPDATE game_parcels SET anthro_id = ? WHERE id = ?', [buyer.id, parcel.id]);
        db.run(
            "UPDATE game_land_listings SET status = 'sold', buyer_anthro_id = ?, closed_at = UTC_TIMESTAMP() WHERE id = ?",
            [buyer.id, listingId],
        );
        db.commit();
        Notifications.toAnthro(sellerId, `${buyer.name} bought your ${what} for ` + Wallets.format(price) + '.', '/game/market/land');
        return null;
    }

    /**
     * Lists some or all of one of the player's lots for sale (acres of it, as typed). Listing only part of it splits
     * those acres off into a new lot. Returns an error message, or null.
     */
    static sell(user: Row, parcelId: number, acres: string | number, price: number): string | null {
        const size = Land.hundredths(acres);
        const seller = Anthros.player(user.id);
        if (!Land.canTrade(seller)) {
            return 'Only an anthro that owns itself can sell land.';
        }
        if (price < 1) {
            return 'The price must be at least 1 coin.';
        }
        const db = Auth.db();
        db.beginTransaction();
        const parcel = Land.parcel(parcelId, true);
        let error: string | null;
        switch (true) {
            case !parcel || parcel.anthro_id !== seller!.id:
                error = "That isn't your land.";
                break;
            case parcel!.held_of !== null:
                error = 'That lot is a fief: it can\'t be sold, only given back.';
                break;
            case Land.openListing(parcelId) !== null:
                error = 'That lot is already for sale.';
                break;
            case size === null || size > Land.size(parcel!):
                error = 'Sell between ' + Land.acres(Land.MIN_ACRES) + ' and ' + Land.acres(parcel!.acres) + '.';
                break;
            // Selling part of a lot sells land no building stands on; the whole lot goes with its buildings.
            case size! < Land.size(parcel!) && size! > Land.size(parcel!) - Buildings.usedHundredths(parcelId):
                error = 'Only ' + Land.acres((Land.size(parcel!) - Buildings.usedHundredths(parcelId)) / 100) + ' of it is free of buildings: sell that, or the whole lot.';
                break;
            default:
                error = null;
        }
        if (error) {
            db.rollBack();
            return error;
        }
        if (size! < Land.size(parcel!)) {
            parcelId = Land.splitOff(parcel!, size!);
        }
        db.run('INSERT INTO game_land_listings (parcel_id, acres, seller_anthro_id, price, created_by) VALUES (?, ?, ?, ?, ?)',
            [parcelId, size! / 100, seller!.id, price, user.id]);
        db.commit();
        return null;
    }

    /**
     * Splits acres (as typed) off a lot into a new lot beside it: same owner, same barony and part. The player's own
     * lots (while their anthro owns itself), or any for an admin; not while it's for sale.
     * Returns [the new lot's id, null] or [null, error message].
     */
    static split(user: Row, parcelId: number, acres: string | number): [number | null, string | null] {
        const size = Land.hundredths(acres);
        const db = Auth.db();
        db.beginTransaction();
        const parcel = Land.parcel(parcelId, true);
        let error: string | null;
        switch (true) {
            case !parcel || !Land.mayReshape(user, parcel):
                error = "That isn't your land.";
                break;
            case Land.openListing(parcelId) !== null:
                error = 'Take it off the market before splitting it.';
                break;
            case Land.size(parcel!) < 2:
                error = 'A lot of ' + Land.acres(Land.MIN_ACRES) + ' can\'t be split.';
                break;
            case size === null || size >= Land.size(parcel!):
                error = 'Split off ' + Land.acres(Land.MIN_ACRES) + ' to ' + Land.acres((Land.size(parcel!) - 1) / 100) + '.';
                break;
            case size! > Land.size(parcel!) - Buildings.usedHundredths(parcelId):
                error = 'Only ' + Land.acres((Land.size(parcel!) - Buildings.usedHundredths(parcelId)) / 100) + ' of it is free: buildings stand on the rest.';
                break;
            default:
                error = null;
        }
        if (error) {
            db.rollBack();
            return [null, error];
        }
        const id = Land.splitOff(parcel!, size!);
        db.commit();
        return [id, null];
    }

    /**
     * Splits hundredths of an acre off the lot into a new lot for the same owner, lying where it does (inside the
     * caller's transaction). Returns the new lot's id.
     */
    static splitOff(parcel: Row, hundredths: number, toAnthroId: number | null = null): number {
        const db = Auth.db();
        db.run('UPDATE game_parcels SET acres = acres - ? WHERE id = ?', [hundredths / 100, parcel.id]);
        // A piece of a fief is held of the same lords.
        db.run('INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id, held_of, tenure) VALUES (?, ?, ?, ?, ?, ?)',
            [toAnthroId ?? parcel.anthro_id, hundredths / 100, parcel.barony_id, parcel.part_id, parcel.held_of ?? null, parcel.tenure ?? '']);
        return db.lastInsertId();
    }

    /**
     * A lot's size in hundredths of an acre.
     */
    private static size(parcel: Row): number {
        return int(round(float(parcel.acres) * 100));
    }

    /**
     * Merges lots into one (the oldest keeps its number): they must have the same owner and lie in the same
     * barony and part, and none may be for sale. The player's own lots (while their anthro owns itself), or any
     * for an admin. Past sales of the merged lots move to the one they became. Returns [its id, null] or
     * [null, error message].
     */
    static merge(user: Row, ids: unknown[]): [number | null, string | null] {
        const sortedIds = array_unique(ids.map(int).filter((id) => id !== 0));
        if (sortedIds.length < 2) {
            return [null, 'Choose at least two lots to merge.'];
        }
        sortedIds.sort((a, b) => a - b);
        const db = Auth.db();
        db.beginTransaction();
        const parcels = sortedIds.map((id) => Land.parcel(id, true));
        const first = parcels[0];
        let error: string | null = null;
        for (const parcel of parcels) {
            error ??= ((): string | null => {
                switch (true) {
                    case !parcel || !Land.mayReshape(user, parcel):
                        return "Those aren't all your land.";
                    case parcel!.anthro_id !== first!.anthro_id:
                        return 'Only lots with the same owner can be merged.';
                    case parcel!.tenure !== first!.tenure:
                        return 'Only lots held the same way (your own, or fiefs of the same lord) can be merged.';
                    case parcel!.barony_id !== first!.barony_id || parcel!.part_id !== first!.part_id:
                        return 'Only lots in the same barony (and the same village, town, city or expanse) can be merged.';
                    case Land.openListing(int(parcel!.id)) !== null:
                        return `Lot #${parcel!.id} is for sale: take it off the market first.`;
                    default:
                        return null;
                }
            })();
        }
        if (error) {
            db.rollBack();
            return [null, error];
        }
        const others = sortedIds.slice(1);
        const inList = array_fill(others.length, '?').join(', ');
        db.run('UPDATE game_parcels SET acres = ? WHERE id = ?',
            [array_sum(parcels.map((p) => Land.size(p!))) / 100, first!.id]);
        db.run(`UPDATE game_land_listings SET parcel_id = ? WHERE parcel_id IN (${inList})`, [first!.id, ...others]);
        db.run(`UPDATE game_buildings SET parcel_id = ? WHERE parcel_id IN (${inList})`, [first!.id, ...others]);
        db.run(`DELETE FROM game_parcels WHERE id IN (${inList})`, others);
        db.commit();
        return [int(first!.id), null];
    }

    /**
     * Whether the user may split and merge the lot: an admin, or the player of the free anthro that owns it.
     */
    private static mayReshape(user: Row, parcel: Row): boolean {
        if (Auth.isAdmin(user)) {
            return true;
        }
        const player = Anthros.player(user.id);
        return Land.canTrade(player) && parcel.anthro_id === player!.id;
    }

    /**
     * Takes a listing off the market: the seller's own, or any for an admin. The land stays with its holder.
     * Returns an error message, or null.
     */
    static cancel(user: Row, listingId: number): string | null {
        const listing = Land.listing(listingId);
        if (!listing || listing.status !== 'open') {
            return 'That land is no longer for sale.';
        }
        const player = Anthros.player(user.id);
        const isSeller = !!player && !listing.from_game && listing.seller_anthro_id === player.id;
        if (!isSeller && !Auth.isAdmin(user)) {
            return "That isn't your listing.";
        }
        Auth.db().run(
            "UPDATE game_land_listings SET status = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'open'",
            [listingId],
        );
        if (!isSeller && !listing.from_game) {
            Notifications.toAnthro(listing.seller_anthro_id, 'An admin took your lot #' + listing.parcel_id + ' off the market.', '/game/market/land');
        }
        return null;
    }

    /**
     * Called when a free anthro gets an owner, the anthro newOwnerId (inside the caller's transaction): it loses its
     * title and any job, and the anthros it owns and its land go to its new owner (with no new owner, its land is
     * forfeit to the crown and its anthros go free). Its land listings are cancelled. Returns how many acres moved.
     */
    static forfeit(anthro: Row, newOwnerId: number | null): number {
        if (!Anthros.isFree(anthro)) {
            return 0;
        }
        const rank = Ranks.of(anthro);
        Ranks.strip(anthro);
        Jobs.end(anthro, 'You lost your job when you lost your freedom.', `${anthro.name} lost their freedom, so their job with you ended.`);
        Land.handOverAnthros(anthro, newOwnerId);
        const holderId = newOwnerId;
        if (holderId === null) {
            return Land.toCrown(anthro, rank);
        }
        const acres = Land.move(anthro.id, holderId);
        if (acres) {
            Notifications.toAnthro(anthro.id, 'Your land (' + Land.acres(acres) + ') now belongs to your new owner.', '/game/market/land');
            Notifications.toAnthro(holderId, `${anthro.name}'s land (` + Land.acres(acres) + ') is yours now.', '/game/market/land');
        }
        return acres;
    }

    /**
     * Called when an anthro dies (inside the caller's transaction): its land and the anthros it owns go to its heir
     * (see Aging::heir). With no heir, its anthros go free and its land to the land office. Returns how many acres moved.
     */
    static bequeath(anthro: Row, heirId: number | null): number {
        const count = Auth.db().run('UPDATE game_anthros SET owner_id = IF(? IS NULL OR id = ?, id, ?) WHERE owner_id = ? AND id <> ?',
            [heirId, heirId, heirId, anthro.id, anthro.id]);
        if (heirId !== null && count) {
            Notifications.toAnthro(heirId, `You inherited ${anthro.name}'s anthros (` + (count === 1 ? '1 anthro' : `${count} anthros`) + ').', '/game/assets');
        }
        const acres = Land.move(anthro.id, heirId);
        if (acres && heirId !== null) {
            Notifications.toAnthro(heirId, `You inherited ${anthro.name}'s land (` + Land.acres(acres) + ').', '/game/assets/land');
        }
        return acres;
    }

    /**
     * The anthros anthro owns (not itself) go to newOwnerId; with no new owner, or if one is the new owner itself,
     * they go free.
     */
    private static handOverAnthros(anthro: Row, newOwnerId: number | null): void {
        const count = Auth.db().run('UPDATE game_anthros SET owner_id = IF(? IS NULL OR id = ?, id, ?) WHERE owner_id = ? AND id <> ?',
            [newOwnerId, newOwnerId, newOwnerId, anthro.id, anthro.id]);
        if (count) {
            const what = count === 1 ? '1 anthro' : `${count} anthros`;
            Notifications.toAnthro(anthro.id, `The anthros you owned (${what}) now belong to your new owner.`, '/game/assets');
            Notifications.toAnthro(newOwnerId, `${anthro.name}'s anthros (${what}) are yours now.`, '/game/assets');
        }
    }

    /**
     * Admin: forfeits one lot to the crown. Returns an error message, or null.
     */
    static seize(parcelId: number): string | null {
        const parcel = Land.parcel(parcelId);
        const anthro = parcel && parcel.anthro_id !== null ? Anthros.findAny(int(parcel.anthro_id)) : null;
        if (!anthro) {
            return 'That lot belongs to the land office already.';
        }
        const db = Auth.db();
        db.beginTransaction();
        Land.toCrown(anthro, Ranks.of(anthro), parcelId);
        db.commit();
        return null;
    }

    /**
     * Forfeits the anthro's land (or one lot of it) to the crown: it goes up to the anthro's liege or the next
     * rank up (see Ranks::heir), or to the land office if no one outranks it. Returns how many acres moved.
     */
    private static toCrown(anthro: Row, rank: number, parcelId: number | null = null): number {
        const heir = Ranks.heir(anthro, rank);
        const acres = Land.move(anthro.id, heir?.id ?? null, parcelId);
        if (acres) {
            const what = Land.acres(acres);
            Notifications.toAnthro(anthro.id, `Your land (${what}) was forfeit to the crown.`, '/game/market/land');
            Notifications.toAnthro(heir?.id ?? null, `${anthro.name}'s land (${what}) was forfeit to the crown and granted to you.`, '/game/market/land');
        }
        return acres;
    }

    /**
     * Moves the anthro's lots (or just parcelId) to another anthro (null: the land office), cancelling their
     * listings. Returns how many acres moved.
     */
    private static move(fromId: number, toId: number | null, parcelId: number | null = null): number {
        const db = Auth.db();
        const only = parcelId === null ? '' : ' AND p.id = ?';
        const params = parcelId === null ? [fromId] : [fromId, parcelId];
        const acres = float(db.value('SELECT COALESCE(SUM(p.acres), 0) FROM game_parcels p WHERE p.anthro_id = ?' + only, params));
        if (!acres) {
            return 0;
        }
        db.run(
            `UPDATE game_land_listings AS l
             SET status = 'cancelled', closed_at = UTC_TIMESTAMP()
             FROM game_parcels p
             WHERE p.id = l.parcel_id AND p.anthro_id = ? AND l.status = 'open'${only}`,
            params,
        );
        db.run('UPDATE game_parcels AS p SET anthro_id = ? WHERE p.anthro_id = ?' + only, [toId, ...params]);
        return acres;
    }

    /**
     * Admin: the land office puts count new lots of acres acres each (as typed), lying in the barony baronyId (and
     * its part partId, if given), up for sale at price each.
     * Returns [how many, null] or [null, error message].
     */
    static supply(count: number, acres: string | number, price: number, adminId: number, baronyId = 0, partId: number | null = null): [number | null, string | null] {
        const size = Land.hundredths(acres);
        if (count < 1 || count > Land.MAX_SUPPLY) {
            return [null, 'Supply 1-' + Land.MAX_SUPPLY + ' lots at a time.'];
        }
        if (size === null || size > Land.MAX_ACRES * 100) {
            return [null, 'Each lot must be ' + Land.acres(Land.MIN_ACRES) + ' to ' + Land.acres(Land.MAX_ACRES) + '.'];
        }
        if (price < 1) {
            return [null, 'The price must be at least 1 coin.'];
        }
        const barony = Baronies.all().get(baronyId) ?? null;
        if (!barony) {
            return [null, 'Choose the barony the land lies in.'];
        }
        if (partId !== null && !barony.parts.map((p: Row) => int(p.id)).includes(partId)) {
            return [null, `Choose a part of ${barony.name}, or none.`];
        }
        const db = Auth.db();
        db.beginTransaction();
        for (let i = 0; i < count; i++) {
            db.run('INSERT INTO game_parcels (anthro_id, acres, barony_id, part_id) VALUES (NULL, ?, ?, ?)', [size / 100, baronyId, partId]);
            Land.listForGame(db.lastInsertId(), size / 100, price, adminId);
        }
        db.commit();
        return [count, null];
    }

    /**
     * Admin: the land office puts one of its unlisted lots back on sale. Returns an error message, or null.
     */
    static relist(parcelId: number, price: number, adminId: number): string | null {
        const parcel = Land.parcel(parcelId);
        if (!parcel || parcel.anthro_id !== null) {
            return 'Only land office lots can be listed here.';
        }
        if (Land.openListing(parcelId) !== null) {
            return 'That lot is already for sale.';
        }
        if (price < 1) {
            return 'The price must be at least 1 coin.';
        }
        Land.listForGame(parcelId, float(parcel.acres), price, adminId);
        return null;
    }

    private static listForGame(parcelId: number, acres: number, price: number, adminId: number): void {
        Auth.db().run('INSERT INTO game_land_listings (parcel_id, acres, from_game, price, created_by) VALUES (?, ?, TRUE, ?, ?)',
            [parcelId, acres, price, adminId]);
    }

    /**
     * (lock: upstream adds FOR UPDATE; SQLite has no row locks, and the caller's transaction serves.)
     */
    static parcel(id: number, lock = false): Row | null {
        void lock;
        return Auth.db().row('SELECT * FROM game_parcels WHERE id = ?', [id]);
    }

    private static openListing(parcelId: number): number | null {
        const id = Auth.db().value("SELECT id FROM game_land_listings WHERE parcel_id = ? AND status = 'open'", [parcelId]);
        return id === null ? null : int(id);
    }
}
