// Upstream: game/src/App.php (breed, rename, showAnthro, breedingDays, transfer, breedingMessage, pregnancyMessage,
// groupAction, sell, setDebt, setLife)
import { Auth, type User } from '../../core/Auth';
import { field, fieldArray, type InputArray } from '../../core/http';
import { Session } from '../../core/Session';
import { array_sum, array_unique, gmdate, int, spaceship, str, trim } from '../../core/php';
import type { Row } from '../../db/Db';
import type { App } from '../App';
import { Anthros, type BreedOutcome } from '../Anthros';
import { Auctions } from '../Auctions';
import { Baronies } from '../Baronies';
import { Groups } from '../Groups';
import { Litters } from '../Litters';
import { Ranks } from '../Ranks';
import { Schedules } from '../Schedules';
import { Wallets } from '../Wallets';
import breedView from '../views/assets/breed';
import showView from '../views/assets/show';

/** A partner on a breeding day (see breedingDays). */
export type BreedingPartner = {
    id: number | null; name: string; role: string; ownerPlayerId: number | null; ownerName: string | null;
    playerId: number | null; times: number;
};

/** A litter on a breeding day (see breedingDays). */
export type BreedingLitter = { dam: string | null; size: number; due_on: string | null; born: boolean; cubs: Row[] };

/**
 * A day of breeding attempts (see breedingDays). partners and litters are Maps keyed as upstream's arrays were
 * (partner id or 'unknown-<role>'; litter id or 'attempt-<id>'); barren is reason => attempts.
 */
export type BreedingDay = {
    at: string; date: string; forced: boolean; forced_by: string[]; groups?: string[];
    partners: Map<number | string, BreedingPartner>; barren?: Record<string, number>;
    litters?: Map<number | string, BreedingLitter>;
};

/** An entry in an anthro's history (see showAnthro). */
export type HistoryEvent =
    | { at: string; type: 'breeding'; data: BreedingDay }
    | { at: string; type: 'transfer'; data: Row }
    | { at: string; type: 'rename'; data: Row };

export function breed(app: App, user: User, anthro: Row, post: boolean): void {
    // This anthro starts in the role it can fill (sire first, for anthros that can do both).
    const sireId = int(app.post.sire_id ?? (anthro.is_male ? anthro.id : 0));
    const damId = int(app.post.dam_id ?? (anthro.is_male ? 0 : anthro.id));
    let error: string | null = null;
    if (post) {
        let outcome;
        [outcome, error] = Anthros.breed(user.id, sireId, damId, int(app.post.times ?? 1));
        if (error === null) {
            Session.data.flash = breedingMessage(sireId, damId, outcome);
            app.redirect('/game/assets/' + anthro.id);
        }
    }
    // Any of them can be chosen for either role; ones that would break the rules are marked.
    const owned = Anthros.breedable(user.id);
    app.echo(app.render(breedView, user, {
        anthro, sires: owned, dams: owned,
        sireId, damId, times: Math.max(1, int(app.post.times ?? 1)), error,
    }));
}

export function rename(app: App, user: User, anthro: Row, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets/' + anthro.id);
    }
    const error = Anthros.rename(anthro, field(app.post, 'name'), user.id);
    if (error !== null) {
        showAnthro(app, user, anthro, error);
        return;
    }
    Session.data.flash = `Renamed ${anthro.name} to ` + trim(app.post.name) + '.';
    app.redirect('/game/assets/' + anthro.id);
}

export function showAnthro(app: App, user: User, anthro: Row, error: string | null = null): void {
    const isOwner = Anthros.isOwner(user, anthro);
    // Breeding days, transfers, and renames, most recent first (the page shows the anthro's arrival last).
    const events: HistoryEvent[] = [
        ...breedingDays(anthro.id).map((day): HistoryEvent => ({ at: day.at, type: 'breeding', data: day })),
        ...Anthros.transfers(anthro.id).map((t): HistoryEvent => ({ at: t.transferred_at, type: 'transfer', data: t })),
        ...Anthros.renames(anthro.id).map((r): HistoryEvent => ({ at: r.renamed_at, type: 'rename', data: r })),
    ];
    events.sort((a, b) => spaceship(b.at, a.at));
    const invitable = Groups.invitableFor(user, anthro);
    app.echo(app.render(showView, user, {
        anthro,
        events,
        groups: Groups.namesFor(anthro.id, user),
        // Where it lives follows its fealty (the living only).
        home: Anthros.isDead(anthro) ? null : Baronies.residenceOf(anthro.id),
        isOwner,
        // Owners and employers can breed it.
        canBreed: Anthros.mayBreed(user, anthro) && Anthros.canBreed(user.id, anthro),
        // A herm the user decides the breeding of can breed itself.
        // In the player's view, only as a player; admins plan any anthro from the admin panel.
        canPlan: Schedules.canPlan(user, anthro, false),
        adminCanPlan: !Schedules.canPlan(user, anthro, false) && Schedules.canPlan(user, anthro),
        canSelfBreed: Anthros.mayBreed(user, anthro) && Anthros.isHerm(anthro)
            && !Anthros.isDead(anthro) && anthro.auction_id === null,
        canRename: isOwner || Auth.isAdmin(user),
        // The anthro the player plays, to give from (see Finances::donate).
        giver: Anthros.player(user.id),
        // Breeding groups the player owns (and is in) that it can invite this anthro into.
        invitable: {
            open: invitable.filter((g) => !g.closed),
            closed: invitable.filter((g) => g.closed),
        },
        // A new player can become an anthro nobody plays (see Anthros::become).
        canBecome: !Anthros.player(user.id) && anthro.player_id === null && anthro.auction_id === null
            && !Anthros.isDead(anthro) && (Auth.isAdmin(user) || !Ranks.isNoble(Ranks.of(anthro))),
        isFertile: Anthros.isFertile(anthro),
        error,
        // Upstream's views read $_POST (the donate and life forms) directly.
        post: app.post,
    }));
}

/**
 * An anthro's breeding attempts grouped by day: which partners and how many times each ("3x with Rex"),
 * and the litters those attempts belong to, with the cubs they produced once born.
 */
export function breedingDays(anthroId: number): BreedingDay[] {
    const days = new Map<string, BreedingDay>();
    // forced_by as it's collected: nulls for attempts that weren't forced.
    const forcedBy = new Map<string, (string | null)[]>();
    for (const attempt of Anthros.history(anthroId)) {
        const date = String(attempt.bred_at).substring(0, 10);
        if (!days.has(date)) {
            days.set(date, { at: attempt.bred_at, date, forced: false, forced_by: [], partners: new Map() });
            forcedBy.set(date, []);
        }
        const day = days.get(date)!;
        day.date = date;
        day.forced = day.forced || !!attempt.forced;
        forcedBy.get(date)!.push(attempt.forced ? (attempt.bred_by_name ?? 'an admin') : null);
        // Breedings a group did on its own ("a dissolved group" once it's gone).
        if (attempt.group_id !== null) {
            (day.groups ??= []).push(attempt.group_name ?? 'a dissolved group');
        }

        const partnerKey: number | string = attempt.partner_id ?? 'unknown-' + attempt.partner_role;
        if (!day.partners.has(partnerKey)) {
            day.partners.set(partnerKey, {
                id: attempt.partner_id, name: attempt.partner_name ?? 'an unknown ' + attempt.partner_role,
                role: attempt.partner_role, ownerPlayerId: attempt.partner_owner_player_id,
                ownerName: attempt.partner_owner_name, playerId: attempt.partner_player_id, times: 0,
            });
        }
        day.partners.get(partnerKey)!.times++;

        // Attempts that broke the rules produced no litter; they're listed by reason.
        if (attempt.barren_reason !== null) {
            day.barren ??= {};
            day.barren[attempt.barren_reason] = (day.barren[attempt.barren_reason] ?? 0) + 1;
            continue;
        }
        const litterKey: number | string = attempt.litter_id ?? 'attempt-' + attempt.id;
        day.litters ??= new Map();
        if (!day.litters.has(litterKey)) {
            day.litters.set(litterKey, {
                // Named when the anthro is the sire, since a sire's day can include several dams' litters.
                dam: attempt.partner_role === 'dam' ? (attempt.partner_name ?? 'an unknown dam') : null,
                size: attempt.litter_size, due_on: attempt.due_on,
                born: !attempt.litter_id || attempt.born_at !== null, cubs: [],
            });
        }
        day.litters.get(litterKey)!.cubs.push(...attempt.offspring);
    }
    for (const [date, day] of days) {
        day.forced_by = array_unique(forcedBy.get(date)!.filter((name): name is string => !!name));
    }
    return [...days.values()];
}

export function transfer(app: App, user: User, anthro: Row, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets/' + anthro.id);
    }
    const error = Anthros.transfer(anthro, app.anthroIdFrom(field(app.post, 'to')), user.id);
    if (error !== null) {
        showAnthro(app, user, anthro, error);
        return;
    }
    const recipient = Anthros.findAny(app.anthroIdFrom(str(app.post.to)))!;
    Session.data.flash = `Gave ${anthro.name} to ${recipient.name}.`;
    // The previous owner may no longer be able to open it (unless they're an admin or it's them).
    app.redirect(Anthros.canSee(user, Anthros.findAny(anthro.id)!) ? '/game/assets/' + anthro.id : '/game/assets');
}

/** outcome: what Anthros.breed, selfBreed or forceBreed returned ({litter, barren[, attempts, took]}). */
export function breedingMessage(sireId: number, damId: number, outcome: BreedOutcome | Row | null): string {
    const dam = Anthros.findAny(damId)!;
    const sire = Anthros.findAny(sireId)!;
    const o = outcome!;
    const attempts = o.attempts ?? 1;
    // A herm breeding itself: "Garnet bred itself".
    const who = sire.id === dam.id ? `${dam.name} bred itself` : `${sire.name} and ${dam.name} were bred`;
    const bred = attempts === 1 ? who : `${who} ${attempts} times`;
    if (o.litter) {
        // The litter as it stands after the last try.
        const litter = Litters.pending(dam.id) ?? o.litter;
        if (attempts === 1) {
            return (sire.id === dam.id ? `${who}. ` : '') + pregnancyMessage(dam, litter);
        }
        const took = o.took === attempts ? 'every time took' : `${o.took} took; the rest didn't: ${o.barren}`;
        return `${bred} (${took}). ` + pregnancyMessage(dam, litter);
    }
    return `${bred}, but no litter will come of it: ${o.barren}.`
        + (sire.id === dam.id ? ' It was recorded in its history.' : ' It was recorded in their history.');
}

export function pregnancyMessage(dam: Row, litter: Row): string {
    const cubs = litter.cubs + ' ' + (litter.cubs === 1 ? 'cub' : 'cubs');
    return `${dam.name} is pregnant: a litter of ${cubs}, due ${litter.due_on}.`
        + (litter.cubs < Anthros.maxCubs(dam) && litter.bred_on === gmdate('Y-m-d')
            ? ' Breed again today to add another cub.' : '');
}

export function groupAction(app: App, user: User, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets');
    }
    const p = app.post;
    // (array)($_POST['ids'] ?? [])
    const idsField = p.ids ?? {};
    const ids = (typeof idsField === 'string' ? [idsField] : Object.values(idsField)).map(int);
    const action = field(p, 'action');
    if (!ids.length) {
        Session.data.flash = ['Select some anthros first.'];
        app.redirect('/game/assets');
    }

    const lines: string[] = [];
    if (action === 'breed') {
        const times = Math.max(1, Math.min(Litters.MAX_CUBS, int(p.times ?? 1)));
        const result = Anthros.groupBreed(user.id, ids, times);
        const total = array_sum(Object.values(result.pairs));
        lines.push(`Bred ${total} ` + (total === 1 ? 'time' : 'times') + ' over ' + times + ' ' + (times === 1 ? 'round' : 'rounds') + '.');
        for (const [pair, count] of Object.entries(result.pairs)) {
            lines.push(`${pair}: ${count}`);
        }
        for (const litter of result.litters.values()) {
            lines.push(`${litter.dam}: litter of ${litter.cubs} due ${litter.due_on}`);
        }
        for (const [what, count] of Object.entries(result.barren)) {
            lines.push(`No litter from ${what}` + (count > 1 ? ` (${count}×)` : ''));
        }
        for (const reason of result.skipped) {
            lines.push(`Skipped: ${reason}`);
        }
    } else if (action === 'group') {
        const [, error] = Groups.create(user, field(p, 'group_name'), ids);
        lines.push(error ?? 'The breeding group was formed. See Breeding groups.');
    } else if (action === 'sell') {
        const buyNow = trim(field(p, 'buy_now'));
        let listed = 0;
        for (const id of array_unique(ids)) {
            const anthro = Anthros.find(user.id, id);
            if (!anthro) {
                continue;
            }
            const [, error] = Auctions.create(anthro, user.id, int(p.starting_bid ?? 0),
                buyNow === '' ? null : int(buyNow), int(p.days ?? 0));
            if (error) {
                lines.push(`Skipped ${anthro.name}: ${error}`);
            } else {
                listed++;
            }
        }
        lines.unshift(`Put ${listed} ` + (listed === 1 ? 'anthro' : 'anthros') + ' up for auction.');
    } else if (action === 'schedule_standard') {
        // The selected anthros follow a standard schedule, or their own routines again.
        const standardId = (p.standard_id ?? '') === '' ? null : int(p.standard_id);
        const done: string[] = [];
        for (const id of array_unique(ids)) {
            const anthro = Anthros.findAny(id);
            if (!anthro) {
                continue;
            }
            const error = Schedules.follow(user, anthro, standardId);
            if (error) {
                lines.push(`Skipped ${anthro.name}: ${error}`);
            } else {
                done.push(anthro.name);
            }
        }
        const standard = standardId === null ? null : Schedules.standard(standardId);
        lines.unshift(done.length
            ? done.join(', ') + (standard ? ` follow ${standard.name} now.` : ' follow their own routines now.')
            : 'No schedules were changed.');
    } else if (action === 'schedule_week' || action === 'schedule_day') {
        // The same routine, or the same planned day, for each selected anthro (each checked on its own).
        const done: string[] = [];
        for (const id of array_unique(ids)) {
            const anthro = Anthros.findAny(id);
            if (!anthro) {
                continue;
            }
            let error = action === 'schedule_week'
                ? Schedules.setWeekly(user, anthro, fieldArray(p, 'week') as unknown as Record<number, Row>)
                : Schedules.planDay(user, anthro, field(p, 'plan_date'), field(p, 'plan_activity'),
                    field(p, 'plan_detail'));
            if (!error && action === 'schedule_week') {
                // A routine set for them is theirs to follow, not a standard schedule's.
                error = Schedules.follow(user, anthro, null);
            }
            if (error) {
                lines.push(`Skipped ${anthro.name}: ${error}`);
            } else {
                done.push(anthro.name);
            }
        }
        lines.unshift(done.length
            ? (action === 'schedule_week' ? 'Set the weekly routine of ' : 'Planned ' + str(p.plan_date ?? '') + ' for ') + done.join(', ') + '.'
            : 'No schedules were changed.');
    } else if (action === 'cancel_auction' || action === 'close_auction') {
        let done = 0;
        for (const id of array_unique(ids)) {
            const anthro = Anthros.find(user.id, id);
            if (!anthro || anthro.auction_id === null) {
                continue;
            }
            const error = action === 'cancel_auction'
                ? Auctions.cancel(int(anthro.auction_id), user)
                : Auctions.closeEarly(int(anthro.auction_id), user);
            if (error) {
                lines.push(`Skipped ${anthro.name}: ${error}`);
                continue;
            }
            done++;
            if (action === 'close_auction') {
                const auction = Auctions.find(int(anthro.auction_id))!;
                lines.push(auction.status === 'sold'
                    ? `${anthro.name}: sold for ` + Wallets.format(int(auction.final_price))
                    : `${anthro.name}: no bids, stays yours`);
            }
        }
        lines.unshift((action === 'cancel_auction' ? 'Cancelled ' : 'Closed ') + `${done} `
            + (done === 1 ? 'auction' : 'auctions') + '.');
    } else {
        lines.push('Choose an action.');
    }
    Session.data.flash = lines;
    // Back to the page the selection was made on (the overview, or Slaves).
    app.redirect((p.back ?? '') === '/game/assets/slaves' ? '/game/assets/slaves' : '/game/assets');
}

export function sell(app: App, user: User, anthro: Row, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets/' + anthro.id);
    }
    const buyNow = trim(field(app.post, 'buy_now'));
    const [id, error] = Auctions.create(
        anthro, user.id, int(app.post.starting_bid ?? 0), buyNow === '' ? null : int(buyNow),
        int(app.post.days ?? 0),
    );
    if (error !== null) {
        showAnthro(app, user, anthro, error);
        return;
    }
    Session.data.flash = `${anthro.name} is up for auction.`;
    app.redirect('/game/market/auctions/' + id);
}

export function setDebt(app: App, user: User, anthro: Row, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets/' + anthro.id);
    }
    const error = Anthros.setDebt(anthro, field(app.post, 'debt'), int(app.post.debt_rate ?? 0));
    if (error !== null) {
        showAnthro(app, user, anthro, error);
        return;
    }
    Session.data.flash = trim(field(app.post, 'debt')) === ''
        ? `${anthro.name} has no debt now, so can't buy their freedom.`
        : `Saved ${anthro.name}'s debt.`;
    app.redirect('/game/assets/' + anthro.id);
}

export function setLife(app: App, user: User, anthro: Row, post: boolean): void {
    if (!post) {
        app.redirect('/game/assets/' + anthro.id);
    }
    // array_intersect_key($_POST, array_flip([...])): those fields, as posted.
    const keys = ['birthdate', 'fertile_on', 'fertile_until', 'dies_on', 'fertile_weekday', 'max_cubs', 'urge_rise'];
    const fields: InputArray = Object.fromEntries(Object.entries(app.post).filter(([key]) => keys.includes(key)));
    const error = Anthros.setLife(anthro, fields);
    if (error !== null) {
        showAnthro(app, user, anthro, error);
        return;
    }
    Session.data.flash = `Saved ${anthro.name}'s life and fertility.`;
    app.redirect('/game/assets/' + anthro.id);
}
