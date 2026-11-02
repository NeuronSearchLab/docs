# NeuronSearchLab public documentation

This repository publishes to https://docs.neuronsearchlab.com through Mintlify. The default branch is the publication branch. Work on a branch and review the rendered preview before merging.

## Information architecture

- **Guides**: choose a starting path, understand the concepts, integrate catalogue/events/recommendations, install a platform integration, and complete a playbook.
- **Console**: follows the product sidebar. Each page explains the controls, their effects and how to verify a change. Related detail pages cover pipelines, context groups and model architectures.
- **SDKs**: complete supported client interfaces, configuration, attribution, errors and version differences. MCP setup is separate from its tool reference.
- **Core API**: application-facing requests and resource contracts.
- **Platform API**: workspace configuration and automation contracts.
- **Changelog**: curated customer-visible changes, with links to current guidance.

Each topic has one canonical owner. Integration guides explain the workflow; console guides explain the UI; SDK pages explain language interfaces; OpenAPI defines the wire contract. Link between them instead of copying long explanations.

## Verify a change

Use Node.js 24:

```bash
npm ci
npm test
npm run check
npx --yes mint@4.2.1184 validate
npx --yes mint@4.2.1184 broken-links --check-anchors
npx --yes mint@4.2.1184 dev --port 3012
```

`npm run check` compiles MDX, parses JSON examples, validates OpenAPI, checks every navigation page and internal link/anchor, rejects orphan pages and redirect chains, checks API-operation coverage, and scans public text for prohibited implementation disclosures. Tests exercise failure cases in the checker. The pull-request workflow runs these checks and the Mintlify validator.

Inspect the rendered overview, quickstart, affected console/SDK guide and API reference. Check code blocks, tables, diagrams, mobile navigation and the relevant tabs. Type-check executable SDK examples against the **published** package version; a source branch is not evidence that an npm/Composer/Swift release supports a method.

## Editorial rules

1. Start with the user's task and an observable outcome. Explain prerequisites, exact current labels, expected results and likely failures.
2. Check behaviour against implementation and the released public contract. Do not invent capabilities, quotas, guarantees, pricing or automatic attribution. Distinguish sample data, preview behaviour and production behaviour.
3. Use integer item/context/event IDs where required. Explain built-in negative event IDs. Preserve per-result request attribution and keep credentials on trusted servers.
4. Keep recommendation architecture details that help users choose and evaluate models. Do not name NSL's hosting providers, databases, queues, deployment services, private source paths, resource identifiers or internal topology. Customer-selected integrations may be named when needed to configure them.
5. Do not publish internal audits, raw OpenAPI infrastructure exports, source commit messages or private repository links. Write changelog entries manually around verified customer-visible changes. There is deliberately no automatic commit-to-changelog publisher.
6. Preserve existing URLs where practical. Add a direct redirect for every removed or moved public page, then update internal links to its canonical destination.
7. Update the explicit OpenAPI operation and its page together. Every operation in either public specification must have exactly one reference page.
8. Never describe internal classes or unreleased SDK helpers as supported public interfaces. Version-specific limitations belong beside the affected method.

Maintenance files are excluded through `.mintignore`. Keep private handoff notes and source-level audit reports outside this publication repository. Do not use a hidden navigation item as a way to keep a file private.

## Publication controls

The `Public documentation checks` workflow validates pull requests and pushes to `main`. Repository administrators should require its `validate` job before merging. A workflow alone does not prevent an administrator or direct push from bypassing review. Mintlify deployment settings and branch protection are managed separately from this repository.
