// Upstream: game/views/court/noble.blade.php
import { html, type Html } from '../../../core/html';
import { int } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { CourtNode } from '../../Ranks';
import { Ranks } from '../../Ranks';

export default function noble(_v: ViewContext, { node, commoners }: { node: CourtNode; commoners: string }): Html {
    return html`<span class="text-body-secondary">${Ranks.name(int(node.rank), node.presents_as)}</span>
<a href="/game/assets/${node.id}">${node.name}</a>
${node.commoners ? html`
    <span class="badge text-bg-secondary" title="Commoners sworn to ${node.name}">${commoners}</span>` : ''}
${node.owned ? html`
    <span class="badge text-bg-dark border" title="Anthros ${node.name} owns, sworn to them">${node.owned} owned</span>` : ''}
`;
}
