import { useEffect, useState } from "react";

/**
 * `value` once it has stood still for `ms` -- for a request that follows what is typed, so
 * it goes out when the typing pauses rather than at every key.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
}
