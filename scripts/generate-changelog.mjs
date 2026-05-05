import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  {
    id: "console",
    label: "Admin console",
    env: "NSL_CONSOLE_REPO",
    defaultPath: "../nsl_admin_console_next",
    description: "Platform UI, tenant operations, ranking workflows, billing, analytics, and model lifecycle controls.",
  },
  {
    id: "typescript-sdk",
    label: "TypeScript SDK",
    env: "NSL_TYPESCRIPT_SDK_REPO",
    defaultPath: "../neuronsearchlab-sdk",
    description: "Browser and server JavaScript client for recommendations, events, catalog items, and API contract updates.",
  },
  {
    id: "php-sdk",
    label: "PHP SDK",
    env: "NSL_PHP_SDK_REPO",
    defaultPath: "../neuronsearchlab-php-sdk",
    description: "PHP client library and release flow for backend recommendation integrations.",
  },
  {
    id: "mcp",
    label: "MCP server",
    env: "NSL_MCP_REPO",
    defaultPath: "../neuronsearchlab-mcp",
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

function commitLabel(count) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

function dateLabel(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-US", {
    day: "numeric",
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

function changeTypeFor(record) {
  if (record.topic?.id === "reliability" || /^fix\b|fix|error|bug|compat|harden|stabilize/i.test(record.rawSubject)) {
    return "Bug fixes";
  }

  if (/^(chore|ci|test|docs|refactor|rename)\b/i.test(record.rawSubject)) {
    return "Maintenance";
  }

  return "Features";
}

function summarizeChanges(records, type) {
  const items = records
    .filter((record) => changeTypeFor(record) === type)
    .map((record) => (type === "Bug fixes" ? sentenceCase(record.title) : record.topic?.summary))
    .filter(Boolean);
  const unique = [...new Set(items)];
  return unique.slice(0, 5);
}

function sentenceCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function sourceLine(source, records) {
  const features = summarizeChanges(records, "Features");
  const bugs = summarizeChanges(records, "Bug fixes");
  const featureLines = features.length
    ? features.map((item) => `- ${mdEscape(item)}`).join("\n")
    : "- No major feature changes in this period.";
  const bugSection = bugs.length
    ? `
#### Bug fixes

${bugs.map((item) => `- ${mdEscape(item)}`).join("\n")}`
    : "";

  return `### ${source.label}

#### Features

${featureLines}
${bugSection}`;
}

function updateEntry(group) {
  const sourceIds = [...new Set(group.records.map((record) => record.source.id))];
  const monthSources = sources.filter((source) => sourceIds.includes(source.id));
  const descriptionSources = monthSources.map((source) => source.label).join(", ");
  const rss = `${dateLabel(group.key)}: ${descriptionSources}.`;
  const body = monthSources
    .map((source) => sourceLine(source, group.records.filter((record) => record.source.id === source.id)))
    .join("\n\n");

  return `<Update label="${dateLabel(group.key)}" description="${descriptionSources}" rss="${mdEscape(rss)}">

${body}

</Update>`;
}

function dateGroupsFor(nextRecords) {
  return [...nextRecords.reduce((groups, record) => {
    const key = record.date;
    const group = groups.get(key) ?? {key, records: []};
    group.records.push(record);
    groups.set(key, group);
    return groups;
  }, new Map()).values()].sort((a, b) => b.key.localeCompare(a.key));
}

function renderPage({title, description, icon, outputPath, pageRecords, links = ""}) {
  const updates = dateGroupsFor(pageRecords).map(updateEntry).join("\n\n");
  const body = [links, updates].filter(Boolean).join("\n\n");
  const mdx = `---
title: ${JSON.stringify(title)}
icon: ${JSON.stringify(icon)}
description: ${JSON.stringify(description)}
rss: true
---

${body}
`;

  const fullPath = path.join(ROOT, outputPath);
  mkdirSync(path.dirname(fullPath), {recursive: true});
  writeFileSync(fullPath, mdx);
}

const sourceCommits = sources.map((source) => {
  const commits = gitLog(source);
  return {source, commits};
});

const records = sourceCommits.flatMap(({source, commits}) =>
  commits
    .filter((commit) => !isNoise(commit.subject))
    .map((commit) => ({
      source,
      date: commit.date,
      rawSubject: commit.subject,
      title: normalizeSubject(commit.subject),
      topic: topicFor(source, commit),
    })),
);

const sourceLinks = `<CardGroup cols={3}>
  <Card title="Console changes" icon="browser" href="/changelog/console">
    Admin console, ranking controls, analytics, billing, and model lifecycle updates.
  </Card>
  <Card title="SDK changes" icon="code" href="/changelog/sdk">
    TypeScript and PHP SDK updates, API contract changes, and release packaging.
  </Card>
  <Card title="MCP changes" icon="robot" href="/changelog/mcp">
    MCP server tools, platform automation, and assistant integration changes.
  </Card>
</CardGroup>`;

renderPage({
  title: "Changelog",
  icon: "list",
  description: "Release history for the NeuronSearchLab console, SDKs, and MCP server.",
  outputPath: "changelog.mdx",
  pageRecords: records,
  links: sourceLinks,
});

renderPage({
  title: "Console Changelog",
  icon: "browser",
  description: "Release history for the NeuronSearchLab admin console.",
  outputPath: "changelog/console.mdx",
  pageRecords: records.filter((record) => record.source.id === "console"),
});

renderPage({
  title: "SDK Changelog",
  icon: "code",
  description: "Release history for the NeuronSearchLab TypeScript and PHP SDKs.",
  outputPath: "changelog/sdk.mdx",
  pageRecords: records.filter((record) => record.source.id === "typescript-sdk" || record.source.id === "php-sdk"),
});

renderPage({
  title: "MCP Changelog",
  icon: "robot",
  description: "Release history for the NeuronSearchLab MCP server.",
  outputPath: "changelog/mcp.mdx",
  pageRecords: records.filter((record) => record.source.id === "mcp"),
});

console.log(`Generated changelog pages from ${commitLabel(records.length)} summarized product changes across ${sources.length} repositories.`);
