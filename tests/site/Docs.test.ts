// Upstream: tests/Site/NavTest.php (testTheSiteHasItsOwnDocs: the parts about the game's docs and the Docs renderer).
// The site's own docs, its privacy policy and Gurps's aren't part of this port, so their assertions aren't either.
import { describe, expect, test } from 'vitest';
import { Docs } from '../../src/site/Docs';
import changesMd from '../../src/game/views/changes.md?raw';
import knowledgeBaseMd from '../../src/game/views/knowledge-base.md?raw';
import { get } from '../AppHarness';
import { player } from '../TestCase';

describe('Docs', () => {
    test('the game has its own docs', () => {
        // Frontier's menu is its own: its Docs, not the site's.
        const home = get('/game/home', player('alice'));
        expect(home).not.toContain('href="/docs/');
        expect(home).toMatch(/nav-link dropdown-toggle" href="\/game\/docs"[^>]*>Docs<\/a>/);
        expect(home).toContain('href="/game/docs/knowledge-base"');
        expect(home).toContain('href="/game/docs/changes"');

        // Its docs render, with a contents list linking to every section.
        expect(changesMd.length).toBeGreaterThan(0);
        const [html, contents] = Docs.render(knowledgeBaseMd);
        expect(contents.length).toBeGreaterThan(10);
        const ids = contents.map((c) => c.id);
        expect(ids, 'Ids are unique.').toEqual([...new Set(ids)]);
        for (const id of ids) {
            expect(html).toContain('id="' + id + '"');
        }
        const page = get('/game/docs/knowledge-base', player('bobby'));
        expect(page).toContain('Frontier Knowledge Base');
        expect(page).toMatch(/class="nav-link px-3 py-2 active" href="\/game\/docs\/knowledge-base"/);
        expect(page).toContain('href="#' + contents[0].id + '"');

        expect(Docs.withContents('<h2>A &amp; B</h2><p>x</p><h3>A &amp; B</h3>')[1])
            .toEqual([{ id: 'a-b', text: 'A & B', level: 2 }, { id: 'a-b-2', text: 'A & B', level: 3 }]);
        expect(Docs.forReader('a\n[[only: gm]]\nb\n[[/only]]\nc\n[[only: gurps, gm]]\n[[only: admin]]\nd\n[[/only]]\ne\n[[/only]]', { id: 1, roles: ['gurps'] }),
            'Nested: gurps sees the gurps passage, but not the admin one inside it.').toBe('a\nc\ne');
    });

    // Not upstream: who sees what in the game's Knowledge Base, and the old address of Changes.
    test('passages for a role', () => {
        const kb = 'a\n[[only: admin]]\nb\n[[/only]]\n[[only: player]]\nc\n[[/only]]';
        expect(Docs.forReader(kb, null)).toBe('a');
        expect(Docs.forReader(kb, { id: 1, roles: ['player'] })).toBe('a\nc');
        expect(Docs.forReader(kb, { id: 1, roles: ['admin'] })).toBe('a\nb\nc');
        const alice = player('alice');
        expect(get('/game/docs/changes', alice)).toContain("What's changed in Frontier");
    });
});
