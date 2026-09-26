// Upstream: game/views/admin/breed.blade.php
import { html, type Html } from '../../../core/html';
import { intdiv, ucfirst } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import { Litters } from '../../Litters';
import gameLayout from '../layouts/game';

export default function breed(v: ViewContext, { sire, dam, error }: { sire: string; dam: string; error: string | null }): Html {
    return gameLayout(v, {
        title: 'Force breed - Game admin',
        content: html`
    <div class="mx-auto" style="max-width: 40rem">
        <h1 class="h3 mb-1">Force breed</h1>
        <p class="text-body-secondary">
            Breed any two anthros regardless of owner or fertility. A litter still needs a sire whose gender can sire and
            a dam whose gender can be a dam; other pairs are only recorded in their history. Each breeding adds one cub to the dam's litter (starting one due in
            ${intdiv(Litters.GESTATION_DAYS, 7)} weeks if she isn't pregnant), up to her max cubs (1 to ${Litters.MAX_CUBS}).
        </p>
        ${error ? html`
            <div class="alert alert-danger">${error}</div>` : ''}
        <form method="post" action="/game/admin/breed" class="card card-body">
            <input type="hidden" name="csrf" value="${v.csrf}">
            ${Object.entries({ sire, dam }).map(([role, value]) => html`
                <div class="mb-3">
                    <label class="form-label" for="${role}">${ucfirst(role)}</label>
                    <input class="form-control" id="${role}" name="${role}" list="${role}-names" data-anthro-search value="${value}"
                           placeholder="Start typing an anthro's name" autocomplete="off" required>
                    <datalist id="${role}-names"></datalist>
                </div>`)}
            <p class="form-text">The cubs belong to the dam's owner (the dam herself, if she's free) until they're grown.</p>
            <button class="btn btn-warning">Force breed</button>
        </form>
    </div>`,
    });
}
