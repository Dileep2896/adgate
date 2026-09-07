# @adgateio/sdk

## 0.1.0

### Minor Changes

- First release of the adgate client packages.
  
  `@adgateio/schemas` is the contract from `docs/api.md`, `docs/policy.md` and `docs/audit.md` as Zod
  schemas plus the generated JSON Schema files: evaluate, attest, events, the policy configuration
  and overrides, the signed audit record and the verification result.
  
  `@adgateio/sdk` is the client for Node 20 and browsers — `evaluate`, `attest`, `track` and the
  generation helpers, never throwing and failing closed to `suppress` — with two optional entries:
  `@adgateio/sdk/react` for the labelled `SponsoredSlot` block that can never render inside model
  output, and `@adgateio/sdk/ai` for the Vercel AI SDK middleware.

### Patch Changes

- Updated dependencies
  - @adgateio/schemas@0.1.0
