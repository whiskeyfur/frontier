// Upstream: game/views/court/lands-node.blade.php
import { html, type Html } from '../../../core/html';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';
import baronyLine from './barony-line';

// A lord in the realm's land tree: the baronies they hold directly, then the lords below them that hold baronies
// (so everything under a lord is held by them, directly or through their vassals). Folded below dukes.
export default function landsNode(v: ViewContext, { node }: { node: Row }): Html {
    return html`<li class="mb-1">
    <details ${node.rank >= 8 ? 'open' : ''}>
        <summary>
            <span class="text-body-secondary">${Ranks.name(int(node.rank), node.presents_as)}</span>
            <a href="/game/assets/${node.id}">${node.name}</a>
            <span class="text-body-secondary small">
                &middot; ${node.branch.baronies} ${node.branch.baronies === 1 ? 'barony' : 'baronies'}
                ${node.baronies.length && node.children.length ? html`
                    (${node.baronies.length} directly)` : ''}
                &middot; ${Land.acres(node.branch.acres)}
            </span>
        </summary>
        <ul class="list-unstyled ms-4 mt-1 border-start ps-3">
            ${node.baronies.map((barony: Row) => html`
                <li class="mb-1">${baronyLine(v, { barony })}</li>`)}
            ${node.children.map((child: Row) => landsNode(v, { node: child }))}
        </ul>
    </details>
</li>
`;
}
