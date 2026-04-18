'use client';

import { useState, useEffect, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';

// Migration required in Supabase:
//   CREATE TABLE member_articles (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     contributor_name text NOT NULL,
//     title text NOT NULL,
//     body text,
//     pdf_url text,
//     pdf_name text,
//     added_at timestamptz DEFAULT now() NOT NULL
//   );
// Plus a public Storage bucket named `member-articles`.

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
  body:             string | null;
  pdf_url:          string | null;
  pdf_name:         string | null;
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
  onAdd: (name: string, title: string, body: string, pdf: File | null) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [name,  setName]  = useState('');
  const [title, setTitle] = useState('');
  const [body,  setBody]  = useState('');
  const [pdf,   setPdf]   = useState<File | null>(null);
  const [open,  setOpen]  = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    if (!name.trim() || !title.trim() || (!body.trim() && !pdf)) return;
    onAdd(name.trim(), title.trim(), body.trim(), pdf);
    setName('');
    setTitle('');
    setBody('');
    setPdf(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
              placeholder="Paste the article text, excerpt, or URL here (optional if attaching a PDF)..."
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm resize-y focus:outline-none focus:border-emerald-600"
            />
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Attach a PDF (optional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={e => setPdf(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-gray-300 file:text-xs file:font-medium hover:file:bg-gray-700 file:cursor-pointer cursor-pointer"
              />
              {pdf && (
                <p className="mt-1.5 text-xs text-gray-500 truncate">
                  {pdf.name} ({(pdf.size / 1024).toFixed(0)} KB)
                </p>
              )}
            </div>
          </div>
          {saveError && (
            <p className="mt-2 text-red-400 text-xs">{saveError}</p>
          )}
          <div className="flex justify-end mt-3">
            <button
              onClick={submit}
              disabled={!name.trim() || !title.trim() || (!body.trim() && !pdf) || saving}
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
                {article.body && (
                  <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed break-words">
                    {article.body}
                  </p>
                )}
                {article.pdf_url && (
                  <a
                    href={article.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 text-emerald-400 hover:text-emerald-300 hover:border-emerald-700 transition-colors ${article.body ? 'mt-3' : ''}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {article.pdf_name || 'View PDF'}
                  </a>
                )}
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

  async function handleAdd(name: string, title: string, body: string, pdf: File | null) {
    setSaving(true);
    setSaveError(null);
    try {
      let pdfUrl: string | null = null;
      let pdfName: string | null = null;
      if (pdf) {
        const safeName = pdf.name.replace(/[^\w.\-]/g, '_');
        const path = `${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('member-articles')
          .upload(path, pdf, { contentType: 'application/pdf' });
        if (uploadError) {
          console.error('[member_articles] PDF upload error:', uploadError.message);
          setSaveError(uploadError.message.toLowerCase().includes('not found')
            ? 'The `member-articles` storage bucket does not exist in Supabase yet. Please create it as a public bucket.'
            : `PDF upload failed: ${uploadError.message}`);
          return;
        }
        pdfUrl  = supabase.storage.from('member-articles').getPublicUrl(path).data.publicUrl;
        pdfName = pdf.name;
      }

      const { data, error } = await supabase
        .from('member_articles')
        .insert({
          contributor_name: name,
          title,
          body:     body || null,
          pdf_url:  pdfUrl,
          pdf_name: pdfName,
        })
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
    const article = articles.find(a => a.id === id);
    if (article?.pdf_url) {
      const path = article.pdf_url.split('/member-articles/')[1];
      if (path) await supabase.storage.from('member-articles').remove([path]);
    }
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
                <pre className="bg-gray-900 text-gray-300 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre">{`-- New install:
CREATE TABLE member_articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contributor_name text NOT NULL,
  title text NOT NULL,
  body text,
  pdf_url text,
  pdf_name text,
  added_at timestamptz DEFAULT now() NOT NULL
);

-- If the table already exists, run these instead:
ALTER TABLE member_articles ALTER COLUMN body DROP NOT NULL;
ALTER TABLE member_articles ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE member_articles ADD COLUMN IF NOT EXISTS pdf_name text;

-- Also create a PUBLIC Storage bucket named "member-articles" via the
-- Supabase dashboard (Storage → New bucket → Public).`}</pre>
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
