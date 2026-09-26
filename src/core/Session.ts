/**
 * The session (upstream's $_SESSION): who's logged in, and the flash message for the next page. It lives in the
 * worker's memory, so it lasts until the page is closed.
 */
export const Session = {
    data: {} as Record<string, any>,

    /** Takes the flash message (a string, or a list of lines), clearing it. */
    takeFlash(): string | string[] | null {
        const flash = Session.data.flash ?? null;
        delete Session.data.flash;
        return flash;
    },

    reset(): void {
        Session.data = {};
    },
};
