// Upstream: game/views/knowledge-base.blade.php
import { html, type Html } from '../../core/html';
import type { ViewContext } from '../../core/View';
import knowledgeBaseBody from '../../site/views/docs/knowledge-base-body';
import type { DocsEntry } from '../../site/Docs';
import gameLayout from './layouts/game';
import subnav from './subnav';

export default function knowledgeBase(v: ViewContext, { html: body, contents }: { html: string; contents: DocsEntry[] }): Html {
    return gameLayout(v, {
        title: 'Knowledge Base - Game',
        content: html`
    ${subnav(v, { section: '/game/docs' })}
    <h1 class="h3 mb-3">Frontier Knowledge Base</h1>
    ${knowledgeBaseBody(v, { html: body, contents })}`,
    });
}
