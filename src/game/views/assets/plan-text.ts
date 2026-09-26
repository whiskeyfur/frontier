// Upstream: game/views/assets/plan-text.blade.php
import { html, type Html } from '../../../core/html';
import { empty, ucfirst } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Schedules } from '../../Schedules';

// A day's plan in words.
export default function planText(_v: ViewContext, { plan }: { plan: Row }): Html {
    switch (plan.activity) {
        case 'birthing':
            return html`<strong>Birthing</strong>`;
        case 'breed':
            return html`Breed with ${plan.group_id ? 'a member of ' + (plan.group_name ?? 'a breeding group') : (plan.partner_name ?? 'a partner who is gone')}`;
        case 'train':
            if (plan.mentor_name) {
                return html`Learn ${plan.skill_name} from ${plan.mentor_name}`;
            }
            return html`Train: ${plan.skill_name ?? 'a skill that is gone'}`;
        case 'work':
            return html`Work as ${plan.occupation_title ?? 'an occupation that is gone'}${!empty(plan.recipe_name) ? ': ' + plan.recipe_name : ''}${plan.occupation_skill != null ? ' (' + plan.occupation_skill + ')' : ''}`;
        case 'clear':
            return html`Clear land in ${plan.part_id ? (plan.part_name ?? 'an expanse') : 'the wilds'}`;
        case 'build':
            return html`Build ${plan.building_name ? 'the ' + plan.building_name + ' on lot #' + plan.building_lot : 'a building that is gone'}`;
        case 'forage':
            return html`Forage`;
        default:
            return html`${Schedules.LABELS[plan.activity] ?? ucfirst(plan.activity)}`;
    }
}
