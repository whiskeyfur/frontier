// Upstream: game/views/admin/notifications.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Notifications } from '../../Notifications';
import gameLayout from '../layouts/game';

/** items: Notifications.all(); from, to, body: the "send as" form's fields. */
export default function notifications(v: ViewContext, { items, error, from, to, body }: {
    items: Row[]; error: string | null; from: string; to: string; body: string;
}): Html {
    return gameLayout(v, {
        title: 'Notifications - Game admin',
        content: html`
    <h1 class="h3 mb-1">All notifications</h1>
    <p class="text-body-secondary">
        Every notification and message, newest first (up to 500), including ones players have deleted: deleting only
        hides them from the player. Only admins see this page.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${/* Speak for an anthro nobody plays: the recipient sees only the anthro's name. */ ''}
    <form method="post" action="/game/admin/notifications" class="card card-body mb-4" id="send-as" style="max-width: 44rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <h2 class="h6">Send as an anthro nobody plays</h2>
        <div class="row g-2 mb-2">
            <div class="col-sm-6">
                <label class="form-label small mb-1" for="send-from">As</label>
                <input class="form-control form-control-sm" id="send-from" name="from" list="send-names" data-anthro-search
                       placeholder="Name (#id)" value="${from}" required>
            </div>
            <div class="col-sm-6">
                <label class="form-label small mb-1" for="send-to">To</label>
                <input class="form-control form-control-sm" id="send-to" name="to" list="send-names" data-anthro-search
                       placeholder="Name (#id)" value="${to}" required>
            </div>
        </div>
        <datalist id="send-names"></datalist>
        <textarea class="form-control form-control-sm mb-2" name="body" rows="3" maxlength="${Notifications.MAX_MESSAGE}" required
                  aria-label="Message" ${from ? html`autofocus` : ''}>${body}</textarea>
        <div class="d-flex flex-wrap align-items-center gap-2">
            <button class="btn btn-sm btn-primary">Send</button>
            <span class="form-text m-0">The player sees it as from the anthro, like any message. Only admins see who wrote it.</span>
        </div>
    </form>
    <div class="table-responsive">
        <table data-sortable class="table table-striped align-middle small">
            <thead>
            <tr><th>Sent (UTC)</th><th>To</th><th>From</th><th>Text</th><th>Read</th><th>Deleted</th></tr>
            </thead>
            <tbody>
            ${items.map((item) => html`
                <tr class="${item.deleted_at ? 'text-body-secondary' : ''}">
                    <td class="text-nowrap">${String(item.created_at).substring(0, 16)}</td>
                    <td>
                        ${item.to_anthro ? html`
                            ${item.to_anthro} <span class="text-body-secondary">(${item.to_player ? 'played by ' + item.to_player : 'not played'})</span>` : html`
                            ${item.to_user ?? 'a deleted user'} <span class="text-body-secondary">(user)</span>`}
                    </td>
                    <td>
                        ${item.kind === 'message' ? html`
                            ${item.from_name ?? 'a deleted anthro'}
                            ${item.from_player ? html`
                                <span class="text-body-secondary">(${item.from_player})</span>` : item.sent_by_name ? html`
                                <span class="text-body-secondary">(written by ${item.sent_by_name})</span>` : ''}
                            ${/* A message to an anthro nobody plays: an admin can answer for it. */ ''}
                            ${item.to_anthro_id && item.to_player_id === null && !item.to_died_at && item.from_anthro_id ? html`
                                <a class="btn btn-sm btn-outline-primary py-0 ms-1" href="/game/admin/notifications?from=${item.to_anthro_id}&amp;to=${item.from_anthro_id}#send-as">Reply as ${item.to_anthro}</a>` : ''}` : html`
                            <span class="text-body-secondary">system</span>`}
                    </td>
                    <td style="white-space: pre-line; min-width: 16rem">${item.times > 1 ? html`<span class="badge text-bg-secondary me-1">${item.times}&times;</span>` : ''}${item.body}</td>
                    <td class="text-nowrap">${item.read_at ? String(item.read_at).substring(0, 16) : '—'}</td>
                    <td class="text-nowrap">
                        ${item.deleted_at ? html`
                            <span class="badge text-bg-secondary">deleted</span> ${String(item.deleted_at).substring(0, 16)}
                            ${item.deleted_by_name ? html`
                                by ${item.deleted_by_name}` : ''}` : html`
                            —`}
                    </td>
                </tr>`)}
            </tbody>
        </table>
    </div>`,
    });
}
