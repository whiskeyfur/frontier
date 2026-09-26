// Upstream: game/src/App.php (the market: auction, groupBid, land, jobs)
import type { User } from '../../core/Auth';
import { field } from '../../core/http';
import { array_unique, int, trim } from '../../core/php';
import { Session } from '../../core/Session';
import { Anthros } from '../Anthros';
import { App } from '../App';
import { Auctions } from '../Auctions';
import { Jobs } from '../Jobs';
import { Land } from '../Land';
import { Wallets } from '../Wallets';
import auctionView from '../views/market/auction';
import jobsView from '../views/market/jobs';
import landView from '../views/market/land';

/** A posted field as PHP's (array)($_POST[name] ?? []): an array's values, a single value as a list of one. */
function postedList(app: App, name: string): unknown[] {
    const value = app.post[name];
    if (value === undefined) return [];
    return typeof value === 'object' ? Object.values(value) : [value];
}

export function auction(app: App, user: User, id: number, post: boolean): void {
    let auction = Auctions.find(id);
    if (!auction) {
        app.gameNotFound(user);
        return;
    }
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        switch (action) {
            case 'bid': error = Auctions.bid(id, user, int(field(app.post, 'amount', '0'))); break;
            case 'buy_now': error = Auctions.buyNow(id, user); break;
            case 'cancel': error = Auctions.cancel(id, user); break;
            case 'close': error = Auctions.closeEarly(id, user); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            const after = Auctions.find(id)!;
            Session.data.flash = action === 'cancel' ? 'Auction cancelled.'
                : action === 'close' && after.status === 'sold'
                    ? `Sold ${after.anthro_name} for ` + Wallets.format(int(after.final_price)) + '.'
                : action === 'close' ? `Auction closed with no bids; ${after.anthro_name} stays yours.`
                : after.status === 'sold' ? `You bought ${after.anthro_name} for ` + Wallets.format(int(after.final_price)) + '.'
                : 'Your bid of ' + Wallets.format(int(after.current_bid)) + ' is the highest.';
            app.redirect(after.status === 'sold' && after.winner_id === user.id
                ? '/game/assets/' + after.anthro_id : '/game/market/auctions/' + id);
        }
        auction = Auctions.find(id)!;
    }
    const payer = Wallets.anthroFor(user.id);
    app.echo(app.render(auctionView, user, {
        auction, bids: Auctions.bids(id), minimum: Auctions.minimumBid(auction),
        balance: payer ? Wallets.balance(payer) : null, error,
    }));
}

/**
 * Bids on (or buys now) several selected auctions from the Market list, in order, reporting each outcome.
 * With no amount given, each bid is that auction's minimum.
 */
export function groupBid(app: App, user: User, post: boolean): void {
    if (!post) {
        app.redirect('/game/market');
    }
    const ids = array_unique(postedList(app, 'ids').map(int));
    const action = field(app.post, 'action');
    const amount = trim(field(app.post, 'amount'));
    if (!ids.length) {
        Session.data.flash = ['Select some auctions first.'];
        app.redirect('/game/market');
    }
    if (!['bid', 'buy_now'].includes(action)) {
        Session.data.flash = ['Choose an action.'];
        app.redirect('/game/market');
    }

    const lines: string[] = [];
    let done = 0;
    for (const id of ids) {
        const auction = Auctions.find(id);
        if (!auction) {
            continue;
        }
        const name = auction.anthro_name;
        let error: string | null;
        if (action === 'buy_now') {
            error = Auctions.buyNow(id, user);
        } else {
            const bid = amount === '' ? Auctions.minimumBid(auction) : int(amount);
            error = Auctions.bid(id, user, bid);
        }
        if (error) {
            lines.push(`Skipped ${name}: ${error}`);
            continue;
        }
        done++;
        const after = Auctions.find(id)!;
        lines.push(after.status === 'sold'
            ? `Bought ${name} for ` + Wallets.format(int(after.final_price))
            : 'Bid ' + Wallets.format(int(after.current_bid)) + ` on ${name}`);
    }
    const payer = Wallets.anthroFor(user.id);
    lines.unshift((action === 'buy_now' ? `Bought ${done}` : `Placed ${done} ` + (done === 1 ? 'bid' : 'bids'))
        + (payer ? '. You have ' + Wallets.format(Wallets.balance(payer)) + ' left.' : '.'));
    Session.data.flash = lines;
    app.redirect('/game/market');
}

export function land(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        switch (action) {
            case 'buy': error = Land.buy(user, int(field(app.post, 'listing_id', '0'))); break;
            case 'sell': error = Land.sell(user, int(field(app.post, 'parcel_id', '0')), field(app.post, 'acres'), int(field(app.post, 'price', '0'))); break;
            case 'cancel': error = Land.cancel(user, int(field(app.post, 'listing_id', '0'))); break;
            default: error = 'Unknown action.';
        }
        if (error === null) {
            Session.data.flash = ({
                buy: 'The land is yours.',
                sell: 'Your land is on the market.',
                cancel: 'The listing was taken off the market.',
            } as Record<string, string>)[action];
            app.redirect('/game/market/land');
        }
    }
    const player = Anthros.player(user.id);
    app.echo(app.render(landView, user, {
        listings: Land.open(), recent: Land.recent(),
        player, canTrade: Land.canTrade(player),
        parcels: player ? Land.parcels(player.id) : [],
        balance: player ? Wallets.balance(player.id) : null,
        error,
    }));
}

export function jobs(app: App, user: User, post: boolean): void {
    if (post) {
        const action = field(app.post, 'action');
        if (action === 'hire') {
            // A row's own Hire button sends "only"; "Hire selected" sends the ticked ids.
            const ids = app.post.only !== undefined ? [int(field(app.post, 'only', '0'))] : postedList(app, 'ids');
            const result = Jobs.hire(user, ids);
            const lines = result.hired.length ? ['Hired ' + result.hired.join(', ') + '.'] : [];
            if (!ids.length) {
                lines.push('Select some anthros first.');
            }
            Session.data.flash = [...(lines.length ? lines : ['No one was hired.']), ...result.skipped.map((s) => `Skipped ${s}`)];
        } else if (action === 'dismiss') {
            Session.data.flash = Jobs.dismiss(user, int(field(app.post, 'anthro_id', '0'))) ?? 'You let them go.';
        }
        // Back to Assets → Workers when the form came from there.
        app.redirect(field(app.post, 'back') === '/game/assets/workers' ? '/game/assets/workers' : '/game/market/jobs');
    }
    const payer = Wallets.anthroFor(user.id);
    const q = field(app.query, 'q');
    app.echo(app.render(jobsView, user, {
        seekers: Anthros.forHire(q, App.LIST_LIMIT + 1).filter((a) => a.id !== payer).slice(0, App.LIST_LIMIT),
        seekersTotal: Anthros.countForHire(q),
        q,
        employees: Anthros.employedBy(user.id),
        balance: payer ? Wallets.balance(payer) : null,
    }));
}
