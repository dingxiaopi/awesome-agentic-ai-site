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
// 上游写给维护者的文档（设计笔记、配图生成提示词），不作为学习页面发布
const MAINTAINER_DOC_RE = /(^|\/)(DESIGN\.md|diagrams\/)/;
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

// 标题用于导航和页面 <title>：去掉 Markdown 反引号和开头的 emoji
const firstHeading = (content) => {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) return null;
  return match[1].replace(/`/g, '').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim() || null;
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

// 上游每篇开头都有一行“繁體中文 | English | 简体中文”，站点页头已有语言切换，去掉避免重复
const LANGUAGE_SWITCH_LINE_RE = /^(?:>\s*)?(?:🌐\s*)?(?:(?:\*\*|\[)(?:繁體中文|繁体中文|简体中文|English)(?:\*\*|\]\([^)]*\))\s*\|?\s*){2,}\n/gm;
const LANGUAGE_SWITCH_HTML_RE = /^[ \t]*(?:(?:<a\s[^>]*>|<strong>|<b>)(?:繁體中文|简体中文|English)(?:<\/a>|<\/strong>|<\/b>)\s*\|?\s*){2,}\n/gm;
const stripLanguageSwitch = (content) => content.replace(LANGUAGE_SWITCH_LINE_RE, '').replace(LANGUAGE_SWITCH_HTML_RE, '');

// 站内有对应页面的 .md 链接改成站内路由；其余相对链接（examples/、CONTRIBUTING.md 等网站上没有的文件）指向上游 GitHub
const toUpstreamUrl = (normalized) => {
  const kind = normalized.endsWith('/') || !path.posix.extname(normalized) ? 'tree' : 'blob';
  return `${REPO_WEB_URL}/${kind}/${REPO_REF}/${normalized}`;
};

const resolveRelativeLink = (rawTarget, currentRelativeDir, language) => {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(rawTarget)) return null;
  const [targetPath, hash = ''] = rawTarget.split('#');
  if (!targetPath) return null;
  const normalized = path.posix.normalize(path.posix.join(currentRelativeDir, targetPath));
  if (normalized.startsWith('..')) return null;
  const route = /\.md$/i.test(normalized) && !MAINTAINER_DOC_RE.test(normalized) ? resolveMarkdownRoute(normalized, language) : null;
  return `${route ?? toUpstreamUrl(normalized)}${hash ? `#${hash}` : ''}`;
};

// 只改正文里的链接：代码块和行内代码原样保留（里面常有 [name](**args) 这类看起来像链接的代码）
const FENCED_CODE_RE = /(^(```|~~~)[^\n]*\n[\s\S]*?^\2[^\n]*$)/m;
const INLINE_TOKEN_RE = /`[^`\n]+`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(<a\s[^>]*?href=")([^"]+)(")/g;

const rewriteLinks = (content, currentRelativeDir, language) => {
  const rewriteSegment = (segment) => segment.replace(INLINE_TOKEN_RE, (full, alt, imgTarget, text, linkTarget, aBefore, aTarget, aAfter) => {
    if (imgTarget !== undefined) {
      if (/^(https?:|data:|#)/.test(imgTarget)) return full;
      const normalized = path.posix.normalize(path.posix.join(currentRelativeDir, imgTarget));
      return `![${alt}](/upstream/${normalized})`;
    }
    if (linkTarget !== undefined) {
      const resolved = resolveRelativeLink(linkTarget, currentRelativeDir, language);
      return resolved ? `[${text}](${resolved})` : full;
    }
    if (aTarget !== undefined) {
      const resolved = resolveRelativeLink(aTarget, currentRelativeDir, language);
      return resolved ? `${aBefore}${resolved}${aAfter}` : full;
    }
    return full;
  });

  let output = '';
  let rest = content;
  let match;
  while ((match = FENCED_CODE_RE.exec(rest))) {
    output += rewriteSegment(rest.slice(0, match.index)) + match[0];
    rest = rest.slice(match.index + match[0].length);
  }
  return output + rewriteSegment(rest);
};

const resolveMarkdownRoute = (normalized, currentLanguage) => {
  const clean = normalized.replace(/^\.\//, '').replace(/^\//, '');
  const parts = clean.split('/');
  // 仓库根目录的 README 对应网站首页；各栏目目录里的 README 是普通页面
  if (parts.length === 1 && README_BASENAME_RE.test(clean)) {
    return buildLangPath(currentLanguage, '/');
  }
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
        if (MAINTAINER_DOC_RE.test(relativePath)) continue;

        const raw = await fs.readFile(sourcePath, 'utf8');
        const normalizedRaw = stripLanguageSwitch(normalizeCodeFences(raw));
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
