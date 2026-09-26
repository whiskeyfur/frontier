/**
 * HTML templates in place of Blade. A template is a function returning html`...`: values in ${} are escaped as
 * Blade's {{ }} escapes them, unless they're already Html (another template, or raw() for Blade's {!! !!}).
 *
 *   Blade                                   here
 *   {{ $x }}                                ${x}
 *   {!! $x !!}                              ${raw(x)}
 *   @if(c) A @else B @endif                 ${c ? html`A` : html`B`}
 *   @foreach($list as $x) ... @endforeach   ${list.map((x) => html`...`)}
 *   @include('view', [...])                 ${view(v, {...})}
 *   @class(['a', 'b' => $c])                class="${cls('a', { b: c })}"
 *   @selected($c) @checked($c) @disabled($c) ${selected(c)} ${checked(c)} ${disabled(c)}
 *   @json($x)                               ${json(x)}
 *   @push('admin') ... @endpush             ${v.push('admin', html`...`)}   (renders nothing where it stands)
 *   @stack('admin')                         ${v.stack('admin')}
 *   @once ... @endonce                      ${v.once('the/template') ? html`...` : ''}
 *
 * Arrays are joined; null, undefined and false print nothing; true prints 1 (as in PHP).
 */
export class Html {
    constructor(public readonly value: string) {}

    toString(): string {
        return this.value;
    }
}

export type Printable = Html | string | number | boolean | null | undefined | Printable[];

/** Blade's e(): htmlspecialchars with ENT_QUOTES. */
export function e(value: unknown): string {
    if (value === null || value === undefined || value === false) return '';
    if (value === true) return '1';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Anything printable as HTML text (escaped unless it's Html). */
export function print(value: unknown): string {
    if (value instanceof Html) return value.value;
    if (Array.isArray(value)) return value.map(print).join('');
    return e(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += print(values[i]) + strings[i + 1];
    return new Html(out);
}

/** Trusted HTML, printed as it is (Blade's {!! !!}). */
export function raw(value: unknown): Html {
    return new Html(value === null || value === undefined ? '' : value instanceof Html ? value.value : String(value));
}

/** Blade's @class: the names whose condition holds, space-separated. */
export function cls(...parts: (string | Record<string, unknown> | null | undefined | false)[]): string {
    const names: string[] = [];
    for (const part of parts) {
        if (!part) continue;
        if (typeof part === 'string') names.push(part);
        else for (const [name, on] of Object.entries(part)) if (on) names.push(name);
    }
    return names.join(' ');
}

export const selected = (on: unknown) => raw(on ? 'selected' : '');
export const checked = (on: unknown) => raw(on ? 'checked' : '');
export const disabled = (on: unknown) => raw(on ? 'disabled' : '');
export const readonly = (on: unknown) => raw(on ? 'readonly' : '');
export const required = (on: unknown) => raw(on ? 'required' : '');

/** Blade's @json: JSON safe to put in a <script> or an attribute. */
export function json(value: unknown): Html {
    return raw(JSON.stringify(value ?? null)
        .replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026').replace(/'/g, '\\u0027'));
}

/** Joins pieces of HTML with a separator (HTML or text). */
export function join(parts: Printable[], separator: Printable = ''): Html {
    return raw(parts.map(print).join(print(separator)));
}
