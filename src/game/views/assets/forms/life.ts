// Upstream: game/views/assets/forms/life.blade.php
import { html, selected, type Html } from '../../../../core/html';
import type { InputArray } from '../../../../core/http';
import { gmdate, int, range, str, strtotimeOrThrow } from '../../../../core/php';
import type { ViewContext } from '../../../../core/View';
import type { Row } from '../../../../db/Db';
import { Anthros } from '../../../Anthros';
import { Litters } from '../../../Litters';
import { Urges } from '../../../Urges';

/**
 * Admin: the anthro's life in order (born, fertile from, fertile until for dams, dies on) and a dam's conceiving
 * weekday and max cubs, saved together (see Anthros.setLife). After a failed save it shows what was entered, with
 * the error, and opens the admin panel. post is the request's form ($_POST upstream).
 */
export default function lifeForm(v: ViewContext, { anthro, error, post }: { anthro: Row; error: string | null; post: InputArray }): Html {
    const posted = error !== null && post.dies_on != null;
    const value = (field: string, current: unknown) => posted ? str(post[field] ?? '') : str(current ?? '');
    const born: string | null = anthro.birthdate;
    const weeksAfterBirth = (date: string | null) => born !== null && date ? Anthros.ageWeeks(born, date) + ' weeks old' : '';
    const isDam = !!anthro.is_female;
    const fields: [string, string, string | null, string, Record<string, string | number>][] = [
        ['birthdate', 'Born', anthro.birthdate, 'Empty: unknown (it doesn\'t age).', { max: gmdate('Y-m-d') }],
        ['fertile_on', 'Fertile from', anthro.fertile_on, 'Empty: no wait.', {}],
        ['fertile_until', 'Fertile until', anthro.fertile_until,
            Anthros.FERTILE_UNTIL_WEEKS[0] + '-' + Anthros.FERTILE_UNTIL_WEEKS[1] + ' weeks after birth; her old age.',
            born !== null ? {
                min: gmdate('Y-m-d', strtotimeOrThrow(born + ' UTC +' + (Anthros.FERTILE_UNTIL_WEEKS[0] * 7) + ' days')),
                max: gmdate('Y-m-d', strtotimeOrThrow(born + ' UTC +' + (Anthros.FERTILE_UNTIL_WEEKS[1] * 7) + ' days')),
            } : {}],
        ['dies_on', 'Dies on', Anthros.diesOn(anthro),
            (isDam ? 'At least ' + Anthros.OLD_AGE_WEEKS + ' weeks after fertile until; ' : '') + 'whole weeks after birth.',
            born !== null ? { min: gmdate('Y-m-d', strtotimeOrThrow(born + ' UTC +7 days')), step: 7 } : {}],
    ];
    return html`<form method="post" action="/game/assets/${anthro.id}/life" class="card card-body mb-3" style="max-width: 36rem"
      ${posted ? html`data-admin-open` : ''}>
    <input type="hidden" name="csrf" value="${v.csrf}">
    <h3 class="h6 mb-2">Life <span class="text-body-secondary small">(admin only)</span></h3>
    ${posted ? html`
        <div class="alert alert-danger py-2 small">${error}</div>` : ''}
    ${fields.filter(([field]) => !(field === 'fertile_until' && !isDam)).map(([field, label, current, help, attributes]) => html`
        <div class="row g-2 align-items-center mb-2">
            <label class="col-4 col-form-label col-form-label-sm" for="life-${field}">${label}</label>
            <div class="col-8">
                <input class="form-control form-control-sm" id="life-${field}" name="${field}" type="date"
                       value="${value(field, current)}" ${Object.entries(attributes).map(([name, attribute]) => html` ${name}="${attribute}" `)}>
                <div class="form-text m-0">
                    ${field !== 'birthdate' && weeksAfterBirth(current) ? html`
                        ${weeksAfterBirth(current)}.` : ''}
                    ${help}
                </div>
            </div>
        </div>`)}
    ${isDam ? html`
        <div class="row g-2 align-items-center mb-2">
            <label class="col-4 col-form-label col-form-label-sm" for="life-fertile_weekday">Conceives on</label>
            <div class="col-8">
                <select class="form-select form-select-sm" id="life-fertile_weekday" name="fertile_weekday">
                    ${range(1, 7).map((day) => html`
                        <option value="${day}" ${selected(int(value('fertile_weekday', anthro.fertile_weekday)) === day)}>${Anthros.weekday(day)}</option>`)}
                </select>
                <div class="form-text m-0">Players never see it: breeding her on another day just "didn't take".</div>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <label class="col-4 col-form-label col-form-label-sm" for="life-max_cubs">Max cubs</label>
            <div class="col-8">
                <input class="form-control form-control-sm" id="life-max_cubs" name="max_cubs" type="number"
                       min="${Litters.MIN_CUBS}" max="${Litters.MAX_CUBS}" value="${value('max_cubs', Anthros.maxCubs(anthro))}" required>
                <div class="form-text m-0">Her daughters get hers, give or take one.</div>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <label class="col-4 col-form-label col-form-label-sm" for="life-urge_rise">Urge rises</label>
            <div class="col-8">
                <div class="input-group input-group-sm">
                    <input class="form-control" id="life-urge_rise" name="urge_rise" type="number"
                           min="${Urges.MIN_RISE}" max="${Urges.MAX_RISE}" value="${value('urge_rise', Urges.rise(anthro))}" required>
                    <span class="input-group-text">% a day</span>
                </div>
                <div class="form-text m-0">
                    Her chance of going looking for a mate rises this much each day she goes without.
                    ${Urges.seeking(anthro) ? html`
                        ${Urges.daysWaiting(anthro)} days so far: ${Urges.chance(anthro)}% today.` : html`
                        She isn't looking now.`}
                </div>
            </div>
        </div>` : ''}
    <div><button class="btn btn-sm btn-outline-warning">Save</button></div>
</form>`;
}
