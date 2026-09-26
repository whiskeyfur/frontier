// Upstream: game/views/assets/anthro-link.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import { Anthros } from '../../Anthros';
import { Played } from '../../Played';

/**
 * An anthro's name: a link if the viewer may open it (they play it or the anthro that owns it, or they're an admin),
 * otherwise the name and its owner. ownerPlayerId is the user playing the owning anthro (for access checks only).
 * playerId is set when a player plays the anthro: only that player sees it ("you"); admins find who plays it in the
 * admin panel (see Played), so it never shows in the page.
 */
export default function anthroLink(v: ViewContext, { id, name, ownerPlayerId, ownerName = null, playerId = null }: {
    id: number | null; name: string | null; ownerPlayerId: number | null; ownerName?: string | null; playerId?: number | null;
}): Html {
    const user = v.user!;
    if (id) {
        Played.note(id, name ?? '', playerId);
    }
    if (!id) {
        return html`<span class="text-body-secondary">&mdash;</span>`;
    }
    if (Anthros.canView(user, ownerPlayerId, playerId)) {
        return html`<a href="/game/assets/${id}">${name}</a>
    ${playerId !== null && playerId === user.id ? html`<span class="text-body-secondary small">(you)</span>` : ''}
    ${ownerPlayerId !== user.id ? html`<span class="text-body-secondary small">(${ownerName ?? 'free'})</span>` : ''}`;
    }
    return html`${name} <span class="text-body-secondary small">(${ownerName !== null ? 'owned by ' + ownerName : 'free'})</span>`;
}
