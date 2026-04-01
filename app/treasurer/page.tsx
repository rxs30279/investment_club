'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';

interface TreasurerReport {
  id: number;
  title: string;
  date: string;
  display_date: string;
  content: string;
  file_url: string;
  file_name: string;
  created_at: string;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};


// ── Main page content (public) ────────────────────────────────────────────────

export default function TreasurerPage() {
  const [reports, setReports] = useState<TreasurerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingReport, setEditingReport] = useState<TreasurerReport | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [newReport, setNewReport] = useState({
    title: '',
    date: new Date().toISOString().split('T')[0],
    content: '',
    file: null as File | null,
  });

  const [editContent, setEditContent] = useState({
    title: '',
    date: '',
    content: '',
    file: null as File | null,
  });


  const loadReports = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    // Fetch reports and unit_values separately then merge
    const [{ data: reports, error: reportsError }, { data: unitValues, error: uvError }] = await Promise.all([
      supabase.from('treasurer_reports').select('*'),
      supabase.from('unit_values').select('report_id, valuation_date'),
    ]);

    if (reportsError) throw reportsError;
    if (uvError) throw uvError;

    // Build a map of report_id → valuation_date
    const valuationDateMap = new Map<number, string>(
      (unitValues || []).map(uv => [uv.report_id, uv.valuation_date])
    );

    // Merge valuation_date into each report, fall back to report.date if not found
    const merged = (reports || []).map(report => ({
      ...report,
      display_date: valuationDateMap.get(report.id) ?? report.date,
    }));

    // Sort by valuation date descending
    merged.sort((a, b) =>
      new Date(b.display_date).getTime() - new Date(a.display_date).getTime()
    );

    setReports(merged);
  } catch (err) {
    console.error('Error loading reports:', err);
    setError('Failed to load treasurer reports. Please try again.');
  } finally {
    setLoading(false);
  }
}, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // ── Sync handler ─────────────────────────────────────────────────────────────

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/performance/sync', { method: 'POST' });
      const data = await res.json();
      if (data.errors?.length > 0) {
        console.error('Sync errors:', data.errors);
        setSyncResult({
          ok: false,
          message: `${data.processed} added, ${data.errors.length} file(s) failed — check console`,
        });
      } else {
        setSyncResult({ ok: true, message: data.message });
      }
    } catch (err) {
      console.error('Sync error:', err);
      setSyncResult({ ok: false, message: 'Sync failed — check console' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncClick = () => {
    runSync();
  };

  // ── File upload helpers ───────────────────────────────────────────────────────

  const uploadFile = async (file: File, reportId: number): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `treasurer-${reportId}-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('treasurer-reports')
      .upload(fileName, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('treasurer-reports')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  };

  const handleAddReport = async () => {
    if (!newReport.title || !newReport.file) {
      alert('Please enter a title and select a PDF file');
      return;
    }
    setUploading(true);
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('treasurer_reports')
        .insert([{ title: newReport.title, date: newReport.date, content: newReport.content || '' }])
        .select();

      if (insertError) throw insertError;

      const reportId = inserted[0].id;
      const fileUrl = await uploadFile(newReport.file, reportId);
      const fileName = newReport.file.name;

      if (fileUrl) {
        await supabase
          .from('treasurer_reports')
          .update({ file_url: fileUrl, file_name: fileName })
          .eq('id', reportId);
      }

      setShowAddForm(false);
      setNewReport({ title: '', date: new Date().toISOString().split('T')[0], content: '', file: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadReports();
      alert('Treasurer report added successfully!');
    } catch (err) {
      console.error('Error adding report:', err);
      alert('Failed to add treasurer report. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteReport = async (id: number, fileUrl: string) => {
    if (confirm('Delete this treasurer report? This action cannot be undone.')) {
      try {
        const fileName = fileUrl.split('/').pop();
        if (fileName) await supabase.storage.from('treasurer-reports').remove([fileName]);

        const { error } = await supabase.from('treasurer_reports').delete().eq('id', id);
        if (error) throw error;
        loadReports();
        alert('Treasurer report deleted successfully!');
      } catch (err) {
        console.error('Error deleting report:', err);
        alert('Failed to delete treasurer report. Please try again.');
      }
    }
  };

  const startEditing = (report: TreasurerReport) => {
    setEditingReport(report);
    setEditContent({ title: report.title, date: report.date, content: report.content || '', file: null });
  };

  const handleEditReport = async () => {
    if (!editingReport || !editContent.title) return;
    setUploading(true);
    try {
      let fileUrl = editingReport.file_url;
      let fileName = editingReport.file_name;

      if (editContent.file) {
        const oldFileName = editingReport.file_url.split('/').pop();
        if (oldFileName) await supabase.storage.from('treasurer-reports').remove([oldFileName]);
        const uploadedUrl = await uploadFile(editContent.file, editingReport.id);
        if (uploadedUrl) { fileUrl = uploadedUrl; fileName = editContent.file.name; }
      }

      const { error } = await supabase
        .from('treasurer_reports')
        .update({ title: editContent.title, date: editContent.date, content: editContent.content || '', file_url: fileUrl, file_name: fileName, updated_at: new Date().toISOString() })
        .eq('id', editingReport.id);

      if (error) throw error;
      setEditingReport(null);
      loadReports();
      alert('Treasurer report updated successfully!');
    } catch (err) {
      console.error('Error updating report:', err);
      alert('Failed to update treasurer report. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-3 text-gray-400 text-sm">Loading treasurer reports...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Treasurer's Reports</h1>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              Financial reports and statements from the club treasurer
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={handleSyncClick}
              disabled={syncing}
              className="w-full sm:w-auto px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {syncing ? 'Syncing...' : '⟳ Sync Performance'}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Upload Report
            </button>
          </div>
        </div>

        {/* Sync result banner */}
        {syncResult && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${
            syncResult.ok
              ? 'bg-blue-900/30 border border-blue-700 text-blue-300'
              : 'bg-red-900/30 border border-red-700 text-red-300'
          }`}>
            <span>{syncResult.ok ? '✓' : '✗'} {syncResult.message}</span>
            <button onClick={() => setSyncResult(null)} className="ml-4 opacity-60 hover:opacity-100 text-xs">✕</button>
          </div>
        )}

        {/* Add Form */}
        {showAddForm && (
          <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-4 sm:p-6 mb-6">
            <h3 className="text-white font-semibold mb-4 text-base sm:text-lg">Upload Treasurer's Report</h3>
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Report Title</label>
                <input
                  type="text"
                  placeholder="e.g., Q1 2026 Financial Report"
                  value={newReport.title}
                  onChange={(e) => setNewReport({ ...newReport, title: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm placeholder-gray-500"
                />
              </div>
              
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">PDF File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setNewReport({ ...newReport, file: e.target.files?.[0] || null })}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-emerald-600 file:text-white hover:file:bg-emerald-500"
                />
                <p className="text-xs text-gray-500 mt-1">Upload PDF file (financial report, balance sheet, etc.)</p>
              </div>
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Notes (optional)</label>
                <textarea
                  placeholder="Additional notes or summary..."
                  value={newReport.content}
                  onChange={(e) => setNewReport({ ...newReport, content: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm placeholder-gray-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleAddReport} disabled={uploading}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm disabled:opacity-50">
                {uploading ? 'Uploading...' : 'Upload Report'}
              </button>
              <button onClick={() => setShowAddForm(false)}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Edit Form */}
        {editingReport && (
          <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-4 sm:p-6 mb-6">
            <h3 className="text-white font-semibold mb-4 text-base sm:text-lg">Edit Report</h3>
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Report Title</label>
                <input type="text" value={editContent.title}
                  onChange={(e) => setEditContent({ ...editContent, title: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm" />
              </div>
              
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Replace PDF (optional)</label>
                <input type="file" accept=".pdf"
                  onChange={(e) => setEditContent({ ...editContent, file: e.target.files?.[0] || null })}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-600 file:text-white hover:file:bg-gray-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Notes</label>
                <textarea value={editContent.content}
                  onChange={(e) => setEditContent({ ...editContent, content: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleEditReport} disabled={uploading}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm disabled:opacity-50">
                {uploading ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditingReport(null)}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Reports List */}
        <div className="space-y-3 sm:space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={loadReports} className="mt-2 text-xs text-red-400 hover:text-red-300">Try Again</button>
            </div>
          )}

          {reports.length === 0 && !error && (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-8 sm:p-12 text-center">
              <div className="text-5xl mb-3">💰</div>
              <p className="text-gray-400 text-sm mb-2">No treasurer reports uploaded yet</p>
              <button onClick={() => setShowAddForm(true)} className="text-emerald-400 hover:text-emerald-300 text-sm">
                Upload the first report →
              </button>
            </div>
          )}

          {reports.map((report) => (
            <div key={report.id}
              className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-800">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                  <div className="flex-1">
                    <h2 className="text-white font-semibold text-base sm:text-lg">{report.title}</h2>
                    <p className="text-gray-500 text-xs sm:text-sm mt-1">{formatDate(report.display_date ?? report.date)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEditing(report)}
                      className="px-2 sm:px-3 py-1 text-blue-400 hover:text-blue-300 text-xs">Edit</button>
                    <button onClick={() => handleDeleteReport(report.id, report.file_url)}
                      className="px-2 sm:px-3 py-1 text-red-400 hover:text-red-300 text-xs">Delete</button>
                  </div>
                </div>
              </div>
              <div className="px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">📊</div>
                    <div className="flex-1 min-w-0">
                      <a href={report.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 font-medium text-sm truncate block">
                        {report.file_name}
                      </a>
                      <p className="text-xs text-gray-500 mt-0.5">Tap to view PDF</p>
                    </div>
                  </div>
                  <a href={report.file_url} target="_blank" rel="noopener noreferrer"
                    className="sm:ml-auto px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg text-xs text-center transition-colors">
                    Open PDF →
                  </a>
                </div>
                {report.content && (
                  <div className="mt-3 p-3 bg-gray-800/30 rounded-lg">
                    <p className="text-gray-300 text-sm whitespace-pre-wrap">{report.content}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          📊 <span className="font-semibold">Treasurer's reports</span> are stored as PDFs. Tap any file to view financial statements.
        </div>
      </div>
    </div>
  );
}
