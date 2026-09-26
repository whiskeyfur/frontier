// Upstream: game/views/groups/admin.blade.php
import { html, selected, type Html } from '../../../core/html';
import { json_encode, ucfirst } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Groups } from '../../Groups';

// One group in the admin panel: rename, who can join, dissolve, take members out and add anyone.
export default function groupAdmin(v: ViewContext, { group }: { group: Row }): Html {
    return html`<details class="border rounded p-2 mb-2">
    <summary>
        ${group.name}
        <span class="badge text-bg-secondary">${ucfirst(group.access)}</span>
        <span class="text-body-secondary small">${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}
            &middot; owned by ${group.owner_name ?? 'no one'}</span>
    </summary>
    <form method="post" action="/game/groups" class="d-flex flex-wrap gap-2 my-2">
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
        <button class="btn btn-sm btn-outline-danger" name="action" value="dissolve"
                onclick="return confirm(${json_encode('Dissolve ' + group.name + '?')})">Dissolve</button>
    </form>
    <ul class="list-unstyled small mb-2">
        ${group.members.map((member: Row) => html`
            <li class="d-flex justify-content-between align-items-center gap-2 mb-1">
                <a href="/game/assets/${member.id}">${member.name}</a>
                <form method="post" action="/game/groups" class="m-0">
                    <input type="hidden" name="csrf" value="${v.csrf}">
                    <input type="hidden" name="group_id" value="${group.id}">
                    <input type="hidden" name="anthro_id" value="${member.id}">
                    <button class="btn btn-sm btn-outline-danger py-0" name="action" value="remove"
                            onclick="return confirm(${json_encode('Take ' + member.name + ' out of ' + group.name + '?' + (group.members.length <= Groups.MIN_MEMBERS ? ' The group will be dissolved.' : ''))})">Take out</button>
                </form>
            </li>`)}
    </ul>
    <form method="post" action="/game/groups" class="d-flex flex-wrap gap-2 m-0">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="group_id" value="${group.id}">
        <input class="form-control form-control-sm w-auto" name="anthro" list="all-anthros" data-anthro-search placeholder="Anthro to add"
               autocomplete="off" aria-label="Anthro to add" required>
        <button class="btn btn-sm btn-outline-primary" name="action" value="invite">Add</button>
    </form>
</details>`;
}
