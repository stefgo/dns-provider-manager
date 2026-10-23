import { useState } from "react";
import { useToast } from "@stefgo/react-ui-components";
import { readAllProviders } from "../queries/providers";
import { describeFailure, plural } from "../utils";

/**
 * "Read Now" for every provider: reads them all, says which could not be read, and whether
 * the request is still running. What the readings found arrives through the socket.
 */
export function useReadAllProviders(): { readAll: () => Promise<void>; reading: boolean } {
    const [reading, setReading] = useState(false);
    const { show } = useToast();

    const readAll = async () => {
        setReading(true);
        try {
            const result = await readAllProviders();
            if (result.failed) {
                show({ variant: "warning", title: `${plural(result.failed, "provider")} could not be read`, duration: 0 });
            }
        } catch (err) {
            show({ variant: "error", ...describeFailure("Could not read the providers", err), duration: 0 });
        } finally {
            setReading(false);
        }
    };

    return { readAll, reading };
}
