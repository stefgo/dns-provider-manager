/**
 * A request a service refuses, with the HTTP status that says why: 400 for what the input
 * cannot be, 404 for what is not there, 409 for what clashes with what is stored. The
 * controller answers with it; anything else a service throws is a 500.
 */
export class RequestError extends Error {
    constructor(
        readonly status: 400 | 404 | 409,
        message: string,
    ) {
        super(message);
        this.name = "RequestError";
    }
}
