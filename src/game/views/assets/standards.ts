// Upstream: game/views/assets/standards.blade.php
import { html, type Html } from '../../../core/html';
import { field, type InputArray } from '../../../core/http';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Schedules } from '../../Schedules';
import gameLayout from '../layouts/game';
import subnav from '../subnav';

export default function standards(v: ViewContext, { standards, error, post }: {
    standards: Row[]; error: string | null;
    /** $_POST: what was just sent. */
    post: InputArray;
}): Html {
    return gameLayout(v, {
        title: 'Schedules - Game',
        content: html`
    <h1 class="h3 mb-3">Schedules</h1>
    ${subnav(v, { section: '/game/assets' })}
    <p class="text-body-secondary">
        Standard schedules are weekly routines you name and keep, for your anthros to follow in place of their own.
        Change one, and every anthro following it follows the change. Have an anthro follow one on its schedule page, or
        several at once from the <a href="/game/assets">Overview</a> or <a href="/game/assets/slaves">Slaves</a>.
        Days planned ahead, and birthing, still come first.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    ${standards.length ? html`
        <ul class="list-group mb-4" style="max-width: 40rem">
            ${standards.map((standard) => html`
                <li class="list-group-item d-flex justify-content-between align-items-center gap-2">
                    <a href="/game/assets/schedules/${standard.id}">${standard.name}</a>
                    <span class="small text-body-secondary">${standard.followers} ${standard.followers == 1 ? 'anthro follows' : 'anthros follow'} it</span>
                </li>`)}
        </ul>` : html`
        <p>You don't have any standard schedules yet.</p>`}
    <form method="post" action="/game/assets/schedules" class="d-flex flex-wrap gap-2" style="max-width: 40rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input class="form-control w-auto" name="name" maxlength="${Schedules.MAX_STANDARD_NAME}" placeholder="Schedule name"
               aria-label="Schedule name" value="${field(post, 'name')}" required>
        <button class="btn btn-primary">New schedule</button>
    </form>`,
    });
}
