/** The work last queued per provider; it settles once everything queued for it has run. */
const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `work` once everything queued for the same provider before it has finished, and
 * answers what it answers. One provider is read or written by one thing at a time -- a
 * reading never sees half of a change, and two changes never cross -- while different
 * providers go ahead side by side.
 */
export function queueFor<T>(providerId: string, work: () => Promise<T>): Promise<T> {
    const before = tails.get(providerId) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.then(
        () => undefined,
        () => undefined,
    );
    tails.set(providerId, tail);
    void tail.then(() => {
        if (tails.get(providerId) === tail) tails.delete(providerId);
    });
    return run;
}
