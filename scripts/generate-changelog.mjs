import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_AT = new Date().toISOString().slice(0, 10);

const sources = [
  {
    id: "console",
    label: "Admin console",
    env: "NSL_CONSOLE_REPO",
    defaultPath: "../nsl_admin_console_next",
    repo: "NeuronSearchLab/nsl_admin_console_next",
    description: "Platform UI, tenant operations, ranking workflows, billing, analytics, and model lifecycle controls.",
  },
  {
    id: "typescript-sdk",
    label: "TypeScript SDK",
    env: "NSL_TYPESCRIPT_SDK_REPO",
    defaultPath: "../neuronsearchlab-sdk",
    repo: "NeuronSearchLab/neuronsearchlab-sdk",
    description: "Browser and server JavaScript client for recommendations, events, catalog items, and API contract updates.",
  },
  {
    id: "php-sdk",
    label: "PHP SDK",
    env: "NSL_PHP_SDK_REPO",
    defaultPath: "../neuronsearchlab-php-sdk",
    repo: "NeuronSearchLab/neuronsearchlab-sdk-php",
    description: "PHP client library and release flow for backend recommendation integrations.",
  },
  {
    id: "mcp",
    label: "MCP server",
    env: "NSL_MCP_REPO",
    defaultPath: "../neuronsearchlab-mcp",
    repo: "NeuronSearchLab/mcp",
    description: "Model Context Protocol tools for assistant-led platform management and analytics.",
  },
];

const topics = [
  {
    id: "platform-foundation",
    label: "Platform foundation",
    match: /(initial|theme|geist|sidebar|layout|navigation|dashboard|topbar|profile|setup checklist|onboarding|readme|favicon)/i,
    summary: "Established the Next.js console shell, product navigation, dashboard surfaces, profile/team areas, and developer-facing project documentation.",
  },
  {
    id: "auth-billing",
    label: "Access and billing",
    match: /(auth|login|signup|register|session|invite|team|billing|stripe|subscription|plan|payment|api key|security|credentials|client)/i,
    summary: "Added account registration, session handling, team invites, API key and SDK credential management, and Stripe-backed billing workflows.",
  },
  {
    id: "data-exploration",
    label: "Catalog, users, and events",
    match: /(catalog|catalogue|explore|item|items|user|users|event|events|ingest|metadata|timeline|history|templates|scheduled|scheduler)/i,
    summary: "Wired live catalog, user, and event data into searchable tables, detail panels, ingest flows, schedulers, and timeline views.",
  },
  {
    id: "analytics",
    label: "Analytics and reporting",
    match: /(analytics|metric|kpi|chart|usage|gauge|funnel|sankey|report|period|tooltip|dashboard data|consumption)/i,
    summary: "Added period-aware dashboards, usage gauges, KPI cards, multi-series charts, saved analytic views, and production data refresh paths.",
  },
  {
    id: "ranking-controls",
    label: "Ranking controls",
    match: /(rank|ranking|rerank|rule|rules|pipeline|segment|experiment|explain|explainability|recommendation|recommendations|filter|facet|fatigue|exploration|trending|discovery)/i,
    summary: "Built rule engines, rerank controls, segmentation, experiment wiring, explainability, discovery feature toggles, and recommendation proxy support.",
  },
  {
    id: "model-lifecycle",
    label: "Model lifecycle",
    match: /(training|train|model|sagemaker|endpoint|deploy|deployment|publish|lambda|embedding|embeddings|fine-tune|fine tune|family|families|inference|ranker|xgboost|docker|image|codebuild|base)/i,
    summary: "Added tenant model families, training kickoff and monitoring, SageMaker deployment automation, learned rankers, embedding refreshes, and endpoint promotion tooling.",
  },
  {
    id: "assistant-mcp",
    label: "Assistant and MCP",
    match: /(assistant|mcp|chat|tool|transport|ai sdk|streaming|starter prompt|standalone)/i,
    summary: "Introduced the in-console assistant, connected MCP tools, hardened transport options, and routed analytics and management actions through platform APIs.",
  },
  {
    id: "reliability",
    label: "Reliability and CI",
    match: /(fix|ci|test|vitest|playwright|qa|build|type|typescript|error|harden|stabilize|lockfile|node|vercel|workflow|migration|cast|rds|aurora|compat|revert|remove node_modules|gitignore|security alerts)/i,
    summary: "Hardened CI, test coverage, build compatibility, database type handling, migration paths, API errors, and production runtime behavior.",
  },
  {
    id: "sdk-contract",
    label: "SDK API contract",
    match: /(context|recommendation|event|item|delete|raw|identifier|api contract|v1|request|session|metadata|contentid|tables|timeout|http|error)/i,
    summary: "Expanded SDK calls around recommendation contexts, event payloads, item identifiers, item deletion, request/session metadata, and the v1 API contract.",
  },
  {
    id: "sdk-distribution",
    label: "SDK distribution",
    match: /(release|publish|version|bump|package|exports|module|npm|composer|workflow|dist|build|logger|typescript|security alerts|gitignore)/i,
    summary: "Improved package metadata, release workflows, version bumps, dual module exports, generated builds, dependency hygiene, and logging.",
  },
  {
    id: "mcp-tools",
    label: "MCP tools",
    match: /(tool|contexts|pipelines|rules|event type|analytics|api|error|server|subpath|install|dist|docs|test results)/i,
    summary: "Expanded MCP coverage from the first server release into contexts, pipelines, rules, event types, analytics, install paths, and clearer API error handling.",
  },
];

const sourceTopics = {
  console: [
    "platform-foundation",
    "auth-billing",
    "data-exploration",
    "analytics",
    "ranking-controls",
    "model-lifecycle",
    "assistant-mcp",
    "reliability",
  ],
  "typescript-sdk": ["sdk-contract", "sdk-distribution", "reliability"],
  "php-sdk": ["sdk-contract", "sdk-distribution"],
  mcp: ["mcp-tools", "sdk-distribution", "reliability"],
};

function repoPath(source) {
  return path.resolve(ROOT, process.env[source.env] ?? source.defaultPath);
}

function gitLog(source) {
  const cwd = repoPath(source);
  if (!existsSync(path.join(cwd, ".git"))) {
    throw new Error(`Missing git repository for ${source.label}: ${cwd}`);
  }

  const output = execFileSync(
    "git",
    ["log", "--date=short", "--pretty=format:%H%x1f%h%x1f%ad%x1f%s%x1e", "--reverse"],
    {cwd, encoding: "utf8"},
  );

  return output
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, shortSha, date, subject] = row.split("\x1f");
      return {sha, shortSha, date, subject};
    });
}

function isNoise(subject) {
  const trimmed = subject.trim();
  return (
    /^merge pull request/i.test(trimmed) ||
    /^(trigger release|test$|chore: trigger redeploy|chore: force redeploy|minor version changes|version update|version packages|new changes|new updates|new additions|new publishe changes|page title changes|general updates|removing model tracks ui)$/i.test(
      trimmed,
    )
  );
}

function normalizeSubject(subject) {
  return subject
    .replace(/^(feat|fix|docs|test|ci|chore|redesign|refactor|rename|agents)(\([^)]+\))?:\s*/i, "")
    .replace(/\s+—\s+/g, ": ")
    .trim();
}

function mdEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function commitUrl(source, commit) {
  return `https://github.com/${source.repo}/commit/${commit.sha}`;
}

function versionList(commits) {
  return commits
    .filter((commit) => /^v?\d+\.\d+\.\d+$/.test(commit.subject.trim()) || /bump version|update version|prepare .* release/i.test(commit.subject))
    .map((commit) =>
      normalizeSubject(commit.subject)
        .replace(/^Bump version to /i, "")
        .replace(/^Update version to /i, ""),
    )
    .slice(-8);
}

function commitLabel(count) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

function sourceTag(source) {
  if (source.id === "console") return "Console";
  if (source.id === "mcp") return "MCP";
  return "SDK";
}

function monthKey(date) {
  return date.slice(0, 7);
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function topicFor(source, commit) {
  const topicIds = sourceTopics[source.id] ?? [];
  return topicIds
    .map((topicId) => topics.find((topic) => topic.id === topicId))
    .find((topic) => topic?.match.test(commit.subject));
}

function sourceLine(source, records) {
  const topicCounts = new Map();
  for (const record of records) {
    const label = record.topic?.label ?? "Other changes";
    topicCounts.set(label, (topicCounts.get(label) ?? 0) + 1);
  }

  const topicsText = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => `${label} (${commitLabel(count)})`)
    .join(", ");

  const examples = records
    .slice(-5)
    .reverse()
    .map((record) => `[${mdEscape(record.title)}](${record.url})`)
    .join("; ");

  return `### ${source.label}

${source.description}

- **Volume:** ${commitLabel(records.length)}
- **Primary areas:** ${topicsText || "General maintenance"}
- **Representative changes:** ${examples}.`;
}

function updateEntry(group) {
  const sourceIds = [...new Set(group.records.map((record) => record.source.id))];
  const monthSources = sources.filter((source) => sourceIds.includes(source.id));
  const tags = [...new Set(monthSources.flatMap((source) => [source.label, sourceTag(source)]))];
  const descriptionSources = monthSources.map((source) => source.label).join(", ");
  const tagsProp = JSON.stringify(tags);
  const rss = `${monthLabel(group.key)}: ${commitLabel(group.records.length)} across ${descriptionSources}.`;
  const body = monthSources
    .map((source) => sourceLine(source, group.records.filter((record) => record.source.id === source.id)))
    .join("\n\n");

  return `<Update label="${monthLabel(group.key)}" description="${commitLabel(group.records.length)} across ${descriptionSources}" tags={${tagsProp}} rss="${mdEscape(rss)}">

${body}

</Update>`;
}

const sourceCommits = sources.map((source) => {
  const commits = gitLog(source);
  return {source, commits};
});

const totalCommits = sourceCommits.reduce((sum, item) => sum + item.commits.length, 0);
const allDates = sourceCommits.flatMap((item) => item.commits.map((commit) => commit.date)).sort();
const dateRange = `${allDates[0]} to ${allDates.at(-1)}`;

const records = sourceCommits.flatMap(({source, commits}) =>
  commits
    .filter((commit) => !isNoise(commit.subject))
    .map((commit) => ({
      source,
      date: commit.date,
      title: normalizeSubject(commit.subject),
      url: commitUrl(source, commit),
      topic: topicFor(source, commit),
    })),
);

const monthGroups = [...records.reduce((groups, record) => {
  const key = monthKey(record.date);
  const group = groups.get(key) ?? {key, records: []};
  group.records.push(record);
  groups.set(key, group);
  return groups;
}, new Map()).values()].sort((a, b) => b.key.localeCompare(a.key));

const mdx = `---
title: Changelog
icon: "clock-rotate-left"
description: "Generated release history for the NeuronSearchLab console, SDKs, and MCP server."
rss: true
---

This changelog is generated from the full git history of the admin console, TypeScript SDK, PHP SDK, and MCP server. The marketing website repository is excluded from the source history.

<Info>
Generated on ${GENERATED_AT} from ${totalCommits} commits across ${sources.length} repositories. Coverage: ${dateRange}. Use the tag filters to switch between Console, SDK, and MCP updates.
</Info>

${monthGroups.map(updateEntry).join("\n\n")}

## Automation

The changelog is refreshed by \`.github/workflows/changelog.yml\` every Monday at 07:24 UTC and can also be regenerated manually with:

\`\`\`bash
node scripts/generate-changelog.mjs
\`\`\`

Override the default sibling repository paths with \`NSL_CONSOLE_REPO\`, \`NSL_TYPESCRIPT_SDK_REPO\`, \`NSL_PHP_SDK_REPO\`, or \`NSL_MCP_REPO\`.
`;

mkdirSync(ROOT, {recursive: true});
writeFileSync(path.join(ROOT, "changelog.mdx"), mdx);
console.log(`Generated changelog.mdx from ${totalCommits} commits across ${sources.length} repositories.`);
