# This file is GENERATED. Do not edit it by hand.
#
# Source:  packages/schemas/json/*.schema.json (the Zod contract in packages/schemas)
# Command: python -m scripts.generate_models
#
# pydantic v2 models for the adgate API contract (docs/api.md). Regenerate after any
# schema change; tests/test_models_generated.py fails while this file is stale.

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class AdvertiserDomain(RootModel[str]):
    root: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    Advertiser domain, e.g. example.com.
    """


class AffiliateNetwork(str, Enum):
    """
    Affiliate network used by an affiliate demand entry.
    """

    partnerstack = 'partnerstack'
    impact = 'impact'
    amazon = 'amazon'


class AmazonMarketplace(str, Enum):
    """
    When set, templates must point at this storefront (tags are storefront-specific).
    """

    com = 'com'
    ca = 'ca'
    com_mx = 'com.mx'
    com_br = 'com.br'
    co_uk = 'co.uk'
    de = 'de'
    fr = 'fr'
    es = 'es'
    it = 'it'
    nl = 'nl'
    se = 'se'
    pl = 'pl'
    com_be = 'com.be'
    com_tr = 'com.tr'
    ae = 'ae'
    sa = 'sa'
    eg = 'eg'
    in_ = 'in'
    sg = 'sg'
    co_jp = 'co.jp'
    com_au = 'com.au'


class DisclosurePosition(RootModel[Literal['after_answer']]):
    root: Annotated[Literal['after_answer'], Field(title='DisclosurePosition')]
    """
    Only after_answer exists in v1.
    """


class DisclosureStyle(RootModel[Literal['separate_block']]):
    root: Annotated[Literal['separate_block'], Field(title='DisclosureStyle')]
    """
    Only separate_block exists in v1.
    """


class AuditDisclosure(BaseModel):
    """
    The disclosure the policy required for this turn. No defaults: signed as written.
    """

    label: Annotated[str, Field(min_length=1, title='DisclosureLabel')]
    """
    Label rendered on the sponsored block. Must be non-empty.
    """
    position: Annotated[Literal['after_answer'], Field(title='DisclosurePosition')]
    """
    Only after_answer exists in v1.
    """
    style: Annotated[Literal['separate_block'], Field(title='DisclosureStyle')]
    """
    Only separate_block exists in v1.
    """


class Keyword(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]
    """
    A dictionary term matched case-insensitively on whole words. Never message text.
    """


class TurnsSinceLast(RootModel[int]):
    root: Annotated[int, Field(ge=0, le=9007199254740991)]
    """
    Turns since the last ad in this conversation, or null when no ad has been served yet.
    """


class CapState(BaseModel):
    """
    Frequency-cap counters the gateway reads before evaluating policy. The policy engine is pure and receives them as input.
    """

    session_count: Annotated[int, Field(ge=0, le=9007199254740991)]
    """
    Ads already served in this conversation.
    """
    day_count: Annotated[int, Field(ge=0, le=9007199254740991)]
    """
    Ads already served to this user today. Only meaningful when user.user_hash is present.
    """
    turns_since_last: TurnsSinceLast | None
    """
    Turns since the last ad in this conversation, or null when no ad has been served yet.
    """


class ClassificationMethod(str, Enum):
    """
    llm when the LLM classifier answered in time, rules when only the rule stage ran, cached when a recent classification of the same text was reused.
    """

    llm = 'llm'
    rules = 'rules'
    cached = 'cached'


class ContentCategory(str, Enum):
    """
    A commercial content category. Matches fixtures/classify-fixtures.json.
    """

    software_devtools_database = 'software.devtools.database'
    software_devtools_hosting = 'software.devtools.hosting'
    software_devtools_ci = 'software.devtools.ci'
    software_devtools_observability = 'software.devtools.observability'
    software_devtools_ai = 'software.devtools.ai'
    software_security = 'software.security'
    software_productivity = 'software.productivity'
    shopping_electronics = 'shopping.electronics'
    shopping_home = 'shopping.home'
    shopping_sportswear = 'shopping.sportswear'
    shopping_pets = 'shopping.pets'
    travel_flights = 'travel.flights'
    travel_hotels = 'travel.hotels'
    travel_connectivity = 'travel.connectivity'
    education_language = 'education.language'
    education_courses = 'education.courses'
    entertainment_streaming = 'entertainment.streaming'
    food_delivery = 'food.delivery'
    general = 'general'


class Decision(str, Enum):
    serve = 'serve'
    suppress = 'suppress'


class DemandEntry1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['direct']
    enabled: bool | None = True
    """
    Only enabled sources are queried.
    """


class DemandEntry2(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['affiliate']
    network: AffiliateNetwork
    """
    Affiliate network used by an affiliate demand entry.
    """
    enabled: bool | None = True
    """
    Only enabled sources are queried.
    """


class DemandEntry3(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['koah']
    enabled: bool | None = True
    """
    Only enabled sources are queried.
    """


class DemandEntry4(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['gravity']
    enabled: bool | None = True
    """
    Only enabled sources are queried.
    """


class DemandEntryOverride1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['direct']
    enabled: bool | None = None


class DemandEntryOverride2(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['affiliate']
    network: AffiliateNetwork | None = None
    """
    When omitted, every affiliate entry matches.
    """
    enabled: bool | None = None


class DemandEntryOverride3(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['koah']
    enabled: bool | None = None


class DemandEntryOverride4(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source: Literal['gravity']
    enabled: bool | None = None


class DemandSource(str, Enum):
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """

    direct = 'direct'
    affiliate = 'affiliate'
    koah = 'koah'
    gravity = 'gravity'


class DemandUser(BaseModel):
    """
    The user fields a demand adapter may see. Never the tier or user_hash.
    """

    region: Annotated[str | None, Field(pattern='^[A-Z]{2}$')] = None
    """
    ISO 3166 alpha-2 country code. Optional; when absent the regions rule fails closed and the turn is suppressed with reason region_blocked.
    """
    locale: Annotated[str | None, Field(min_length=1)] = None
    """
    BCP 47 locale, e.g. en-US.
    """


class DisclosurePosition1(RootModel[Literal['after_answer']]):
    root: Annotated[Literal['after_answer'], Field(title='DisclosurePosition')] = (
        'after_answer'
    )
    """
    Only after_answer exists in v1.
    """


class DisclosureStyle1(RootModel[Literal['separate_block']]):
    root: Annotated[Literal['separate_block'], Field(title='DisclosureStyle')] = (
        'separate_block'
    )
    """
    Only separate_block exists in v1.
    """


class Disclosure(BaseModel):
    """
    How the sponsored block is labeled and placed.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    label: Annotated[str | None, Field(min_length=1, title='DisclosureLabel')] = (
        'Sponsored'
    )
    """
    Label rendered on the sponsored block. Must be non-empty.
    """
    position: Annotated[Literal['after_answer'], Field(title='DisclosurePosition')] = (
        'after_answer'
    )
    """
    Only after_answer exists in v1.
    """
    style: Annotated[Literal['separate_block'], Field(title='DisclosureStyle')] = (
        'separate_block'
    )
    """
    Only separate_block exists in v1.
    """


class Error(BaseModel):
    code: Annotated[str, Field(min_length=1)]
    message: str


class ErrorResponse(BaseModel):
    """
    Body of every 4xx/5xx response from endpoints other than /v1/evaluate.
    """

    error: Error


class EventType(str, Enum):
    impression = 'impression'
    click = 'click'
    dismiss = 'dismiss'
    conversion = 'conversion'


class ExcludedCandidate(BaseModel):
    """
    One entry of an audit record demand.excluded list: a candidate mediation dropped before ranking. This resolves the pending competitor_exclusions policy decision.
    """

    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    creative_id: Annotated[
        str, Field(min_length=4, pattern='^cr_.*', title='CreativeId')
    ]
    """
    Identifier with the "cr_" prefix.
    """
    advertiser_domain: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    The candidate advertiser domain that matched a competitor exclusion.
    """
    reason: Literal['competitor_exclusion']
    """
    Why the candidate was dropped. Only competitor_exclusion exists in v1.
    """


class FrequencyCaps(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    per_session: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = 1
    """
    Per conversation.
    """
    per_user_per_day: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = 3
    """
    Requires user.user_hash; if absent, per_session applies only.
    """
    min_turns_between: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = 4
    """
    Turns that must pass between two ads.
    """


class GravityConfig(BaseModel):
    """
    The app owner's Gravity settings. Until partner API access exists the adapter answers not_implemented even when enabled with both credentials (docs/decisions.md item 10).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    enabled: bool | None = False
    """
    Whether the Gravity adapter may be queried. Off by default; the adapter answers not_configured while false.
    """
    api_key: Annotated[str | None, Field(min_length=1)] = None
    """
    Gravity API credential. A secret the gateway reads from its environment; never persisted, logged or written to the audit record.
    """
    base_url: Annotated[str | None, Field(min_length=1)] = None
    """
    Gravity API base URL, e.g. https://api.example. Required alongside api_key.
    """


class HealthResponse(BaseModel):
    """
    Body of GET /healthz.
    """

    ok: Literal[True]


class ImpactConfig(BaseModel):
    """
    The app owner’s impact.com identifiers. Never a credential.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    program_id: Annotated[str, Field(min_length=1)]
    """
    The impact.com program or media partner id that appears in tracked links ({{program_id}}).
    """
    campaign_id: Annotated[str | None, Field(min_length=1)] = None
    """
    Optional campaign id for templates that carry {{campaign_id}}.
    """


class IsoTimestamp(RootModel[str]):
    root: Annotated[
        str,
        Field(
            pattern='^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$',
            title='IsoTimestamp',
        ),
    ]
    """
    ISO 8601 timestamp in UTC, e.g. 2026-09-02T18:04:11Z.
    """


class KeyId(RootModel[str]):
    root: Annotated[
        str, Field(pattern='^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$', title='KeyId')
    ]
    """
    Identifier of the Ed25519 key pair that signed a record, e.g. k_2026_09.
    """


class KoahConfig(BaseModel):
    """
    The app owner's Koah settings. Until partner API access exists the adapter answers not_implemented even when enabled with both credentials (docs/decisions.md item 10).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    enabled: bool | None = False
    """
    Whether the Koah adapter may be queried. Off by default; the adapter answers not_configured while false.
    """
    api_key: Annotated[str | None, Field(min_length=1)] = None
    """
    Koah API credential. A secret the gateway reads from its environment; never persisted, logged or written to the audit record.
    """
    base_url: Annotated[str | None, Field(min_length=1)] = None
    """
    Koah API base URL, e.g. https://api.example. Required alongside api_key.
    """


class MessageRole(str, Enum):
    system = 'system'
    user = 'user'
    assistant = 'assistant'
    tool = 'tool'


class OverrideRejection(BaseModel):
    """
    A policy_overrides value that would have loosened the stored policy and was ignored.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    path: Annotated[str, Field(min_length=1)]
    """
    Dotted path of the ignored override, e.g. frequency_caps.per_session or demand[1].
    """
    reason: Annotated[str, Field(min_length=1)]


class PartnerStackConfig(BaseModel):
    """
    The app owner’s PartnerStack identifiers. Never a credential.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    program_id: Annotated[str, Field(min_length=1)]
    """
    The PartnerStack partner key or link id that appears in tracked links ({{program_id}}).
    """


class SensitiveDetection(str, Enum):
    """
    strict suppresses on any sensitive signal from rules OR the LLM.
    """

    strict = 'strict'
    balanced = 'balanced'


class PolicyDecisionResult(str, Enum):
    """
    pass or fail for rules resolved by the policy engine; pending for competitor_exclusions, which is resolved during creative selection.
    """

    pass_ = 'pass'
    fail = 'fail'
    pending = 'pending'


class PolicyOverridesFrequencyCaps(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    per_session: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = None
    """
    A frequency cap: a non-negative integer.
    """
    per_user_per_day: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = None
    """
    A frequency cap: a non-negative integer.
    """
    min_turns_between: Annotated[
        int | None, Field(ge=0, le=9007199254740991, title='PolicyCap')
    ] = None
    """
    A frequency cap: a non-negative integer.
    """


class DisclosurePosition2(RootModel[Literal['after_answer']]):
    root: Annotated[Literal['after_answer'], Field(title='DisclosurePosition')]
    """
    Only after_answer exists in v1.
    """


class DisclosureStyle2(RootModel[Literal['separate_block']]):
    root: Annotated[Literal['separate_block'], Field(title='DisclosureStyle')]
    """
    Only separate_block exists in v1.
    """


class PolicyOverridesDisclosure(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    label: Annotated[str | None, Field(min_length=1, title='DisclosureLabel')] = None
    """
    Label rendered on the sponsored block. Must be non-empty.
    """
    position: Annotated[
        Literal['after_answer'] | None, Field(title='DisclosurePosition')
    ] = None
    """
    Only after_answer exists in v1.
    """
    style: Annotated[Literal['separate_block'] | None, Field(title='DisclosureStyle')] = (
        None
    )
    """
    Only separate_block exists in v1.
    """


class PolicyOverridesPrivacy(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    store_raw_text: bool | None = None
    retain_days: Annotated[
        int | None, Field(ge=1, le=9007199254740991, title='PolicyRetainDays')
    ] = None
    """
    Retention window in days, at least 1.
    """


class PolicyRegion(RootModel[str]):
    root: Annotated[str, Field(pattern='^[A-Z]{2}$', title='PolicyRegion')]
    """
    ISO 3166-1 alpha-2 country code, or the token EU.
    """


class PolicyRule(str, Enum):
    """
    A docs/policy.md rule name, listed in the order the rules run.
    """

    serve_to_tiers = 'serve_to_tiers'
    regions = 'regions'
    blocked_categories = 'blocked_categories'
    min_confidence = 'min_confidence'
    min_commercial_intent = 'min_commercial_intent'
    frequency_caps = 'frequency_caps'
    competitor_exclusions = 'competitor_exclusions'


class PolicyTier(RootModel[str]):
    root: Annotated[str, Field(min_length=1, title='PolicyTier')]
    """
    A user tier name, e.g. free or paid.
    """


class Privacy(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    store_raw_text: bool | None = False
    """
    When false, only hashes and classification are persisted.
    """
    retain_days: Annotated[
        int | None, Field(ge=1, le=9007199254740991, title='PolicyRetainDays')
    ] = 90
    """
    Retention window in days, at least 1.
    """


class PublicKeyPem(RootModel[str]):
    root: Annotated[
        str,
        Field(
            pattern='^-----BEGIN PUBLIC KEY-----\\r?\\n[A-Za-z0-9+/=\\r\\n]+-----END PUBLIC KEY-----\\r?\\n?$',
            title='PublicKeyPem',
        ),
    ]
    """
    An Ed25519 public key as an SPKI PEM string (-----BEGIN PUBLIC KEY-----).
    """


class PublicKeysJson(RootModel[dict[KeyId, PublicKeyPem]]):
    root: Annotated[dict[KeyId, PublicKeyPem], Field(title='PublicKeysJson')]
    """
    Shape of ADGATE_PUBLIC_KEYS_JSON: key_id -> SPKI PEM public key, including every retired key (old public keys remain available for verification forever).
    """


class Regions(BaseModel):
    """
    Regions in which ads may be served.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    allow: Annotated[
        list[PolicyRegion] | None, Field(validate_default=True)
    ] = ['US', 'CA', 'GB', 'EU']


class SensitiveCategory(str, Enum):
    """
    A sensitive topic that blocks ads. Matches fixtures/classify-fixtures.json.
    """

    health = 'health'
    finance = 'finance'
    politics = 'politics'
    legal = 'legal'
    adult = 'adult'
    gambling = 'gambling'
    weapons = 'weapons'
    religion = 'religion'
    self_harm = 'self_harm'


class Sha256Hash(RootModel[str]):
    root: Annotated[str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')]
    """
    A SHA-256 digest written as sha256:<64 lowercase hex digits>.
    """


class SuppressReason(str, Enum):
    """
    Why no ad was served: paid_user, region_blocked, sensitive_category:<name> (name from the sensitive taxonomy), low_confidence, low_commercial_intent, frequency_cap, no_fill, or error.
    """

    paid_user = 'paid_user'
    region_blocked = 'region_blocked'
    low_confidence = 'low_confidence'
    low_commercial_intent = 'low_commercial_intent'
    frequency_cap = 'frequency_cap'
    no_fill = 'no_fill'
    error = 'error'
    sensitive_category_health = 'sensitive_category:health'
    sensitive_category_finance = 'sensitive_category:finance'
    sensitive_category_politics = 'sensitive_category:politics'
    sensitive_category_legal = 'sensitive_category:legal'
    sensitive_category_adult = 'sensitive_category:adult'
    sensitive_category_gambling = 'sensitive_category:gambling'
    sensitive_category_weapons = 'sensitive_category:weapons'
    sensitive_category_religion = 'sensitive_category:religion'
    sensitive_category_self_harm = 'sensitive_category:self_harm'


class SurfaceType(str, Enum):
    chat = 'chat'
    agent = 'agent'
    cli = 'cli'


class TargetCategory(RootModel[str]):
    root: Annotated[
        str,
        Field(
            pattern='^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*(\\.\\*)?$',
            title='TargetCategory',
        ),
    ]
    """
    A content category such as software.devtools.database, or a trailing-wildcard pattern such as software.devtools.* that matches every deeper category.
    """


class User(BaseModel):
    """
    The end user of the app for this turn.
    """

    tier: Annotated[str, Field(min_length=1)]
    """
    free or paid. Apps may add other strings; anything not in serve_to_tiers is suppressed.
    """
    region: Annotated[str | None, Field(pattern='^[A-Z]{2}$')] = None
    """
    ISO 3166 alpha-2 country code. Optional; when absent the regions rule fails closed and the turn is suppressed with reason region_blocked.
    """
    locale: Annotated[str | None, Field(min_length=1)] = None
    """
    BCP 47 locale, e.g. en-US.
    """
    user_hash: Annotated[str | None, Field(min_length=1)] = None
    """
    Optional stable per-user hash (sha256). Enables per_user_per_day frequency caps.
    """


class VerifyCheckName(str, Enum):
    schema = 'schema'
    record_hash = 'record_hash'
    chain = 'chain'
    signature = 'signature'
    creative_hash = 'creative_hash'
    disclosure_present = 'disclosure_present'
    separation_attested = 'separation_attested'
    supersedes = 'supersedes'


class AmazonConfig(BaseModel):
    """
    The app owner’s Amazon Associates identifiers. Never a credential.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    tag: Annotated[str, Field(min_length=1)]
    """
    The Associates tracking id (Associate tag), e.g. mysite-20, set as tag=.
    """
    marketplace: AmazonMarketplace | None = None
    """
    When set, templates must point at this storefront (tags are storefront-specific).
    """


class AttestRequest(BaseModel):
    """
    Body of POST /v1/attest, sent after the model answer is complete. Returns 204.
    """

    audit_id: Annotated[str, Field(min_length=5, pattern='^aud_.*', title='AuditId')]
    """
    Identifier with the "aud_" prefix.
    """
    model_output_hash: Annotated[
        str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')
    ]
    """
    sha256 of the complete model answer.
    """
    rendered: bool
    """
    Whether the sponsored block was actually rendered.
    """


class AuditCreative(BaseModel):
    """
    The served creative as recorded: identity plus a content hash, never the copy.
    """

    id: Annotated[str, Field(min_length=4, pattern='^cr_.*', title='CreativeId')]
    """
    Identifier with the "cr_" prefix.
    """
    advertiser: Annotated[str, Field(min_length=1)]
    """
    Advertiser display name.
    """
    advertiser_domain: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    Advertiser domain, e.g. example.com.
    """
    content_hash: Annotated[
        str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')
    ]
    """
    sha256 over the canonical JSON of the creative content (advertiser, advertiser_domain, headline, body, cta, url_template). Verification compares it with the stored creative.
    """


class AuditSurface(BaseModel):
    """
    Where the slot would have rendered: the request surface without max_creatives.
    """

    type: SurfaceType
    placement: Literal['after_answer']
    """
    Always after_answer in v1.
    """


class Candidate(BaseModel):
    """
    A catalog creative an adapter proposes for this turn, with its scores.
    """

    id: Annotated[str, Field(min_length=4, pattern='^cr_.*', title='CreativeId')]
    """
    Identifier with the "cr_" prefix.
    """
    advertiser: Annotated[str, Field(min_length=1)]
    """
    Advertiser display name.
    """
    advertiser_domain: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    Advertiser domain, e.g. exampledb.dev. Matched against policy competitor_exclusions.
    """
    headline: Annotated[str, Field(min_length=1)]
    body: str
    cta: Annotated[str, Field(min_length=1)]
    """
    Call-to-action label.
    """
    url_template: Annotated[str, Field(min_length=1)]
    """
    Destination URL. Affiliate entries may contain placeholders such as {{program_id}} that the affiliate adapter fills in.
    """
    target_categories: list[TargetCategory]
    """
    Categories the creative targets. An empty list matches no category.
    """
    target_regions: list[PolicyRegion]
    """
    ISO 3166-1 alpha-2 codes or the token EU. An empty list means every region.
    """
    keywords: list[Keyword]
    """
    Dictionary terms that raise targeting_match when the request carries them.
    """
    ecpm: Annotated[float, Field(ge=0.0)]
    """
    Expected revenue per thousand impressions, in currency units.
    """
    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    active: bool
    """
    Inactive creatives are never returned by any adapter.
    """
    network: AffiliateNetwork | None = None
    """
    Affiliate entries only. When absent, the affiliate adapter treats the creative as belonging to its own network (the one named in the policy’s affiliate demand entry).
    """
    program_id: Annotated[str | None, Field(min_length=1)] = None
    """
    Affiliate entries only: overrides the app-level AffiliateConfig id for this creative (program_id for partnerstack and impact, the Associates tag for amazon). Always the app owner’s own id.
    """
    ecpm_estimate: Annotated[float, Field(ge=0.0)]
    """
    The adapter’s revenue estimate for this impression. Direct: the creative ecpm.
    """
    targeting_match: Annotated[float, Field(ge=0.0, le=1.0)]
    """
    How well the creative fits the classification; 1 is an exact category match with full keyword overlap.
    """
    resolved_url: Annotated[str | None, Field(min_length=1)] = None
    """
    Destination URL once the adapter resolved url_template. The click redirect uses it when present.
    """


class CatalogCreative(BaseModel):
    """
    A creative as stored in the catalog (creatives table, dashboard, seed file plus id).
    """

    id: Annotated[str, Field(min_length=4, pattern='^cr_.*', title='CreativeId')]
    """
    Identifier with the "cr_" prefix.
    """
    advertiser: Annotated[str, Field(min_length=1)]
    """
    Advertiser display name.
    """
    advertiser_domain: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    Advertiser domain, e.g. exampledb.dev. Matched against policy competitor_exclusions.
    """
    headline: Annotated[str, Field(min_length=1)]
    body: str
    cta: Annotated[str, Field(min_length=1)]
    """
    Call-to-action label.
    """
    url_template: Annotated[str, Field(min_length=1)]
    """
    Destination URL. Affiliate entries may contain placeholders such as {{program_id}} that the affiliate adapter fills in.
    """
    target_categories: list[TargetCategory]
    """
    Categories the creative targets. An empty list matches no category.
    """
    target_regions: list[PolicyRegion]
    """
    ISO 3166-1 alpha-2 codes or the token EU. An empty list means every region.
    """
    keywords: list[Keyword]
    """
    Dictionary terms that raise targeting_match when the request carries them.
    """
    ecpm: Annotated[float, Field(ge=0.0)]
    """
    Expected revenue per thousand impressions, in currency units.
    """
    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    active: bool
    """
    Inactive creatives are never returned by any adapter.
    """
    network: AffiliateNetwork | None = None
    """
    Affiliate entries only. When absent, the affiliate adapter treats the creative as belonging to its own network (the one named in the policy’s affiliate demand entry).
    """
    program_id: Annotated[str | None, Field(min_length=1)] = None
    """
    Affiliate entries only: overrides the app-level AffiliateConfig id for this creative (program_id for partnerstack and impact, the Associates tag for amazon). Always the app owner’s own id.
    """


class Classification(BaseModel):
    """
    What the classifier concluded about the conversation turn. Never contains message text.
    """

    commercial_intent: Annotated[float, Field(ge=0.0, le=1.0)]
    """
    0..1 likelihood the user is in a buying context.
    """
    categories: list[ContentCategory]
    """
    Commercial categories detected, most relevant first.
    """
    sensitive: list[SensitiveCategory]
    """
    Sensitive topics detected. Any entry blocks ads under strict detection.
    """
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]
    """
    0..1 classifier confidence in this result.
    """
    method: ClassificationMethod
    """
    llm when the LLM classifier answered in time, rules when only the rule stage ran, cached when a recent classification of the same text was reused.
    """
    prompt_version: Annotated[str, Field(min_length=1)]
    """
    Version of the classifier prompt or rule set, e.g. sha256:<hex>.
    """


class Creative(BaseModel):
    """
    A sponsored creative to render in a separate labeled block after the answer.
    """

    id: Annotated[str, Field(min_length=4, pattern='^cr_.*', title='CreativeId')]
    """
    Identifier with the "cr_" prefix.
    """
    advertiser: Annotated[str, Field(min_length=1)]
    """
    Advertiser display name.
    """
    headline: Annotated[str, Field(min_length=1)]
    body: str
    cta: Annotated[str, Field(min_length=1)]
    """
    Call-to-action label.
    """
    url: Annotated[str, Field(min_length=1)]
    """
    Always the gateway click redirect (/c/:audit_id), never the advertiser directly.
    """
    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    disclosure_label: Annotated[str, Field(min_length=1)]
    """
    Label the SDK must render, e.g. Sponsored.
    """


class DemandResponse(BaseModel):
    """
    One demand adapter’s answer; summarized into the audit record demand block.
    """

    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    candidates: list[Candidate]
    """
    Best candidates first. Empty on failure.
    """
    latency_ms: Annotated[int, Field(ge=0, le=9007199254740991)]
    error: Annotated[str | None, Field(min_length=1)] = None
    """
    Set when the adapter failed, timed out or was aborted. Never message text.
    """


class DemandResponseSummary(BaseModel):
    """
    One entry of an audit record demand.responses list: a demand adapter answer with the candidates reduced to a count. error is set when the adapter failed, timed out or was aborted.
    """

    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    candidates: Annotated[int, Field(ge=0, le=9007199254740991)]
    """
    How many candidates the source returned (0 on failure or timeout).
    """
    latency_ms: Annotated[int, Field(ge=0, le=9007199254740991)]
    error: Annotated[str | None, Field(min_length=1)] = None
    """
    Set when the adapter failed, timed out or was aborted. Never message text.
    """


class DemandTrace(BaseModel):
    """
    The demand block of an audit record: the mediation trace for one evaluation (docs/audit.md).
    """

    requested: list[DemandSource]
    """
    The sources queried, in policy demand order (enabled entries only).
    """
    responses: list[DemandResponseSummary]
    """
    One entry per requested source, in the same order.
    """
    excluded: list[ExcludedCandidate]
    """
    Candidates dropped by competitor_exclusions, in the order they were seen.
    """
    selected: DemandSource | None
    """
    The source of the winning candidate, or null when nothing was selected (no_fill).
    """


class EvaluateResponse(BaseModel):
    """
    Body of POST /v1/evaluate. Always HTTP 200; internal failures suppress with reason error.
    """

    decision: Decision
    reason: SuppressReason | None
    """
    null when decision is serve.
    """
    classification: Classification
    """
    What the classifier concluded about the conversation turn. Never contains message text.
    """
    creative: Creative | None
    """
    null when decision is suppress.
    """
    audit_id: Annotated[str, Field(min_length=5, pattern='^aud_.*', title='AuditId')]
    """
    Returned for every evaluation, including suppressions.
    """
    latency_ms: Annotated[int, Field(ge=0, le=9007199254740991)]


class EventRequest(BaseModel):
    """
    Body of POST /v1/events. Returns 204. Duplicate impressions for the same audit_id are ignored.
    """

    audit_id: Annotated[str, Field(min_length=5, pattern='^aud_.*', title='AuditId')]
    """
    Identifier with the "aud_" prefix.
    """
    type: EventType
    ts: Annotated[
        str,
        Field(
            pattern='^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$',
            title='IsoTimestamp',
        ),
    ]
    """
    ISO 8601 timestamp in UTC, e.g. 2026-09-02T18:04:11Z.
    """
    meta: dict[str, Any] | None = None


class Message(BaseModel):
    """
    One conversation turn. Servers truncate to the last 4 messages and 4,000 characters before classification, and reject a single message over 32,768 characters.
    """

    role: MessageRole
    content: Annotated[str, Field(max_length=32768)]


class PolicyConfig(BaseModel):
    """
    An app policy (docs/policy.md). Omitted fields take the documented defaults; unknown keys are rejected.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    version: Literal[1] = 1
    """
    Policy schema version. Only 1 exists.
    """
    app_id: Annotated[str, Field(min_length=1)]
    """
    The app this policy belongs to.
    """
    serve_to_tiers: Annotated[
        list[PolicyTier] | None, Field(validate_default=True)
    ] = ['free']
    """
    Tiers that may see ads. Any other tier is suppressed with reason paid_user.
    """
    allow_paid_tiers: bool | None = False
    """
    Must be explicitly true to include non-free tiers in serve_to_tiers.
    """
    blocked_categories: list[SensitiveCategory] | None = [
        'health',
        'finance',
        'politics',
        'legal',
        'adult',
        'gambling',
        'weapons',
        'religion',
        'self_harm',
    ]
    """
    Sensitive categories that suppress ads. self_harm cannot be removed.
    """
    sensitive_detection: Annotated[
        SensitiveDetection | None, Field(title='SensitiveDetection')
    ] = 'strict'
    """
    strict suppresses on any sensitive signal from rules OR the LLM.
    """
    min_commercial_intent: Annotated[
        float | None, Field(ge=0.0, le=1.0, title='PolicyThreshold')
    ] = 0.6
    """
    A score threshold between 0 and 1.
    """
    min_confidence: Annotated[
        float | None, Field(ge=0.0, le=1.0, title='PolicyThreshold')
    ] = 0.7
    """
    A score threshold between 0 and 1.
    """
    competitor_exclusions: Annotated[
        list[AdvertiserDomain] | None, Field(validate_default=True)
    ] = []
    frequency_caps: FrequencyCaps | None = None
    disclosure: Disclosure | None = None
    """
    How the sponsored block is labeled and placed.
    """
    demand: Annotated[list[DemandEntry1 | DemandEntry2 | DemandEntry3 | DemandEntry4] | None, Field(validate_default=True)] = [
        {'enabled': True, 'source': 'direct'},
        {'enabled': True, 'network': 'partnerstack', 'source': 'affiliate'},
        {'enabled': False, 'source': 'koah'},
        {'enabled': False, 'source': 'gravity'},
    ]
    """
    Ordered list; only enabled sources are queried.
    """
    privacy: Privacy | None = None
    regions: Regions | None = None
    """
    Regions in which ads may be served.
    """


class PolicyDecision(BaseModel):
    """
    One entry of an audit record policy_decisions list: the outcome of one rule. Every rule records an entry, pass or fail.
    """

    rule: PolicyRule
    """
    A docs/policy.md rule name, listed in the order the rules run.
    """
    result: PolicyDecisionResult
    """
    pass or fail for rules resolved by the policy engine; pending for competitor_exclusions, which is resolved during creative selection.
    """
    detail: Annotated[str | None, Field(min_length=1)] = None
    """
    Human-readable context, e.g. session=0/1 day=1/3 turns_since=9. Never contains message text.
    """


class PolicyOverridesRegions(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    allow: list[PolicyRegion] | None = None


class PolicyOverrides(BaseModel):
    """
    Deep-partial PolicyConfig sent as EvaluateRequest.policy_overrides. Only values that make the stored policy stricter are applied; the rest are ignored and recorded as override_rejected.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    version: Literal[1] | None = None
    app_id: Annotated[str | None, Field(min_length=1)] = None
    serve_to_tiers: list[PolicyTier] | None = None
    allow_paid_tiers: bool | None = None
    blocked_categories: list[SensitiveCategory] | None = None
    sensitive_detection: Annotated[
        SensitiveDetection | None, Field(title='SensitiveDetection')
    ] = 'strict'
    """
    strict suppresses on any sensitive signal from rules OR the LLM.
    """
    min_commercial_intent: Annotated[
        float | None, Field(ge=0.0, le=1.0, title='PolicyThreshold')
    ] = None
    """
    A score threshold between 0 and 1.
    """
    min_confidence: Annotated[
        float | None, Field(ge=0.0, le=1.0, title='PolicyThreshold')
    ] = None
    """
    A score threshold between 0 and 1.
    """
    competitor_exclusions: list[AdvertiserDomain] | None = None
    frequency_caps: Annotated[
        PolicyOverridesFrequencyCaps | None, Field(title='PolicyOverridesFrequencyCaps')
    ] = None
    disclosure: Annotated[
        PolicyOverridesDisclosure | None, Field(title='PolicyOverridesDisclosure')
    ] = None
    demand: list[DemandEntryOverride1 | DemandEntryOverride2 | DemandEntryOverride3 | DemandEntryOverride4] | None = (
        None
    )
    privacy: Annotated[
        PolicyOverridesPrivacy | None, Field(title='PolicyOverridesPrivacy')
    ] = None
    regions: Annotated[
        PolicyOverridesRegions | None, Field(title='PolicyOverridesRegions')
    ] = None


class SeedCreative(BaseModel):
    """
    A catalog creative before an id is assigned: the shape of examples/creatives.seed.json entries.
    """

    advertiser: Annotated[str, Field(min_length=1)]
    """
    Advertiser display name.
    """
    advertiser_domain: Annotated[str, Field(min_length=1, title='AdvertiserDomain')]
    """
    Advertiser domain, e.g. exampledb.dev. Matched against policy competitor_exclusions.
    """
    headline: Annotated[str, Field(min_length=1)]
    body: str
    cta: Annotated[str, Field(min_length=1)]
    """
    Call-to-action label.
    """
    url_template: Annotated[str, Field(min_length=1)]
    """
    Destination URL. Affiliate entries may contain placeholders such as {{program_id}} that the affiliate adapter fills in.
    """
    target_categories: list[TargetCategory]
    """
    Categories the creative targets. An empty list matches no category.
    """
    target_regions: list[PolicyRegion]
    """
    ISO 3166-1 alpha-2 codes or the token EU. An empty list means every region.
    """
    keywords: list[Keyword]
    """
    Dictionary terms that raise targeting_match when the request carries them.
    """
    ecpm: Annotated[float, Field(ge=0.0)]
    """
    Expected revenue per thousand impressions, in currency units.
    """
    source: DemandSource
    """
    Demand source that supplied a creative (see docs/policy.md demand list).
    """
    active: bool
    """
    Inactive creatives are never returned by any adapter.
    """
    network: AffiliateNetwork | None = None
    """
    Affiliate entries only. When absent, the affiliate adapter treats the creative as belonging to its own network (the one named in the policy’s affiliate demand entry).
    """
    program_id: Annotated[str | None, Field(min_length=1)] = None
    """
    Affiliate entries only: overrides the app-level AffiliateConfig id for this creative (program_id for partnerstack and impact, the Associates tag for amazon). Always the app owner’s own id.
    """


class Surface(BaseModel):
    """
    Where the sponsored slot would be rendered.
    """

    type: SurfaceType
    placement: Literal['after_answer']
    """
    Always after_answer in v1.
    """
    max_creatives: Annotated[int | None, Field(ge=1, le=9007199254740991)] = None
    """
    Upper bound on creatives to return. v1 returns at most one.
    """


class VerifyCheck(BaseModel):
    """
    Result of one verification check.
    """

    name: VerifyCheckName
    ok: bool
    detail: str | None = None
    """
    Free-form detail, e.g. key_id=k_2026_09.
    """


class VerifyResponse(BaseModel):
    """
    Body of GET /v1/verify/:id.
    """

    valid: bool
    checks: list[VerifyCheck]


class AffiliateConfig(BaseModel):
    """
    Per-app affiliate identifiers, one optional entry per AffiliateNetwork. The app owner brings their own accounts; a network without an entry yields no affiliate candidates.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    partnerstack: PartnerStackConfig | None = None
    """
    The app owner’s PartnerStack identifiers. Never a credential.
    """
    impact: ImpactConfig | None = None
    """
    The app owner’s impact.com identifiers. Never a credential.
    """
    amazon: AmazonConfig | None = None
    """
    The app owner’s Amazon Associates identifiers. Never a credential.
    """


class AuditRecord(BaseModel):
    """
    A signed audit record (docs/audit.md): one per /v1/evaluate call, chained per app through prev_hash. Body of GET /v1/audit/:id.
    """

    id: Annotated[str, Field(min_length=5, pattern='^aud_.*', title='AuditId')]
    """
    Identifier with the "aud_" prefix.
    """
    app_id: Annotated[str, Field(min_length=5, pattern='^app_.*', title='AppId')]
    """
    Identifier with the "app_" prefix.
    """
    conversation_id_hash: Annotated[
        str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')
    ]
    """
    sha256(app_salt + conversation_id). Raw conversation ids are never stored.
    """
    user_hash: Sha256Hash | None
    """
    The app-supplied user hash normalised to sha256:<hex>, or null when the request carried none.
    """
    turn_id: Annotated[str, Field(min_length=1)]
    ts: Annotated[
        str,
        Field(
            pattern='^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$',
            title='IsoTimestamp',
        ),
    ]
    """
    When the evaluation happened.
    """
    surface: AuditSurface
    """
    Where the slot would have rendered: the request surface without max_creatives.
    """
    classification: Classification
    """
    What the classifier concluded about the conversation turn. Never contains message text.
    """
    policy_version: Annotated[int, Field(ge=1, le=9007199254740991)]
    """
    The version field of the policy applied.
    """
    policy_hash: Annotated[
        str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')
    ]
    """
    policy_hash of the policy applied (docs/policy.md).
    """
    policy_decisions: list[PolicyDecision]
    """
    One entry per rule in docs/policy.md rule order, pass or fail.
    """
    override_rejected: Annotated[
        list[OverrideRejection] | None, Field(validate_default=True)
    ] = []
    """
    policy_overrides values that would have loosened the policy and were ignored (docs/policy.md Overrides). Empty when none.
    """
    decision: Decision
    reason: SuppressReason | None
    """
    null when decision is serve.
    """
    demand: DemandTrace
    """
    The demand block of an audit record: the mediation trace for one evaluation (docs/audit.md).
    """
    creative: AuditCreative | None
    """
    null when decision is suppress.
    """
    disclosure: AuditDisclosure
    """
    The disclosure the policy required for this turn. No defaults: signed as written.
    """
    model_output_hash: Sha256Hash | None
    """
    Set by attestation: the hash of the model output the SDK rendered the slot after.
    """
    separation_attestation: bool
    """
    true only on a record produced by attestation (POST /v1/attest).
    """
    attested_at: IsoTimestamp | None
    supersedes_hash: Sha256Hash | None
    """
    On an attestation record: the record_hash of the record it supersedes. Both stay in the chain.
    """
    prev_hash: Annotated[Sha256Hash | Literal['genesis'], Field(title='PrevHash')]
    """
    The record_hash of the previous record for the same app_id, or the literal genesis for the first record.
    """
    record_hash: Annotated[
        str, Field(pattern='^sha256:[0-9a-f]{64}$', title='Sha256Hash')
    ]
    """
    sha256 over the canonical JSON of the record without record_hash and signature, concatenated with prev_hash.
    """
    signature: Annotated[
        str, Field(pattern='^ed25519:[A-Za-z0-9+/]+={0,2}$', title='Ed25519Signature')
    ]
    """
    Ed25519 over the record_hash string, by key_id.
    """
    key_id: Annotated[
        str, Field(pattern='^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$', title='KeyId')
    ]
    """
    Identifier of the Ed25519 key pair that signed a record, e.g. k_2026_09.
    """


class DemandRequest(BaseModel):
    """
    What the gateway hands every demand adapter for one evaluation.
    """

    app_id: Annotated[str, Field(min_length=5, pattern='^app_.*', title='AppId')]
    """
    Identifier with the "app_" prefix.
    """
    classification: Classification
    """
    What the classifier concluded about the conversation turn. Never contains message text.
    """
    surface: Surface
    """
    Where the sponsored slot would be rendered.
    """
    user: DemandUser
    """
    The user fields a demand adapter may see. Never the tier or user_hash.
    """
    exclusions: list[AdvertiserDomain]
    """
    Advertiser domains that must not be selected (policy competitor_exclusions). Mediation enforces them; adapters receive them so they can skip work.
    """
    keywords: list[Keyword] | None = None
    """
    Normalized dictionary terms the rules classifier matched (never raw message text). Adapters use them for keyword overlap.
    """


class EvaluateRequest1(BaseModel):
    """
    Body of POST /v1/evaluate.
    """

    app_id: Annotated[str, Field(min_length=5, pattern='^app_.*', title='AppId')]
    """
    Identifier with the "app_" prefix.
    """
    conversation_id: Annotated[str, Field(min_length=1)]
    """
    App-side conversation id. Stored only as a salted hash.
    """
    turn_id: Annotated[str, Field(min_length=1)]
    user: User
    """
    The end user of the app for this turn.
    """
    messages: Annotated[list[Message], Field(min_length=1)]
    """
    The last few turns, newest last. Required and non-empty unless context_summary is sent.
    """
    context_summary: Annotated[str | None, Field(min_length=1)] = None
    """
    Short summary sent instead of raw messages. Required unless messages is sent.
    """
    surface: Surface
    """
    Where the sponsored slot would be rendered.
    """
    policy_overrides: PolicyOverrides | None = None
    """
    Partial PolicyConfig merged over the stored policy. May only make policy stricter.
    """


class EvaluateRequest2(BaseModel):
    """
    Body of POST /v1/evaluate.
    """

    app_id: Annotated[str, Field(min_length=5, pattern='^app_.*', title='AppId')]
    """
    Identifier with the "app_" prefix.
    """
    conversation_id: Annotated[str, Field(min_length=1)]
    """
    App-side conversation id. Stored only as a salted hash.
    """
    turn_id: Annotated[str, Field(min_length=1)]
    user: User
    """
    The end user of the app for this turn.
    """
    messages: list[Message] | None = None
    """
    The last few turns, newest last. Required and non-empty unless context_summary is sent.
    """
    context_summary: Annotated[str, Field(min_length=1)]
    """
    Short summary sent instead of raw messages. Required unless messages is sent.
    """
    surface: Surface
    """
    Where the sponsored slot would be rendered.
    """
    policy_overrides: PolicyOverrides | None = None
    """
    Partial PolicyConfig merged over the stored policy. May only make policy stricter.
    """


class EvaluateRequest(RootModel[EvaluateRequest1 | EvaluateRequest2]):
    root: Annotated[EvaluateRequest1 | EvaluateRequest2, Field(title='EvaluateRequest')]
    """
    Body of POST /v1/evaluate.
    """


__all__ = [
    "AdvertiserDomain",
    "AffiliateConfig",
    "AffiliateNetwork",
    "AmazonConfig",
    "AmazonMarketplace",
    "AttestRequest",
    "AuditCreative",
    "AuditDisclosure",
    "AuditRecord",
    "AuditSurface",
    "Candidate",
    "CapState",
    "CatalogCreative",
    "Classification",
    "ClassificationMethod",
    "ContentCategory",
    "Creative",
    "Decision",
    "DemandEntry1",
    "DemandEntry2",
    "DemandEntry3",
    "DemandEntry4",
    "DemandEntryOverride1",
    "DemandEntryOverride2",
    "DemandEntryOverride3",
    "DemandEntryOverride4",
    "DemandRequest",
    "DemandResponse",
    "DemandResponseSummary",
    "DemandSource",
    "DemandTrace",
    "DemandUser",
    "Disclosure",
    "DisclosurePosition",
    "DisclosurePosition1",
    "DisclosurePosition2",
    "DisclosureStyle",
    "DisclosureStyle1",
    "DisclosureStyle2",
    "Error",
    "ErrorResponse",
    "EvaluateRequest",
    "EvaluateRequest1",
    "EvaluateRequest2",
    "EvaluateResponse",
    "EventRequest",
    "EventType",
    "ExcludedCandidate",
    "FrequencyCaps",
    "GravityConfig",
    "HealthResponse",
    "ImpactConfig",
    "IsoTimestamp",
    "KeyId",
    "Keyword",
    "KoahConfig",
    "Message",
    "MessageRole",
    "OverrideRejection",
    "PartnerStackConfig",
    "PolicyConfig",
    "PolicyDecision",
    "PolicyDecisionResult",
    "PolicyOverrides",
    "PolicyOverridesDisclosure",
    "PolicyOverridesFrequencyCaps",
    "PolicyOverridesPrivacy",
    "PolicyOverridesRegions",
    "PolicyRegion",
    "PolicyRule",
    "PolicyTier",
    "Privacy",
    "PublicKeyPem",
    "PublicKeysJson",
    "Regions",
    "SeedCreative",
    "SensitiveCategory",
    "SensitiveDetection",
    "Sha256Hash",
    "SuppressReason",
    "Surface",
    "SurfaceType",
    "TargetCategory",
    "TurnsSinceLast",
    "User",
    "VerifyCheck",
    "VerifyCheckName",
    "VerifyResponse",
]
