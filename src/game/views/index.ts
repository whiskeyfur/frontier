// Upstream: game/views/index.blade.php
import { Auth } from '../../core/Auth';
import { disabled, html, selected, type Html } from '../../core/html';
import type { InputArray } from '../../core/http';
import { int, json_encode, number_format } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Anthros } from '../Anthros';
import { Goods } from '../Goods';
import { Jobs } from '../Jobs';
import { Land } from '../Land';
import { Ranks } from '../Ranks';
import { Schedules } from '../Schedules';
import { Wallets } from '../Wallets';
import gender from './assets/gender';
import nameInput from './assets/name-input';
import selfBreedForm from './assets/forms/self-breed';
import details, { type HomeForm } from './home/details';
import gameLayout from './layouts/game';
import subnav from './subnav';
import listSearch from './list-search';

export type IndexData = {
    player: Row | null; available: Row[]; gameEmpty: boolean; availableTotal: number; q: string; nobles: Row[];
    balance: number | null; land: number; form: HomeForm; canBreed: boolean;
    canSelfBreed: boolean; genders: Row[]; error: string | null;
    /** The request's form: upstream's views read $_POST directly. */
    post: InputArray;
};

export default function index(v: ViewContext, data: IndexData): Html {
    const { player, available, gameEmpty, availableTotal, q, nobles, balance, land, form, canBreed, canSelfBreed, error } = data;
    const user = v.user!;
    const offerable = player ? Jobs.offerable(player) : new Map<number, Row>();
    return gameLayout(v, {
        title: 'Game',
        content: html`
    ${subnav(v, { section: '/game/home' })}
    <h1 class="h3 mb-3">Welcome, ${user.username}</h1>
    <div class="row g-3">
        <div class="col-md-7">
            <div class="card h-100">
                <div class="card-body">
                    <h2 class="h5 card-title">
                        ${player ? player.name : 'Your anthro'}
                        ${player ? html`
                            ${gender(v, { gender: player.gender, presentsAs: player.presents_as })}
                            <span class="text-body-secondary fs-6">${player.gender} ${player.species ?? ''}</span>
                            <a class="badge text-bg-secondary align-middle text-decoration-none" href="/game/court">${Ranks.title(player)}</a>` : ''}
                    </h2>
                    ${error ? html`
                        <div class="alert alert-danger">${error}</div>` : ''}
                    <p class="text-body-secondary">
                        ${!player ? html`
                            ${gameEmpty ? html`
                                There's no one in the game yet: you'll be the first. Create the anthro you'll play as. You can't change` : availableTotal === 0 && q === '' ? html`
                                Create the anthro you'll play as. You can't change` : html`
                                Create the anthro you'll play as, or become one already in the game (below). You can't change`}
                            which anthro you play later. To other players it's just another anthro: it can breed and be
                            traded like any other, and nobody else can tell it's you. A new anthro starts with
                            ${Wallets.STARTING_MIN}-${Wallets.STARTING_MAX} coins.` : html`
                            ${!Anthros.isFree(player) ? html`
                                ${player.name} is owned by <strong>${player.owner_name}</strong>, whose player decides its breeding.` : ''}
                            ${player.is_male && player.is_female ? html`
                                As ${player.gender}, ${player.name} can sire or be a dam.` : player.is_male ? html`
                                As ${player.gender}, ${player.name} can sire.` : player.is_female ? html`
                                As ${player.gender}, ${player.name} can be a dam.` : html`
                                As ${player.gender}, ${player.name} can't breed.`}`}
                    </p>
                    ${/* Players can only rename the anthro they play; admins change everything about theirs from the admin panel. */ ''}
                    ${player ? html`
                        <dl class="row small mb-2">
                            <dt class="col-4">Gender</dt><dd class="col-8">${player.gender}</dd>
                            <dt class="col-4">Species</dt><dd class="col-8">${player.species ?? 'not set'}</dd>
                            <dt class="col-4">Born</dt><dd class="col-8">${player.birthdate ?? 'unknown'} (${Anthros.age(player.birthdate)})</dd>
                        </dl>
                        <form method="post" action="/game/home" class="mb-3">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="gender_id" value="${player.gender_id}">
                            <label class="form-label small" for="name">Name</label>
                            <div class="d-flex gap-2">
                                <div class="flex-grow-1">
                                    ${nameInput(v, { id: 'name', value: form.name, genderField: 'gender_id' })}
                                </div>
                                <button class="btn btn-primary text-nowrap">Rename</button>
                            </div>
                            <div class="form-text">Gender, species and birthdate are fixed once you play an anthro.</div>
                        </form>` : html`
                        ${details(v, { ...data, prefix: '' })}`}
                    ${player ? html`
                        <div class="d-flex flex-wrap gap-2">
                            <a class="btn btn-outline-secondary" href="/game/wallet">Wallet: ${Wallets.format(balance!)}</a>
                            <a class="btn btn-outline-secondary" href="/game/assets/goods">Food: ${number_format(Goods.food(Goods.keeperOf(player) ?? player.id))}${Goods.isHungry(player) ? html` <span class="badge text-bg-warning">hungry</span>` : ''}</a>
                            <a class="btn btn-outline-secondary" href="/game/assets/land">Land: ${Land.acres(land)}</a>
                            ${canBreed ? html`
                                <a class="btn btn-success" href="/game/assets/${player.id}/breed">Breed</a>` : ''}
                            <a class="btn btn-outline-secondary" href="/game/assets/${player.id}/schedule">Schedule</a>
                            <a class="btn btn-outline-secondary" href="/game/assets/${player.id}">${player.name}'s page &amp; history</a>
                        </div>
                        ${!Anthros.isFree(player) ? html`
                            <div class="alert alert-secondary mt-3 mb-0">
                                ${player.debt === null ? html`
                                    ${player.owner_name} hasn't set a debt,
                                    so you can't buy your freedom.` : html`
                                    <div class="mb-2">
                                        Your freedom costs <strong>${Wallets.format(int(player.debt))}</strong>
                                        ${player.debt_rate ? html`
                                            (growing by ${Wallets.format(int(player.debt_rate))} a day)` : ''}
                                        &middot; you have ${Wallets.format(balance!)}.
                                    </div>
                                    <form method="post" action="/game/home" class="m-0">
                                        <input type="hidden" name="csrf" value="${v.csrf}">
                                        <input type="hidden" name="action" value="buy_freedom">
                                        <button class="btn btn-success btn-sm" ${disabled(balance! < int(player.debt))}
                                                onclick="return confirm(${json_encode('Pay ' + Wallets.format(int(player.debt)) + ' to ' + player.owner_name + ' and own yourself?')})">
                                            Buy my freedom
                                        </button>
                                    </form>`}
                            </div>` : ''}
                        ${player.employer_id !== null ? html`
                            <div class="alert alert-secondary mt-3 mb-0 d-flex flex-wrap align-items-center justify-content-between gap-2">
                                <span>
                                    You work for <strong>${player.employer_name}</strong> at
                                    ${Wallets.format(int(player.employed_wage))} a day (paid through ${player.paid_until}).
                                </span>
                                <form method="post" action="/game/home" class="m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <button class="btn btn-outline-danger btn-sm" name="action" value="quit"
                                            onclick="return confirm('Quit your job?')">Quit</button>
                                </form>
                            </div>` : Anthros.isFree(player) ? html`
                            <form method="post" action="/game/home" class="mt-3">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="action" value="set_wage">
                                <label class="form-label small mb-1" for="wage">
                                    Looking for work? Your daily wage on the <a href="/game/market/jobs">job market</a>
                                </label>
                                <div class="d-flex flex-wrap gap-2">
                                    <input class="form-control form-control-sm" style="width: 9rem" id="wage" name="wage" type="number"
                                           min="${Jobs.WAGE_MIN}" max="${Jobs.WAGE_MAX}" value="${player.wage}" placeholder="Not looking">
                                    ${/* The work on offer: only what the anthro has learned the skill for. */ ''}
                                    <select class="form-select form-select-sm w-auto" name="occupation_id" aria-label="Work you want to do">
                                        <option value="">Any work</option>
                                        ${[...offerable].map(([occupationId, occupation]) => html`
                                            <option value="${occupationId}" ${selected(player.seeking_occupation_id === occupationId)}>
                                                ${occupation.title} (${occupation.skill}: ${occupation.level}): about ${occupation.wage}
                                            </option>`)}
                                    </select>
                                    <button class="btn btn-outline-primary btn-sm">Save</button>
                                </div>
                                <div class="form-text">
                                    ${Jobs.WAGE_MIN} to ${Jobs.WAGE_MAX} coins a day; leave it empty if you're not looking.
                                    What you make at work goes to your employer, who can't breed you.
                                    ${Goods.mealPrice() ? html`
                                        Food costs ${Wallets.format(Goods.mealPrice()!)} a unit at the <a href="/game/market/goods">market</a>.` : ''}
                                    ${!offerable.size ? html`
                                        You haven't learned a skill to offer yet: <a href="/game/assets/${player.id}/schedule">train at one</a> first.` : html`
                                        Offer work you've learned; hired for it, you start on it every day. What each pays, by your level,
                                        is what you can expect to ask.`}
                                </div>
                            </form>` : ''}
                        <details class="mt-3">
                            <summary class="small text-body-secondary">Want to play a different anthro?</summary>
                            ${/* Not upstream (there, a reset is a request to the admins, with a reason): the player resets at once. */ ''}
                            <form method="post" action="/game/home" class="mt-2">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="action" value="reset">
                                <p class="small mb-2">
                                    Stop playing ${player.name}, then create or become another anthro.
                                    ${player.name} stays in the game with everything it has, played by nobody.
                                </p>
                                <button class="btn btn-sm btn-outline-warning"
                                        onclick="return confirm(${json_encode('Stop playing ' + player.name + '?')})">Stop playing ${player.name}</button>
                            </form>
                        </details>` : ''}
                </div>
            </div>
        </div>
        <div class="col-md-5">
            <div class="card h-100">
                <div class="card-body">
                    <h2 class="h5 card-title">Your anthros</h2>
                    <p class="text-body-secondary">See, add, breed, and transfer the anthros you own.</p>
                    <a class="btn btn-outline-primary" href="/game/assets">Assets</a>
                    ${canSelfBreed ? html`
                        <div class="border-top pt-3 mt-3">
                            ${selfBreedForm(v, { anthro: player!, action: '/game/home' })}
                        </div>` : ''}
                </div>
            </div>
        </div>
    </div>

    ${/* Only when there's someone to become. */ ''}
    ${!player && (availableTotal > 0 || q !== '') ? html`
        <h2 class="h5 mt-4">Or become an anthro already in the game</h2>
        <p class="text-body-secondary">
            Any anthro nobody plays and that isn't up for auction. Its owner stays its owner, and it keeps its coins.
        </p>
        ${listSearch(v, { action: '/game/home', q, shown: available.length, total: availableTotal })}
        ${!available.length ? html`
            <p>${q !== '' ? 'No one by that name.' : 'There are none right now.'}</p>` : html`
            <div class="table-responsive">
                <table data-sortable class="table table-striped align-middle">
                    <thead>
                    <tr>
                        <th>Name</th>
                        <th>Job</th><th>Gender</th><th>Species</th><th>Age</th><th>Owner</th><th data-nosort></th>
                    </tr>
                    </thead>
                    <tbody>
                    ${available.map((anthro) => html`
                        <tr>
                            <td>${anthro.name}</td>
                            <td>${Schedules.jobLabel(anthro) ?? '—'}</td>
                            <td>${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })} ${anthro.gender}</td>
                            <td>${anthro.species ?? '—'}</td>
                            <td class="text-nowrap" data-sort="${anthro.birthdate}">${Anthros.age(anthro.birthdate)}</td>
                            <td>${anthro.owner_name ?? 'free'}</td>
                            <td class="text-end">
                                <form method="post" action="/game/home" class="m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="action" value="become">
                                    <input type="hidden" name="anthro_id" value="${anthro.id}">
                                    <button class="btn btn-sm btn-outline-primary"
                                            onclick="return confirm(${json_encode('Become ' + anthro.name + '? You can\'t change this later.')})">Become</button>
                                </form>
                            </td>
                        </tr>`)}
                    </tbody>
                </table>
            </div>`}` : ''}

    ${Auth.isAdmin(user) ? v.push('admin', html`
            ${player ? html`
                <h3 class="h6">${player.name} <span class="text-body-secondary small">(the anthro you play)</span></h3>
                ${details(v, { ...data, prefix: 'admin-' })}` : html`
                ${/* Players can't become nobles above knight; admins can, here. */ ''}
                <form method="post" action="/game/home" class="mb-3">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="action" value="become">
                    <label class="form-label small" for="admin-become">Become a noble</label>
                    ${!nobles.length ? html`
                        <p class="small text-body-secondary mb-0">No noble is free to become.</p>` : html`
                        <div class="d-flex gap-2">
                            <select class="form-select form-select-sm" id="admin-become" name="anthro_id">
                                ${nobles.map((anthro) => html`
                                    <option value="${anthro.id}">${anthro.name}, ${Ranks.title(anthro)}</option>`)}
                            </select>
                            <button class="btn btn-sm btn-warning">Become</button>
                        </div>
                        <div class="form-text">You can't change this later.</div>`}
                </form>`}`) : ''}`,
    });
}
