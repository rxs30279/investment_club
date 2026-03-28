'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import RefreshButton from '@/components/RefreshButton';

interface MeetingMinute {
  id: number;
  title: string;
  date: string;
  content: string;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export default function MinutesPage() {
  const [minutes, setMinutes] = useState<MeetingMinute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingMinute, setEditingMinute] = useState<MeetingMinute | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  
  const [newMinute, setNewMinute] = useState({
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

  const loadMinutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('meeting_minutes')
        .select('*')
        .order('date', { ascending: false });

      if (error) throw error;
      setMinutes(data || []);
    } catch (err) {
      console.error('Error loading minutes:', err);
      setError('Failed to load meeting minutes. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMinutes();
  }, [loadMinutes]);

  const uploadFile = async (file: File, minuteId: number): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${minuteId}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('meeting-minutes')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('meeting-minutes')
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  };

  const handleAddMinute = async () => {
    if (!newMinute.title) {
      alert('Please enter a title');
      return;
    }

    setUploading(true);
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('meeting_minutes')
        .insert([
          {
            title: newMinute.title,
            date: newMinute.date,
            content: newMinute.content || 'No additional notes',
          },
        ])
        .select();

      if (insertError) throw insertError;
      
      const minuteId = inserted[0].id;
      let fileUrl = null;
      let fileName = null;

      if (newMinute.file) {
        fileUrl = await uploadFile(newMinute.file, minuteId);
        fileName = newMinute.file.name;
        
        if (fileUrl) {
          await supabase
            .from('meeting_minutes')
            .update({ file_url: fileUrl, file_name: fileName })
            .eq('id', minuteId);
        }
      }

      setShowAddForm(false);
      setNewMinute({
        title: '',
        date: new Date().toISOString().split('T')[0],
        content: '',
        file: null,
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadMinutes();
      alert('Meeting minutes added successfully!');
    } catch (err) {
      console.error('Error adding minute:', err);
      alert('Failed to add meeting minutes. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMinute = async (id: number, fileUrl: string | null) => {
    if (confirm('Delete this meeting record? This action cannot be undone.')) {
      try {
        if (fileUrl) {
          const fileName = fileUrl.split('/').pop();
          if (fileName) {
            await supabase.storage.from('meeting-minutes').remove([fileName]);
          }
        }

        const { error } = await supabase
          .from('meeting_minutes')
          .delete()
          .eq('id', id);

        if (error) throw error;
        loadMinutes();
        alert('Meeting minutes deleted successfully!');
      } catch (err) {
        console.error('Error deleting minute:', err);
        alert('Failed to delete meeting minutes. Please try again.');
      }
    }
  };

  const startEditing = (minute: MeetingMinute) => {
    setEditingMinute(minute);
    setEditContent({
      title: minute.title,
      date: minute.date,
      content: minute.content || '',
      file: null,
    });
  };

  const handleEditMinute = async () => {
    if (!editingMinute) return;

    if (!editContent.title) {
      alert('Please enter a title');
      return;
    }

    setUploading(true);
    try {
      let fileUrl = editingMinute.file_url;
      let fileName = editingMinute.file_name;

      if (editContent.file) {
        if (editingMinute.file_url) {
          const oldFileName = editingMinute.file_url.split('/').pop();
          if (oldFileName) {
            await supabase.storage.from('meeting-minutes').remove([oldFileName]);
          }
        }
        
        fileUrl = await uploadFile(editContent.file, editingMinute.id);
        fileName = editContent.file.name;
      }

      const { error } = await supabase
        .from('meeting_minutes')
        .update({
          title: editContent.title,
          date: editContent.date,
          content: editContent.content || 'No additional notes',
          file_url: fileUrl,
          file_name: fileName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingMinute.id);

      if (error) throw error;

      setEditingMinute(null);
      loadMinutes();
      alert('Meeting minutes updated successfully!');
    } catch (err) {
      console.error('Error updating minute:', err);
      alert('Failed to update meeting minutes. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto"></div>
              <p className="mt-3 text-gray-400 text-sm">Loading meeting minutes...</p>
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
        {/* Header - Responsive */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Meeting Minutes</h1>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              Store and view monthly investment club meeting notes
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Upload Minutes
          </button>
        </div>

        {/* Add Form - Mobile Optimized */}
        {showAddForm && (
          <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-4 sm:p-6 mb-6">
            <h3 className="text-white font-semibold mb-4 text-base sm:text-lg">Upload Meeting Minutes</h3>
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Meeting Title</label>
                <input
                  type="text"
                  placeholder="e.g., March 2026 Investment Review"
                  value={newMinute.title}
                  onChange={(e) => setNewMinute({ ...newMinute, title: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm placeholder-gray-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Meeting Date</label>
                <input
                  type="date"
                  value={newMinute.date}
                  onChange={(e) => setNewMinute({ ...newMinute, date: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">PDF File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setNewMinute({ ...newMinute, file: e.target.files?.[0] || null })}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-emerald-600 file:text-white hover:file:bg-emerald-500"
                />
                <p className="text-xs text-gray-500 mt-1">Upload PDF file</p>
              </div>
              <div>
                <label className="text-gray-400 text-xs sm:text-sm block mb-1">Notes (optional)</label>
                <textarea
                  placeholder="Additional notes..."
                  value={newMinute.content}
                  onChange={(e) => setNewMinute({ ...newMinute, content: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 sm:px-4 py-2 text-white text-sm placeholder-gray-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleAddMinute}
                disabled={uploading}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload Minutes'}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Minutes List - Mobile Optimized */}
        <div className="space-y-3 sm:space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={loadMinutes} className="mt-2 text-xs text-red-400 hover:text-red-300">
                Try Again
              </button>
            </div>
          )}

          {minutes.length === 0 && !error && (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-8 sm:p-12 text-center">
              <p className="text-gray-400 text-sm mb-2">No meeting minutes recorded yet</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="text-emerald-400 hover:text-emerald-300 text-sm"
              >
                Upload your first meeting minutes →
              </button>
            </div>
          )}

          {minutes.map((minute) => (
            <div
              key={minute.id}
              className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors"
            >
              {/* Header - Mobile friendly */}
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-800">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                  <div className="flex-1">
                    <h2 className="text-white font-semibold text-base sm:text-lg">{minute.title}</h2>
                    <p className="text-gray-500 text-xs sm:text-sm mt-1">{formatDate(minute.date)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(minute)}
                      className="px-2 sm:px-3 py-1 text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteMinute(minute.id, minute.file_url)}
                      className="px-2 sm:px-3 py-1 text-red-400 hover:text-red-300 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Content - Mobile optimized */}
              <div className="px-4 sm:px-6 py-3 sm:py-4">
                {minute.file_url ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl">📄</div>
                      <div className="flex-1 min-w-0">
                        <a
                          href={minute.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:text-emerald-300 font-medium text-sm truncate block"
                        >
                          {minute.file_name || 'Meeting Minutes.pdf'}
                        </a>
                        <p className="text-xs text-gray-500 mt-0.5">Tap to view PDF</p>
                      </div>
                    </div>
                    <a
                      href={minute.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sm:ml-auto px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg text-xs text-center transition-colors"
                    >
                      Open PDF →
                    </a>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">No PDF attached</div>
                )}
                {minute.content && minute.content !== 'No additional notes' && (
                  <div className="mt-3 p-3 bg-gray-800/30 rounded-lg">
                    <p className="text-gray-300 text-sm whitespace-pre-wrap">{minute.content}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          📄 <span className="font-semibold">Meeting minutes</span> are stored as PDFs. Tap any file to view.
        </div>
      </div>
    </div>
  );
}