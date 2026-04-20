import type { NewsItem, Position } from '../monthly-brief/types';

// Searches Google News RSS for each portfolio company name. Google News
// aggregates FT, Reuters, Bloomberg and others so it serves as the proxy
// after Bloomberg shut down public RSS in 2019.
// XML is parsed inline with regex — no rss-parser dependency needed.

const RSS_HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, text/xml' };

function parseRssItems(xml: string, fallbackSource: string): { title: string; source: string; date: string }[] {
  const out: { title: string; source: string; date: string }[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const block of blocks.slice(0, 5)) {
    const rawTitle = (
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
    ).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

    const raw = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
    let date = 'recent';
    try { if (raw) date = new Date(raw).toISOString().slice(0, 10); } catch { /* keep 'recent' */ }

    // Google News RSS embeds the source at the end of the title as " - Source Name".
    let title  = rawTitle;
    let source = fallbackSource;
    const xmlSource = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim();
    if (xmlSource) {
      source = xmlSource;
    } else {
      const dashIdx = rawTitle.lastIndexOf(' - ');
      if (dashIdx !== -1) {
        title  = rawTitle.slice(0, dashIdx).trim();
        source = rawTitle.slice(dashIdx + 3).trim();
      }
    }

    if (title.length > 8) out.push({ title, source, date });
  }
  return out;
}

async function fetchCompanyNews(companyName: string): Promise<NewsItem[]> {
  // Two queries: exact company name + broader name (first two words) to catch
  // articles that abbreviate the company name.
  const q1   = encodeURIComponent(`"${companyName}"`);
  const name2words = companyName.split(/\s+/).slice(0, 2).join(' ');
  const q2   = encodeURIComponent(name2words);
  const tail = '&hl=en-GB&gl=GB&ceid=GB:en';
  const base = 'https://news.google.com/rss/search?q=';

  const [res1, res2, res3] = await Promise.allSettled([
    fetch(`${base}${q1}${tail}`,                      { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
    fetch(`${base}${q2}${tail}`,                      { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
    fetch(`${base}${q1}+site%3Abloomberg.com${tail}`, { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) }),
  ]);

  const seen  = new Set<string>();
  const items: NewsItem[] = [];

  const add = (parsed: ReturnType<typeof parseRssItems>) => {
    for (const p of parsed) {
      const key = p.title.toLowerCase().slice(0, 40);
      if (!seen.has(key)) { seen.add(key); items.push({ company: companyName, ...p }); }
    }
  };

  if (res1.status === 'fulfilled' && res1.value.ok)
    add(parseRssItems(await res1.value.text(), 'News'));
  if (res2.status === 'fulfilled' && res2.value.ok)
    add(parseRssItems(await res2.value.text(), 'News'));
  if (res3.status === 'fulfilled' && res3.value.ok)
    add(parseRssItems(await res3.value.text(), 'News'));

  // Real FT/Bloomberg journalism floats to the top; company announcement feeds sink to bottom
  const isPremium = (s: string) => s === 'Financial Times' || s.toLowerCase().includes('bloomberg');
  const isDemoted = (s: string) => /co\.?\s*announcement|regulatory|filing/i.test(s);
  const priority  = items.filter(i => isPremium(i.source));
  const demoted   = items.filter(i => !isPremium(i.source) && isDemoted(i.source));
  const middle    = items.filter(i => !isPremium(i.source) && !isDemoted(i.source));
  return [...priority, ...middle, ...demoted].slice(0, 5);
}

export async function fetchPortfolioNews(positions: Position[]): Promise<string> {
  if (positions.length === 0) return '[No portfolio news — no positions]';

  // Batch in groups of 3 to be polite to Google News
  const all: NewsItem[] = [];
  const BATCH = 3;
  for (let i = 0; i < positions.length; i += BATCH) {
    const batch = positions.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(p => fetchCompanyNews(p.name)));
    for (const r of settled) if (r.status === 'fulfilled') all.push(...r.value);
  }

  if (all.length === 0)
    return '[No press news found — RSS feeds returned no results or were unavailable]';

  const byCompany: Record<string, NewsItem[]> = {};
  for (const item of all) (byCompany[item.company] ??= []).push(item);

  const lines: string[] = ['=== Press Coverage (Google News RSS + FT RSS, portfolio companies) ===\n'];
  for (const [company, news] of Object.entries(byCompany)) {
    lines.push(`${company.toUpperCase()} (${news.length}):`);
    for (const n of news) lines.push(`  ${n.date} | ${n.source} | ${n.title}`);
    lines.push('');
  }
  return lines.join('\n');
}
