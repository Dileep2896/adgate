# Decisions (ADR style, short)

1. Single service, Postgres only. Reason: one founder, one deploy target, fewer moving parts. Revisit at 500 req/s.
2. Fail closed everywhere. Reason: an ad that should not have shown is far worse than a missing ad.
3. Ads only after the answer, in a separate block. Reason: regulatory disclosure expectations and user trust. Not negotiable in v1.
4. Classifier is rules first, LLM second, cached. Reason: sensitive detection must be cheap and reliable; LLM adds nuance for commercial intent.
5. No auction in v1. Rank by ecpm_estimate * targeting_match. Reason: we have at most three demand sources.
6. Affiliate links use the app owner's own accounts. Reason: no payout infrastructure needed in v1; developers keep commissions.
7. Signed hash chain per app instead of a global chain. Reason: simple, parallelizable, sufficient for per-advertiser verification.
8. Open source under Apache 2.0. Reason: distribution to indie apps and coding agents; the hosted verification reports are the business.
9. Python SDK is a thin HTTP client generated from JSON Schema. Reason: one source of truth, no logic drift.
10. Koah and Gravity adapters are stubs until partner API access exists. Reason: do not build against guessed request shapes.
