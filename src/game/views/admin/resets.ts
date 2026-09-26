// Upstream: game/views/admin/resets.blade.php
import { html, type Html } from '../../../core/html';
import { json_encode } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import gameLayout from '../layouts/game';

/** requests: Resets.pending(); players: Resets.players(). */
export default function resets(v: ViewContext, { requests, players, error }: { requests: Row[]; players: Row[]; error: string | null }): Html {
    return gameLayout(v, {
        title: 'Resets - Game admin',
        content: html`
    <h1 class="h3 mb-1">Resets</h1>
    <p class="text-body-secondary">
        Players can't change which anthro they play. Resetting releases it (it stays in the game with its owner and
        coins) so they can create or become another. The player is notified either way.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <h2 class="h5">Requests</h2>
    ${!requests.length ? html`
        <p class="text-body-secondary">No pending requests.</p>` : html`
        <ul class="list-group mb-4">
            ${requests.map((request) => html`
                <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span>
                        <strong>${request.username}</strong> plays
                        ${request.anthro_id ? html`
                            <a href="/game/assets/${request.anthro_id}">${request.anthro_name}</a>` : html`
                            an anthro that no longer exists`}
                        <span class="text-body-secondary small">&middot; ${String(request.requested_at).substring(0, 16)} UTC</span>
                        ${request.reason ? html`
                            <br><span class="small">&ldquo;${request.reason}&rdquo;</span>` : ''}
                    </span>
                    <form method="post" action="/game/admin/resets" class="d-flex gap-2 m-0">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="user_id" value="${request.user_id}">
                        <input type="hidden" name="request_id" value="${request.id}">
                        <button class="btn btn-sm btn-warning" name="action" value="reset"
                                onclick="return confirm(${json_encode('Release ' + request.username + ' from playing ' + (request.anthro_name ?? 'their anthro') + '?')})">Reset</button>
                        <button class="btn btn-sm btn-outline-secondary" name="action" value="dismiss">Dismiss</button>
                    </form>
                </li>`)}
        </ul>`}

    <h2 class="h5">All players</h2>
    <div class="table-responsive">
        <table data-sortable class="table table-striped align-middle">
            <thead><tr><th>Player</th><th>Plays</th><th data-nosort></th></tr></thead>
            <tbody>
            ${players.map((row) => html`
                <tr>
                    <td>${row.username}</td>
                    <td><a href="/game/assets/${row.anthro_id}">${row.anthro_name}</a></td>
                    <td class="text-end">
                        <form method="post" action="/game/admin/resets" class="m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="user_id" value="${row.user_id}">
                            <button class="btn btn-sm btn-outline-warning" name="action" value="reset"
                                    onclick="return confirm(${json_encode('Release ' + row.username + ' from playing ' + row.anthro_name + '?')})">Reset</button>
                        </form>
                    </td>
                </tr>`)}
            </tbody>
        </table>
    </div>`,
    });
}
