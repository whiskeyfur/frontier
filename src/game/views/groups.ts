// Upstream: game/views/groups.blade.php
import { Auth } from '../../core/Auth';
import { html, selected, type Html } from '../../core/html';
import { json_encode, ucfirst } from '../../core/php';
import type { ViewContext } from '../../core/View';
import type { Row } from '../../db/Db';
import { Groups } from '../Groups';
import gender from './assets/gender';
import pregnantBadge from './assets/pregnant-badge';
import groupAdmin from './groups/admin';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function groups(v: ViewContext, { groups, directory, candidates, allGroups, error }: {
    groups: Row[]; directory: Row[]; candidates: Row[]; allGroups: Row[]; error: string | null;
}): Html {
    const user = v.user!;
    // Invitations to, and requests from, anthros the user controls.
    const answers: { group: Row; pending: Row }[] = [];
    for (const group of groups) {
        for (const pending of group.pending) {
            if (Groups.controls(user, pending.anthro, false) && !Groups.manages(user, group, false)) {
                answers.push({ group, pending });
            }
        }
    }
    return gameLayout(v, {
        title: 'Breeding groups - Game',
        content: html`
    <h1 class="h3 mb-3">Social</h1>
    ${subnav(v, { section: '/game/socials' })}
    <p class="text-body-secondary">
        A breeding group is anthros who are, in effect, married. A dam who goes looking for a mate (the longer she
        goes without, the likelier she is to) turns to her groups first; as with any breeding, a pair that breaks the
        rules is recorded with no litter. A group belongs to the anthro that formed it, and its owner
        decides who can join. Anthros join (or ask to) through whoever owns or employs them.
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    ${answers.length ? html`
        <ul class="list-group mb-4">
            ${answers.map((answer) => html`
                <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span>
                        <strong>${answer.pending.anthro.name}</strong>
                        ${answer.pending.kind === 'invite' ? html`
                            is invited to join <a href="#group-${answer.group.id}">${answer.group.name}</a>.` : html`
                            asked to join <a href="#group-${answer.group.id}">${answer.group.name}</a>; waiting for its owner.`}
                    </span>
                    <form method="post" action="/game/groups" class="d-flex gap-2 m-0">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="pending_id" value="${answer.pending.id}">
                        ${answer.pending.kind === 'invite' ? html`
                            <button class="btn btn-sm btn-success" name="action" value="accept">Accept</button>
                            <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Decline</button>` : html`
                            <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Withdraw</button>`}
                    </form>
                </li>`)}
        </ul>` : ''}

    ${groups.map((group) => {
        // As a player; admins manage any group from the admin panel.
        const manages = Groups.manages(user, group, false);
        return html`
        <div class="card mb-3" id="group-${group.id}">
            <div class="card-body">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <h2 class="h5 mb-0">
                        ${group.name}
                        <span class="badge text-bg-secondary align-middle">${ucfirst(group.access)}</span>
                    </h2>
                    <span class="text-body-secondary small">
                        ${group.owner_player_id !== null && group.owner_player_id === user.id ? html`
                            Yours` : html`
                            Owned by ${group.owner_name ?? 'no one (admins manage it)'}`}
                    </span>
                </div>
                ${manages ? html`
                    <form method="post" action="/game/groups" class="d-flex flex-wrap gap-2 mb-3">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="group_id" value="${group.id}">
                        <input class="form-control form-control-sm w-auto" name="name" value="${group.name}"
                               maxlength="${Groups.MAX_NAME}" aria-label="Group name">
                        <button class="btn btn-sm btn-outline-secondary" name="action" value="rename">Rename</button>
                        <select class="form-select form-select-sm w-auto" name="access" aria-label="Who can join">
                            ${Object.entries(Groups.ACCESS).map(([value, label]) => html`
                                <option value="${value}" ${selected(group.access === value)}>${label}</option>`)}
                        </select>
                        <button class="btn btn-sm btn-outline-primary" name="action" value="access">Save</button>
                        <button class="btn btn-sm btn-outline-danger ms-auto" name="action" value="dissolve"
                                onclick="return confirm(${json_encode('Dissolve ' + group.name + '?')})">Dissolve</button>
                    </form>` : ''}

                <ul class="list-group mb-2">
                    ${group.members.map((member: Row) => html`
                        <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                            <span>
                                <a href="/game/assets/${member.id}">${member.name}</a>
                                ${gender(v, { gender: member.gender, presentsAs: member.presents_as })}
                                ${member.player_id === user.id ? html`
                                    <span class="badge text-bg-secondary">you</span>` : ''}
                                ${pregnantBadge(v, { anthro: member })}
                                <span class="text-body-secondary small">${member.species ?? ''}</span>
                            </span>
                            ${manages || Groups.controls(user, member, false) ? html`
                                <form method="post" action="/game/groups" class="m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="group_id" value="${group.id}">
                                    <input type="hidden" name="anthro_id" value="${member.id}">
                                    <button class="btn btn-sm btn-outline-danger" name="action" value="remove"
                                            onclick="return confirm(${json_encode('Take ' + member.name + ' out of ' + group.name + '?' + (group.members.length <= Groups.MIN_MEMBERS ? ' The group will be dissolved.' : ''))})">
                                        ${member.player_id === user.id ? 'Leave' : 'Take out'}
                                    </button>
                                </form>` : member.player_id === user.id ? html`
                                ${/* Owned: only the owner can take it out. */ ''}
                                <form method="post" action="/game/groups" class="m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="group_id" value="${group.id}">
                                    <button class="btn btn-sm btn-outline-secondary" name="action" value="ask_to_leave"
                                            title="Only ${member.owner_name ?? 'your owner'} can take you out">Ask to leave</button>
                                </form>` : ''}
                        </li>`)}
                </ul>

                ${manages ? html`
                    ${group.pending.map((pending: Row) => html`
                        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 border rounded p-2 mb-2">
                            <span>
                                <a href="/game/assets/${pending.anthro.id}">${pending.anthro.name}</a>
                                ${pending.kind === 'request' ? 'asks to join.' : 'is invited; waiting for an answer.'}
                            </span>
                            <form method="post" action="/game/groups" class="d-flex gap-2 m-0">
                                <input type="hidden" name="csrf" value="${v.csrf}">
                                <input type="hidden" name="pending_id" value="${pending.id}">
                                ${pending.kind === 'request' ? html`
                                    <button class="btn btn-sm btn-success" name="action" value="accept">Approve</button>
                                    <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Decline</button>` : html`
                                    <button class="btn btn-sm btn-outline-secondary" name="action" value="decline">Withdraw</button>`}
                            </form>
                        </div>`)}
                    <form method="post" action="/game/groups" class="d-flex flex-wrap align-items-center gap-2 m-0">
                        <input type="hidden" name="csrf" value="${v.csrf}">
                        <input type="hidden" name="group_id" value="${group.id}">
                        <input class="form-control form-control-sm w-auto" name="anthro" list="all-anthros" data-anthro-search placeholder="Anthro to invite or add"
                               autocomplete="off" aria-label="Anthro to invite" required>
                        <button class="btn btn-sm btn-outline-primary" name="action" value="invite">Invite</button>
                        <span class="form-text m-0">Your own anthros are added straight away; others are invited.</span>
                    </form>` : ''}
            </div>
        </div>`;
    })}
    ${!groups.length ? html`
        <p class="text-body-secondary">You aren't in any breeding group yet.</p>` : ''}

    <h2 class="h5 mt-4">Find a group</h2>
    ${!directory.length ? html`
        <p class="text-body-secondary">There are no other groups to join.</p>` : html`
        <div class="table-responsive">
            <table data-sortable class="table table-striped align-middle">
                <thead><tr><th>Group</th><th>Owner</th><th class="text-end">Members</th><th>Joining</th><th data-nosort></th></tr></thead>
                <tbody>
                ${directory.map((group) => html`
                    <tr>
                        <td>${group.name}</td>
                        <td>${group.owner_name ?? '—'}</td>
                        <td class="text-end">${group.members.length}</td>
                        <td>${({ open: 'Open', request: 'By request', invite: 'Invite only', closed: 'Closed' } as Record<string, string>)[group.access]}</td>
                        <td class="text-end">
                            ${['open', 'request'].includes(group.access) && candidates.length ? html`
                                <form method="post" action="/game/groups" class="d-inline-flex gap-2 m-0">
                                    <input type="hidden" name="csrf" value="${v.csrf}">
                                    <input type="hidden" name="group_id" value="${group.id}">
                                    <select class="form-select form-select-sm w-auto" name="anthro_id" aria-label="Anthro to join with">
                                        ${candidates.map((candidate) => html`
                                            <option value="${candidate.id}">${candidate.name}</option>`)}
                                    </select>
                                    <button class="btn btn-sm ${group.access === 'open' ? 'btn-success' : 'btn-outline-primary'}" name="action" value="join">
                                        ${group.access === 'open' ? 'Join' : 'Ask to join'}
                                    </button>
                                </form>` : ''}
                        </td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`}

    ${candidates.length ? html`
        <form method="post" action="/game/groups" class="card card-body mt-4" style="max-width: 40rem">
            <input type="hidden" name="csrf" value="${v.csrf}">
            <input type="hidden" name="action" value="create">
            <h2 class="h6">Form a breeding group</h2>
            <div class="mb-2">
                <label class="form-label small" for="group-name">Name</label>
                <input class="form-control" id="group-name" name="name" maxlength="${Groups.MAX_NAME}" required>
            </div>
            <div class="row row-cols-sm-2 g-1 mb-3">
                ${candidates.map((candidate) => html`
                    <div class="col form-check">
                        <input class="form-check-input" type="checkbox" name="ids[]" value="${candidate.id}" id="member-${candidate.id}">
                        <label class="form-check-label" for="member-${candidate.id}">
                            ${candidate.name} <span class="text-body-secondary small">${candidate.gender} ${candidate.species ?? ''}</span>
                        </label>
                    </div>`)}
            </div>
            <button class="btn btn-primary">Form group</button>
            <div class="form-text">Pick at least one. New groups are closed until you choose who can join.</div>
        </form>` : ''}

    <datalist id="all-anthros"></datalist>

    ${Auth.isAdmin(user) ? v.push('admin', html`
            <h3 class="h6">Every breeding group</h3>
            ${allGroups.length ? allGroups.map((group) => groupAdmin(v, { group })) : html`
                <p class="small text-body-secondary">There are no breeding groups.</p>`}`) : ''}`,
    });
}
