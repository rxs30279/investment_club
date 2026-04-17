'use client';

import { useState, useEffect, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';

// Migration required in Supabase:
//   CREATE TABLE member_articles (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     contributor_name text NOT NULL,
//     title text NOT NULL,
//     body text NOT NULL,
//     added_at timestamptz DEFAULT now() NOT NULL
//   );

function reportMonthLabel() {
  return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function twoMonthsAgoIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d.toISOString();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemberArticle {
  id:               string;
  contributor_name: string;
  title:            string;
  body:             string;
  added_at:         string; // ISO timestamp from Supabase
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

// ── Members' Reading List panel ───────────────────────────────────────────────

function ReadingList({
  articles,
  onAdd,
  onDelete,
  saving,
  saveError,
}: {
  articles: MemberArticle[];
  onAdd: (name: string, title: string, body: string) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [name,  setName]  = useState('');
  const [title, setTitle] = useState('');
  const [body,  setBody]  = useState('');
  const [open,  setOpen]  = useState(false);

  function submit() {
    if (!name.trim() || !title.trim() || !body.trim()) return;
    onAdd(name.trim(), title.trim(), body.trim());
    setName('');
    setTitle('');
    setBody('');
    setOpen(false);
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Members&apos; Reading List</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Share articles with the club. Articles are kept for two months and featured in the next generated briefing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{articles.length} article{articles.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setOpen(v => !v)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            {open ? 'Cancel' : '+ Add Article'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {open && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-4 mb-5">
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-emerald-600"
            />
            <input
              type="text"
              placeholder="Article title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-emerald-600"
            />
            <textarea
              placeholder="Paste the article text, excerpt, or URL here..."
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm resize-y focus:outline-none focus:border-emerald-600"
            />
          </div>
          {saveError && (
            <p className="mt-2 text-red-400 text-xs">{saveError}</p>
          )}
          <div className="flex justify-end mt-3">
            <button
              onClick={submit}
              disabled={!name.trim() || !title.trim() || !body.trim() || saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Submit Article'}
            </button>
          </div>
        </div>
      )}

      {/* Article list */}
      {articles.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl">
          No articles shared yet. Be the first to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map(article => (
            <details
              key={article.id}
              className="bg-gray-900/50 border border-gray-800 rounded-xl group"
            >
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none select-none">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-emerald-400 text-xs font-semibold flex-shrink-0">
                    {article.contributor_name}
                  </span>
                  <span className="text-gray-300 text-sm truncate">{article.title}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className="text-gray-600 text-xs hidden sm:block">
                    {formatDate(article.added_at)}
                  </span>
                  <button
                    onClick={e => { e.preventDefault(); onDelete(article.id); }}
                    className="text-gray-600 hover:text-red-400 transition-colors text-xs"
                    title="Remove"
                  >
                    ✕
                  </button>
                  <svg
                    className="w-3.5 h-3.5 text-gray-500 transition-transform group-open:rotate-180"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="px-4 pb-4 pt-1 border-t border-gray-800">
                <p className="text-gray-400 text-xs mb-2">{formatDate(article.added_at)}</p>
                <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed break-words">
                  {article.body}
                </p>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MonthlyBriefPage() {
  const [html,        setHtml]       = useState<string>('');
  const [loading,     setLoading]    = useState(true);
  const [articles,    setArticles]   = useState<MemberArticle[]>([]);
  const [saving,      setSaving]     = useState(false);
  const [saveError,   setSaveError]  = useState<string | null>(null);
  const [tableError,  setTableError] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      // Load the current month's report
      const { data: report } = await supabase
        .from('monthly_reports')
        .select('html')
        .eq('report_month', reportMonthLabel())
        .maybeSingle();
      if (report?.html) setHtml(report.html);

      // Load member articles from the last 2 months; also delete expired ones
      const cutoff = twoMonthsAgoIso();
      await supabase.from('member_articles').delete().lt('added_at', cutoff);
      const { data: arts, error: artsError } = await supabase
        .from('member_articles')
        .select('*')
        .gte('added_at', cutoff)
        .order('added_at', { ascending: false });
      if (artsError) {
        console.error('[member_articles] load error:', artsError.message);
        setTableError(true);
      }
      setArticles((arts ?? []) as MemberArticle[]);

      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (html && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [html]);

  async function handleAdd(name: string, title: string, body: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const { data, error } = await supabase
        .from('member_articles')
        .insert({ contributor_name: name, title, body })
        .select()
        .single();
      if (error) {
        console.error('[member_articles] insert error:', error.message);
        setSaveError(error.message.includes('does not exist')
          ? 'The member_articles table has not been created in Supabase yet. Please run the migration SQL.'
          : `Save failed: ${error.message}`);
      } else if (data) {
        setArticles(prev => [data as MemberArticle, ...prev]);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('member_articles').delete().eq('id', id);
    setArticles(prev => prev.filter(a => a.id !== id));
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

        {/* Members' Reading List — always visible */}
        {!loading && (
          <>
            {tableError && (
              <div className="mt-8 bg-red-900/20 border border-red-700 rounded-xl p-4 text-sm text-red-300">
                <p className="font-semibold mb-1">Database table missing</p>
                <p className="text-red-400 text-xs mb-2">
                  The <code className="font-mono bg-red-900/40 px-1 rounded">member_articles</code> table does not exist in Supabase yet. Run this migration in the Supabase SQL editor:
                </p>
                <pre className="bg-gray-900 text-gray-300 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre">{`CREATE TABLE member_articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contributor_name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  added_at timestamptz DEFAULT now() NOT NULL
);`}</pre>
              </div>
            )}
            <ReadingList
              articles={articles}
              onAdd={handleAdd}
              onDelete={handleDelete}
              saving={saving}
              saveError={saveError}
            />
          </>
        )}

      </div>
    </div>
  );
}
