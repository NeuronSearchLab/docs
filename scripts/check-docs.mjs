import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { compile } from '@mdx-js/mdx';
import GithubSlugger from 'github-slugger';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateRoots = new Set(['.git', '.github', 'node_modules', '.mintlify', 'scripts']);
const privateFiles = new Set(['README.md', 'AGENTS.md', 'package.json', 'package-lock.json']);
const forbidden = [
  /\b(?:hosted|deployed|running|runs|built)\s+(?:on|with|using)\s+(?:Vercel|Azure|Google Cloud|Cloudflare|Render|Railway|Fly\.io)\b/i,
  /\b(?:AWS|Amazon Web Services|Cognito|SageMaker|CloudWatch|CloudFront|DynamoDB|Aurora|Fargate|CodeBuild|EventBridge|ElastiCache|Redshift|RDS|EC2|ECS|EKS|SQS|SNS|IAM|Bedrock|CloudFormation|Lambda|Supabase|Stripe|PostgreSQL|Postgres|Redis)\b/i,
  /(?:amazonaws\.com|\.api\.aws\b|arn:(?:aws|azure)|x-amazon-|execute-api|AKIA[A-Z0-9]{16})/i,
  /(?:\/Users\/|\/home\/[a-z][^ /]*\/|nsl_admin_console|infra\/(?:lambda|lib)|\.env\.local)/,
  /\b(?:Pipeline Config|Rerank Controls|NSL Connect)\b/,
];

export function publicPolicyErrors(text, file) {
  const errors = [];
  for (const [i, line] of text.split('\n').entries()) {
    for (const pattern of forbidden) if (pattern.test(line)) errors.push(`${file}:${i + 1}: public-content policy: ${pattern}`);
    if (/github\.com\/[^\s"<>]+\/(?:commit|commits)\//.test(line)) errors.push(`${file}:${i + 1}: raw commit link in public content`);
  }
  return errors;
}

async function filesIn(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || privateRoots.has(entry.name)) continue;
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(path.join(dir, entry.name), rel));
    else if (!privateFiles.has(rel)) result.push(rel);
  }
  return result;
}
const nodeText = node => node.value ?? (node.children ?? []).map(nodeText).join('');
function headingCollector(anchors) {
  return () => tree => {
    const slugger = new GithubSlugger();
    function walk(node) {
      if (node.type === 'heading') anchors.add(slugger.slug(nodeText(node)));
      for (const child of node.children ?? []) walk(child);
    }
    walk(tree);
  };
}
function pageRefs(value, pages = []) {
  if (Array.isArray(value)) for (const v of value) pageRefs(v, pages);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (k === 'pages') for (const p of v) typeof p === 'string' ? pages.push(p) : pageRefs(p, pages);
    else if (k === 'root' && typeof v === 'string') pages.push(v);
    else pageRefs(v, pages);
  }
  return pages;
}

export async function auditDirectory(dir = root, { specs = true } = {}) {
  const errors = [];
  const files = await filesIn(dir);
  const fileSet = new Set(files);
  const pages = new Map();
  const config = JSON.parse(await readFile(path.join(dir, 'docs.json'), 'utf8'));
  for (const file of files) {
    if (!/\.(?:mdx?|json|ya?ml|html|svg|txt|js|css)$/.test(file)) continue;
    const text = await readFile(path.join(dir, file), 'utf8');
    errors.push(...publicPolicyErrors(text, file));
    if (!file.endsWith('.mdx')) continue;
    try {
      const { data, content } = matter(text);
      if (!data.title || !data.description) errors.push(`${file}: title and description are required`);
      const anchors = new Set();
      await compile(content, { remarkPlugins: [headingCollector(anchors)] });
      for (const m of content.matchAll(/\b(?:id|anchor)=["']([^"']+)["']/g)) anchors.add(m[1]);
      pages.set('/' + file.replace(/\.mdx$/, ''), { file, data, content, anchors });
      for (const block of content.matchAll(/```json[^\n]*\n([\s\S]*?)\n```/g)) {
        try { JSON.parse(block[1]); } catch (e) { errors.push(`${file}: invalid JSON example: ${e.message}`); }
      }
    } catch (e) { errors.push(`${file}: MDX/frontmatter: ${e.message}`); }
  }
  const nav = pageRefs(config.navigation);
  const navSet = new Set(nav.map(p => '/' + p));
  for (const p of nav) if (!pages.has('/' + p)) errors.push(`docs.json: navigation points to missing page ${p}`);
  if (navSet.size !== nav.length) errors.push('docs.json: duplicate navigation page');
  for (const [url, page] of pages) if (!navSet.has(url) && !url.startsWith('/snippets/')) errors.push(`${page.file}: page is not in navigation`);
  const redirects = new Map();
  for (const redir of config.redirects ?? []) {
    if (redirects.has(redir.source)) errors.push(`Duplicate redirect: ${redir.source}`);
    if (pages.has(redir.source)) errors.push(`Redirect shadows page: ${redir.source}`);
    redirects.set(redir.source, redir.destination);
  }
  function checkLink(link, from, { canonical = true } = {}) {
    if (!link || /^(?:[a-z]+:|\/\/)/i.test(link)) return;
    const [targetPart, anchor] = link.split('#');
    const targetNoQuery = targetPart.split('?')[0];
    const base = '/' + from.replace(/\.mdx$/, '');
    const target = (targetNoQuery ? path.posix.resolve(path.posix.dirname(base), targetNoQuery) : base).replace(/\.(?:mdx?|html)$/, '').replace(/\/$/, '');
    if (redirects.has(target)) {
      if (canonical) errors.push(`${from}: link uses old URL ${link}`);
      return;
    }
    const page = pages.get(target);
    if (page) {
      if (anchor && !page.anchors.has(decodeURIComponent(anchor))) errors.push(`${from}: missing anchor ${link}`);
    } else if (!fileSet.has(target.replace(/^\//, ''))) errors.push(`${from}: broken local link ${link}`);
  }
  for (const [source, target] of redirects) {
    if (!source.startsWith('/') || !target.startsWith('/')) errors.push(`Redirect must be local: ${source}`);
    if (redirects.has(target)) errors.push(`Redirect chain or cycle: ${source} → ${target}`);
    checkLink(target, 'docs.json', { canonical: false });
  }
  const operations = new Set();
  for (const page of pages.values()) {
    const prose = page.content.replace(/```[^\n]*\n[\s\S]*?\n```/g, '');
    const links = [...prose.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g), ...prose.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)];
    for (const m of links) checkLink(m[1], page.file);
    if (page.data.openapi) {
      const m = /^\/?(api-reference\/[^ ]+\.json) (GET|POST|PUT|PATCH|DELETE) (\/\S+)$/.exec(page.data.openapi);
      if (!m) { errors.push(`${page.file}: use an explicit spec path, HTTP method and route`); continue; }
      try {
        const spec = JSON.parse(await readFile(path.join(dir, m[1]), 'utf8'));
        const key = `${m[1]} ${m[2]} ${m[3]}`;
        if (!spec.paths?.[m[3]]?.[m[2].toLowerCase()]) errors.push(`${page.file}: operation not in spec: ${key}`);
        if (operations.has(key)) errors.push(`${page.file}: duplicate operation page: ${key}`);
        operations.add(key);
      } catch (e) { errors.push(`${page.file}: ${e.message}`); }
    }
  }
  for (const file of files.filter(f => /^api-reference\/.*openapi\.json$/.test(f))) {
    const spec = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (specs) try { await SwaggerParser.validate(path.join(dir, file), { resolve: { external: false } }); } catch (e) { errors.push(`${file}: OpenAPI: ${e.message}`); }
    for (const [route, value] of Object.entries(spec.paths)) for (const method of Object.keys(value)) {
      if (!['get','post','put','patch','delete'].includes(method)) continue;
      if (!operations.has(`${file} ${method.toUpperCase()} ${route}`)) errors.push(`${file}: operation without a page: ${method.toUpperCase()} ${route}`);
    }
  }
  // Maintenance files must never become document pages or search content.
  const ignore = await readFile(path.join(dir, '.mintignore'), 'utf8').catch(() => '');
  for (const needed of ['scripts/', '.github/', 'README.md', 'node_modules/']) if (!ignore.split('\n').includes(needed)) errors.push(`.mintignore: missing ${needed}`);
  return { errors, pages: pages.size, operations: operations.size, redirects: redirects.size };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditDirectory();
  if (report.errors.length) { console.error(report.errors.join('\n')); process.exitCode = 1; }
  else console.log(`PASS: ${report.pages} MDX pages, ${report.operations} API operations, ${report.redirects} redirects; syntax, JSON examples, navigation, links, anchors, OpenAPI and public-content policy.`);
}
