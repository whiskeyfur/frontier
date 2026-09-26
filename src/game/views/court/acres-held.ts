// Upstream: game/views/court/acres-held.blade.php
import { html, type Html } from '../../../core/html';
import type { ViewContext } from '../../../core/View';
import type { Row } from '../../../db/Db';
import { Land } from '../../Land';
import { Ranks } from '../../Ranks';

// The land counting toward the player's rank: theirs, and that of everyone sworn to them (see Ranks::acresHeld).
export default function acresHeld(_v: ViewContext, { player }: { player: Row }): Html {
    const held = Ranks.acresHeld(player);
    return html`You hold ${Land.acres(held.total)}${held.sworn > 0 ? html` (${Land.acres(held.own)} yours, ${Land.acres(held.sworn)} of your household and those sworn to you)` : ''}:
`;
}
