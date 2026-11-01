import type { ConfigArea } from "@dpm/shared";

/**
 * How one area of a provider's configuration is kept the same on the nodes of a cluster: read
 * from each, brought into a form two providers can be compared in, and written to a copy as
 * the steps that turn what it holds into what the primary holds.
 *
 * `Api` is how the provider is reached, `State` the area in comparable form, `Step` one change
 * at a copy. Only `read` and `apply` talk to the provider; the rest is pure and tested against
 * recorded answers. Each method that talks to the provider throws an `Error` whose message
 * says in a sentence why it failed.
 */
export interface ConfigAreaSync<Api, State, Step> {
    readonly area: ConfigArea;
    /** The oldest version of the provider the area can be read and written on; null for any. */
    readonly minVersion: string | null;
    /** What the provider answers for the area, as it answers it. */
    read(api: Api): Promise<unknown>;
    /**
     * The area in comparable form: without what differs from one provider to the next for the
     * same configuration -- its own ids, counters, times -- and with every set in one order,
     * so that two providers that hold the same hold equal states, and equal hashes.
     */
    normalise(raw: unknown): State;
    /** The steps that turn `current` into `target`, in the order they are to be written; none when equal. */
    diff(target: State, current: State): Step[];
    /** Writes `steps` in their order; stops at the first that fails, by throwing. */
    apply(api: Api, steps: readonly Step[]): Promise<void>;
    /** One step in a sentence, for the activity and the preview: `Client "TV" added`. */
    describe(step: Step): string;
}
