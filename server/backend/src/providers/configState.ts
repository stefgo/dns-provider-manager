import crypto from "node:crypto";

/**
 * JSON with the keys of every object in one order, so that two equal states are written
 * alike however they were built. Arrays keep their order: where order does not matter, the
 * area's `normalise` has sorted them already.
 */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
                .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}

/** The hash a state is compared and remembered by: SHA-256 of its canonical JSON, in hex. */
export function stateHash(state: unknown): string {
    return crypto.createHash("sha256").update(canonicalJson(state)).digest("hex");
}

/** Whether two states, or two parts of one, are equal, whatever order their keys were built in. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
    return canonicalJson(a) === canonicalJson(b);
}

/**
 * Which keys a state has, object by object. An array's elements share one shape; `null`
 * says nothing -- a value that is no object, or an array without elements.
 */
export type Shape = { kind: "object"; keys: Map<string, Shape | null> } | { kind: "array"; element: Shape | null };

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function shapeOf(value: unknown): Shape | null {
    if (Array.isArray(value)) return { kind: "array", element: value.map(shapeOf).reduce<Shape | null>((a, b) => intersect(a, b), null) };
    if (isPlainObject(value)) return { kind: "object", keys: new Map(Object.entries(value).map(([key, child]) => [key, shapeOf(child)])) };
    return null;
}

/** The keys both shapes have; a shape that says nothing leaves the other as it is. */
function intersect(a: Shape | null, b: Shape | null): Shape | null {
    if (a === null) return b;
    if (b === null) return a;
    if (a.kind === "array" && b.kind === "array") return { kind: "array", element: intersect(a.element, b.element) };
    if (a.kind === "object" && b.kind === "object") {
        const keys = new Map<string, Shape | null>();
        for (const [key, shape] of a.keys) if (b.keys.has(key)) keys.set(key, intersect(shape, b.keys.get(key)!));
        return { kind: "object", keys };
    }
    return null;
}

/**
 * The keys every one of `states` has. Instances of different versions know different fields
 * -- an older one has no `fallback_dns`, no Ecosia in Safe Search -- and a field one of them
 * does not know cannot be kept the same: the states are compared, and hashed, without it.
 * A list without elements (no clients yet) says nothing about the fields of its elements.
 */
export function commonShape(states: readonly unknown[]): Shape | null {
    return states.map(shapeOf).reduce<Shape | null>((a, b) => (a === null ? b : b === null ? a : intersect(a, b)), null);
}

/** `state` with only the keys `shape` names. */
export function project<T>(state: T, shape: Shape | null): T {
    return projectValue(state, shape) as T;
}

function projectValue(value: unknown, shape: Shape | null): unknown {
    if (shape === null) return value;
    if (shape.kind === "array" && Array.isArray(value)) return value.map((element) => projectValue(element, shape.element));
    if (shape.kind === "object" && isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => shape.keys.has(key))
                .map(([key, child]) => [key, projectValue(child, shape.keys.get(key)!)]),
        );
    }
    return value;
}
