// Upstream: game/views/assets/show.blade.php
import { Auth } from '../../../core/Auth';
import { html, selected, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { array_unique, empty, int, json_encode, number_format } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import type { HistoryEvent } from '../../app/assets';
import { Anthros } from '../../Anthros';
import { Auctions } from '../../Auctions';
import { Baronies } from '../../Baronies';
import { Goods } from '../../Goods';
import { Market } from '../../Market';
import { Ranks } from '../../Ranks';
import { Schedules } from '../../Schedules';
import { Wallets } from '../../Wallets';
import gameLayout from '../layouts/game';
import anthroLink from './anthro-link';
import debtForm from './forms/debt';
import lifeForm from './forms/life';
import renameForm from './forms/rename';
import selfBreedForm from './forms/self-breed';
import transferForm from './forms/transfer';
import gender from './gender';

export type ShowData = {
    anthro: Row; events: HistoryEvent[];
    /** Breeding groups it's in: id => name. */
    groups: Map<number, string>;
    home: Row | null; isOwner: boolean; canBreed: boolean; canPlan: boolean; adminCanPlan: boolean;
    canSelfBreed: boolean; canRename: boolean; giver: Row | null; invitable: { open: Row[]; closed: Row[] };
    canBecome: boolean; isFertile: boolean; error: string | null;
    /** The request's form: upstream's views read $_POST directly. */
    post: InputArray;
};

export default function show(v: ViewContext, data: ShowData): Html {
    const { anthro, events, groups, home, isOwner, canBreed, canPlan, adminCanPlan, canSelfBreed, giver, invitable, canBecome, error, post } = data;
    const user = v.user!;
    const isYou = anthro.player_id !== null && anthro.player_id === user.id;
    const isDead = Anthros.isDead(anthro);
    const open = invitable.open;
    const closed = invitable.closed;
    const groupList = [...groups];
    const unknown = 'an anthro no longer in the game';
    const history = events.map((event) => {
        if (event.type === 'rename') {
            const r = event.data;
            return html`
                    <span class="text-body-secondary me-2">${String(r.renamed_at).substring(0, 10)}</span>
                    Renamed from ${r.old_name} to ${r.new_name}`;
        }
        if (event.type === 'transfer') {
            const t = event.data;
            return html`
                    <span class="text-body-secondary me-2">${String(t.transferred_at).substring(0, 10)}</span>
                    ${t.from_owner_id === t.anthro_id ? html`
                        Gave up its freedom to ${t.to_name ?? unknown}` : t.to_owner_id === t.anthro_id ? html`
                        Freed by ${t.from_name ?? unknown}` : t.from_owner_id === null && !empty(t.note) ? html`
                        Bought from the game by ${t.to_name ?? unknown}` : html`
                        Passed from ${t.from_name ?? unknown} to ${t.to_name ?? unknown}`}
                    ${!empty(t.note) ? html` &mdash; ${t.note}` : ''}
                    ${!(!empty(t.by_owner) || !empty(t.note)) ? html`
                        <span class="badge text-bg-warning" title="By ${t.by_name ?? 'an admin'}">by admin</span>` : ''}`;
        }
        const day = event.data;
        const partners = [...day.partners.values()];
        return html`
                    <div>
                        <span class="text-body-secondary me-2">${day.date}</span>
                        Bred
                        ${partners.map((partner, i) => html`
                            ${partner.times}&times; with
                            ${anthroLink(v, { id: partner.id, name: partner.name, ownerPlayerId: partner.ownerPlayerId, ownerName: partner.ownerName, playerId: partner.playerId })}
                            <span class="text-body-secondary small">(${partner.role})</span>${i === partners.length - 1 ? '' : ','}`)}
                        ${day.forced ? html`
                            <span class="badge text-bg-warning" title="Forced by ${day.forced_by.join(', ')}">forced</span>` : ''}
                        ${!empty(day.groups) ? html`
                            <span class="badge text-bg-info" title="Bred on their own as members of a breeding group">
                                on their own (${array_unique(day.groups!).join(', ')})
                            </span>` : ''}
                    </div>
                    ${Object.entries(day.barren ?? {}).map(([reason, times]) => html`
                        <div class="ms-md-5 mt-1 text-body-secondary">
                            No litter${times > 1 ? ` (${times} attempts)` : ''}: ${reason}
                        </div>`)}
                    ${[...(day.litters ?? new Map()).values()].map((litter) => {
                        const litterName = litter.dam ? litter.dam + "'s litter" : 'Litter';
                        return html`
                        <div class="ms-md-5 mt-1">
                            ${!litter.born ? html`
                                ${litterName} of ${litter.size} due ${litter.due_on}` : html`
                                ${litter.due_on ? html`
                                    ${litterName} of ${litter.size} born ${litter.due_on}:` : ''}
                                ${litter.cubs.length ? litter.cubs.map((child: Row) => html`
                                    <span class="me-2">
                                        ${anthroLink(v, { id: child.id, name: child.name, ownerPlayerId: child.owner_player_id, ownerName: child.owner_name, playerId: child.player_id })}
                                        ${gender(v, { gender: child.gender, presentsAs: child.presents_as })}
                                        <span class="text-body-secondary small">${child.species}</span>
                                    </span>`) : html`
                                    <span class="text-body-secondary">no cubs remaining</span>`}`}
                        </div>`;
                    })}`;
    });

    const content = html`
    ${isYou ? html`
        <p><a href="/game/home">&larr; Game home</a></p>` : isOwner || Anthros.isEmployer(user, anthro) ? html`
        <p><a href="/game/assets">&larr; Assets</a></p>` : html`
        <p><a href="/game/court">&larr; Court</a></p>`}
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 class="h3 mb-0">
            ${anthro.name}
            ${isYou ? html`
                <span class="badge text-bg-secondary align-middle fs-6">you</span>` : ''}
            ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}
            ${isDead ? html`
                <span class="badge text-bg-dark border align-middle fs-6">Deceased</span>` : Goods.isHungry(anthro) ? html`
                <span class="badge text-bg-warning align-middle fs-6" title="No food today: it can only rest or forage">Hungry</span>` : ''}
        </h1>
        <div class="d-flex gap-2">
            ${canBecome ? html`
                <form method="post" action="/game/home" class="m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="action" value="become">
                    <input type="hidden" name="anthro_id" value="${anthro.id}">
                    <button class="btn btn-primary"
                            onclick="return confirm(${json_encode('Become ' + anthro.name + '? You play them from now on, and that can\'t be changed.')})">Become</button>
                </form>` : ''}
            ${open.length ? html`
                ${/* Invite it into a breeding group the player owns (added at once if the player controls it). */ ''}
                <form method="post" action="/game/groups" class="d-flex gap-1 m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="action" value="invite">
                    <input type="hidden" name="anthro_id" value="${anthro.id}">
                    <input type="hidden" name="back" value="/game/assets/${anthro.id}">
                    ${open.length === 1 ? html`
                        <input type="hidden" name="group_id" value="${open[0].id}">
                        <button class="btn btn-outline-success">Invite to ${open[0].name}</button>` : html`
                        <select class="form-select w-auto" name="group_id" aria-label="Breeding group">
                            ${open.map((group) => html`
                                <option value="${group.id}">${group.name}</option>`)}
                        </select>
                        <button class="btn btn-outline-success">Invite</button>`}
                </form>` : closed.length ? html`
                ${/* Its groups are all closed: say so, rather than hide the invite. */ ''}
                <div class="d-flex align-items-center gap-2">
                    <button class="btn btn-outline-success" disabled>Invite to ${closed[0].name}</button>
                    <a class="small" href="/game/groups">${closed[0].name} is closed: open it to invites</a>
                </div>` : ''}
            ${!(isYou || isDead || !giver) ? html`
                <button class="btn btn-outline-secondary" type="button" data-bs-toggle="collapse" data-bs-target="#donate"
                        aria-expanded="false" aria-controls="donate">Donate</button>` : ''}
            ${!(isYou || isDead) ? html`
                <a class="btn btn-outline-secondary" href="/game/notifications?to=${anthro.id}#compose">Message</a>
                <a class="btn btn-outline-danger" href="/game/socials?to=${anthro.id}">Flirt</a>` : ''}
            ${canPlan ? html`
                <a class="btn btn-outline-primary" href="/game/assets/${anthro.id}/schedule">Schedule</a>` : ''}
            ${canBreed ? html`
                <a class="btn btn-success" href="/game/assets/${anthro.id}/breed">Breed</a>` : ''}
        </div>
    </div>
    ${!isYou && !isDead && giver ? html`
        ${/* A gift from the anthro the player plays: coins to its wallet, goods to the store it's fed from. */ ''}
        <form method="post" action="/game/donate" id="donate" class="collapse card card-body mb-3 ${error && post.resource != null ? html` show ` : ''}" style="max-width: 36rem">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <input type="hidden" name="to" value="${anthro.id}">
            <div class="d-flex flex-wrap align-items-center gap-2">
                <span>Give ${anthro.name}</span>
                <input class="form-control form-control-sm" style="width: 6rem" name="amount" type="number" min="1" value="${post.amount ?? 1}"
                       required aria-label="How much">
                <select class="form-select form-select-sm w-auto" name="resource" aria-label="What">
                    <option value="coins">coins (you have ${number_format(Wallets.balance(giver.id))})</option>
                    ${Object.entries(Market.names()).map(([good, goodName]) => html`
                        <option value="${good}" ${selected((post.resource ?? '') === good)}>${goodName.toLowerCase()} (you have ${number_format(Goods.amount(giver.id, good))})</option>`)}
                </select>
                <button class="btn btn-sm btn-primary">Give</button>
            </div>
            ${!Anthros.isFree(anthro) && anthro.owner_id !== null ? html`
                <div class="form-text">Coins go to ${anthro.name}'s own wallet; goods to ${anthro.owner_name}'s store, which feeds ${anthro.name}.</div>` : ''}
        </form>` : ''}
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${anthro.auction_id !== null ? html`
        <div class="alert alert-warning">
            Up for auction until ${anthro.auction_ends_at} UTC.
            <a href="/game/market/auctions/${anthro.auction_id}">View the auction</a>
        </div>` : ''}
    <dl class="row">
        ${!isOwner ? html`
            <dt class="col-sm-3">Owner</dt>
            <dd class="col-sm-9">${anthro.owner_name ?? 'no one (free)'}</dd>` : ''}
        ${anthro.employer_id !== null ? html`
            <dt class="col-sm-3">Employer</dt>
            <dd class="col-sm-9">
                ${Anthros.isEmployer(user, anthro) ? 'you' : anthro.employer_name}
                <span class="text-body-secondary small">
                    ${Wallets.format(int(anthro.employed_wage))} a day since ${String(anthro.employed_since ?? '').substring(0, 10)}
                </span>
            </dd>` : ''}
        ${groupList.length ? html`
            <dt class="col-sm-3">Breeding groups</dt>
            <dd class="col-sm-9">
                ${groupList.map(([groupId, groupName], i) => html`
                    <a href="/game/groups#group-${groupId}">${groupName}</a>${i !== groupList.length - 1 ? ', ' : ''}`)}
            </dd>` : ''}
        <dt class="col-sm-3">Rank</dt>
        <dd class="col-sm-9">
            ${Ranks.title(anthro)}
            ${anthro.liege_id && Ranks.of(anthro) > Ranks.SLAVE ? html`
                <span class="text-body-secondary small">sworn to ${anthro.liege_name}</span>` : ''}
        </dd>
        <dt class="col-sm-3">Gender</dt>
        <dd class="col-sm-9">
            ${anthro.gender}
            <span class="text-body-secondary small">
                (presents ${anthro.presents_as};
                ${anthro.is_male && anthro.is_female ? html`
                    can sire or be a dam)` : anthro.is_male ? html`
                    can sire)` : anthro.is_female ? html`
                    can be a dam)` : html`
                    can't breed)`}
            </span>
        </dd>
        ${home ? html`
            <dt class="col-sm-3">Lives in</dt>
            <dd class="col-sm-9">
                ${home.part_id ? html`
                    ${Baronies.KINDS[home.part_kind]} ${home.part_name},` : ''}
                ${home.part_id ? 'in the' : 'The'} barony of <a href="/game/court/lands/${home.barony_id}">${home.barony_name}</a>
            </dd>` : ''}
        <dt class="col-sm-3">Species</dt>
        <dd class="col-sm-9">${anthro.species ?? 'not set'}</dd>
        <dt class="col-sm-3">Born</dt>
        <dd class="col-sm-9">${anthro.birthdate ?? 'unknown'}</dd>
        ${isDead ? html`
            <dt class="col-sm-3">Died</dt>
            <dd class="col-sm-9">${String(anthro.died_at).substring(0, 10)}, aged ${Anthros.age(anthro.birthdate, anthro.died_at)}</dd>` : html`
            <dt class="col-sm-3">Age</dt>
            <dd class="col-sm-9">
                ${Anthros.age(anthro.birthdate)}
            </dd>`}
        <dt class="col-sm-3">Fertile</dt>
        ${/* What anyone can see. Admins find the details (conceiving day, fertile until, max cubs, lifespan) in the
             admin panel's Life form. */ ''}
        <dd class="col-sm-9">
            ${Anthros.fertility(anthro) !== 'yes' ? html`
                ${Anthros.fertility(anthro)}` : anthro.fertile_on === null ? html`
                yes` : html`
                yes, since ${anthro.fertile_on}`}
        </dd>
        ${/* Debt is private: only the owner and the anthro's own player see it (admins, in the admin panel). */ ''}
        ${(isOwner || isYou) && !Anthros.isFree(anthro) && !isDead ? html`
            <dt class="col-sm-3">Debt</dt>
            <dd class="col-sm-9">
                ${anthro.debt === null ? html`
                    none <span class="text-body-secondary small">(can't buy ${isYou ? 'your' : 'their'} freedom)</span>` : html`
                    ${Wallets.format(int(anthro.debt))}
                    ${anthro.debt_rate ? html`
                        <span class="text-body-secondary small">(+${Wallets.format(int(anthro.debt_rate))} a day)</span>` : ''}`}
            </dd>` : ''}
        ${anthro.pregnant_due_on !== null ? html`
            <dt class="col-sm-3">Pregnant</dt>
            <dd class="col-sm-9">
                litter of ${anthro.pregnant_cubs} due ${anthro.pregnant_due_on}
                <span class="text-body-secondary small">(bred ${anthro.pregnant_bred_on})</span>
            </dd>` : ''}
        <dt class="col-sm-3">Sire</dt>
        <dd class="col-sm-9">${anthroLink(v, { id: anthro.sire_id, name: anthro.sire_name, ownerPlayerId: anthro.sire_owner_player_id, ownerName: anthro.sire_owner_name, playerId: anthro.sire_player_id })}</dd>
        <dt class="col-sm-3">Dam</dt>
        <dd class="col-sm-9">${anthroLink(v, { id: anthro.dam_id, name: anthro.dam_name, ownerPlayerId: anthro.dam_owner_player_id, ownerName: anthro.dam_owner_name, playerId: anthro.dam_player_id })}</dd>
    </dl>
    ${/* A herm can always breed itself; anyone else needs a partner. */ ''}
    ${canSelfBreed ? html`
        <div class="card card-body mb-3" style="max-width: 36rem">
            ${selfBreedForm(v, { anthro, action: '/game/assets/' + anthro.id + '/self-breed' })}
        </div>` : isOwner && !canBreed ? html`
        <p class="text-body-secondary">You need another anthro to breed ${isYou ? 'yourself' : anthro.name} with.</p>` : ''}

    ${isOwner && !Anthros.isFree(anthro) ? html`
        ${debtForm(v, { anthro })}` : ''}



    ${isOwner ? html`
        ${renameForm(v, { anthro })}` : ''}

    ${isOwner && anthro.auction_id === null ? html`
        <form method="post" action="/game/assets/${anthro.id}/sell" class="card card-body mb-3" style="max-width: 36rem">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <h2 class="h6">Sell ${isYou ? 'yourself' : anthro.name} at auction</h2>
            <div class="row g-2 mb-2">
                <div class="col-sm-4">
                    <label class="form-label small" for="starting_bid">Starting bid</label>
                    <input class="form-control" id="starting_bid" name="starting_bid" type="number" min="1" required>
                </div>
                <div class="col-sm-4">
                    <label class="form-label small" for="buy_now">Buy now <span class="text-body-secondary">(optional)</span></label>
                    <input class="form-control" id="buy_now" name="buy_now" type="number" min="1">
                </div>
                <div class="col-sm-4">
                    <label class="form-label small" for="days">Runs for</label>
                    <select class="form-select" id="days" name="days">
                        ${Auctions.DURATIONS.map((days) => html`
                            <option value="${days}" ${selected(days === 3)}>${days} ${days === 1 ? 'day' : 'days'}</option>`)}
                    </select>
                </div>
            </div>
            <div class="form-text mb-2">
                You're paid the winning bid when the auction ends. If nobody bids, ${isYou ? 'you stay' : anthro.name + ' stays'} yours.
                While listed, ${isYou ? 'you' : anthro.name} can't be bred or transferred.
            </div>
            <div><button class="btn btn-outline-primary">Put up for auction</button></div>
        </form>` : ''}

    ${isOwner && anthro.auction_id === null ? html`
        ${transferForm(v, { anthro, isYou })}` : ''}

    <h2 class="h5 mt-4">History</h2>
    <ul class="list-group">
        ${history.map((item) => html`
            <li class="list-group-item">${item}
            </li>`)}
        ${/* Its arrival in the game: the oldest entry, so last. */ ''}
        <li class="list-group-item">
            ${isYou ? html`
                <span class="text-body-secondary me-2">${String(anthro.created_at).substring(0, 10)}</span>
                You joined the game as this anthro` : anthro.breeding_id || anthro.sire_id || anthro.dam_id ? html`
                <span class="text-body-secondary me-2">${anthro.birthdate}</span>
                Born to
                ${anthroLink(v, { id: anthro.sire_id, name: anthro.sire_name ?? 'unknown sire', ownerPlayerId: anthro.sire_owner_player_id, ownerName: anthro.sire_owner_name, playerId: anthro.sire_player_id })}
                &times;
                ${anthroLink(v, { id: anthro.dam_id, name: anthro.dam_name ?? 'unknown dam', ownerPlayerId: anthro.dam_owner_player_id, ownerName: anthro.dam_owner_name, playerId: anthro.dam_player_id })}` : html`
                <span class="text-body-secondary me-2">${anthro.birthdate ?? String(anthro.created_at).substring(0, 10)}</span>
                Born &mdash; a founder with no recorded parents, added ${String(anthro.created_at).substring(0, 10)}`}
        </li>
    </ul>
    ${!events.length ? html`
        <p class="text-body-secondary mt-2">No breedings, transfers, or renames yet.</p>` : ''}
    ${/* Admin controls, in the admin panel (see layouts/admin-panel). Owners already have debt, rename and give above. */ ''}
    ${Auth.isAdmin(user) ? v.push('admin', adminControls(v, data, isDead)) : ''}`;

    return gameLayout(v, { title: anthro.name + ' - Game', content });
}

/** What the page pushes to the admin panel. */
function adminControls(v: ViewContext, { anthro, events, isOwner, adminCanPlan, error, post }: ShowData, isDead: boolean): Html {
    const isYou = anthro.player_id !== null && anthro.player_id === v.user!.id;
    const trade = Schedules.trade(anthro);
    const renames = events.filter((e) => e.type === 'rename');
    return html`
            ${/* Admin-only facts about the anthro: who plays it and who renamed it. */ ''}
            <p class="small mb-2">
                <strong>${anthro.name}</strong>
                <span class="text-body-secondary">&middot; ${anthro.player_id !== null ? 'played by ' + anthro.player_name : 'not played'}</span>
            </p>
            ${/* Its purse and larder. */ ''}
            <p class="small mb-2">
                <a href="/game/admin/wallets">${Wallets.format(Wallets.balance(anthro.id))}</a>
                ${Object.entries(Market.names()).map(([good, goodName]) => good === 'food' || Goods.amount(anthro.id, good) ? html`
                        &middot; ${number_format(Goods.amount(anthro.id, good))} ${goodName.toLowerCase()}` : '')}
                ${trade ? html`
                    &middot; trade: ${trade.title}` : ''}
            </p>
            ${adminCanPlan ? html`
                <p class="mb-2"><a class="btn btn-sm btn-outline-warning" href="/game/assets/${anthro.id}/schedule">Schedule (admin)</a></p>` : ''}
            ${renames.length ? html`
                <ul class="small text-body-secondary ps-3 mb-3">
                    ${renames.map((event) => html`
                        <li>${String(event.data.renamed_at).substring(0, 10)}: ${event.data.old_name} &rarr; ${event.data.new_name},
                            by ${event.data.renamed_by_name ?? 'a deleted user'}</li>`)}
                </ul>` : ''}
            ${isDead ? html`
                ${renameForm(v, { anthro })}` : html`
            <div class="d-flex flex-wrap gap-2 mb-3">
                <a class="btn btn-sm btn-outline-warning"
                   href="/game/admin/breed?${anthro.is_male ? 'sire' : 'dam'}=${anthro.id}">Force breed</a>
                ${anthro.pregnant_due_on !== null ? html`
                    <form method="post" action="/game/assets/${anthro.id}/birth" class="m-0">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <button class="btn btn-sm btn-outline-warning"
                                onclick="return confirm(${json_encode('Have ' + anthro.name + ' give birth now to a litter of ' + anthro.pregnant_cubs + ' (due ' + anthro.pregnant_due_on + ')?')})">
                            Force the birth now
                        </button>
                    </form>` : ''}
            </div>
            ${lifeForm(v, { anthro, error, post })}
            ${!isOwner ? html`
                ${!Anthros.isFree(anthro) ? html`
                    ${debtForm(v, { anthro })}` : ''}
                ${renameForm(v, { anthro })}
                ${anthro.auction_id === null ? html`
                    ${transferForm(v, { anthro, isYou })}` : ''}` : ''}`}`;
}
