/**
 * The largest request body any route reads (256 KiB; an EvaluateRequest with four 4,000 code
 * point messages is under 20 KiB). Larger bodies are 413 payload_too_large before a route runs
 * (app.ts mounts hono's bodyLimit with it). Lives apart from app.ts so openapi/paths.ts can
 * quote it without a cycle. S36 (load and abuse) confirms or tunes the figure.
 */
export const BODY_LIMIT_BYTES = 256 * 1024;
