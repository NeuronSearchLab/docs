# Neuron Search Lab Recommendation Pipeline Audit

Audit date: 2026-05-09  
Audited codebase: `/home/ubuntu/Coding/nsl_admin_console_next`  
Report location: `/home/ubuntu/Coding/docs/audits/recommendation-pipeline-audit.md`

## Executive Summary

| Area | Confidence | Finding |
| --- | --- | --- |
| Tenant isolation | High for serving queries; Medium overall | Core serving, event, item, rule, context, and model-resolution queries consistently filter by resolved tenant/team IDs. Leakage tests are incomplete. |
| Retrieval | High for implementation shape; Low for quality proof | Retrieval is pgvector nearest-neighbour over 64-dimensional item embeddings using the user or seed-item vector. No checked-in golden tests prove boat/yacht, football-user, or metadata cold-start behaviour. |
| Embeddings | Medium | Item embeddings are generated from item ID, name, description, and metadata through SageMaker. User embeddings are sequence based. Storage/query use `::vector` and `<=>`. The reason for 64 dimensions is configurable default, not empirically justified in code. |
| Model architecture | Medium | The retrieval model is a two-tower TFRS model with a GRU user sequence encoder and metadata/content-aware item tower. It should remain for now, but quality gates and dimensionality evaluation should be added before calling it proven. |
| Ranking/reranking | Medium | A learned XGBoost ranker path exists, uses bounded numeric features, validates score count, and falls back when configured. Current tests are partial and one standalone ranker feature test is stale versus production feature count. |
| Customer rules | Medium | Boost, bury, filter, cap, diversity, pin, weighted-topic, time windows, context scoping, and explanations exist. Golden end-to-end traces for every required scenario do not exist. |
| Validation | Low | Existing tests cover helper semantics and some controls, but there is no repeatable synthetic recommendation validation suite covering retrieval, tenant leakage, model versions, or trace expectations. |

Overall answer: NSL has the right structural components to recommend the right things for tenant-scoped reasons, but the repository does not yet prove the core behavioural claims. The serving path is evidence-rich enough to audit, yet retrieval quality, 64-dimensional sufficiency, cold start quality, tenant leakage, and customer-rule compliance need synthetic golden tests before they can be marked verified.

## Current Pipeline Map

1. Authenticated serving request reaches `infra/lambda/recommendation-lambda.ts`. The handler validates query/body fields including `context_id`, `limit`, `user_id`, `scope`, `filter`, and auto-section parameters (`recommendation-lambda.ts:152-181`).
2. Tenant is resolved from Cognito `client_id` or `sub` through `oauth_clients`, then used as `tenantId` for subsequent data access (`recommendation-lambda.ts:1218-1239`).
3. Context configuration is loaded only when `contexts.id = contextLookupId AND team_id = tenantId` (`recommendation-lambda.ts:1272-1289`).
4. Previously viewed items can be excluded by querying `user_events` for the same `tenant_id` and `user_id` (`recommendation-lambda.ts:1321-1395`).
5. The scoring vector is selected from the stored user embedding, tenant mean embedding fallback, or auto-section seed-item embedding (`recommendation-lambda.ts:759-836`, `recommendation-lambda.ts:1397-1498`).
6. Active pipeline configuration is loaded context-first, then global, from `ranking_pipelines` for the same tenant (`recommendation-lambda.ts:1694-1789`).
7. Candidate retrieval runs against active item embeddings for the same tenant and orders by pgvector cosine distance (`embedding <=> $1::vector`) (`recommendation-lambda.ts:1794-1810`).
8. Cold-start trending backfill can inject popular/recent items when a default embedding was used and retrieved candidates are insufficient (`recommendation-lambda.ts:1867-1924`).
9. Learned ranking, when enabled, builds numeric features, calls a SageMaker endpoint, and replaces candidate scores with returned ranker scores if the count matches (`recommendation-lambda.ts:1926-2208`).
10. Catalog Intelligence can blend tenant-scoped item relationships and metadata similarity into scores (`recommendation-lambda.ts:520-566`, `recommendation-lambda.ts:2232-2381`).
11. Scoring adjustments can add freshness, fatigue, trending backfill, and exploration according to pipeline config (`recommendation-lambda.ts:2392-2690`).
12. Customer rules are loaded by tenant/context and time window, applied after scoring, then sorted and pinned (`recommendation-lambda.ts:2901-3365`).
13. Post-processing can dedupe and enforce diversity (`recommendation-lambda.ts:3369-3425`).
14. Explanations include source, final/base/retrieval/ranker score, embedding source, pipeline trace, rules, experiments, and user segments (`recommendation-lambda.ts:3638-3748`).
15. Served recommendation telemetry stores item scores, retrieval/ranker scores, tenant, context, and model version when present (`recommendation-lambda.ts:3914-3960`).

## Retrieval Audit

| Check | Actual Behaviour | Evidence | Confidence |
| --- | --- | --- | --- |
| What embeddings are retrieved | `entity_type = 'Item'` rows from `embeddings`, scoped to `tenant_id`, `active = TRUE`. | `recommendation-lambda.ts:1794-1807` | High |
| Query operator | Uses `embedding <=> $1::vector` for distance and orders ascending. The returned public score is transformed to `1 / (1 + distance)`. | `recommendation-lambda.ts:1794-1836` | High |
| Retrieval basis | Primary retrieval is semantic/vector similarity to user profile embedding or auto-section seed-item embedding. Behaviour affects user embedding generation and ranker features, not the first SQL candidate order except auto-mode seed selection and viewed-item exclusion. | `recommendation-lambda.ts:1397-1415`, `recommendation-lambda.ts:1794-1852`, `train.py:372-433` | High |
| Hybrid retrieval | Hybrid behaviour exists after vector retrieval through cold-start backfill, Catalog Intelligence, freshness, fatigue, exploration, trending, learned ranker, and rules. It is not a hybrid SQL retrieval query combining lexical/metadata/behaviour at candidate generation. | `recommendation-lambda.ts:1867-1924`, `recommendation-lambda.ts:1926-2208`, `recommendation-lambda.ts:2232-2690`, `recommendation-lambda.ts:2901-3365` | Medium |
| Semantic similarity | Implemented through two-tower vectors and pgvector distance. No checked-in test proves examples like boat/yacht closer than boat/monkey. | `train.py:530-582`, `recommendation-lambda.ts:1794-1810`; absence found by search for golden tests. | Low |
| Behavioural similarity | User tower learns from event sequences and retrieval can use a stored user embedding. Ranker features include user-item and user-facet history. No synthetic football-user test proves expected retrieval. | `train.py:372-433`, `train.py:588-633`, `recommendation-lambda.ts:2016-2130` | Medium for implementation; Low for quality proof |
| Metadata-rich cold start | Item tower includes metadata text, and Catalog Intelligence has metadata token similarity. No golden test proves new metadata-rich item ranks correctly for cold start. | `train.py:558-582`, `recommendation-lambda.ts:520-566`, `recommendation-lambda.ts:2232-2381` | Medium for implementation; Low for quality proof |

Required example tests status:

| Scenario | Expected | Actual Evidence | Result |
| --- | --- | --- | --- |
| Boat/yacht closer than boat/monkey | Cosine distance boat-yacht lower than boat-monkey. | No repository test or logged embedding comparison found. | Unknown, add synthetic embedding test. |
| Football users retrieve football content | Football-heavy user event sequence retrieves football items in top K. | User sequences and user-facet ranker features exist, but no golden test found. | Unknown, add synthetic recommendation test. |
| Metadata-rich new items cold start | New item with matching category/tags can surface without interaction history. | Item tower consumes metadata and Catalog Intelligence computes metadata similarity, but no golden test found. | Unknown, add cold-start fixture. |

## Embedding Generation, Storage, and Query Review

| Topic | Actual Behaviour | Evidence | Confidence |
| --- | --- | --- | --- |
| Dimension | Retrieval lambda expects exactly 64 values. Training default is `EMBEDDING_DIM = 64`. | `recommendation-lambda.ts:12`, `recommendation-lambda.ts:777-791`, `train.py:105-110` | High |
| Why 64 dimensions | Code exposes 64 as a default config and validates it. It does not contain an ablation, benchmark, or design note proving 64 is sufficient. | `train.py:107-110`, `recommendation-lambda.ts:12` | High that it is configured; Unknown why/sufficient |
| User embedding generation | Events are read per user, sorted by timestamp, converted into sliding-window sequences, padded to `SEQUENCE_LENGTH`, and weighted by event weight/freshness. | `train.py:300-474` | High |
| Item embedding generation | Items are represented by ID, name, description, and metadata text. Text is encoded by Universal Sentence Encoder, combined with item ID embedding, dense projected, and L2-normalized. | `train.py:530-582` | High |
| Inference item payload | Item ingestion calls SageMaker with `mode: "item"` and item ID/name/description/metadata. | `items-lambda.ts:94-170` | High |
| User embedding refresh | Event ingestion has refresh controls, invokes model in user mode, and upserts user embeddings into `embeddings`. | `events-lambda.ts:33-68`, `events-lambda.ts:732-735`, `events-lambda.ts:771` | Medium |
| Storage | Items and user embeddings are inserted/updated using `$n::vector`. | `items-lambda.ts:579-670`, `events-lambda.ts:732-735`, `events-lambda.ts:771` | High |
| pgvector schema/index | Serving code depends on pgvector operators. The audited migrations do not include a `CREATE EXTENSION vector`, `vector(64)` column definition, or HNSW/IVFFLAT index for `embeddings.embedding`. | Search results over `migrations`, `infra`, and `lib`; retrieval uses `::vector` and `<=>`. | Unknown/Gap |

Assessment: 64 dimensions may be operationally pragmatic for latency and storage, but sufficiency cannot be asserted from code. Add an offline ablation comparing 32/64/128/256 dimensions on Recall@K, NDCG@K, MRR, storage size, and retrieval latency before documenting 64 as sufficient.

## Model Architecture Review

| Requirement | Actual Behaviour | Evidence | Confidence |
| --- | --- | --- | --- |
| Two-tower / GRU | Retrieval model has separate `UserModel` and `ItemModel`; user model includes a GRU over item sequence embeddings. | `train.py:530-647` | High |
| Recent and historical behaviour | Sliding windows use the last `SEQUENCE_LENGTH` positive events before each target; default sequence length is 10. This captures recent behaviour. Historical behaviour beyond the window is only indirectly represented by repeated examples and ID embedding. | `train.py:107`, `train.py:372-433`, `train.py:588-633` | Medium |
| Item metadata/content | Item tower uses item ID plus USE text over name, description, metadata. | `train.py:530-582`, `shared/text_formatter.py` referenced by `train.py:71` | High |
| Event sequences | Events are grouped by user, sorted by timestamp, split into positive sequences, and exported to TensorFlow datasets. | `train.py:300-474` | High |
| Custom events and weights | Training input expects `weight`; event export and ranker use `event_types.value / 100` where present. | `train.py:15-23`, `train.py:322-330`, `recommendation-lambda.ts:2056-2076`, `rank_train.py:16-19` | Medium |
| Tenant fine-tuning | Schema separates base and tenant models; endpoint resolver prefers tenant fine-tuned model for context family, then base, then general. | `010_model_families.sql:1-147`, `recommendation-lambda.ts:838-962` | Medium |
| Base/fine-tuned families and versions | Tables exist for `model_families`, `base_models`, `tenant_models`, `model_versions`, `serving_deployments`, and deployment history. | `010_model_families.sql:26-147`, `012_model_lifecycle_and_history.sql:16-60` | High |
| Fine-tuning improves relevance | No repository evidence proves tenant fine-tuning improves offline metrics over base models. | No test/log artifact found in audited paths. | Unknown |

Recommendation: keep the current two-tower + GRU architecture as the baseline. Improve it with explicit long-term user profile features, tenant-specific offline evaluation gates, dimensionality ablation, and production trace tests before replacing it. Replacement is not justified by the current evidence; the main problem is missing proof, not clearly wrong architecture.

## Ranking and Reranking Audit

| Check | Actual Behaviour | Evidence | Confidence |
| --- | --- | --- | --- |
| Ranker technology | XGBoost second-stage ranker is implemented in `rank_train.py`; README describes it after pgvector retrieval and before rules/pins. | `rank_train.py:1-19`, `README-ranker.md:1-12` | High |
| Features used | Production feature list has retrieval score, freshness, context bucket, metadata flag, popularity/serves, user-item interactions, user-facet interactions, fatigue, and weighted engagement. | `recommendation-lambda.ts:568-702`, `rank_train.py:53-79` | High |
| Ranker input safety | Feature field names are validated for facets; ranker invocation sends numeric feature matrix only; endpoint call has timeout. | `recommendation-lambda.ts:605-621`, `recommendation-lambda.ts:2132-2167` | High |
| Boundedness | Returned score array must exist and match candidate count before application. | `recommendation-lambda.ts:2169-2198` | High |
| Fallback | If configured `fallback_on_error` is not false, ranker failures preserve existing scores. | `recommendation-lambda.ts:1935-1948`, `recommendation-lambda.ts:2199-2205` | High |
| Determinism | Core vector retrieval is deterministic for fixed DB state. Exploration uses SQL `ORDER BY RANDOM()` for slot injection and deterministic hash jitter for weighted-topic `explore`. | `recommendation-lambda.ts:2631-2643`, `recommendation-lambda.ts:3109-3144` | Medium |
| LLM input | No LLM is in the serving ranking path found. | Search of serving files; ranker uses SageMaker numeric features. | Medium |
| Offline metrics | Retrieval training emits Recall@K and popularity baseline. Ranker training emits RMSE/MAE. NDCG/MRR are not present in the audited training scripts. | `train.py:688-842`, `train.py:1044-1104`, `rank_train.py:175-205` | Medium |

Score separation in traces:

| Trace Field | Meaning | Evidence |
| --- | --- | --- |
| `score.base` | Initial vector-derived score before later stages. | `recommendation-lambda.ts:1831-1842`, `recommendation-lambda.ts:3680-3686` |
| `score.retrieval` | Stored pre-ranker score when ranker runs, otherwise base score. | `recommendation-lambda.ts:2173-2178`, `recommendation-lambda.ts:3680-3686` |
| `score.ranker` | Second-stage ranker score when applied. | `recommendation-lambda.ts:2173-2189`, `recommendation-lambda.ts:3680-3686` |
| Rule adjustments | Per-item `rules_considered` and applied `rule_adjustments`. | `recommendation-lambda.ts:3152-3179`, `recommendation-lambda.ts:3707` |
| Final position | `rank: index + 1` after pagination slice. | `recommendation-lambda.ts:3739-3746` |
| Diversity/exploration | Score events and source labels are included for exploration and post-processing. | `recommendation-lambda.ts:2619-2690`, `recommendation-lambda.ts:3635-3679` |

Known issue: `infra/lambda/__tests__/ranker-features.test.mjs` is stale. It asserts a 9-feature inline helper (`ranker-features.test.mjs:27-57`) while production now uses 17 features (`recommendation-lambda.ts:571-594`). The standalone test passed, but it is not sufficient evidence for production feature contract correctness.

## Customer Rules Review

Rules are stored in `ranking_rules` with `team_id`, optional `context_id`, active flag, type, JSON conditions/actions, and priority (`001_ranking_platform.sql:5-20`). Serving loads only active rules for the tenant and global/current context, honoring `start_date` and `end_date` (`recommendation-lambda.ts:2907-2925`).

| Scenario | Implementation Evidence | Proven by Tests? | Audit Result |
| --- | --- | --- | --- |
| Pin item to slot 3 | Pin uses `pin_position`, 1-based, applied after score sort (`recommendation-lambda.ts:3331-3355`). | No end-to-end trace test. | Implemented, not proven. |
| Boost a category | `boost` multiplies score when conditions match metadata fields (`recommendation-lambda.ts:3184-3200`). | Helper tests only. | Implemented, not proven end-to-end. |
| Demote metadata flag | `bury` multiplies score by configured/default weight when conditions match (`recommendation-lambda.ts:3201-3217`). | Helper tests only. | Implemented, not proven end-to-end. |
| Suppress an item | `filter` removes matched items (`recommendation-lambda.ts:3253-3263`). | No end-to-end trace for removed-item explanation. | Implemented, trace for removed item is lost. |
| Exclude viewed items | Context flag queries `user_events` and adds `entity_id NOT IN (...)` filter (`recommendation-lambda.ts:1321-1395`, `recommendation-lambda.ts:1686-1692`). | No synthetic test found. | Implemented, not proven. |
| Force include content | No explicit serving rule type named `force_include` was found. `ensure_top` appears in UI types but default serving switch records unsupported rule types as not applied. | `RulesClient.tsx:83`, `recommendation-lambda.ts:3305-3318` | Unknown/not implemented in serving path. |
| Group by metadata | Context grouping exists after recommendation assembly, and UI has `group_by`. Rule type `group_by` is not applied by serving switch. | `recommendation-lambda.ts:3457-3819`, `recommendation-lambda.ts:3305-3318`, `RulesClient.tsx:83` | Partly implemented via context, not as rule. |
| Add diversity | Rule-level `diversity` caps per metadata bucket; post-processing diversity enforcement can reposition consecutive buckets. | `recommendation-lambda.ts:3283-3303`, `recommendation-lambda.ts:3397-3425` | Implemented, not proven end-to-end. |
| Add exploration | Pipeline `exploration_pct` injects random unseen active items; weighted-topic `explore` applies deterministic jitter. | `recommendation-lambda.ts:2619-2690`, `recommendation-lambda.ts:3138-3144` | Implemented, not proven quality-safe. |
| Time-bounded rules | Rule SQL filters `start_date <= NOW()` and `end_date >= NOW()`. | `recommendation-lambda.ts:2915-2925` | Implemented, not proven. |
| Context-specific rules | Serving loads global plus matching context when context is present; otherwise only global. | `recommendation-lambda.ts:2909-2925` | Implemented. |
| Tenant-specific rules | Rule SQL filters `team_id = tenantId`. | `recommendation-lambda.ts:2915-2925` | Implemented. |

Rule explainability: applied and considered rules are recorded per surviving item (`recommendation-lambda.ts:3152-3179`) and returned in item explanations (`recommendation-lambda.ts:3707`). Filtered-out items are removed, so their explanation is not returned; this prevents proving suppression reasons from the final response alone.

## Tenant Isolation Review

| Surface | Isolation Evidence | Confidence |
| --- | --- | --- |
| Serving tenant resolution | OAuth client maps Cognito client to team ID; team ID becomes `tenantId`. | `recommendation-lambda.ts:1218-1239` | High |
| Context lookup | `contexts` lookup includes `team_id = tenantId`. | `recommendation-lambda.ts:1272-1289` | High |
| Embedding retrieval | User, item, and candidate embedding queries filter by `tenant_id`. | `recommendation-lambda.ts:759-836`, `recommendation-lambda.ts:1794-1807` | High |
| Events | Event write/read code uses tenant ID and validates configured event types by tenant. | `events-lambda.ts:405`, `events-lambda.ts:1198-1234` | Medium |
| Items | Item CRUD resolves tenant from OAuth client and queries `embeddings` by tenant. | `items-lambda.ts:392-424`, `items-lambda.ts:488-750` | High |
| Rules and pipelines | Queries filter by tenant/team and optional context. | `recommendation-lambda.ts:1745-1768`, `recommendation-lambda.ts:2907-2925` | High |
| Model endpoints | Context-family model resolution filters tenant models by `tm.team_id = tenantId` and contexts by `team_id`. | `recommendation-lambda.ts:853-912` | High |

Gap: No checked-in tenant-leakage regression test creates two tenants with overlapping item IDs/events/rules and proves zero cross-tenant retrieval, rule, model, and telemetry leakage.

## Model Family, Version, Base Model, and Fine-Tuned Model Review

Schema evidence:

| Object | Evidence | Notes |
| --- | --- | --- |
| Model families | `model_families` has `family_key`, `architecture`, `objective`, `feature_set`, default flag, and enabled flag. | `010_model_families.sql:26-39` |
| Base models | `base_models` are family-scoped, versioned, statused, have dimensions and publish metadata. | `010_model_families.sql:48-68` |
| Tenant models | `tenant_models` include `team_id`, family, base model, version, status, training job, package ARN, dimensions. | `010_model_families.sql:73-91` |
| Immutable versions | `model_versions` stores source, base/tenant parent, version, status, metrics. | `010_model_families.sql:97-115` |
| Deployments | `serving_deployments` maps base/tenant models to endpoint names per environment. | `010_model_families.sql:121-137` |
| Lifecycle history | `lifecycle_state` and `serving_deployment_history` track promotion/retirement. | `012_model_lifecycle_and_history.sql:16-60` |
| Serving resolution | Endpoint resolver prioritizes tenant fine-tuned production deployment, family base, then general base. | `recommendation-lambda.ts:838-962` |

Audit result: separation exists in schema and serving resolution. Unknown: there is no proof that tenant fine-tuned models improve relevance or that version promotion/rollback is covered by regression tests.

## Custom Event and Weighting Review

| Requirement | Evidence | Result |
| --- | --- | --- |
| Custom event types | API accepts `type`, `eventType`, `event_id`, etc. and stores normalized `event_id`. | `events-lambda.ts:81-130`, `events-lambda.ts:405` | Implemented |
| Tenant event weights | Ranker weighted engagement joins `event_types` on event ID and tenant ID, with `value / 100`. | `recommendation-lambda.ts:2056-2076` | Implemented |
| Training weights | Retrieval training reads `weight`, clamps to `[-1, 1]`, and applies it as `sample_weight` with freshness decay. | `train.py:322-330`, `train.py:393-430`, `train.py:643-647` | Implemented |
| Event-sequence model impact | Positive weighted events generate target examples; hard negatives are optional. | `train.py:376-453` | Implemented |
| Customer-configured weights affect embeddings | The training file supports weight values, but the exact export path from `event_types.value` into retrieval `weight` was not fully proven in this audit. | `train.py:15-23`, `lib/training-data.ts` referenced by search | Unknown |

## Recommendation Traces

A recommendation item explanation is expected to include:

```json
{
  "item_id": "itm_example",
  "rank": 1,
  "source": "model",
  "score": {
    "final": 0.82,
    "base": 0.74,
    "cosine_distance": 0.35,
    "retrieval": 0.74,
    "ranker": 0.82
  },
  "embedding": {
    "source": "db",
    "used_default": false,
    "default_reason": null,
    "dimension": 64,
    "scoring_vector": "user_profile"
  },
  "rules": [
    {
      "rule_id": 12,
      "rule_name": "Boost football",
      "rule_type": "boost",
      "matched": true,
      "applied": true,
      "effect": "score x 1.5"
    }
  ]
}
```

This is a code-derived trace shape, not a captured production log. Evidence for fields is `recommendation-lambda.ts:3638-3748`. Captured golden traces should be added for every synthetic scenario because current repository tests do not prove final candidate order and explanation output.

## Validation Matrix: Expected vs Actual Behaviour

| Area | Expected Behaviour | Actual Proven Behaviour | Status |
| --- | --- | --- | --- |
| Retrieval semantic sanity | Similar concepts rank closer than unrelated concepts. | Vector retrieval exists; no semantic golden test. | Unknown |
| Behavioural retrieval | Recent/history events affect user embedding and football users retrieve football. | Sequence model and ranker history features exist; no golden test. | Unknown |
| Metadata cold start | Metadata-rich item can rank without interactions. | Metadata enters item embeddings and Catalog Intelligence; no cold-start golden test. | Unknown |
| pgvector correctness | Extension, vector dimension, ANN index, query operator all configured. | Query operator and casts found; schema/index not found in migrations. | Partial |
| 64-dim sufficiency | 64 dimensions meets quality/latency target. | 64 is default and enforced; no ablation evidence. | Unknown |
| Learned ranker | Ranker uses bounded numeric feature matrix and does not silently corrupt ordering. | Score-count validation and fallback exist. | Implemented, partially tested |
| Rules | Pin, boost, bury, filter, cap, diversity affect ranking with explanations. | Serving code applies them and returns surviving-item explanations. | Implemented, not end-to-end proven |
| Tenant isolation | No cross-tenant data/model/rule leakage. | Queries are tenant-scoped. No leakage fixtures. | Mostly implemented, not proven |
| Model versioning | Base, fine-tuned, family, version, deployment are separated. | Schema and resolver prove separation. | Implemented |
| Metrics | Recall@K, Precision@K, NDCG@K, MRR, coverage, diversity, cold start, rule compliance, leakage, latency. | Recall@K and ranker RMSE/MAE exist; others missing or not found. | Partial |

## Synthetic Test Scenarios To Add

Create a repeatable fixture under `nsl_admin_console_next/__tests__/recommendations/fixtures` with deterministic in-memory or test-DB data:

1. `semantic_similarity.test`: insert boat, yacht, monkey item embeddings or use deterministic model inference; assert distance boat-yacht < boat-monkey.
2. `football_user_retrieval.test`: create a user with football event sequence, football and non-football catalog items, assert Recall@5 and top category.
3. `metadata_cold_start.test`: create metadata-rich unseen item and user/context affinity; assert item appears without interaction history.
4. `tenant_isolation.test`: two tenants share item IDs and rules; assert tenant A never returns tenant B rows, rules, events, or endpoints.
5. `rules_trace.test`: table-driven cases for pin slot 3, boost category, demote flag, suppress item, exclude viewed, diversity, exploration, time-bounded, context-specific, tenant-specific rules; assert final order and explanation fields.
6. `model_resolution.test`: seed base, tenant, family, version, deployment rows; assert resolver picks tenant fine-tune, family base, general fallback in order.
7. `ranker_contract.test`: import or share production `RANKER_FEATURE_NAMES`; assert feature vector count/order matches `rank_train.py` and `feature_meta.json`.
8. `latency_budget.test`: benchmark retrieval and ranking latency on fixed candidate counts; store thresholds in CI.

## Metrics Scorecard

| Metric | Present? | Evidence | Gap |
| --- | --- | --- | --- |
| Recall@K | Yes for retrieval training | `train.py:688-842`, `train.py:1044-1088` | Need CI thresholds and fixture outputs. |
| Precision@K | Not found | Search across training/eval scripts. | Add evaluator. |
| NDCG@K | Not found | Search across training/eval scripts. | Add evaluator. |
| MRR | Not found | Search across training/eval scripts. | Add evaluator. |
| Coverage | Not found as offline metric | Analytics may calculate catalogue coverage, but not golden validation. | Add evaluator. |
| Diversity | Runtime rules/post-processing exist | `recommendation-lambda.ts:3283-3303`, `recommendation-lambda.ts:3397-3425` | Add diversity metric and fixture. |
| Cold-start performance | No metric found | Cold-start fallback exists (`recommendation-lambda.ts:1867-1924`). | Add cold-start Recall@K/NDCG@K. |
| Rule compliance | No end-to-end metric found | Rule engine traces exist. | Add compliance rate over scenario table. |
| Tenant leakage | No metric found | Tenant-scoped SQL exists. | Add leakage count metric. |
| Retrieval latency | Process duration stored, but no retrieval-only budget found. | `recommendation-lambda.ts:1816-1829` | Add stage latency instrumentation. |
| Ranking latency | Ranker latency captured. | `recommendation-lambda.ts:2140-2167`, `recommendation-lambda.ts:3524-3530` | Add CI/prod SLO. |

## Tests Run During Audit

| Command | Result | Notes |
| --- | --- | --- |
| `npm test -- --run __tests__/lib/rule-eval.test.ts lib/__tests__/rerank-controls.test.mjs infra/lambda/__tests__/ranker-features.test.mjs` | Passed: 2 files, 11 tests. | Vitest did not run the Node `.mjs` ranker feature test. |
| `node infra/lambda/__tests__/ranker-features.test.mjs` | Passed: 20 tests. | Test is stale versus production feature count, so it is weak evidence. |

## Risk Register

| Risk | Severity | Evidence | Recommendation |
| --- | --- | --- | --- |
| Retrieval quality unproven | High | No golden semantic/behaviour/cold-start tests found. | Add deterministic synthetic retrieval suite before release claims. |
| 64-dimensional sufficiency unproven | Medium | 64 is a default/enforced dimension, not justified by metrics. | Run dimension ablation and publish quality/latency tradeoff. |
| pgvector schema/index not found in migrations | High | Serving uses `::vector` and `<=>`; migrations searched did not define extension/index. | Add migration or document external schema source, including HNSW/IVFFLAT index. |
| Stale ranker feature test | Medium | Test checks 9 inline features; production has 17 features. | Export shared feature contract and use it in tests/training. |
| Filtered-item explanation lost | Medium | Filter removes item after `noteRule`; final response cannot show suppression reason. | Add response-level `suppressed_items` trace in debug/explain mode. |
| Force include not proven | Medium | UI lists `ensure_top`, serving switch default does not apply unsupported rule types. | Implement force/include semantics or remove exposed rule type. |
| Random exploration can affect determinism | Medium | Exploration SQL uses `ORDER BY RANDOM()`. | Add seedable exploration for tests and deterministic mode for audits. |
| Tenant leakage untested | High | SQL is scoped but no fixture proves isolation. | Add cross-tenant regression tests. |
| Fine-tuning improvement unproven | Medium | Model registry/resolution exists, no base-vs-fine-tune evaluation artifact. | Require offline metric delta before promotion. |
| Metrics incomplete | Medium | Precision@K, NDCG@K, MRR, coverage, leakage, and latency scorecards missing. | Build evaluator and CI gate. |

## Recommended Engineering Changes

1. Build a `recommendation-validation` test harness with fixed synthetic tenants, users, items, embeddings, rules, contexts, and model deployments.
2. Add golden trace snapshots containing candidates, base scores, ranker scores, rule adjustments, diversity/exploration changes, editorial overrides, final positions, and explanations.
3. Move `RANKER_FEATURE_NAMES` to a shared contract imported by serving, rank export, rank training, rank inference, and tests.
4. Add a migration or documented IaC source for `pgvector` extension, `embeddings.embedding vector(64)`, and ANN index configuration.
5. Add dimension ablation experiments for 32/64/128/256 with Recall@K, NDCG@K, MRR, latency, and storage results.
6. Add tenant leakage tests across embeddings, events, rules, contexts, model endpoints, and telemetry.
7. Add rule compliance tests for pin, boost, bury, filter/suppress, exclude viewed, force include, group by, diversity, exploration, time windows, context scoping, and tenant scoping.
8. Add offline evaluator metrics: Precision@K, NDCG@K, MRR, coverage, diversity, cold-start performance, rule compliance, tenant leakage, retrieval latency, ranking latency.
9. Add debug/explain support for suppressed items so filter and exclusion rules can be audited after removal.
10. Gate tenant fine-tune promotion on base-vs-fine-tune metric deltas and store the results in `model_versions.metrics_json`.

## Completion Checklist Against Request

| Requested Deliverable | Included? | Evidence |
| --- | --- | --- |
| Executive summary with confidence levels | Yes | Executive Summary table |
| Current pipeline map | Yes | Current Pipeline Map |
| Retrieval audit | Yes | Retrieval Audit |
| Ranking/reranking audit | Yes | Ranking and Reranking Audit |
| Embedding generation, storage, query review | Yes | Embedding Generation section |
| Tenant isolation review | Yes | Tenant Isolation Review |
| Model family/version/base/fine-tuned review | Yes | Model Family section |
| Custom event and weighting review | Yes | Custom Event section |
| Validation matrix expected vs actual | Yes | Validation Matrix |
| Synthetic test scenarios | Yes | Synthetic Test Scenarios |
| Recommendation traces with candidates/scores/rules/positions/explanations | Partial | Trace shape and code references included; no captured live trace exists, marked as code-derived. |
| Metrics scorecard | Yes | Metrics Scorecard |
| Risk register | Yes | Risk Register |
| Recommended engineering changes | Yes | Recommended Engineering Changes |
| Every claim backed or marked assumption/unknown | Yes | Tables include evidence or Unknown/Gap markers |

