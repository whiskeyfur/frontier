/**
 * The scripts in upstream's game layout (game/views/layouts/game.blade.php), which fetched JSON from the server:
 * here they ask the worker. They listen on the document once, for every page.
 */
import type { RequestInit, Response } from '../core/http';

type Ask = (init: RequestInit) => Promise<Response>;

async function getJson(ask: Ask, url: string): Promise<any> {
    const response = await ask({ method: 'GET', url });
    return response.kind === 'json' ? response.body : null;
}

export function installLayoutScripts(ask: Ask): void {
    // "Random" buttons next to name fields (game::assets.name-input).
    document.addEventListener('click', async (event) => {
        const button = (event.target as Element).closest?.('[data-random-name]') as HTMLButtonElement | null;
        if (!button) return;
        const input = document.getElementById(button.dataset.randomName!) as HTMLInputElement;
        // form.elements[...].value works for a <select> and for a group of radio buttons.
        const gender = button.dataset.genderField ? (button.form?.elements.namedItem(button.dataset.genderField) as HTMLInputElement | null)?.value : null;
        button.disabled = true;
        try {
            const url = '/game/names/random' + (gender ? '?gender=' + encodeURIComponent(gender) : '');
            const body = await getJson(ask, url);
            if (body) {
                input.value = body.name;
                input.focus();
            }
        } finally {
            button.disabled = false;
        }
    });

    // Anthro name fields: <input data-anthro-search list="..."> gets "Name (#id)" suggestions as you type, from
    // /game/anthros/search (there are far too many anthros to list them all in the page).
    const timers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();
    const asked = new WeakMap<HTMLInputElement, string>();
    document.addEventListener('input', (event) => {
        const input = event.target as HTMLInputElement;
        if (!input.matches?.('input[data-anthro-search]')) return;
        const list = input.list;
        clearTimeout(timers.get(input));
        const q = input.value.trim();
        if (q === '' || q === asked.get(input) || !list) return;
        timers.set(input, setTimeout(async () => {
            asked.set(input, q);
            const body = await getJson(ask, '/game/anthros/search?q=' + encodeURIComponent(q));
            if (!Array.isArray(body) || input.value.trim() !== q) return;
            list.replaceChildren(...body.map((anthro: { label: string }) => Object.assign(document.createElement('option'), { value: anthro.label })));
        }, 150));
    });
}
