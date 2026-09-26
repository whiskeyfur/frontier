// Upstream: game/views/socials.blade.php
import { html, type Html } from '../../core/html';
import { empty, ucfirst } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Litters } from '../Litters';
import { Socials } from '../Socials';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function socials(v: ViewContext, { player, flirts, prefill, error }: {
    player: Row | null; flirts: Row[]; prefill: string; error: string | null;
}): Html {
    const incoming = player ? flirts.filter((f) => f.status === 'pending' && f.to_anthro_id === player.id) : [];
    return gameLayout(v, {
        title: 'Flirt - Game',
        content: html`
    <h1 class="h3 mb-3">Social</h1>
    ${subnav(v, { section: '/game/socials' })}
    <p class="text-body-secondary">
        Flirt with another anthro, saying how many times you'd like to breed. If they accept, you try breeding that many
        times there and then; as with any breeding, a pair that
        breaks the rules gets no litter. Anthros nobody plays answer for themselves.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    ${!player ? html`
        <div class="alert alert-secondary"><a href="/game/home">Create or become an anthro</a> first: you flirt as your anthro.</div>` : html`
        <form method="post" action="/game/socials" class="card card-body mb-4" style="max-width: 40rem">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <input type="hidden" name="action" value="flirt">
            <h2 class="h6">Flirt as ${player.name}</h2>
            <div class="mb-2">
                <label class="form-label small" for="to">With</label>
                <input class="form-control" id="to" name="to" list="flirt-anthros" data-anthro-search value="${prefill}"
                       placeholder="Start typing an anthro's name" autocomplete="off" required>
                <datalist id="flirt-anthros"></datalist>
            </div>
            <div class="mb-2">
                <label class="form-label small" for="times">Times to breed</label>
                <input class="form-control" style="max-width: 6rem" id="times" name="times" type="number" min="1" max="${Litters.MAX_CUBS}"
                       value="1" required>
                <div class="form-text">Up to ${Litters.MAX_CUBS}: each try that takes adds a cub to the dam's litter, until it's full (each dam's litters have their own limit).</div>
            </div>
            <div class="mb-3">
                <label class="form-label small" for="message">Say something <span class="text-body-secondary">(optional)</span></label>
                <input class="form-control" id="message" name="message" maxlength="${Socials.MAX_MESSAGE}">
            </div>
            <button class="btn btn-danger">Flirt</button>
        </form>

        ${incoming.length ? html`
            <h2 class="h5">Flirting with you</h2>
            <ul class="list-group mb-4">
                ${incoming.map((flirt) => html`
                    <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <span>
                            <strong>${flirt.from_name}</strong>
                            ${flirt.times > 1 ? html`
                                <span class="badge text-bg-secondary">breed ${flirt.times}×</span>` : ''}
                            ${!empty(flirt.message) ? html`
                                &ldquo;${flirt.message}&rdquo;` : ''}
                        </span>
                        <form method="post" action="/game/socials" class="d-flex gap-2 m-0">
                            <input type="hidden" name="csrf" value="${v.csrf}">
                            <input type="hidden" name="flirt_id" value="${flirt.id}">
                            <button class="btn btn-sm btn-success" name="action" value="accept">Accept</button>
                            <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Decline</button>
                        </form>
                    </li>`)}
            </ul>` : ''}

        <h2 class="h5">History</h2>
        ${!flirts.length ? html`
            <p class="text-body-secondary">No flirts yet.</p>` : html`
            <div class="table-responsive">
                <table data-sortable class="table table-striped align-middle">
                    <thead><tr><th>When</th><th>Who</th><th>Said</th><th class="text-end">Times</th><th>Answer</th><th data-nosort></th></tr></thead>
                    <tbody>
                    ${flirts.map((flirt) => {
                        const sent = flirt.from_anthro_id === player.id;
                        return html`
                        <tr>
                            <td class="text-nowrap" data-sort="${flirt.created_at}">${String(flirt.created_at).substring(0, 16)}</td>
                            <td>${sent ? 'You → ' + (flirt.to_name ?? '?') : (flirt.from_name ?? '?') + ' → you'}</td>
                            <td>${flirt.message ?? ''}</td>
                            <td class="text-end">${flirt.times}</td>
                            <td>
                                ${flirt.status === 'accepted' ? html`
                                    Accepted &middot; ${flirt.litter ? 'a litter is coming' : 'no litter' + (!empty(flirt.barren_reason) ? ' (' + flirt.barren_reason + ')' : '')}` : html`
                                    ${ucfirst(flirt.status)}`}
                            </td>
                            <td class="text-end">
                                ${sent && flirt.status === 'pending' ? html`
                                    <form method="post" action="/game/socials" class="m-0">
                                        <input type="hidden" name="csrf" value="${v.csrf}">
                                        <input type="hidden" name="flirt_id" value="${flirt.id}">
                                        <button class="btn btn-sm btn-outline-secondary" name="action" value="withdraw">Take back</button>
                                    </form>` : ''}
                            </td>
                        </tr>`;
                    })}
                    </tbody>
                </table>
            </div>`}`}`,
    });
}
