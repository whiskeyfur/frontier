// Upstream: game/views/court/node.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { CourtNode } from '../../Ranks';
import noble from './noble';

// One title holder in the court structure, with the title holders sworn to them below. Branches below dukes start folded.
export default function node(v: ViewContext, { node: n }: { node: CourtNode }): Html {
    const commoners = n.commoners === 1 ? '1 commoner' : n.commoners + ' commoners';
    return html`<li class="mb-1">
    ${n.children.length ? html`
        <details ${n.rank >= 8 ? 'open' : ''}>
            <summary>
                ${noble(v, { node: n, commoners })}
                <span class="text-body-secondary small">
                    &middot; ${n.children.length} sworn below
                    ${n.branchCommoners ? html`
                        &middot; ${n.branchCommoners} ${n.branchCommoners === 1 ? 'commoner' : 'commoners'} in this branch` : ''}
                </span>
            </summary>
            <ul class="list-unstyled ms-4 mt-1 border-start ps-3">
                ${n.children.map((child) => node(v, { node: child }))}
            </ul>
        </details>` : html`
        ${noble(v, { node: n, commoners })}`}
</li>
`;
}
