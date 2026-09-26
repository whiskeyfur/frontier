/**
 * Markdown to HTML, as upstream's Pages::render does it (league/commonmark's GitHub-flavoured Markdown, with raw
 * HTML in the source escaped and unsafe links dropped).
 */
import { Marked } from 'marked';

const marked = new Marked({
    gfm: true,
    renderer: {
        // Raw HTML in the Markdown is shown as text ('html_input' => 'escape').
        html(token: string | { text: string }) {
            return escapeHtml(typeof token === 'string' ? token : token.text);
        },
    },
    walkTokens(token) {
        // 'allow_unsafe_links' => false: javascript:, vbscript:, file: and data: (other than images) links go.
        if ((token.type === 'link' || token.type === 'image') && /^\s*(javascript|vbscript|file|data):/i.test(token.href)
            && !(token.type === 'image' && /^\s*data:image\/(png|gif|jpeg|webp);/i.test(token.href))) {
            token.href = '';
        }
    },
});

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMarkdown(markdown: string): string {
    return marked.parse(markdown, { async: false }) as string;
}
