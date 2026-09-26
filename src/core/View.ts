/**
 * What every template can see (Blade's shared view data and its stacks). App.render makes one per page and hands it
 * to the view function, which hands it on to the views it includes and to the layout.
 */
import type { User } from './Auth';
import { Html, print, raw, type Printable } from './html';

export class ViewContext {
    private stacks = new Map<string, string[]>();
    title = '';

    constructor(
        /** The logged-in user. */
        public readonly user: User | null,
        /** The page's path (upstream templates read it from $_SERVER['REQUEST_URI']). */
        public readonly path: string,
        /** The flash message: a string, or lines (the first a heading). */
        public readonly flash: string | string[] | null = null,
        /** Unread notifications, for the bell. */
        public readonly unread: number = 0,
        public readonly csrf: string = 'local',
    ) {}

    /** Blade's @push: adds to a stack, printing nothing where it stands. */
    push(name: string, content: Printable): Html {
        const list = this.stacks.get(name) ?? [];
        list.push(print(content));
        this.stacks.set(name, list);
        return raw('');
    }

    /** Blade's @stack: everything pushed to a stack so far. */
    stack(name: string): Html {
        return raw((this.stacks.get(name) ?? []).join('\n'));
    }
}

/** A template: the view context and its data in, HTML out. */
export type View<T = any> = (v: ViewContext, data: T) => Html;
