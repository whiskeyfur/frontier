// Upstream: game/views/assets/breed.blade.php
import { html, type Html } from '../../../core/html';
import { intdiv } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Litters } from '../../Litters';
import gameLayout from '../layouts/game';
import anthroOption from './anthro-option';
import gender from './gender';

export default function breed(v: ViewContext, { anthro, sires, dams, sireId, damId, times, error }: {
    anthro: Row; sires: Row[]; dams: Row[]; sireId: number; damId: number; times: number; error: string | null;
}): Html {
    const roles: [string, [string, Row[], number, string]][] = [['sire_id', ['Sire', sires, sireId, 'sire']], ['dam_id', ['Dam', dams, damId, 'dam']]];
    return gameLayout(v, {
        title: 'Breed ' + anthro.name + ' - Game',
        content: html`
    <p><a href="/game/assets/${anthro.id}">&larr; ${anthro.name}</a></p>
    <div class="mx-auto" style="max-width: 32rem">
        <h1 class="h3 mb-3">Breed ${anthro.name} ${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })}</h1>
        ${error ? html`
            <div class="alert alert-danger">${error}</div>` : ''}
        ${sires.length < 2 ? html`
            <p>You need at least two anthros (or employees) to breed.</p>
            <a class="btn btn-primary" href="/game/market">Visit the market</a>` : html`
            <form method="post" action="/game/assets/${anthro.id}/breed" class="card card-body">
                <input type="hidden" name="csrf" value="${v.csrf}">
                ${roles.map(([field, [label, options, selectedId, role]]) => html`
                    <div class="mb-3">
                        <label class="form-label" for="${field}">${label}</label>
                        <select class="form-select" id="${field}" name="${field}" required>
                            <option value="">Choose the ${label.toLowerCase()}</option>
                            ${options.map((option) => html`
                                ${anthroOption(v, { anthro: option, selectedId, blocker: Anthros.breedingBlocker(option, role) })}`)}
                        </select>
                    </div>`)}
                <div class="mb-3">
                    <label class="form-label" for="times">Attempts</label>
                    <input class="form-control" style="max-width: 6rem" id="times" name="times" type="number" min="1"
                           max="${Litters.MAX_CUBS}" value="${times}" required>
                    <div class="form-text">
                        How many times to breed them, up to ${Litters.MAX_CUBS}. It stops once the dam's litter is full
                        (each dam's litters have their own limit).
                    </div>
                </div>
                <p class="form-text">
                    For a litter, the sire's gender must be able to sire and the dam's to be a dam, and both must be
                    fertile. Any pair can be bred, but one that breaks these rules (marked "no litter") is only
                    recorded in their history. Each dam can only conceive on one day of the week, and nobody knows
                    which: on any other day, breeding her just doesn't take. Breeding makes the dam pregnant with a litter due in
                    ${intdiv(Litters.GESTATION_DAYS, 7)} weeks; each time she's bred on that same day adds
                    one more cub, up to her own limit (1 to ${Litters.MAX_CUBS}, close to her mother's). Each cub gets a random gender, the species of
                    one of its parents, and a random name you can change once it's born.
                </p>
                <button class="btn btn-success">Breed</button>
            </form>`}
    </div>`,
    });
}
