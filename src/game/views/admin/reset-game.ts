// Upstream: game/views/admin/reset-game.blade.php
import { checked, html, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { empty, number_format, range, ucfirst } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import { Baronies } from '../../Baronies';
import { Board } from '../../Board';
import { Ranks } from '../../Ranks';
import gameLayout from '../layouts/game';

/** counts: Board.counts() (table => rows); post: the form sent ($_POST). */
export default function resetGame(v: ViewContext, { counts, error, post }: { counts: Record<string, number>; error: string | null; post: InputArray }): Html {
    const posted = Object.keys(post).length > 0;
    const postedRanks = typeof post.ranks === 'object' ? post.ranks : {};
    return gameLayout(v, {
        title: 'Reset game - Game admin',
        content: html`
    <div class="mx-auto" style="max-width: 40rem">
        <h1 class="h3 mb-1">Reset game</h1>
        <p class="text-body-secondary">
            Deletes every anthro, players' anthros included, all land and baronies, and everything that happened in the
            game. Players start over by creating an anthro. Choose how many title holders of each rank the new game
            starts with: with none, it starts empty, and the first player can also start with a slave to breed with. If no
            barony is seated, there's still one, held by no one: three villages, a town and an expanse, with
            ${number_format(Baronies.EMPTY_ACRES[0])} to ${number_format(Baronies.EMPTY_ACRES[1])} acres of the land office's land.
            Land earns ranks from baronet up. Species, genders, names, ranks and site accounts are kept.
        </p>
        <div class="alert alert-warning">
            Keep "Save the game first" ticked to be able to undo this from <a href="/game/admin/saves">Saved games</a>.
        </div>
        ${error ? html`
            <div class="alert alert-danger">${error}</div>` : ''}
        <table class="table table-sm w-auto">
            <thead><tr><th>Will be deleted</th><th class="text-end">Rows</th></tr></thead>
            <tbody>
            ${Object.entries(counts).map(([table, count]) => html`
                <tr>
                    <td>${ucfirst(table.substring(5).replaceAll('_', ' '))}</td>
                    <td class="text-end">${number_format(count)}</td>
                </tr>`)}
            </tbody>
        </table>
        <form method="post" action="/game/admin/reset-game" class="card card-body border-danger">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <h2 class="h6">The new game's court</h2>
            <p class="form-text mt-0">
                How many of each rank to create: free, unplayed anthros holding titles granted by the crown. Each is sworn
                to someone of the nearest rank above that has anyone, spread evenly.
            </p>
            <div class="row g-2 mb-2" style="max-width: 28rem">
                ${range(Ranks.KING, Ranks.KNIGHT).map((rank) => html`
                    <label class="col-6 col-form-label col-form-label-sm" for="rank-${rank}">
                        ${Ranks.name(rank)}${Ranks.isNoble(rank) ? '' : ' (not noble)'}
                    </label>
                    <div class="col-6">
                        <input class="form-control form-control-sm" id="rank-${rank}" name="ranks[${rank}]" type="number" min="0"
                               max="${rank === Ranks.KING ? 1 : Board.MAX_PER_RANK}" value="${postedRanks[rank] ?? 0}">
                    </div>`)}
            </div>
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="consort" name="consort" value="1" ${checked(!posted || !empty(post.consort))}>
                <label class="form-check-label" for="consort">Give the ${Ranks.name(Ranks.KING)} a ${Ranks.name(Ranks.KING, 'female')} consort</label>
            </div>
            <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="settle" name="settle" value="1" ${checked(!posted || !empty(post.settle))}>
                <label class="form-check-label" for="settle">
                    Seat them: a barony for the crown and each ${Ranks.name(Baronies.HOLDER_RANK)}, a town or city for
                    each ${Ranks.name(3)}, a village, manor or expanse for each ${Ranks.name(Ranks.KNIGHT)}, and their commoners
                </label>
            </div>
            <hr>
            <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="save_first" name="save_first" value="1" checked>
                <label class="form-check-label" for="save_first">Save the game first (as "Before reset")</label>
            </div>
            <label class="form-label" for="confirm">Type <strong>${Board.CONFIRM_WORD}</strong> to confirm</label>
            <div class="d-flex flex-wrap gap-2">
                <input class="form-control w-auto" id="confirm" name="confirm" autocomplete="off" required>
                <button class="btn btn-danger" onclick="return confirm('Delete every anthro and reset the game?')">Reset the game</button>
            </div>
        </form>
    </div>`,
    });
}
