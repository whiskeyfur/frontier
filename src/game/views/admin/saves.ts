// Upstream: game/views/admin/saves.blade.php
import { html, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { gmdate, json_encode, number_format, round } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Saves } from '../../Saves';
import gameLayout from '../layouts/game';

/** saves: Saves.all(); post: the form sent ($_POST). */
export default function saves(v: ViewContext, { saves, error, post }: { saves: Row[]; error: string | null; post: InputArray }): Html {
    return gameLayout(v, {
        title: 'Saved games - Game admin',
        content: html`
    <h1 class="h3 mb-1">Saved games</h1>
    <p class="text-body-secondary">
        A save is a snapshot of the whole game: every anthro and everything that happened to them, plus species, genders
        and names. Restoring one replaces the current game with it, after saving the current game as "Before restoring".
        Site accounts aren't part of a save; anything that refers to an account deleted since is cleared.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <form method="post" action="/game/admin/saves" class="card card-body mb-4" style="max-width: 36rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="save">
        <label class="form-label" for="name">Save the game as</label>
        <div class="d-flex flex-wrap gap-2">
            <input class="form-control w-auto flex-grow-1" id="name" name="name" maxlength="${Saves.MAX_NAME}" required
                   value="${post.name ?? 'Save of ' + gmdate('Y-m-d H:i') + ' UTC'}">
            <button class="btn btn-primary">Save</button>
        </div>
    </form>

    ${!saves.length ? html`
        <p>No saves yet.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead>
                <tr><th>Name</th><th>Saved</th><th>By</th><th class="text-end">Anthros</th><th class="text-end">Size</th><th data-nosort></th></tr>
                </thead>
                <tbody>
                ${saves.map((save) => html`
                    <tr>
                        <td>${save.name}</td>
                        <td class="text-nowrap" data-sort="${save.created_at}">${save.created_at} UTC</td>
                        <td>${save.created_by_name ?? '—'}</td>
                        <td class="text-end">${number_format(save.anthros)}</td>
                        <td class="text-end text-nowrap" data-sort="${save.size}">${number_format(Math.max(1, round(save.size / 1024)))} KB</td>
                        <td>
                            <div class="d-flex flex-wrap gap-2 justify-content-end">
                                <a class="btn btn-sm btn-outline-secondary" href="/game/admin/saves/${save.id}.json">Download</a>
                                <form method="post" action="/game/admin/saves" class="d-flex gap-2 m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="id" value="${save.id}">
                                    <input class="form-control form-control-sm" style="width: 7rem" name="confirm" placeholder="RESTORE"
                                           autocomplete="off" aria-label="Type RESTORE to confirm">
                                    <button class="btn btn-sm btn-warning" name="action" value="restore">Restore</button>
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="delete"
                                            onclick="return confirm(${json_encode('Delete the save "' + save.name + '"?')})">Delete</button>
                                </form>
                            </div>
                        </td>
                    </tr>`)}
                </tbody>
            </table>
        </div>
        <p class="form-text">To restore, type RESTORE next to the save and press Restore.</p>`}`,
    });
}
