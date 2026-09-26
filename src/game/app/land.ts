// Upstream: game/src/App.php (reshapeLand)
import type { User } from '../../core/Auth';
import { field, fieldList } from '../../core/http';
import { Session } from '../../core/Session';
import { int } from '../../core/php';
import type { App } from '../App';
import { Land } from '../Land';

/**
 * Splits a parcel ("parcel_id", "lots" to split off) or merges the ticked parcels ("ids"), setting the flash.
 * Returns an error message, or null.
 */
export function reshapeLand(app: App, user: User, action: string): string | null {
    if (action === 'split') {
        const [id, error] = Land.split(user, int(field(app.post, 'parcel_id', '0')), field(app.post, 'acres'));
        Session.data.flash = error ? null : `Split off lot #${id}.`;
        return error;
    }
    if (action === 'merge') {
        const [id, error] = Land.merge(user, fieldList(app.post, 'ids'));
        Session.data.flash = error ? null : `Merged into lot #${id}.`;
        return error;
    }
    return 'Unknown action.';
}
