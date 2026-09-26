// Upstream: game/views/notifications.blade.php
import { html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Notifications } from '../Notifications';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function notifications(v: ViewContext, { items, player, prefill, body, error }: {
    items: Row[]; player: Row | null; prefill: string; body: string; error: string | null;
}): Html {
    return gameLayout(v, {
        title: 'Notifications - Game',
        content: html`
    <h1 class="h3 mb-3">Social</h1>
    ${subnav(v, { section: '/game/socials' })}
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}
    <div class="row g-4">
        <div class="col-lg-7">
            ${!items.length ? html`
                <p class="text-body-secondary">Nothing yet.</p>` : html`
                <form method="post" action="/game/notifications" data-select-group>
                <input type="hidden" name="csrf" value="${v.csrf}">
                <input type="hidden" name="action" value="delete">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <input class="form-check-input mt-0" type="checkbox" data-select-all id="select-all-notes" aria-label="Select all">
                    <label class="small" for="select-all-notes">Select all <span class="text-body-secondary" data-selected-count></span></label>
                    <button class="btn btn-sm btn-outline-danger ms-auto"
                            onclick="return confirm('Delete the selected notifications? They\\'ll be gone from your list, but administrators can still review them.')">Delete selected</button>
                </div>
                <ul class="list-group">
                    ${items.map((item) => html`
                        <li class="list-group-item ${item.read_at === null ? 'border-start border-4 border-primary' : ''}">
                            <div class="d-flex justify-content-between gap-2 small text-body-secondary mb-1">
                                <span>
                                    <input class="form-check-input me-1" type="checkbox" name="ids[]" value="${item.id}" aria-label="Select">
                                    ${item.kind === 'message' ? html`
                                        Message from <strong class="text-body">${item.from_name ?? 'an anthro that no longer exists'}</strong>` : html`
                                        System`}
                                    ${item.read_at === null ? html`
                                        <span class="badge text-bg-primary">new</span>` : ''}
                                </span>
                                <span class="text-nowrap">${String(item.created_at).substring(0, 16)} UTC</span>
                            </div>
                            <div style="white-space: pre-line">${item.times > 1 ? html`<span class="badge text-bg-secondary me-1" title="${item.times} times, most recent shown">${item.times}&times;</span>` : ''}${item.body}</div>
                            <div class="d-flex align-items-center gap-3 small mt-1">
                                ${item.link ? html`
                                    <a href="${item.link}">View</a>` : ''}
                                ${item.kind === 'message' && item.from_anthro_id && player ? html`
                                    <a href="/game/notifications?to=${item.from_anthro_id}#compose">Reply</a>` : ''}
                                <button class="btn btn-link btn-sm p-0 text-danger ms-auto" name="only" value="${item.id}">Delete</button>
                            </div>
                        </li>`)}
                </ul>
                </form>`}
        </div>
        <div class="col-lg-5">
            <div class="card card-body" id="compose">
                <h2 class="h6">Send a message</h2>
                ${!player ? html`
                    <p class="mb-0 text-body-secondary">
                        Messages are sent as your anthro. <a href="/game/home">Create or become an anthro</a> to send one.
                    </p>` : html`
                    <form method="post" action="/game/notifications">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <div class="mb-2">
                            <label class="form-label small" for="to">To</label>
                            <input class="form-control" id="to" name="to" list="anthro-names" data-anthro-search value="${prefill}"
                                   placeholder="Start typing an anthro's name" autocomplete="off" required>
                            <datalist id="anthro-names"></datalist>
                        </div>
                        <div class="mb-2">
                            <label class="form-label small" for="body">Message</label>
                            <textarea class="form-control" id="body" name="body" rows="5" maxlength="${Notifications.MAX_MESSAGE}" required>${body}</textarea>
                        </div>
                        <div class="form-text mb-2">Sent from ${player.name}. Only your anthro's name is shown, never your username.</div>
                        <button class="btn btn-primary">Send</button>
                    </form>`}
            </div>
        </div>
    </div>`,
    });
}
