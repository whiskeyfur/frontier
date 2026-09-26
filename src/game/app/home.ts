// Upstream: game/src/App.php (home)
import { Auth, type User } from '../../core/Auth';
import { field, type Input } from '../../core/http';
import { Session } from '../../core/Session';
import { int, str, trim } from '../../core/php';
import { App } from '../App';
import { Anthros } from '../Anthros';
import { Genders } from '../Genders';
import { Jobs } from '../Jobs';
import { Land } from '../Land';
import { Resets } from '../Resets';
import { Wallets } from '../Wallets';
import indexView from '../views/index';
import { breedingMessage } from './assets';

export function home(app: App, user: User, post: boolean): void {
    const player = Anthros.player(user.id);
    const p = app.post;
    const form = {
        name: str(p.name ?? player?.name ?? ''),
        gender_id: int(p.gender_id ?? player?.gender_id ?? 0),
        species_id: int(p.species_id ?? player?.species_id ?? 0),
        birthdate: str(p.birthdate ?? player?.birthdate ?? ''),
    };
    const action = p.action ?? '';
    let error: string | null = null;
    if (post && action === 'set_wage') {
        error = Jobs.setAsking(user, field(p, 'wage'),
            (p.occupation_id ?? '') === '' ? null : int(p.occupation_id));
        if (error === null) {
            Session.data.flash = trim(field(p, 'wage')) === '' ? "You're not looking for work."
                : "You're on the job market.";
            app.redirect('/game/home');
        }
    } else if (post && action === 'quit') {
        error = Jobs.quit(user);
        if (error === null) {
            Session.data.flash = 'You quit your job.';
            app.redirect('/game/home');
        }
    } else if (post && action === 'buy_freedom') {
        error = Anthros.buyFreedom(user);
        if (error === null) {
            Session.data.flash = 'You bought your freedom: you now own yourself.';
            app.redirect('/game/home');
        }
    } else if (post && action === 'request_reset') {
        error = Resets.request(user, field(p, 'reason'));
        if (error === null) {
            Session.data.flash = 'Your reset request was sent to the admins.';
            app.redirect('/game/home');
        }
    } else if (post && action === 'self_breed') {
        let outcome;
        [outcome, error] = Anthros.selfBreed(user, int(player?.id ?? 0), int(field(p, 'cubs', '0')));
        if (error === null) {
            Session.data.flash = breedingMessage(player!.id, player!.id, outcome);
            app.redirect('/game/home');
        }
    } else if (post && action === 'become') {
        error = Anthros.become(user, int(field(p, 'anthro_id', '0')));
        if (error === null) {
            Session.data.flash = 'You are now ' + Anthros.player(user.id)!.name + '.';
            app.redirect('/game/home');
        }
    } else if (post) {
        // The game's first anthro can start with a slave to breed with ("starter": '', 'mate', 'sire' or 'dam').
        const first = !player && Anthros.gameIsEmpty();
        error = Anthros.setPlayer(user, form.name, form.gender_id, form.species_id, form.birthdate);
        if (error === null) {
            Session.data.flash = 'Your details are saved.';
            const starter = field(p, 'starter');
            if (first && starter !== '') {
                const [slave, slaveError] = Anthros.createStarterSlave(Anthros.player(user.id)!, starter);
                Session.data.flash = slave
                    ? `Welcome! ${slave.name} (${slave.gender}) is yours to breed with.`
                    : `Your anthro is made. ${slaveError}`;
            }
            app.redirect('/game/home');
        }
    }
    const q = field(app.query, 'q');
    app.echo(app.render(indexView, user, {
        player,
        // New players can become an existing anthro instead of creating one.
        // Searchable by name, a page of it at a time: there can be thousands.
        available: player ? [] : Anthros.available(false, q, App.LIST_LIMIT),
        // Nobody at all in the game yet: the first player can start with a slave (see createStarterSlave).
        gameEmpty: !player && Anthros.gameIsEmpty(),
        availableTotal: player ? 0 : Anthros.countAvailable(false, q),
        q,
        // Admins can also become a noble, from the admin panel.
        nobles: player || !Auth.isAdmin(user) ? []
            : Anthros.availableNobles(),
        balance: player ? Wallets.balance(player.id) : null,
        land: player ? Land.totalAcres(player.id) : 0,
        resetPending: Resets.pendingFor(user.id),
        form,
        // Only an owner can breed an anthro, so players owned by someone else can't breed themselves.
        canBreed: !!player && Anthros.isOwner(user, player) && Anthros.canBreed(user.id, player),
        // A herm the user decides the breeding of can breed itself.
        canSelfBreed: !!player && Anthros.isHerm(player) && Anthros.isOwner(user, player) && player.auction_id === null,
        genders: Genders.all(),
        error,
        // Upstream's views read $_POST['starter'] (home/details) directly.
        post: p as Record<string, Input>,
    }));
}
