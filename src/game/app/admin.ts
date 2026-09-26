// Upstream: game/src/App.php (the /game/admin pages: manageSpecies, manageGenders, manageRanks, showRank,
// listUnowned, forceBreed, supply, advanceTime, resetGame, manageNames, manageSaves, downloadSave, landOffice,
// moveLots, manageBuildings, manageGoods, manageBaronies, allNotifications, manageResets, manageWallets)
import type { User } from '../../core/Auth';
import { Auth } from '../../core/Auth';
import { resetCaches } from '../../core/caches';
import { field, fieldArray } from '../../core/http';
import { array_sum, empty, int, trim } from '../../core/php';
import { Session } from '../../core/Session';
import { App } from '../App';
import { Anthros, type BreedOutcome } from '../Anthros';
import { Auctions } from '../Auctions';
import { Baronies } from '../Baronies';
import { Board } from '../Board';
import { Buildings } from '../Buildings';
import { Genders } from '../Genders';
import { Jobs } from '../Jobs';
import { Land } from '../Land';
import { Market } from '../Market';
import { Names } from '../Names';
import { Notifications } from '../Notifications';
import { Ranks } from '../Ranks';
import { Resets } from '../Resets';
import { Saves } from '../Saves';
import { Schedules } from '../Schedules';
import { Species } from '../Species';
import { Wallets } from '../Wallets';
import { breedingMessage } from './assets';
import { reshapeLand } from './land';
import speciesView from '../views/admin/species';
import gendersView from '../views/admin/genders';
import ranksView from '../views/admin/ranks';
import rankView from '../views/admin/rank';
import unownedView from '../views/admin/unowned';
import breedView from '../views/admin/breed';
import supplyView from '../views/admin/supply';
import timeView from '../views/admin/time';
import resetGameView from '../views/admin/reset-game';
import namesView from '../views/admin/names';
import savesView from '../views/admin/saves';
import landView from '../views/admin/land';
import buildingsView from '../views/admin/buildings';
import goodsView from '../views/admin/goods';
import baroniesView from '../views/admin/baronies';
import notificationsView from '../views/admin/notifications';
import resetsView from '../views/admin/resets';
import walletsView from '../views/admin/wallets';

export function manageSpecies(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const id = int(field(app.post, 'id', '0'));
        const name = field(app.post, 'name');
        const groupId = int(field(app.post, 'group_id', '0'));
        const order = int(field(app.post, 'sort_order', '0'));
        const action = field(app.post, 'action');
        switch (action) {
            case 'add_species': error = Species.addSpecies(name, groupId); break;
            case 'update_species': error = Species.updateSpecies(id, name, groupId); break;
            case 'delete_species': error = Species.deleteSpecies(id); break;
            case 'add_group': error = Species.addGroup(name, order); break;
            case 'update_group': error = Species.updateGroup(id, name, order); break;
            case 'delete_group': error = Species.deleteGroup(id); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                add_species: 'Added species ' + trim(name) + '.',
                update_species: 'Saved species ' + trim(name) + '.',
                delete_species: 'Deleted the species.',
                add_group: 'Added group ' + trim(name) + '.',
                update_group: 'Saved group ' + trim(name) + '.',
                delete_group: 'Deleted the group.',
            } as Record<string, string>)[action];
            app.redirect('/game/admin/species');
        }
    }
    app.echo(app.render(speciesView, user, { groups: Species.groupsWithSpecies(), error }));
}

export function manageGenders(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const id = int(field(app.post, 'id', '0'));
        const fields = {
            name: field(app.post, 'name'),
            is_male: app.post.is_male !== undefined,
            is_female: app.post.is_female !== undefined,
            presents_as: field(app.post, 'presents_as'),
            birth_weight: int(field(app.post, 'birth_weight', '0')),
            sort_order: int(field(app.post, 'sort_order', '0')),
        };
        switch (action) {
            case 'add': error = Genders.add(fields); break;
            case 'update': error = Genders.update(id, fields); break;
            case 'delete': error = Genders.delete(id); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                add: 'Added gender ' + trim(fields.name) + '.',
                update: 'Saved gender ' + trim(fields.name) + '.',
                delete: 'Deleted the gender.',
            } as Record<string, string>)[action];
            app.redirect('/game/admin/genders');
        }
    }
    app.echo(app.render(gendersView, user, { genders: Genders.all(), error }));
}

export function manageRanks(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const rank = int(field(app.post, 'rank', '-1'));
        error = Ranks.update(rank, field(app.post, 'name'), field(app.post, 'female_name'),
            app.post.is_noble !== undefined, app.post.is_hereditary !== undefined);
        if (error === null) {
            Session.data.flash = 'Saved ' + Ranks.name(rank) + '.';
            app.redirect('/game/admin/ranks');
        }
    }
    app.echo(app.render(ranksView, user, { ranks: Ranks.all(), counts: Ranks.counts(), error }));
}

export function showRank(app: App, user: User, rank: number): void {
    if (rank < Ranks.KNIGHT || !Ranks.all().has(rank)) {
        app.gameNotFound(user);
        return;
    }
    app.echo(app.render(rankView, user, { rank: Ranks.all().get(rank)!, holders: Ranks.holders(rank) }));
}

export function listUnowned(app: App, user: User): void {
    app.echo(app.render(unownedView, user, { anthros: Anthros.unowned() }));
}

export function forceBreed(app: App, user: User, post: boolean): void {
    // Sire and dam are typed as "Name (#id)" (?sire=id and ?dam=id fill them in).
    const fieldOf = (role: string): string => {
        if (app.post[role] !== undefined && app.post[role] !== null) {
            return field(app.post, role);
        }
        const anthro = Anthros.findAny(int(field(app.query, role, '0')));
        return anthro ? `${anthro.name} (#${anthro.id})` : '';
    };
    const sire = fieldOf('sire');
    const dam = fieldOf('dam');
    const sireId = app.anthroIdFrom(sire);
    const damId = app.anthroIdFrom(dam);
    let error: string | null = null;
    if (post) {
        let outcome;
        [outcome, error] = Anthros.forceBreed(sireId, damId, 0, user.id);
        if (error === null) {
            // (A forced breeding's outcome is Litters.attempt's: no attempts or took, so breedingMessage reads one attempt.)
            Session.data.flash = breedingMessage(sireId, damId, outcome as BreedOutcome);
            app.redirect('/game/assets/' + damId);
        }
    }
    app.echo(app.render(breedView, user, {
        sire, dam, error,
    }));
}

export function supply(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post && field(app.post, 'action') === 'workers') {
        // Blank (or "random") fields are chosen at random for each worker.
        const pick = (name: string): number | null => (['', 'random'].includes(field(app.post, name)) ? null : int(field(app.post, name)));
        let count;
        [count, error] = Jobs.supply(int(field(app.post, 'count', '0')), pick('skill_id'),
            pick('breedable') === null ? null : !!pick('breedable'), pick('wage'));
        if (error === null) {
            Session.data.flash = `Put ${count} ` + (count === 1 ? 'worker' : 'workers') + ' on the job market.';
            app.redirect('/game/market/jobs');
        }
    } else if (post) {
        const buyNow = trim(field(app.post, 'buy_now'));
        let count;
        [count, error] = Auctions.supply(
            int(field(app.post, 'count', '0')), int(field(app.post, 'starting_bid', '0')),
            buyNow === '' ? null : int(buyNow), int(field(app.post, 'days', '0')),
        );
        if (error === null) {
            Session.data.flash = `Put ${count} random ` + (count === 1 ? 'anthro' : 'anthros') + ' up for auction.';
            app.redirect('/game/market');
        }
    }
    app.echo(app.render(supplyView, user, { error, skills: Schedules.skills(), post: app.post }));
}

export function advanceTime(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const days = int(field(app.post, 'days', '0'));
        // Save first (the default) so the jump can be undone from Saved games.
        if (!empty(app.post.save_first) && days >= 1 && days <= Board.MAX_ADVANCE) {
            [, error] = Saves.create(user, `Before advancing ${days} ` + (days === 1 ? 'day' : 'days'));
        }
        error ??= Board.advance(user, days);
        if (error === null) {
            Session.data.flash = `The game moved ${days} ` + (days === 1 ? 'day' : 'days') + ' ahead.';
            app.redirect('/game/admin/time');
        }
    }
    app.echo(app.render(timeView, user, { error }));
}

export function resetGame(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const confirm = trim(field(app.post, 'confirm'));
        // Save first (the default) so the reset can be undone from Saved games.
        if (confirm === Board.CONFIRM_WORD && !empty(app.post.save_first)) {
            [, error] = Saves.create(user, 'Before reset');
        }
        const counts = fieldArray(app.post, 'ranks');
        error ??= Board.reset(user, confirm, counts, !empty(app.post.consort), !empty(app.post.settle));
        if (error === null) {
            // Upstream's statics (ranks, the clock...) were forgotten at the end of the request.
            resetCaches();
            const court = array_sum(Object.values(counts).map((c) => int(c)));
            Session.data.flash = 'The game was reset: every anthro is gone, and players start over'
                + (court ? ', with a new court.' : '.') + (!empty(app.post.save_first) ? ' The old game is in Saved games.' : '');
            app.redirect('/game/home');
        }
    }
    app.echo(app.render(resetGameView, user, { counts: Board.counts(), error, post: app.post }));
}

export function manageNames(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        let flash = '';
        if (action === 'add') {
            let added;
            [added, error] = Names.add(field(app.post, 'names'), !empty(app.post.is_male), !empty(app.post.is_female));
            flash = `Added ${added} ` + (added === 1 ? 'name' : 'names') + '.';
        } else if (action.startsWith('save:')) {
            // Each row's Save button sends "save:<id>"; its fields are keyed by id.
            const id = int(action.substring(5));
            const name = fieldArray(app.post, 'name')[id];
            error = Names.update(id, typeof name === 'string' ? name : '', !empty(fieldArray(app.post, 'male')[id]), !empty(fieldArray(app.post, 'female')[id]));
            flash = 'Saved ' + trim(typeof name === 'string' ? name : '') + '.';
        } else if (action === 'delete') {
            const deleted = Names.delete(Object.values(fieldArray(app.post, 'ids')));
            flash = deleted ? `Removed ${deleted} ` + (deleted === 1 ? 'name' : 'names') + '.' : 'Select some names first.';
        } else {
            error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = flash;
            app.redirect('/game/admin/names');
        }
    }
    app.echo(app.render(namesView, user, { names: Names.all(), counts: Names.counts(), error, post: app.post }));
}

export function manageSaves(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const id = int(field(app.post, 'id', '0'));
        if (action === 'save') {
            [, error] = Saves.create(user, field(app.post, 'name'));
        } else if (action === 'restore') {
            error = trim(field(app.post, 'confirm')) === 'RESTORE' ? Saves.restore(user, id) : 'Type RESTORE to confirm.';
            if (error === null) {
                // Upstream's statics (ranks, the clock...) were forgotten at the end of the request.
                resetCaches();
            }
        } else if (action === 'delete') {
            error = Saves.delete(id);
        } else {
            error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                save: 'The game was saved.',
                restore: 'The saved game was restored. The game as it was is saved as "Before restoring".',
                delete: 'The save was deleted.',
            } as Record<string, string>)[action];
            app.redirect('/game/admin/saves');
        }
    }
    app.echo(app.render(savesView, user, { saves: Saves.all(), error, post: app.post }));
}

export function downloadSave(app: App, user: User, id: number): void {
    const save = Saves.find(id);
    if (!save) {
        app.gameNotFound(user);
        return;
    }
    const file = ('game-save-' + save.id + '-' + String(save.name).replace(/[^A-Za-z0-9]+/g, '-')).replace(/^-+|-+$/g, '') + '.json';
    app.download(file, 'application/json', Saves.json(save));
}

export function landOffice(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        let count: number | null = 0;
        // Where land lies is picked as "barony id" or "barony id:part id".
        const where = field(app.post, 'where', '0');
        const colon = where.indexOf(':');
        const [baronyId, partId] = colon === -1 ? [int(where), 0] : [int(where.slice(0, colon)), int(where.slice(colon + 1))];
        if (action === 'supply') {
            [count, error] = Land.supply(
                int(field(app.post, 'count', '0')), field(app.post, 'acres'), int(field(app.post, 'price', '0')), user.id,
                baronyId, partId || null,
            );
        }
        if (['split', 'merge'].includes(action)) {
            error = reshapeLand(app, user, action);
        }
        if (error === null) {
            switch (action) {
                case 'supply': case 'split': case 'merge': error = null; break;
                case 'move': error = moveLots(app, baronyId, partId || null); break;
                case 'relist': error = Land.relist(int(field(app.post, 'parcel_id', '0')), int(field(app.post, 'price', '0')), user.id); break;
                case 'seize': error = Land.seize(int(field(app.post, 'parcel_id', '0'))); break;
                case 'cancel': error = Land.cancel(user, int(field(app.post, 'listing_id', '0'))); break;
                default: error = 'Unknown action.';
            }
        }
        if (error === null) {
            switch (action) {
                case 'supply': Session.data.flash = `Put ${count} ` + (count === 1 ? 'lot' : 'lots') + ' up for sale.'; break;
                case 'move': Session.data.flash = 'Moved the ticked lots.'; break;
                case 'split': case 'merge': break; // (reshapeLand set the flash)
                case 'relist': Session.data.flash = 'The lot is for sale again.'; break;
                case 'seize': Session.data.flash = 'The lot was forfeit to the crown.'; break;
                case 'cancel': Session.data.flash = 'The listing was taken off the market.'; break;
            }
            app.redirect('/game/admin/land');
        }
    }
    const baronyId = int(field(app.query, 'barony', '0')) || null;
    app.echo(app.render(landView, user, {
        parcels: Land.all(baronyId), baronies: Baronies.all(), baronyId, error, post: app.post,
    }));
}

/**
 * Admin: moves the ticked lots ("ids") to a barony (and part). Returns an error message, or null.
 */
export function moveLots(app: App, baronyId: number, partId: number | null): string | null {
    const ids = Object.values(fieldArray(app.post, 'ids')).map((id) => int(id)).filter((id) => id);
    if (!ids.length) {
        return 'Tick the lots to move.';
    }
    for (const id of ids) {
        const error = Baronies.moveParcel(id, baronyId, partId);
        if (error) {
            return error;
        }
    }
    return null;
}

export function manageBuildings(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const id = int(field(app.post, 'id', '0')) || null;
        switch (action) {
            case 'save':
                error = Buildings.saveType(id, field(app.post, 'name'), int(field(app.post, 'days', '0')),
                    field(app.post, 'acres'), int(field(app.post, 'sort_order', '0')));
                break;
            case 'delete': error = Buildings.deleteType(int(id)); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = action === 'delete' ? 'The kind of building was removed.' : 'Saved.';
            app.redirect('/game/admin/buildings');
        }
    }
    app.echo(app.render(buildingsView, user, { types: Buildings.types(), error }));
}

/**
 * Admin: the market's goods and their prices (see Market).
 */
export function manageGoods(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const key = field(app.post, 'good') === '' ? null : field(app.post, 'good');
        switch (action) {
            case 'save':
                error = Market.save(key, field(app.post, 'name'), field(app.post, 'buy_price'),
                    field(app.post, 'sell_price'), int(field(app.post, 'sort_order', '0')));
                break;
            case 'delete': error = Market.delete(key ?? ''); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = action === 'delete' ? 'The good was removed.' : 'Saved.';
            app.redirect('/game/admin/goods');
        }
    }
    const stock = Auth.db().pairs('SELECT good, SUM(quantity) FROM game_goods GROUP BY good');
    app.echo(app.render(goodsView, user, { goods: Market.goods(), stock, error }));
}

export function manageBaronies(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const id = int(field(app.post, 'barony_id', '0'));
        const partId = int(field(app.post, 'part_id', '0')) || null;
        // Holders and managers are typed as "Name (#id)", or left empty for nobody.
        const who = (name: string): number | null => (trim(field(app.post, name)) === '' ? null : (app.anthroIdFrom(field(app.post, name)) || -1));
        switch (action) {
            case 'create': error = Baronies.create(field(app.post, 'name'), who('holder'))[1]; break;
            case 'update': error = Baronies.update(id, field(app.post, 'name'), who('holder')); break;
            case 'delete': error = Baronies.delete(id); break;
            case 'save_part': error = Baronies.savePart(id, partId, field(app.post, 'name'), field(app.post, 'kind'), who('manager')); break;
            case 'delete_part': error = Baronies.deletePart(int(partId)); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                create: 'The barony was founded.',
                update: 'The barony was saved.',
                delete: 'The barony was removed.',
                save_part: 'The part was saved.',
                delete_part: 'The part was removed; its land stays in the barony.',
            } as Record<string, string>)[action];
            app.redirect('/game/admin/baronies');
        }
    }
    app.echo(app.render(baroniesView, user, {
        baronies: Baronies.all(),
        // Who can be picked: holders (baron and up) and managers (baronet and up), by name.
        lords: Ranks.titled().filter((a) => int(a.rank) >= Baronies.MANAGER_RANK),
        error,
    }));
}

export function allNotifications(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const from = app.anthroIdFrom(field(app.post, 'from'));
        const to = app.anthroIdFrom(field(app.post, 'to'));
        error = Notifications.sendAs(user, from, to, field(app.post, 'body'));
        if (error === null) {
            Session.data.flash = 'Sent as ' + Anthros.findAny(from)!.name + ' to ' + Anthros.findAny(to)!.name + '.';
            app.redirect('/game/admin/notifications');
        }
    }
    // "Reply as" fills in the form: ?from=<unplayed anthro>&to=<who wrote to it>.
    const fieldOf = (key: string): string => {
        if (post) {
            return field(app.post, key);
        }
        const anthro = Anthros.findAny(int(field(app.query, key, '0')));
        return anthro ? `${anthro.name} (#${anthro.id})` : '';
    };
    app.echo(app.render(notificationsView, user, {
        items: Notifications.all(), error,
        from: fieldOf('from'), to: fieldOf('to'), body: post ? field(app.post, 'body') : '',
    }));
}

export function manageResets(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        switch (action) {
            case 'reset': error = Resets.reset(int(field(app.post, 'user_id', '0')), user.id); break;
            case 'dismiss': error = Resets.dismiss(int(field(app.post, 'request_id', '0')), user.id); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = action === 'reset' ? 'Player reset; they can choose a new anthro.' : 'Request dismissed.';
            app.redirect('/game/admin/resets');
        }
    }
    app.echo(app.render(resetsView, user, {
        requests: Resets.pending(), players: Resets.players(), error,
    }));
}

export function manageWallets(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        error = Wallets.adjust(int(field(app.post, 'anthro_id', '0')), int(field(app.post, 'amount', '0')),
            field(app.post, 'reason'), user.id);
        if (error === null) {
            Session.data.flash = 'Wallet adjusted.';
            app.redirect('/game/admin/wallets');
        }
    }
    const q = field(app.query, 'q');
    app.echo(app.render(walletsView, user, {
        wallets: Wallets.all(q, App.LIST_LIMIT), total: Wallets.countAll(q), q, error,
    }));
}
