// Upstream: game/views/admin/names.blade.php
import { checked, html, type Html } from '../../../core/html';
import type { InputArray } from '../../../core/http';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Names } from '../../Names';
import gameLayout from '../layouts/game';

/** names: Names.all(); counts: Names.counts(); post: the form sent ($_POST). */
export default function names(v: ViewContext, { names, counts, error, post }: {
    names: Row[]; counts: { male: number; female: number; neutral: number; unused: number }; error: string | null; post: InputArray;
}): Html {
    return gameLayout(v, {
        title: 'Names - Game admin',
        content: html`
    <h1 class="h3 mb-1">Names</h1>
    <p class="text-body-secondary">
        Random names for new anthros. Male-presenting anthros get names marked male, female-presenting ones names marked
        female, and androgynous ones neutral names (marked both). A name marked neither is never picked. Removing a name
        doesn't rename anthros that have it.
    </p>
    <p>
        <span class="badge text-bg-primary">${counts.male} male</span>
        <span class="badge text-bg-danger">${counts.female} female</span>
        <span class="badge text-bg-secondary">${counts.neutral} neutral</span>
        ${counts.unused ? html`
            <span class="badge text-bg-light border">${counts.unused} unused</span>` : ''}
    </p>
    ${error ? html`
        <div class="alert alert-danger">${error}</div>` : ''}

    <form method="post" action="/game/admin/names" class="card card-body mb-4" style="max-width: 36rem">
        <input type="hidden" name="csrf" value="${v.csrf}">
        <input type="hidden" name="action" value="add">
        <label class="form-label" for="names">Add names <span class="text-body-secondary small">(one per line, or separated by commas)</span></label>
        <textarea class="form-control mb-2" id="names" name="names" rows="3" required>${(post.action ?? '') === 'add' ? (post.names ?? '') : ''}</textarea>
        <div class="d-flex flex-wrap align-items-center gap-3">
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="add_male" name="is_male" value="1">
                <label class="form-check-label" for="add_male">Male</label>
            </div>
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="add_female" name="is_female" value="1">
                <label class="form-check-label" for="add_female">Female</label>
            </div>
            <span class="form-text m-0">Tick both for a neutral name.</span>
            <button class="btn btn-primary ms-auto">Add</button>
        </div>
    </form>

    <form method="post" action="/game/admin/names" data-select-group>
        <input type="hidden" name="csrf" value="${v.csrf}">
        <div class="table-responsive">
            <table data-sortable class="table table-striped table-sm align-middle">
                <thead>
                <tr>
                    <th data-nosort><input class="form-check-input" type="checkbox" data-select-all title="Select all" aria-label="Select all names"></th>
                    <th>Name</th><th>Male</th><th>Female</th><th>Kind</th><th data-nosort></th>
                </tr>
                </thead>
                <tbody>
                ${names.map((name) => {
                    const kind = name.is_male && name.is_female ? 'neutral' : (name.is_male ? 'male' : (name.is_female ? 'female' : 'unused'));
                    return html`
                    <tr>
                        <td><input class="form-check-input" type="checkbox" name="ids[]" value="${name.id}" aria-label="Select ${name.name}"></td>
                        ${/* The hidden text lets the column search and sort see the field's value. */ ''}
                        <td data-sort="${name.name}">
                            <span class="visually-hidden">${name.name}</span>
                            <input class="form-control form-control-sm" name="name[${name.id}]" value="${name.name}"
                                   maxlength="${Names.MAX_NAME}" aria-label="Name" style="min-width: 9rem">
                        </td>
                        <td data-sort="${int(name.is_male)}">
                            <span class="visually-hidden">${name.is_male ? 'yes' : 'no'}</span>
                            <input class="form-check-input" type="checkbox" name="male[${name.id}]" value="1" ${checked(name.is_male)} aria-label="Male">
                        </td>
                        <td data-sort="${int(name.is_female)}">
                            <span class="visually-hidden">${name.is_female ? 'yes' : 'no'}</span>
                            <input class="form-check-input" type="checkbox" name="female[${name.id}]" value="1" ${checked(name.is_female)} aria-label="Female">
                        </td>
                        <td>${kind}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-primary" name="action" value="save:${name.id}">Save</button>
                        </td>
                    </tr>`;
                })}
                </tbody>
            </table>
        </div>
        <button class="btn btn-outline-danger" name="action" value="delete"
                onclick="return confirm('Remove the selected names from the list?')">
            Remove selected <span class="small" data-selected-count></span>
        </button>
    </form>`,
    });
}
