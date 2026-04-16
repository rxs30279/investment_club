'use client';

import { useState, useEffect, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';

function reportMonthLabel() {
  return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemberArticle {
  id:      string;
  text:    string;   // pasted URL or article text/excerpt
  label:   string;   // optional short label e.g. "Re: Rolls-Royce"
  addedAt: string;   // ISO date string
}

// ── Report frame — renders AI-generated HTML in isolation ─────────────────────

function ReportFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    const resize = () => {
      const body = iframe.contentDocument?.body;
      if (body) setHeight(body.scrollHeight + 40);
    };
    const t1 = setTimeout(resize, 300);
    const t2 = setTimeout(resize, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="Monthly Intelligence Briefing"
      style={{ width: '100%', height: `${height}px`, border: 'none', display: 'block' }}
      sandbox="allow-same-origin allow-popups"
    />
  );
}

// ── Reading List panel ────────────────────────────────────────────────────────

function ReadingList({
  articles,
  onAdd,
  onDelete,
  saving,
}: {
  articles: MemberArticle[];
  onAdd: (text: string, label: string) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const [text,  setText]  = useState('');
  const [label, setLabel] = useState('');

  function submit() {
    const t = text.trim();
    if (!t) return;
    onAdd(t, label.trim());
    setText('');
    setLabel('');
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Members&apos; Reading List</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Paste articles, URLs or excerpts here. They will be featured in Section 13 of the next generated brief.
          </p>
        </div>
        <span className="text-xs text-gray-600">{articles.length} saved</span>
      </div>

      {/* Add form */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 mb-4">
        <div className="mb-3">
          <input
            type="text"
            placeholder="Short label — e.g. Re: Rolls-Royce (optional)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-emerald-600"
          />
        </div>
        <textarea
          placeholder="Paste a URL, article headline, or excerpt here..."
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm resize-y focus:outline-none focus:border-emerald-600"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={submit}
            disabled={!text.trim() || saving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Add to Reading List'}
          </button>
        </div>
      </div>

      {/* Saved articles */}
      {articles.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl">
          No articles saved yet for {reportMonthLabel()}.
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map(article => (
            <div
              key={article.id}
              className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 flex gap-3"
            >
              <div className="flex-1 min-w-0">
                {article.label && (
                  <p className="text-emerald-400 text-xs font-medium mb-1">{article.label}</p>
                )}
                <p className="text-gray-300 text-sm break-words whitespace-pre-wrap leading-relaxed">
                  {article.text}
                </p>
                <p className="text-gray-600 text-xs mt-2">{article.addedAt}</p>
              </div>
              <button
                onClick={() => onDelete(article.id)}
                className="text-gray-600 hover:text-red-400 transition-colors text-xs flex-shrink-0 mt-0.5"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MonthlyBriefPage() {
  const [html,     setHtml]     = useState<string>('');
  const [loading,  setLoading]  = useState(true);
  const [articles, setArticles] = useState<MemberArticle[]>([]);
  const [saving,   setSaving]   = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // Serialise/deserialise articles to/from a single TEXT column in Supabase.
  // Run this migration if not done:
  //   ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS user_articles TEXT;

  function articlesToText(arts: MemberArticle[]): string {
    return arts
      .map(a => (a.label ? `[${a.label}]\n` : '') + a.text)
      .join('\n\n---\n\n');
  }

  function parseStoredArticles(raw: string | null | undefined): MemberArticle[] {
    if (!raw) return [];
    // stored as JSON array (new format)
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as MemberArticle[];
    } catch { /* fall through to legacy plain text */ }
    return [];
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('monthly_reports')
        .select('html, user_articles')
        .eq('report_month', reportMonthLabel())
        .maybeSingle();
      if (data?.html) setHtml(data.html);
      setArticles(parseStoredArticles(data?.user_articles));
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (html && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [html]);

  async function persistArticles(updated: MemberArticle[]) {
    setSaving(true);
    try {
      const stored = JSON.stringify(updated);
      // Upsert: create the row for this month if it doesn't exist yet
      const { data: existing } = await supabase
        .from('monthly_reports')
        .select('id')
        .eq('report_month', reportMonthLabel())
        .maybeSingle();

      if (existing) {
        await supabase
          .from('monthly_reports')
          .update({ user_articles: stored })
          .eq('report_month', reportMonthLabel());
      } else {
        await supabase
          .from('monthly_reports')
          .insert({ report_month: reportMonthLabel(), user_articles: stored });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(text: string, label: string) {
    const article: MemberArticle = {
      id:      Date.now().toString(),
      text,
      label,
      addedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    };
    const updated = [...articles, article];
    setArticles(updated);
    persistArticles(updated);
  }

  function handleDelete(id: string) {
    const updated = articles.filter(a => a.id !== id);
    setArticles(updated);
    persistArticles(updated);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Monthly Intelligence Briefing
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {reportMonthLabel()} — AI-generated analysis using live portfolio data
          </p>
        </div>

        {loading && (
          <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto" />
            <p className="text-gray-500 text-sm mt-3">Loading report...</p>
          </div>
        )}

        {!loading && !html && (
          <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-gray-400 text-sm">
              No report generated yet for {reportMonthLabel()}.
            </p>
            <p className="text-gray-600 text-xs mt-2">
              An admin can generate this month&apos;s briefing from the Manage page.
            </p>
          </div>
        )}

        {!loading && html && (
          <div ref={reportRef} className="rounded-xl overflow-hidden border border-gray-700">
            <div className="bg-gray-900 border-b border-gray-700 px-4 sm:px-6 py-3 flex items-center justify-between">
              <span className="text-white font-semibold text-sm">
                {reportMonthLabel()} — MESI Intelligence Briefing
              </span>
              <button
                onClick={() => {
                  const win = window.open('', '_blank');
                  if (win) { win.document.write(html); win.document.close(); }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
              >
                Open full screen
              </button>
            </div>
            <ReportFrame html={html} />
          </div>
        )}

        {/* Reading list — always visible so members can add articles before generation */}
        {!loading && (
          <ReadingList
            articles={articles}
            onAdd={handleAdd}
            onDelete={handleDelete}
            saving={saving}
          />
        )}

      </div>
    </div>
  );
}
