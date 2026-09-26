// Upstream: game/views/admin/unowned.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import gameLayout from '../layouts/game';
import gender from '../assets/gender';

/** anthros: Anthros.unowned(). */
export default function unowned(v: ViewContext, { anthros }: { anthros: Row[] }): Html {
    return gameLayout(v, {
        title: 'Game-owned anthros - Game admin',
        content: html`
    <h1 class="h3 mb-1">Game-owned anthros</h1>
    <p class="text-body-secondary">
        Anthros with no owner: the game's, supplied for auction (ones it doesn't sell go free). Transferring one gives
        it to an anthro.
    </p>
    ${!anthros.length ? html`
        <p>The game owns no anthros right now.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr><th>Name</th><th>Gender</th><th>Species</th><th>Born</th><th>Age</th><th>Added</th></tr>
                </thead>
                <tbody>
                ${anthros.map((anthro) => html`
                    <tr>
                        <td><a href="/game/assets/${anthro.id}">${anthro.name}</a></td>
                        <td>${gender(v, { gender: anthro.gender, presentsAs: anthro.presents_as })} ${anthro.gender}</td>
                        <td>${anthro.species ?? '—'}</td>
                        <td>${anthro.birthdate ?? 'unknown'}</td>
                        <td>${Anthros.age(anthro.birthdate)}</td>
                        <td>${String(anthro.created_at).substring(0, 10)}</td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`}`,
    });
}
