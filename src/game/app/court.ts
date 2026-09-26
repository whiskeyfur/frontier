// Upstream: game/src/App.php (fiefs, court)
import type { User } from '../../core/Auth';
import { field } from '../../core/http';
import { int, range, ucfirst } from '../../core/php';
import { Session } from '../../core/Session';
import type { Row } from '../../db/Db';
import type { App } from '../App';
import { Anthros } from '../Anthros';
import { Fiefs } from '../Fiefs';
import { Land } from '../Land';
import { Marriages } from '../Marriages';
import { Ranks } from '../Ranks';
import { Wallets } from '../Wallets';
import courtView from '../views/court';
import courtFiefsView from '../views/court/fiefs';

/**
 * Fiefs (see Fiefs): offers to and from the player's anthro, the fiefs it holds and its tax, its vassals' fiefs,
 * and granting land.
 */
export function fiefs(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = field(app.post, 'action');
        const offerId = int(field(app.post, 'offer_id', '0'));
        let said: string | null = null;
        switch (action) {
            case 'grant':
                [said, error] = Fiefs.offerGrant(user, int(field(app.post, 'parcel_id', '0')), field(app.post, 'acres'),
                    app.anthroIdFrom(field(app.post, 'anthro')), int(field(app.post, 'rate', '0')));
                break;
            case 'rate':
                [said, error] = Fiefs.offerRate(user, int(field(app.post, 'vassal_id', '0')), int(field(app.post, 'rate', '0')));
                break;
            case 'accept': case 'decline':
                [said, error] = [action === 'accept' ? 'Accepted.' : 'Turned down.', Fiefs.answer(user, offerId, action === 'accept')];
                break;
            case 'withdraw':
                [said, error] = ['You took back the offer.', Fiefs.withdraw(user, offerId)];
                break;
            case 'pay':
                [said, error] = ['Paid ' + Wallets.format(Math.max(0, int(field(app.post, 'coins', '0')))) + '.', Fiefs.pay(user, int(field(app.post, 'coins', '0')))];
                break;
            case 'seize':
                [said, error] = ['You seized their fiefs.', Fiefs.seize(user, int(field(app.post, 'vassal_id', '0')))];
                break;
            default:
                [said, error] = [null, 'Unknown action.'];
        }
        if (error === null) {
            Session.data.flash = said;
            app.redirect('/game/court/fiefs');
        }
    }
    const player = Anthros.player(user.id);
    app.echo(app.render(courtFiefsView, user, {
        player,
        held: player ? Fiefs.heldBy(player.id) : [],
        vassals: player ? Fiefs.vassalsOf(player.id) : [],
        offers: player ? Fiefs.offers(player.id) : { received: [], sent: [] },
        // Lots it can grant: its own, not for sale.
        lots: player ? Land.parcels(player.id).filter((p) => !p.listing_id) : [],
        error,
    }));
}

export function court(app: App, user: User, post: boolean): void {
    let error: string | null = null;
    if (post) {
        const action = app.post.action ?? '';
        let done: string | null = null;
        if (action === 'grant') {
            // The anthro field reads "Name (#id)" (like message recipients); the id decides who it is.
            const match = field(app.post, 'anthro').match(/#(\d+)\)?\s*$/);
            const anthroId = match ? int(match[1]) : 0;
            const rank = field(app.post, 'rank');
            error = Ranks.grant(user, anthroId, rank === '' ? null : int(rank));
        } else if (action === 'swear') {
            // A titled liege is picked from a list; a fellow commoner is typed as "Name (#id)".
            const liegeId = app.post.liege !== undefined ? app.anthroIdFrom(field(app.post, 'liege')) : int(field(app.post, 'liege_id', '0'));
            error = app.post.liege !== undefined && !liegeId ? 'Choose a commoner to swear to.' : Ranks.swear(user, liegeId || null);
        } else if (action === 'assume') {
            error = Ranks.assume(user);
        } else if (action === 'propose') {
            // Who is typed as "Name (#id)"; into says whose household it is.
            [done, error] = Marriages.propose(user, app.anthroIdFrom(field(app.post, 'anthro')), (app.post.into ?? '') === 'mine');
        } else if (action === 'accept' || action === 'decline') {
            error = Marriages.answer(user, int(field(app.post, 'proposal_id', '0')), action === 'accept');
        } else if (action === 'withdraw') {
            error = Marriages.withdraw(user, int(field(app.post, 'proposal_id', '0')));
        } else if (action === 'leave') {
            error = Marriages.leave(user);
        } else if (action === 'dismiss') {
            error = Marriages.dismiss(user, int(field(app.post, 'spouse_id', '0')));
        } else {
            error = 'Unknown action.';
        }
        if (error === null) {
            const me = Anthros.player(user.id)!;
            switch (action) {
                case 'grant': Session.data.flash = 'The title was granted.'; break;
                case 'assume': Session.data.flash = 'You are ' + Ranks.title(me) + ' now.'; break;
                case 'propose': Session.data.flash = ucfirst(done ?? ''); break;
                case 'accept': Session.data.flash = 'You are married. You are ' + Ranks.title(me) + ' now.'; break;
                case 'decline': Session.data.flash = 'You said no.'; break;
                case 'withdraw': Session.data.flash = 'You took back your proposal.'; break;
                case 'leave': case 'dismiss': Session.data.flash = 'The marriage is over. You are ' + Ranks.title(me) + ' now.'; break;
                default: Session.data.flash = 'Your fealty is recorded.';
            }
            app.redirect('/game/court');
        }
    }
    const player = Anthros.player(user.id);
    const rank = player ? Ranks.of(player) : null;
    const nobles = Ranks.titled();
    const fealty = player ? Ranks.fealtyOf(player.id) : [];
    app.echo(app.render(courtView, user, {
        nobles, player, rank,
        // A free anthro can swear to anyone of its rank or higher, but not to anyone sworn to it.
        lieges: player && rank! > Ranks.SLAVE
            ? nobles.filter((n: Row) => int(n.rank) >= rank! && n.id !== player.id && !fealty.includes(n.id)) : [],
        sworn: player ? Ranks.sworn(player.id) : { vassals: [], followers: [], children: [], slaves: [] },
        spouses: player ? Marriages.spouses(player.id) : [],
        proposals: player ? Marriages.proposals(player.id) : { received: [], sent: [] },
        // A rank its land earns, or the crown while nobody holds it (see Ranks.assumable).
        assumable: player ? Ranks.assumable(player) : null,
        // The King or Queen grants titles below theirs on the page; admins grant any from the admin panel.
        crownRanks: Ranks.playsCrown(user) ? range(Ranks.KING - 1, Ranks.KNIGHT) : [],
        error,
    }));
}
