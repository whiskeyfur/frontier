// Upstream: game/views/assets/gender.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';

/** Gender symbol by how the gender presents; the gender's name shows on hover. */
export default function gender(_v: ViewContext, { gender, presentsAs }: { gender: string; presentsAs: string | null }): Html {
    const symbol = ({ male: ['♂', 'text-info'], female: ['♀', 'text-danger-emphasis'] } as Record<string, string[]>)[presentsAs ?? ''] ?? ['⚥', 'text-warning'];
    return html`<span title="${gender}" class="${symbol[1]}">${symbol[0]}</span>`;
}
