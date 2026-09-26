// Upstream: game/views/assets/anthro-option.blade.php
import { disabled, html, selected, type Html } from '../../../core/html';
import { empty } from '../../../core/php';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Anthros } from '../../Anthros';
import { Played } from '../../Played';

/**
 * Breeding list entry. Only the player sees that an anthro is theirs; admins find who plays it in the admin panel
 * (see Played).
 * blocker (optional) is why breeding it in this role would give no litter; it can still be chosen (the attempt is
 * recorded), except while it's up for auction, unless forced.
 */
export default function anthroOption(v: ViewContext, { anthro, selectedId, blocker = null, forced = null }: {
    anthro: Row; selectedId: number | null; blocker?: string | null; forced?: unknown;
}): Html {
    Played.note(anthro.id, anthro.name, anthro.player_id);
    return html`<option value="${anthro.id}" ${selected(anthro.id === selectedId)} ${disabled(anthro.auction_id !== null && empty(forced))}>
    ${anthro.name}${anthro.player_id === v.user!.id ? ' (you)' : ''}
    (${anthro.gender} ${anthro.species ?? 'no species'}, ${Anthros.age(anthro.birthdate)})${blocker ? html` &mdash; ${blocker === 'up for auction' ? blocker : 'no litter: ' + blocker}` : ''}
</option>`;
}
