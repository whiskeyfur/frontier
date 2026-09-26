// Upstream: src/Docs.php
//
// Here only the game's docs are ported (game/views/knowledge-base.md and changes.md): the site's own (and its privacy
// policy) and Gurps's aren't part of this port, so the site's Docs menu (upstream's PAGES and SUBPAGES) isn't either.
// render() takes the Markdown itself rather than a file's path: the files are bundled into the page (`?raw` imports).
import { Auth } from '../core/Auth';
import type { Row } from '../db/Db';
import { renderMarkdown } from './markdown';

/** A heading in a rendered doc's contents list. */
export type DocsEntry = { id: string; text: string; level: number };

/** PHP 8's strtolower(): ASCII letters only. */
function strtolower(s: string): string {
    return s.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rarr: '→', larr: '←', hellip: '…', times: '×', middot: '·' };

/** html_entity_decode($s, ENT_QUOTES | ENT_HTML5), for the entities Markdown's output has. */
function htmlEntityDecode(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] === '#') {
            const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return String.fromCodePoint(code);
        }
        return ENTITIES[name] ?? whole;
    });
}

/**
 * Each part of the site's documentation: a Knowledge Base (how it works) and Changes (what's changed), kept as Markdown
 * beside that part's templates (views/docs for the site, game/views for Frontier, gurps/views/docs for Gurps) and
 * scoped to it alone. Each part has a Docs menu for them; the site's is here.
 */
export class Docs {
    // Who a passage is for, marked in the Markdown by lines "[[only: admin]]" (or several: "[[only: player, gurps]]")
    // and "[[/only]]" around it. Admins see every passage; roles are only ever mentioned inside [[only: admin]].
    static readonly AUDIENCES = ['admin', 'editor', 'player', 'gurps', 'gm'];

    /**
     * Markdown rendered for user (null: someone logged out): [html, contents], the passages they aren't among the
     * audience of left out (see AUDIENCES), its h2 and h3 headings given ids from their text, for links to them, and
     * the contents [{id, text, level (2 or 3)}, ...] in order.
     */
    static render(markdown: string, user: Row | null = null): [string, DocsEntry[]] {
        return Docs.withContents(renderMarkdown(Docs.forReader(markdown, user)));
    }

    /**
     * Markdown with the passages user isn't among the audience of taken out (see AUDIENCES). Passages can nest.
     */
    static forReader(markdown: string, user: Row | null): string {
        // Upstream's Auth::isEditor, isGurps and isGurpsGm: roles this port's account doesn't have, read from its roles.
        const roles: string[] = user?.roles ?? [];
        const is: Record<string, boolean> = {
            admin: Auth.isAdmin(user), editor: roles.includes('editor'), player: Auth.isPlayer(user),
            gurps: roles.includes('gurps') || roles.includes('gurps-gm'), gm: roles.includes('gurps-gm'),
        };
        const shown = [true];
        const kept: string[] = [];
        for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
            const m = line.match(/^\[\[only:\s*([a-z, -]+)\]\]\s*$/);
            if (m) {
                const forWhom = m[1].split(',').map((a) => a.trim());
                shown.push(shown[shown.length - 1] && (is.admin || forWhom.some((audience) => !!is[audience])));
                continue;
            }
            if (/^\[\[\/only\]\]\s*$/.test(line) && shown.length > 1) {
                shown.pop();
                continue;
            }
            if (shown[shown.length - 1]) {
                kept.push(line);
            }
        }
        return kept.join('\n');
    }

    static withContents(html: string): [string, DocsEntry[]] {
        const contents: DocsEntry[] = [];
        const used: Record<string, number> = Object.create(null);
        html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_whole, level: string, inner: string) => {
            const text = htmlEntityDecode(inner.replace(/<[^>]*>/g, ''));
            let id = strtolower(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
            id = used[id] !== undefined ? id + '-' + ++used[id] : id;
            used[id] ??= 1;
            contents.push({ id, text, level: Number(level) });
            return '<h' + level + ' id="' + id + '">' + inner + '</h' + level + '>';
        });
        return [html, contents];
    }
}
