/**
 * `@adgate/sdk/ai`: the Vercel AI SDK entry. Separate from the core client entry, because it
 * imports the `ai` package (an optional peer dependency) for its middleware types.
 */
export { ADGATE_METADATA_KEY, adgateMiddleware } from './middleware.js';
export type {
  AdgateCallParams,
  AdgateMiddlewareOptions,
  AdgateProviderMetadata,
  AdgateSurfaceType,
  AdgateUser,
} from './middleware.js';
