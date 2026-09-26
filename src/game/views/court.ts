// Upstream: game/views/court.blade.php
import { Auth } from '../../core/Auth';
import { html, selected, type Html } from '../../core/html';
import { int, json_encode, range, round } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Land } from '../Land';
import { Ranks } from '../Ranks';
import acresHeld from './court/acres-held';
import grant from './court/grant';
import marriage from './court/marriage';
import gameLayout from './layouts/game';
import subnav from './subnav';

export type CourtData = {
    nobles: Row[];
    player: Row | null;
    rank: number | null;
    lieges: Row[];
    sworn: { vassals: Row[]; followers: Row[]; children: Row[]; slaves: Row[] };
    spouses: Row[];
    proposals: { received: Row[]; sent: Row[] };
    assumable: number | null;
    crownRanks: number[];
    error: string | null;
};

export default function court(v: ViewContext, data: CourtData): Html {
    const { nobles, player, rank, lieges, sworn, assumable, crownRanks, error } = data;
    const user = v.user!;
    const byLand = player && rank !== null && rank >= Ranks.COMMONER ? Ranks.nextByLand(player) : null;
    return gameLayout(v, {
        title: 'Court - Game',
        content: html`
    <h1 class="h3 mb-3">Court</h1>
    ${subnav(v, { section: '/game/court' })}
    <p class="text-body-secondary">
        Ranks run from ${Ranks.name(Ranks.KING)} down to ${Ranks.name(Ranks.KNIGHT)};
        below them, an anthro that owns itself is a commoner and one owned by someone else is a slave. Titles are granted by
        the crown, or earned by land: from ${Ranks.name(Ranks.BARONET)} at ${Land.acres(Ranks.BARONET_ACRES)}
        up to the crown, each rank takes ${Ranks.ACRES_FACTOR} times the land of the one below, counting the land of
        your household and everyone sworn to you, and a title earned by land is lost when the land is. You can swear
        fealty to anyone of your rank or higher. Those who marry into a household share its head's rank: there's one
        monarch by right, and any number of consorts. Noble titles are the peerage; hereditary ones pass to the holder's eldest free child if the holder loses its
        freedom, and the rest are lost with it. Land forfeit to the crown goes up a rank: to the anthro's liege, or else to
        whoever has held the next rank up the longest.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    ${player ? html`
        <div class="card card-body mb-4">
            <h2 class="h5">
                ${player.name} <span class="badge text-bg-secondary align-middle">${Ranks.name(rank!, player.presents_as)}</span>
            </h2>
            ${rank === Ranks.SLAVE ? html`
                <p class="mb-0">
                    ${player.name} is owned by ${player.owner_name ?? 'the game'}, so it's sworn to its owner and can't hold a title.
                    ${player.debt !== null ? html`
                        <a href="/game/home">Buy your freedom</a> first.` : ''}
                </p>` : html`
                <p class="mb-2">
                    ${player.liege_id ? html`
                        Sworn to <a class="fw-semibold" href="/game/assets/${player.liege_id}">${player.liege_name}</a>,
                        who would receive your land if it were forfeit to the crown.` : html`
                        You haven't sworn to a liege.`}
                </p>
                ${lieges.length || player.liege_id ? html`
                    <form method="post" action="/game/court" class="d-flex flex-wrap gap-2 align-items-center mb-2">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="action" value="swear">
                        <select class="form-select w-auto" name="liege_id" aria-label="Liege">
                            ${rank !== Ranks.COMMONER ? html`
                                <option value="">No liege</option>` : ''}
                            ${lieges.map((noble) => html`
                                <option value="${noble.id}" ${selected(noble.id === player.liege_id)}>
                                    ${Ranks.name(int(noble.rank), noble.presents_as)} ${noble.name}
                                </option>`)}
                        </select>
                        <button class="btn btn-outline-primary">Swear fealty</button>
                    </form>` : html`
                    <p class="text-body-secondary small mb-2">No one of your rank or higher to swear to.</p>`}
                ${rank === Ranks.COMMONER ? html`
                    ${''/* A commoner can also swear to a fellow commoner, whose land then counts theirs (see Ranks::acresHeld). */}
                    <form method="post" action="/game/court" class="d-flex flex-wrap gap-2 align-items-center mb-2">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="action" value="swear">
                        <input class="form-control w-auto" name="liege" list="commoner-names" data-anthro-search placeholder="Name (#id)"
                               aria-label="Fellow commoner to swear to" required>
                        <datalist id="commoner-names"></datalist>
                        <button class="btn btn-outline-primary">Swear to a fellow commoner</button>
                    </form>` : ''}
                ${assumable ? html`
                    ${''/* Land earns ranks from baronet to duke; a duke can take up the crown while no one holds it. */}
                    <form method="post" action="/game/court" class="d-flex flex-wrap gap-2 align-items-center mb-2">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="action" value="assume">
                        <button class="btn btn-outline-warning"
                                onclick="return confirm(${json_encode('Take up the rank of ' + Ranks.name(assumable, player.presents_as) + '?')})">
                            Become ${Ranks.name(assumable, player.presents_as)}
                        </button>
                        <span class="form-text m-0">
                            ${assumable === Ranks.KING ? html`
                                No one holds the crown you would wear, so you can take it up.` : html`
                                ${acresHeld(v, { player })}
                                enough to take up the rank.`}
                        </span>
                    </form>` : byLand !== null ? html`
                    <p class="text-body-secondary small mb-2">
                        It takes ${Land.acres(Ranks.acresFor(byLand))} of land, counting your household's and everyone's sworn to you,
                        to take up the rank of ${Ranks.name(byLand, player.presents_as)}.
                        ${acresHeld(v, { player })}
                        ${round(100 * Ranks.acresHeld(player).total / Ranks.acresFor(byLand)!)}% of the way.
                    </p>` : ''}`}
            ${rank !== Ranks.SLAVE ? marriage(v, { player, spouses: data.spouses, proposals: data.proposals }) : ''}
            ${''/* Who is sworn to the player's anthro: titled anthros, free commoners, and the anthros it owns. */}
            ${(Object.entries({ vassals: 'Vassals', followers: 'Followers', children: 'Children', slaves: 'Slaves' }) as [keyof CourtData['sworn'], string][]).map(([kind, heading]) => sworn[kind].length ? html`
                    <p class="mb-0 mt-2">
                        <span class="fw-semibold">${heading} (${sworn[kind].length}):</span>
                        ${sworn[kind].map((anthro, i) => html`
                            ${kind === 'vassals' ? html`
                                ${Ranks.name(int(anthro.title_rank), anthro.presents_as)}` : ''}
                            <a href="/game/assets/${anthro.id}">${anthro.name}</a>${i !== sworn[kind].length - 1 ? ', ' : ''}`)}
                    </p>` : '')}
        </div>` : ''}

    <h2 class="h5">Nobility</h2>
    ${!nobles.length ? html`
        <p>No one holds a title yet.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead><tr><th>Title</th><th>Name</th><th>Liege</th><th class="text-end">Vassals</th><th>Since</th></tr></thead>
                <tbody>
                ${nobles.map((noble) => html`
                    <tr>
                        <td data-sort="${noble.rank}">
                            ${Ranks.name(int(noble.rank), noble.presents_as)}
                            ${noble.by_marriage ? html`
                                <span class="small text-body-secondary">by marriage to <a href="/game/assets/${noble.spouse_of}">${noble.spouse_of_name}</a></span>` : ''}
                        </td>
                        <td><a href="/game/assets/${noble.id}">${noble.name}</a></td>
                        <td>
                            ${noble.liege_id ? html`
                                <a href="/game/assets/${noble.liege_id}">${noble.liege_name}</a>` : html`
                                &mdash;`}
                        </td>
                        <td class="text-end">${noble.vassals}</td>
                        <td class="text-nowrap" data-sort="${noble.title_since}">${String(noble.title_since ?? '').slice(0, 10)}</td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`}

    ${crownRanks.length ? html`
        <div class="mt-4">${grant(v, { ranks: crownRanks, as: 'crown' })}</div>` : ''}

    ${''/* Admins grant any title from the admin panel. */}
    ${Auth.isAdmin(user) ? v.push('admin', grant(v, { ranks: range(Ranks.KING, Ranks.KNIGHT), as: 'admin' })) : ''}`,
    });
}
