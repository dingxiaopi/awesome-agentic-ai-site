import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const CONTENT_ROOT = path.join(PROJECT_ROOT, 'src', 'content');
const DATA_ROOT = path.join(PROJECT_ROOT, 'src', 'data');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const MANIFEST_PATH = path.join(DATA_ROOT, 'sync-manifest.json');
const DEFAULT_REPO_URL = process.env.REPO_URL || 'https://github.com/WenyuChiou/awesome-agentic-ai-zh.git';
const REPO_REF = process.env.REPO_REF || 'main';
const REPO_WEB_URL = DEFAULT_REPO_URL.replace(/\.git$/, '');
const DEFAULT_LANG = 'zh-cn';
const LANG_META = {
  'zh-cn': { label: '简体中文', suffix: '.zh-CN.md', routePrefix: '' },
  'zh-tw': { label: '繁體中文', suffix: '.md', routePrefix: '/zh-tw' },
  en: { label: 'English', suffix: '.en.md', routePrefix: '/en' }
};
const COLLECTION_KEYS = new Set(['stages', 'branches', 'walkthroughs', 'resources', 'tracks']);
const README_BASENAME_RE = /^readme(?:\.[a-z0-9_-]+)?\.md$/i;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'awesome-agentic-ai-site-'));
const repoDir = path.join(tempDir, 'repo');

const sections = [
  { key: 'stages', label: 'Stage', dir: 'stages' },
  { key: 'tracks', label: 'Track', dir: 'tracks' },
  { key: 'branches', label: 'Branch', dir: 'branches' },
  { key: 'resources', label: 'Resource', dir: 'resources' },
  { key: 'walkthroughs', label: 'Walkthrough', dir: 'walkthroughs' }
];

const copyDir = async (from, to) => {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else await fs.copyFile(src, dest);
  }
};

// 不在 git 仓库中时无法比较，按有变化处理
const hasGeneratedChanges = async () => {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', 'src/content', 'public/upstream'], { cwd: PROJECT_ROOT });
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
};

const emptyDir = async (target) => {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
};

const slugify = (value) => value.toLowerCase().replace(/\.md$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const normalizeRelativePath = (value) => value.replace(/\\/g, '/');

const parseLanguage = (filePath) => {
  const normalized = normalizeRelativePath(filePath);
  const lower = normalized.toLowerCase();
  if (lower.endsWith('.en.md') || lower.endsWith('.english.md')) return { language: 'en', extension: normalized.slice(normalized.length - '.en.md'.length) };
  if (/(\.zh[-_.]?(cn|hans)|\.zh[-_.]?sg)\.md$/i.test(normalized)) {
    const match = normalized.match(/(\.zh[-_.]?(?:cn|hans|sg)\.md)$/i);
    return { language: 'zh-cn', extension: match ? match[1] : '.md' };
  }
  if (/(\.zh[-_.]?(tw|hant|hk)|\.zh[-_.]?mo)\.md$/i.test(normalized)) {
    const match = normalized.match(/(\.zh[-_.]?(?:tw|hant|hk|mo)\.md)$/i);
    return { language: 'zh-tw', extension: match ? match[1] : '.md' };
  }
  return { language: 'zh-tw', extension: normalized.match(/\.md$/i)?.[0] || '.md' };
};

const getBaseSlugFromRelativePath = (relativePath) => {
  const { extension } = parseLanguage(relativePath);
  return slugify(relativePath.slice(0, -extension.length));
};

const getOutputSlug = (relativePath) => {
  const { language } = parseLanguage(relativePath);
  const baseSlug = getBaseSlugFromRelativePath(relativePath);
  if (language === 'zh-cn') return `${baseSlug}-zh-cn`;
  if (language === 'en') return `${baseSlug}-en`;
  return baseSlug;
};

const buildLangPath = (language, pathName) => {
  const prefix = LANG_META[language].routePrefix;
  const normalized = pathName === '/' ? '/' : pathName.startsWith('/') ? pathName : `/${pathName}`;
  return prefix ? `${prefix}${normalized === '/' ? '' : normalized}` : normalized;
};

const firstHeading = (content) => {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
};

const stripMarkdown = (value) => value
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^>\s?/gm, '')
  .replace(/^[-*+]\s+/gm, '')
  .replace(/^\d+\.\s+/gm, '')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/[*_~]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const firstParagraph = (content) => {
  const chunks = content
    .split(/\r?\n\r?\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    if (/^(#|>|```|!\[|\[!|[-*]\s|\d+\.)/m.test(chunk)) continue;
    const cleaned = stripMarkdown(chunk);
    if (cleaned.length >= 30) return cleaned.slice(0, 220);
  }

  const fallback = stripMarkdown(content);
  return fallback ? fallback.slice(0, 220) : undefined;
};

const computeOrder = (relativePath) => {
  const match = relativePath.match(/(?:^|\/)(\d{2})[-_]/);
  if (match) return Number(match[1]);
  const alpha = relativePath.match(/(?:^|\/)([Aa]\d+|stage\s*\d+)/i);
  if (alpha) return Number(alpha[1].replace(/[^\d]/g, '')) || undefined;
  return undefined;
};

const normalizeCodeFences = (content) => content
  .replace(/^```gitignore\s*$/gim, '```plaintext')
  .replace(/^```hgignore\s*$/gim, '```plaintext')
  .replace(/^```npmignore\s*$/gim, '```plaintext');

const rewriteLinks = (content, currentRelativeDir, language) => {
  return content
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, rawTarget) => {
      if (/^(https?:|data:|#)/.test(rawTarget)) return full;
      const normalized = path.posix.normalize(path.posix.join(currentRelativeDir, rawTarget));
      return `![${alt}](/upstream/${normalized})`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+\.md(?:#[^)]+)?)\)/g, (full, text, rawTarget) => {
      if (/^https?:/i.test(rawTarget)) return full;
      const [targetPath, hash = ''] = rawTarget.split('#');
      const normalized = path.posix.normalize(path.posix.join(currentRelativeDir, targetPath));
      const route = resolveMarkdownRoute(normalized, language);
      if (!route) return full;
      return `[${text}](${route}${hash ? `#${hash}` : ''})`;
    });
};

const resolveMarkdownRoute = (normalized, currentLanguage) => {
  const clean = normalized.replace(/^\.\//, '').replace(/^\//, '');
  const basename = path.posix.basename(clean);
  if (README_BASENAME_RE.test(basename)) {
    return buildLangPath(currentLanguage, '/');
  }
  const parts = clean.split('/');
  const collection = parts[0];
  if (!COLLECTION_KEYS.has(collection)) return null;
  const { language } = parseLanguage(clean);
  const baseSlug = getBaseSlugFromRelativePath(parts.slice(1).join('/'));
  return buildLangPath(language, `/${collection}/${baseSlug}/`);
};

try {
  console.log(`Cloning ${DEFAULT_REPO_URL}#${REPO_REF} ...`);
  await execFileAsync('git', ['clone', '--depth', '1', '--branch', REPO_REF, DEFAULT_REPO_URL, repoDir], { cwd: tempDir });
  const { stdout: commitStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
  const repoCommit = commitStdout.trim();
  const syncedAt = new Date().toISOString();

  for (const section of sections) {
    await emptyDir(path.join(CONTENT_ROOT, section.key));
  }
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.mkdir(path.join(PUBLIC_ROOT, 'upstream'), { recursive: true });

  const counts = {};

  for (const section of sections) {
    const sourceDir = path.join(repoDir, section.dir);
    const targetDir = path.join(CONTENT_ROOT, section.key);
    counts[section.key] = 0;
    if (!existsSync(sourceDir)) continue;

    const walk = async (dir, relativePrefix = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const sourcePath = path.join(dir, entry.name);
        const relativePath = path.posix.join(relativePrefix, entry.name);
        if (entry.isDirectory()) {
          await walk(sourcePath, relativePath);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;

        const raw = await fs.readFile(sourcePath, 'utf8');
        const normalizedRaw = normalizeCodeFences(raw);
        const { language } = parseLanguage(relativePath);
        const title = firstHeading(normalizedRaw) || entry.name.replace(/\.md$/i, '');
        const description = firstParagraph(normalizedRaw) || `${section.label} 内容页面`;
        const slug = getOutputSlug(relativePath);
        const baseSlug = getBaseSlugFromRelativePath(relativePath);
        const currentRelativeDir = path.posix.dirname(path.posix.join(section.dir, relativePath));
        const rewritten = rewriteLinks(normalizedRaw, currentRelativeDir, language);
        const frontmatter = [
          '---',
          `title: ${JSON.stringify(title)}`,
          `description: ${JSON.stringify(description)}`,
          `section: ${JSON.stringify(section.label)}`,
          `sourcePath: ${JSON.stringify(path.posix.join(section.dir, relativePath))}`,
          `sourceUrl: ${JSON.stringify(`${REPO_WEB_URL}/blob/${REPO_REF}/${path.posix.join(section.dir, relativePath)}`)}`,
          `sourceRepo: ${JSON.stringify(REPO_WEB_URL)}`,
          `language: ${JSON.stringify(language)}`,
          `languageLabel: ${JSON.stringify(LANG_META[language].label)}`,
          `baseSlug: ${JSON.stringify(baseSlug)}`,
          computeOrder(relativePath) !== undefined ? `order: ${computeOrder(relativePath)}` : null,
          '---',
          ''
        ].filter(Boolean).join('\n');
        await fs.writeFile(path.join(targetDir, `${slug}.md`), `${frontmatter}\n${rewritten}`);
        counts[section.key] += 1;
      }
    };

    await walk(sourceDir);
  }

  const resourcesDir = path.join(repoDir, 'resources');
  if (existsSync(resourcesDir)) {
    await fs.rm(path.join(PUBLIC_ROOT, 'upstream', 'resources'), { recursive: true, force: true });
    await copyDir(resourcesDir, path.join(PUBLIC_ROOT, 'upstream', 'resources'));
  }

  const manifest = {
    repoUrl: REPO_WEB_URL,
    repoRef: REPO_REF,
    repoCommit,
    syncedAt,
    defaultLanguage: DEFAULT_LANG,
    counts
  };

  // 上游提交常常只改动网站用不到的文件；生成结果没变时保留旧 manifest，避免产生只改时间戳的提交
  const contentChanged = await hasGeneratedChanges();
  if (!contentChanged && existsSync(MANIFEST_PATH)) {
    console.log(`No content changes from ${repoCommit}; manifest kept as is.`);
  } else {
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log('Sync complete:', manifest);
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
