// Upstream: game/src/App.php
//
// App.php's private handler methods are split by section, so each can be ported and changed on its own:
// src/game/app/{home,assets,schedules,land,market,social,court,admin}.ts, as functions taking the App first
// (`$this->breed($user, $anthro, $post)` → `assets.breed(this, user, anthro, post)`). handle() and the helpers at the
// end of App.php (render, gameNotFound, anthroIdFrom, redirect) stay here.
import { Auth, type User } from '../core/Auth';
import { Redirect, Respond, field, type InputArray, type Request, type Response } from '../core/http';
import type { Html } from '../core/html';
import { Session } from '../core/Session';
import { ViewContext, type View } from '../core/View';
import { int } from '../core/php';
import type { Row } from '../db/Db';
import { Anthros } from './Anthros';
import { Auctions } from './Auctions';
import { Baronies } from './Baronies';
import { Board } from './Board';
import { Buildings } from './Buildings';
import { Finances } from './Finances';
import { Genders } from './Genders';
import { Goods } from './Goods';
import { Land } from './Land';
import { Litters } from './Litters';
import { Market } from './Market';
import { Names } from './Names';
import { Notifications } from './Notifications';
import { Played } from './Played';
import { Preferences } from './Preferences';
import { Ranks } from './Ranks';
import { Schedules } from './Schedules';
import { Wallets } from './Wallets';
import * as admin from './app/admin';
import * as assets from './app/assets';
import * as court from './app/court';
import * as home from './app/home';
import * as market from './app/market';
import * as social from './app/social';
import * as schedules from './app/schedules';
import * as land from './app/land';
import { Docs } from '../site/Docs';
import changesMd from './views/changes.md?raw';
import knowledgeBaseMd from './views/knowledge-base.md?raw';
import assetsIndexView from './views/assets/index';
import assetsWorkersView from './views/assets/workers';
import assetsLandView from './views/assets/land';
import assetsGoodsView from './views/assets/goods';
import preferencesView from './views/preferences';
import marketIndexView from './views/market/index';
import marketGoodsView from './views/market/goods';
import courtStructureView from './views/court-structure';
import courtLandsView from './views/court-lands';
import courtBaronyView from './views/court/barony';
import changesView from './views/changes';
import knowledgeBaseView from './views/knowledge-base';
import financesReportView from './views/finances-report';
import walletView from './views/wallet';
import messageView from './views/message';

/**
 * The /game app: a separate application that reuses the main site's login.
 * Only players and admins can use it; to everyone else it doesn't exist.
 */
export class App {
    // Game pages, in menu order.
    static readonly PAGES: Record<string, string> = {
        '/game/home': 'Game',
        '/game/assets': 'Assets',
        '/game/market': 'Market',
        '/game/socials': 'Social',
        '/game/court': 'Court',
        '/game/wallet': 'Finances',
        '/game/docs': 'Docs',
    };

    // Menu items that open a submenu: [path => label], the first usually the item's own page.
    static readonly SUBPAGES: Record<string, Record<string, string>> = {
        '/game/assets': {
            '/game/assets': 'Overview', '/game/assets/slaves': 'Slaves', '/game/assets/workers': 'Workers',
            '/game/assets/land': 'Land', '/game/assets/goods': 'Goods', '/game/assets/schedules': 'Schedules',
        },
        '/game/market': {
            '/game/market': 'Anthros', '/game/market/jobs': 'Jobs', '/game/market/goods': 'Goods',
            '/game/market/land': 'Real estate',
        },
        '/game/socials': { '/game/socials': 'Flirt', '/game/groups': 'Breeding groups', '/game/notifications': 'Notifications' },
        '/game/court': { '/game/court': 'Nobility', '/game/court/structure': 'Structure', '/game/court/lands': 'Lands', '/game/court/fiefs': 'Fiefs' },
        '/game/home': { '/game/home': 'Home', '/game/preferences': 'Preferences' },
        '/game/wallet': { '/game/wallet': 'Wallet', '/game/finances/report': 'Report' },
        '/game/docs': { '/game/docs/knowledge-base': 'Knowledge Base', '/game/docs/changes': 'Changes' },
    };

    // Long lists (anthros to become, job seekers, wallets) show this many at a time, searchable by name.
    static readonly LIST_LIMIT = 100;

    // Admin-only game pages, [label, what it's for], listed on the admin page (/admin).
    // (Upstream's first entry, /admin/game, takes the live site's game down for maintenance: there's none here.)
    static readonly ADMIN_PAGES: Record<string, [string, string]> = {
        '/game/admin/species': ['Species', 'Add, rename, regroup or remove species.'],
        '/game/admin/genders': ['Genders', 'Genders, which can sire or carry, how they present, and how often they\'re born.'],
        '/game/admin/names': ['Names', 'The random names given to new anthros.'],
        '/game/admin/ranks': ['Ranks', 'Rename the ranks, choose which are noble and hereditary, and see who holds each.'],
        '/game/admin/breed': ['Force breed', 'Breed any two anthros, ignoring fertility and ownership.'],
        '/game/admin/unowned': ['Game-owned', 'Anthros the game owns (supplied for auction), to give away.'],
        '/game/admin/supply': ['Supply anthros', 'Put new random anthros up for auction, or on the job market with a trade.'],
        '/game/admin/land': ['Land office', 'Put land up for sale, and see who holds every lot.'],
        '/game/admin/baronies': ['Baronies', 'Found, name and grant baronies and their towns, villages and expanses.'],
        '/game/admin/buildings': ['Buildings', 'The kinds of buildings anthros can build: days of work and acres of land.'],
        '/game/admin/goods': ['Goods', 'The goods the market trades, and what it charges and pays for them.'],
        '/game/admin/recipes': ['Recipes', 'What each occupation makes, from what: producers, craftsmen and service jobs.'],
        '/game/admin/wallets': ['Wallets', 'Every anthro\'s coins; add or take away.'],
        '/game/admin/resets': ['Resets', 'Players asking to stop playing their anthro.'],
        '/game/admin/notifications': ['Notifications', 'Every notification and message, deleted ones included.'],
        '/game/admin/saves': ['Saved games', 'Save, download and restore the whole game.'],
        '/game/admin/reset-game': ['Reset game', 'Start the game over with a new court.'],
        '/game/admin/time': ['Advance time', 'Move the game a day, a week, a month or more ahead.'],
    };

    /** The page being written (upstream echoes it). */
    private output = '';
    private title = '';
    status = 200;

    constructor(public readonly request: Request) {}

    /** $_POST */
    get post(): InputArray {
        return this.request.post;
    }

    /** $_GET */
    get query(): InputArray {
        return this.request.query;
    }

    /**
     * Handles the request, returning its response: the page, or the redirect it ended in (upstream's run()).
     */
    run(): Response {
        try {
            this.handle();
        } catch (e) {
            if (e instanceof Redirect) return { kind: 'redirect', location: e.location };
            if (e instanceof Respond) return e.response;
            throw e;
        }
        return { kind: 'html', status: this.status, html: this.output, title: this.title };
    }

    /**
     * Handles the current request, echoing the page. A redirect ends it by throwing Redirect (run() returns it), so
     * tests can call this directly.
     */
    handle(): void {
        const user = Auth.user();
        if (!user) {
            this.redirect('/');
        }
        if (!Auth.isPlayer(user) && !Auth.isAdmin(user)) {
            this.gameNotFound(user);
            return;
        }

        // The day's business (births, deaths, meals, schedules...) happens the first time anyone uses the game that day.
        Board.runDaily();

        const path = this.request.path;
        const post = this.request.isPost;
        let match: RegExpMatchArray | null;

        if ((match = path.match(/^\/game\/court\/lands\/(\d+)$/))) {
            const barony = Baronies.find(int(match[1]));
            if (barony) {
                this.echo(this.render(courtBaronyView, user, { barony }));
            } else {
                this.gameNotFound(user);
            }
            return;
        }

        if ((match = path.match(/^\/game\/market\/auctions\/(\d+)$/))) {
            market.auction(this, user, int(match[1]), post);
            return;
        }

        if ((match = path.match(/^\/game\/assets\/schedules(?:\/(\d+))?$/))) {
            schedules.standards(this, user, match[1] !== undefined ? int(match[1]) : null, post);
            return;
        }

        if ((match = path.match(/^\/game\/assets\/(\d+)(\/breed|\/self-breed|\/schedule|\/transfer|\/rename|\/life|\/birth|\/sell|\/debt)?$/))) {
            // Any player can open an anthro's page to look at it; what it lets them do depends on who they are.
            // Breeding is for the owner (or employer); transfers for the owner or an admin. The "owner" is the player
            // of the anthro that owns it (or of the anthro itself, when it's free).
            const anthro = Anthros.findAny(int(match[1]));
            const isOwner = !!anthro && Anthros.isOwner(user, anthro);
            const action = match[2] ?? '';
            let allowed = false;
            if (anthro) {
                switch (action) {
                    case '/breed': case '/self-breed': allowed = Anthros.mayBreed(user, anthro); break;
                    case '/schedule': allowed = Schedules.canPlan(user, anthro); break;
                    case '/sell': allowed = isOwner; break;
                    case '/transfer': case '/rename': case '/debt': allowed = isOwner || Auth.isAdmin(user); break;
                    case '/life': case '/birth': allowed = Auth.isAdmin(user); break;
                    default: allowed = true;
                }
            }
            if (!anthro || !allowed) {
                this.gameNotFound(user);
            } else if (action === '/breed') {
                assets.breed(this, user, anthro, post);
            } else if (action === '/schedule') {
                schedules.schedule(this, user, anthro, post);
            } else if (action === '/self-breed') {
                if (post) {
                    const [outcome, error] = Anthros.selfBreed(user, anthro.id, int(field(this.post, 'cubs', '0')));
                    if (error !== null) {
                        assets.showAnthro(this, user, anthro, error);
                        return;
                    }
                    Session.data.flash = assets.breedingMessage(anthro.id, anthro.id, outcome);
                }
                this.redirect('/game/assets/' + anthro.id);
            } else if (action === '/transfer') {
                assets.transfer(this, user, anthro, post);
            } else if (action === '/rename') {
                assets.rename(this, user, anthro, post);
            } else if (action === '/birth') {
                // Admin: her litter is born now.
                if (post) {
                    const error = Litters.forceBirth(anthro.id);
                    if (error !== null) {
                        assets.showAnthro(this, user, anthro, error);
                        return;
                    }
                    Session.data.flash = `${anthro.name} gave birth.`;
                }
                this.redirect('/game/assets/' + anthro.id);
            } else if (action === '/life') {
                assets.setLife(this, user, anthro, post);
            } else if (action === '/sell') {
                assets.sell(this, user, anthro, post);
            } else if (action === '/debt') {
                assets.setDebt(this, user, anthro, post);
            } else {
                assets.showAnthro(this, user, anthro);
            }
            return;
        }

        if ((path + '/').startsWith('/game/admin/')) {
            if (!Auth.isAdmin(user)) {
                this.gameNotFound(user);
                return;
            }
            if ((match = path.match(/^\/game\/admin\/ranks\/(\d+)$/))) {
                admin.showRank(this, user, int(match[1]));
                return;
            }
            if ((match = path.match(/^\/game\/admin\/saves\/(\d+)\.json$/))) {
                admin.downloadSave(this, user, int(match[1]));
                return;
            }
            switch (path) {
                case '/game/admin': this.redirect('/game/admin/species'); break;
                case '/game/admin/species': admin.manageSpecies(this, user, post); break;
                case '/game/admin/genders': admin.manageGenders(this, user, post); break;
                case '/game/admin/names': admin.manageNames(this, user, post); break;
                case '/game/admin/ranks': admin.manageRanks(this, user, post); break;
                case '/game/admin/breed': admin.forceBreed(this, user, post); break;
                case '/game/admin/unowned': admin.listUnowned(this, user); break;
                case '/game/admin/supply': admin.supply(this, user, post); break;
                case '/game/admin/land': admin.landOffice(this, user, post); break;
                case '/game/admin/baronies': admin.manageBaronies(this, user, post); break;
                case '/game/admin/buildings': admin.manageBuildings(this, user, post); break;
                case '/game/admin/goods': admin.manageGoods(this, user, post); break;
                case '/game/admin/recipes': admin.manageRecipes(this, user, post); break;
                case '/game/admin/wallets': admin.manageWallets(this, user, post); break;
                case '/game/admin/resets': admin.manageResets(this, user, post); break;
                case '/game/admin/notifications': admin.allNotifications(this, user, post); break;
                case '/game/admin/reset-game': admin.resetGame(this, user, post); break;
                case '/game/admin/time': admin.advanceTime(this, user, post); break;
                case '/game/admin/saves': admin.manageSaves(this, user, post); break;
                default: this.gameNotFound(user);
            }
            return;
        }

        switch (path) {
            // /game and /game/ (the app's directory) go to the home page.
            case '/game':
                this.redirect('/game/home');

            case '/game/home':
                home.home(this, user, post);
                break;

            case '/game/assets': {
                // In-house anthros can be bred and sold; ones up for auction are listed separately.
                const owned = Anthros.forOwner(user.id);
                this.echo(this.render(assetsIndexView, user, {
                    anthros: owned.filter((a) => a.auction_id === null),
                    listed: owned.filter((a) => a.auction_id !== null).map((a) => ({ ...a, auction: Auctions.find(int(a.auction_id)) })),
                    employees: Anthros.employedBy(user.id),
                    planOptions: Schedules.groupOptions(user), standards: Schedules.standards(user.id),
                }));
                break;
            }

            case '/game/assets/slaves': {
                // The anthros the player's anthro owns (not itself), in the same layout as the overview.
                const me = Wallets.anthroFor(user.id);
                const owned = Anthros.forOwner(user.id).filter((a) => a.id !== me);
                this.echo(this.render(assetsIndexView, user, {
                    heading: 'Slaves',
                    anthros: owned.filter((a) => a.auction_id === null),
                    listed: owned.filter((a) => a.auction_id !== null).map((a) => ({ ...a, auction: Auctions.find(int(a.auction_id)) })),
                    employees: [],
                    planOptions: Schedules.groupOptions(user), standards: Schedules.standards(user.id),
                }));
                break;
            }

            case '/game/assets/workers':
                this.echo(this.render(assetsWorkersView, user, { employees: Anthros.employedBy(user.id) }));
                break;

            case '/game/assets/land': {
                const error = post ? land.reshapeLand(this, user, field(this.post, 'action')) : null;
                if (post && error === null) {
                    this.redirect('/game/assets/land');
                }
                const player = Anthros.player(user.id);
                this.echo(this.render(assetsLandView, user, {
                    player, parcels: player ? Land.parcels(player.id) : [],
                    canTrade: Land.canTrade(player), error,
                    holdings: player ? Baronies.holdingsOf(player.id) : { held: [], through: [], managed: [] },
                    buildings: player ? Buildings.onLots(Land.parcels(player.id).map((p) => p.id)) : new Map(),
                }));
                break;
            }

            case '/game/assets/goods': {
                const player = Anthros.player(user.id);
                const names = [...Object.keys(Market.names())];
                this.echo(this.render(assetsGoodsView, user, {
                    player,
                    goods: player ? Object.fromEntries(names.map((good) => [good, Goods.amount(player.id, good)])) : {},
                    household: player ? Goods.household(player.id) : [],
                }));
                break;
            }

            case '/game/assets/group':
                assets.groupAction(this, user, post);
                break;

            case '/game/pace': {
                // The pace buttons by the clock (see game::clock-bar): ask for a pace, or (the one asked for) no longer.
                if (post) {
                    const error = Preferences.setTimeRate(user, field(this.post, 'time_rate'));
                    Session.data.flash = error ?? (field(this.post, 'time_rate') === ''
                        ? 'You no longer ask for a pace.' : 'You ask for ' + field(this.post, 'time_rate') + ' game days per real day.');
                }
                const back = field(this.post, 'back');
                this.redirect(/^\/game\/[a-z0-9\/_-]*$/.test(back) ? back : '/game/home');
            }

            case '/game/preferences': {
                let error: string | null = null;
                if (post) {
                    error = Preferences.setEra(user, field(this.post, 'era'))
                        ?? Preferences.setTimeRate(user, field(this.post, 'time_rate'));
                    if (error === null) {
                        Session.data.flash = 'Your preferences are saved.';
                        this.redirect('/game/preferences');
                    }
                }
                this.echo(this.render(preferencesView, user, { era: Preferences.era(user.id), timeRate: Preferences.timeRate(user.id), error }));
                break;
            }

            case '/game/anthros/search':
                // Suggestions for name fields (see the data-anthro-search script in src/shell/layout-scripts.ts).
                this.json(Anthros.search(field(this.query, 'q')));

            case '/game/names/random': {
                // Names follow how the chosen gender presents; androgynous or unknown gets neutral names.
                const presentsAs = Genders.find(int(field(this.query, 'gender', '0')))?.presents_as ?? null;
                this.json({ name: Names.random(Wallets.anthroFor(user.id) ?? 0, presentsAs) });
            }

            case '/game/market': {
                const payer = Wallets.anthroFor(user.id);
                this.echo(this.render(marketIndexView, user, {
                    auctions: Auctions.open(), mine: Auctions.involving(user.id),
                    balance: payer ? Wallets.balance(payer) : null,
                }));
                break;
            }

            case '/game/market/goods': {
                let error: string | null = null;
                if (post) {
                    // The button pressed says "buy:<good>" or "sell:<good>"; the quantity is that good's row.
                    const [action, good = ''] = field(this.post, 'trade').split(/:(.*)/s);
                    const quantities = this.post.quantity;
                    const quantity = int(typeof quantities === 'object' ? quantities[good] ?? 0 : 0);
                    error = action === 'sell' ? Market.sell(user, good, quantity) : Market.buy(user, good, quantity);
                    if (error === null) {
                        Session.data.flash = (action === 'sell' ? 'Sold ' : 'Bought ') + `${quantity} ` + String(Market.names()[good]).toLowerCase() + '.';
                        this.redirect('/game/market/goods');
                    }
                }
                const player = Anthros.player(user.id);
                this.echo(this.render(marketGoodsView, user, {
                    player, error,
                    balance: player ? Wallets.balance(player.id) : null,
                    goods: Object.fromEntries(Object.entries(Market.goods()).filter(([, g]) => g.buy_price !== null || g.sell_price !== null)),
                }));
                break;
            }

            case '/game/market/jobs':
                market.jobs(this, user, post);
                break;

            case '/game/court':
                court.court(this, user, post);
                break;

            case '/game/court/fiefs':
                court.fiefs(this, user, post);
                break;

            case '/game/court/structure':
                this.echo(this.render(courtStructureView, user, { court: Ranks.structure() }));
                break;

            case '/game/court/lands':
                this.echo(this.render(courtLandsView, user, { realm: Baronies.tree() }));
                break;

            case '/game/groups':
                social.groups(this, user, post);
                break;

            case '/game/socials':
                social.socials(this, user, post);
                break;

            case '/game/docs':
                this.redirect('/game/docs/knowledge-base');

            case '/game/changes':
                // Its old address.
                this.redirect('/game/docs/changes');

            case '/game/docs/changes':
                // What's changed in the game, kept as Markdown in game/views/changes.md.
                this.echo(this.render(changesView, user, {
                    html: Docs.render(changesMd, user)[0],
                }));
                break;

            case '/game/docs/knowledge-base': {
                // How the game works, kept as Markdown in game/views/knowledge-base.md, with a contents list.
                const [html, contents] = Docs.render(knowledgeBaseMd, user);
                this.echo(this.render(knowledgeBaseView, user, { html, contents }));
                break;
            }

            case '/game/market/land':
                market.land(this, user, post);
                break;

            case '/game/notifications':
                social.notifications(this, user, post);
                break;

            case '/game/market/group':
                market.groupBid(this, user, post);
                break;

            case '/game/finances/report': {
                const player = Anthros.player(user.id);
                this.echo(this.render(financesReportView, user, { player, report: player ? Finances.report(player) : null }));
                break;
            }

            case '/game/donate': {
                // From an anthro's page: back there, with the error if the gift couldn't be given.
                const to = Anthros.findAny(int(field(this.post, 'to', '0')));
                if (!post || !to) {
                    this.gameNotFound(user);
                    break;
                }
                const error = Finances.donate(user, to.id, field(this.post, 'resource'), int(field(this.post, 'amount', '0')));
                if (error !== null) {
                    assets.showAnthro(this, user, to, error);
                    break;
                }
                Session.data.flash = `Your gift to ${to.name} was given.`;
                this.redirect('/game/assets/' + to.id);
                break;
            }

            case '/game/wallet': {
                // The wallet is the played anthro's.
                const player = Anthros.player(user.id);
                this.echo(this.render(walletView, user, player ? {
                    player, balance: Wallets.balance(player.id),
                    held: Wallets.held(player.id), ledger: Wallets.ledger(player.id),
                } : { player: null }));
                break;
            }

            default:
                this.gameNotFound(user);
        }
    }

    /** Adds to the page (upstream's echo). */
    echo(html: string): void {
        this.output += html;
    }

    gameNotFound(user: User): void {
        this.status = 404;
        this.echo(this.render(messageView, user, { title: 'Not found', message: 'There is nothing here.' }));
    }

    render<T extends object>(view: View<T>, user: User, data: T): string {
        const flash = Session.takeFlash();
        Played.reset();
        const v = new ViewContext(user, this.request.path, flash, Notifications.unreadCount(user));
        const html: Html = view(v, data);
        this.title = v.title;
        return html.value;
    }

    /**
     * The anthro id from a field that reads "Name (#id)" (anthro pickers use a datalist of those), or 0.
     */
    anthroIdFrom(value: string): number {
        const match = value.match(/#(\d+)\)?\s*$/);
        return match ? int(match[1]) : 0;
    }

    redirect(to: string): never {
        throw new Redirect(to);
    }

    /** Ends the request with JSON (upstream: header('Content-Type: application/json'); echo json_encode(...)). */
    json(body: unknown, status = 200): never {
        throw new Respond({ kind: 'json', status, body: JSON.parse(JSON.stringify(body, (_, v) => (v instanceof Map ? Object.fromEntries(v) : v))) });
    }

    /** Ends the request with a file to download. */
    download(filename: string, type: string, data: string | Uint8Array): never {
        throw new Respond({ kind: 'download', filename, type, data });
    }
}

export type { Row };
