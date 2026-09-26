// Upstream: game/views/assets/plan-fields.blade.php
import { html, selected, type Html } from '../../../core/html';
import { int, str } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Schedules, type PlanOptions } from '../../Schedules';

/*
 * One day's plan: what to do, and with whom or at what (plan: its current plan, or what was just sent: activity
 * and detail; names: the field names; options: see Schedules.options; invalid: marks it as the day in error).
 * Breeding picks a partner or a breeding group; training, a skill; work, an occupation, clearing land (where),
 * building (which building) or foraging (see Schedules.checked).
 */
export default function planFields(_v: ViewContext, { plan, names, options, invalid = false }: {
    plan: Row; names: [string, string]; options: PlanOptions; invalid?: boolean;
}): Html {
    let detail: string;
    if (plan.detail != null) {
        detail = str(plan.detail);
    } else {
        switch (plan.activity ?? 'rest') {
            case 'breed': detail = plan.group_id ? 'g:' + plan.group_id : (plan.partner_anthro_id ? 'p:' + plan.partner_anthro_id : ''); break;
            case 'train': detail = plan.skill_id ? 's:' + plan.skill_id : ''; break;
            case 'work': detail = plan.occupation_id ? 'o:' + plan.occupation_id : ''; break;
            case 'clear': detail = 'c:' + (plan.part_id ?? 'wilds'); break;
            case 'build': detail = plan.building_id ? 'b:' + plan.building_id : ''; break;
            case 'forage': detail = 'f'; break;
            default: detail = '';
        }
    }
    const activity = ['clear', 'build', 'forage'].includes(plan.activity ?? 'rest') ? 'work' : (plan.activity ?? 'rest');
    // For one anthro, the occupations it hasn't learned the skill for are apart: it has to train first.
    const learned = options.learned ?? null;
    const occupations = [...options.occupations.values()];
    return html`<div class="d-flex flex-wrap gap-2" data-plan>
    <select class="form-select form-select-sm w-auto ${invalid ? 'is-invalid' : ''}" name="${names[0]}" aria-label="Activity" data-plan-activity>
        ${Object.entries(Schedules.ACTIVITIES).map(([value, label]) => html`
            <option value="${value}" ${selected(activity === value)}>${label}</option>`)}
    </select>
    <select class="form-select form-select-sm w-auto ${invalid ? 'is-invalid' : ''}" name="${names[1]}" aria-label="With whom, or what" data-plan-detail>
        <option value="">&mdash;</option>
        <optgroup label="Breed with" data-for="breed">
            ${options.partners.map((partner) => html`
                <option value="p:${partner.id}" ${selected(detail === 'p:' + partner.id)}>${partner.name} (${partner.gender})</option>`)}
        </optgroup>
        <optgroup label="Breeding group" data-for="breed">
            ${[...options.groups].map(([groupId, groupName]) => html`
                <option value="g:${groupId}" ${selected(detail === 'g:' + groupId)}>${groupName}</option>`)}
        </optgroup>
        <optgroup label="Skill" data-for="train">
            ${[...options.skills].map(([skillId, skillName]) => html`
                <option value="s:${skillId}" ${selected(detail === 's:' + skillId)}>${skillName}</option>`)}
        </optgroup>
        <optgroup label="Occupation" data-for="work">
            ${occupations.filter((occupation) => !(learned !== null && !learned.includes(int(occupation.skill_id)))).map((occupation) => html`
                <option value="o:${occupation.id}" ${selected(detail === 'o:' + occupation.id)}>${occupation.title} (${occupation.skill})</option>`)}
        </optgroup>
        ${learned !== null ? html`
            <optgroup label="Needs training first" data-for="work">
                ${occupations.filter((occupation) => !learned.includes(int(occupation.skill_id))).map((occupation) => html`
                    <option value="o:${occupation.id}" ${selected(detail === 'o:' + occupation.id)}>${occupation.title} (train at ${occupation.skill} first)</option>`)}
            </optgroup>` : ''}
        <optgroup label="Clear land" data-for="work">
            <option value="c:wilds" ${selected(detail === 'c:wilds')}>Clear land in the wilds</option>
            ${[...options.places].map(([partId, place]) => html`
                <option value="c:${partId}" ${selected(detail === 'c:' + partId)}>Clear land in ${place}</option>`)}
        </optgroup>
        <optgroup label="Build" data-for="work">
            ${options.sites.map((site) => html`
                <option value="b:${site.id}" ${selected(detail === 'b:' + site.id)}>
                    Build the ${site.name} on lot #${site.parcel_id} (${site.progress}/${site.days} days)
                </option>`)}
        </optgroup>
        <optgroup label="Forage" data-for="work">
            <option value="f" ${selected(detail === 'f')}>Forage for food</option>
        </optgroup>
    </select>
</div>`;
}
