import { getCollection, type CollectionEntry } from 'astro:content';
import type { CollectionKey, SiteLang } from './i18n';
import { buildEntryRoute, createLanguageLinks, filterEntriesByLang, getCollectionLabel } from './i18n';

function stripMarkdown(input?: string) {
  if (!input) return undefined;
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarize(input?: string, maxLength = 88) {
  const cleaned = stripMarkdown(input);
  if (!cleaned) return undefined;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trimEnd()}…`;
}

// 侧边导航用：把 “Stage 1 — LLM 基础（LLM Basics）” 拆成序号 “1” 和短标题 “LLM 基础”；中文标题冒号后的副标题也去掉
export function splitEntryTitle(title: string) {
  const match = title.match(/^(?:Stage\s+)?([A-Z]?\d+(?:\.\d+)?)\s*[—–-]\s*(.+)$/);
  let name = match ? match[2] : title;
  if (/[\u4e00-\u9fff]/.test(name)) {
    name = name.split('：')[0].replace(/\s*（[^（）]*[A-Za-z][^（）]*）\s*$/, '') || name;
  }
  return { index: match?.[1], name };
}

export async function getCollectionByLang(collection: CollectionKey, lang: SiteLang) {
  const entries = await getCollection(collection);
  return filterEntriesByLang(entries as CollectionEntry<CollectionKey>[], lang);
}

export async function getHomeData(lang: SiteLang) {
  const [stages, tracks, branches, resources] = await Promise.all([
    getCollectionByLang('stages', lang),
    getCollectionByLang('tracks', lang),
    getCollectionByLang('branches', lang),
    getCollectionByLang('resources', lang)
  ]);

  return {
    stages,
    tracks,
    branches,
    resources,
    featuredStages: stages.slice(0, 6).map((entry) => ({
      title: entry.data.title,
      href: buildEntryRoute('stages', entry),
      description: summarize(entry.data.description) ?? `Stage ${entry.data.order ?? '-'} 的核心学习内容与建议路径。`,
      meta: `Stage ${entry.data.order ?? '-'}`
    })),
    trackSteps: tracks.slice(0, 3).map((entry) => ({
      title: entry.data.title,
      href: buildEntryRoute('tracks', entry),
      subtitle: summarize(entry.data.description, 72)
    })),
    branchSteps: branches.slice(0, 5).map((entry) => ({
      title: entry.data.title,
      href: buildEntryRoute('branches', entry),
      subtitle: summarize(entry.data.description, 72)
    }))
  };
}

export async function getEntryForLang(collection: CollectionKey, lang: SiteLang, baseSlug: string) {
  const entries = await getCollection(collection);
  const typedEntries = entries as CollectionEntry<CollectionKey>[];
  const filtered = filterEntriesByLang(typedEntries, lang);
  const match = filtered.find((entry) => entry.data.baseSlug === baseSlug);
  if (!match) return null;
  const currentIndex = filtered.findIndex((entry) => entry.data.baseSlug === baseSlug);
  const previousEntry = currentIndex > 0 ? filtered[currentIndex - 1] : null;
  const nextEntry = currentIndex >= 0 && currentIndex < filtered.length - 1 ? filtered[currentIndex + 1] : null;

  return {
    entry: match,
    entries: typedEntries,
    collectionEntries: filtered,
    previousEntry,
    nextEntry,
    cleanedDescription: stripMarkdown(match.data.description),
    summary: summarize(match.data.description),
    languageLinks: createLanguageLinks(collection, typedEntries, baseSlug)
  };
}

export async function getSearchData(lang: SiteLang) {
  const collections: CollectionKey[] = ['stages', 'tracks', 'branches', 'resources', 'walkthroughs'];
  const grouped = await Promise.all(collections.map(async (collection) => ({
    collection,
    entries: await getCollectionByLang(collection, lang)
  })));

  return grouped.flatMap(({ collection, entries }) =>
    entries.map((entry) => ({
      title: entry.data.title,
      href: buildEntryRoute(collection, entry),
      description: summarize(entry.data.description, 120) ?? '',
      collection,
      collectionLabel: getCollectionLabel(collection, lang),
      section: entry.data.section,
      language: entry.data.language,
      languageLabel: entry.data.languageLabel,
      meta: entry.data.order !== undefined
        ? `${getCollectionLabel(collection, lang)} · ${entry.data.section} ${entry.data.order}`
        : `${getCollectionLabel(collection, lang)} · ${entry.data.section}`,
      searchText: [
        entry.data.title,
        entry.data.description ?? '',
        entry.data.baseSlug,
        entry.data.section,
        entry.data.languageLabel,
        getCollectionLabel(collection, lang)
      ].join(' ')
    }))
  );
}

export { stripMarkdown, summarize };
