import { useState } from "react";
import { useToast } from "@stefgo/react-ui-components";
import { readAllProviders } from "../queries/providers";
import { readAllOutcome } from "../lib/readOutcome";
import { describeFailure } from "../utils";

/**
 * "Read Now" for every provider: reads them all, says in a toast how many were read and how
 * many could not be, and whether the request is still running. What the readings found
 * arrives through the socket.
 */
export function useReadAllProviders(): { readAll: () => Promise<void>; reading: boolean } {
    const [reading, setReading] = useState(false);
    const { show } = useToast();

    const readAll = async () => {
        setReading(true);
        try {
            show(readAllOutcome(await readAllProviders()));
        } catch (err) {
            show({ variant: "error", ...describeFailure("Could not read the providers", err), duration: 0 });
        } finally {
            setReading(false);
        }
    };

    return { readAll, reading };
}
