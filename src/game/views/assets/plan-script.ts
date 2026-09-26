// Upstream: game/views/assets/plan-script.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';

// The "with whom, or what" choices follow the activity: partners and groups to breed, skills to train.
export default function planScript(_v: ViewContext, _data: Record<string, never> = {}): Html {
    return html`<script>
    document.querySelectorAll('[data-plan]').forEach((plan) => {
        const activity = plan.querySelector('[data-plan-activity]');
        const detail = plan.querySelector('[data-plan-detail]');
        const update = () => {
            const needs = activity.value !== 'rest';
            detail.hidden = !needs;
            detail.disabled = !needs;
            detail.querySelectorAll('optgroup').forEach((group) => {
                group.hidden = group.disabled = !group.dataset.for.split(' ').includes(activity.value);
            });
            if (detail.selectedOptions[0]?.parentElement?.disabled) {
                detail.value = '';
            }
        };
        activity.addEventListener('change', update);
        update();
    });
</script>`;
}
