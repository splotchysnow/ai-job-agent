'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const API_BASE = 'https://ai-job-agent-production-5cc3.up.railway.app';

type FetchStatus = {
  status: 'running' | 'done' | 'error';
  page: number;
  total_pages: number;
  fetched: number;
  error?: string;
};

type Session = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  job_count: number;
  created_at: string;
};

export default function JobFetchPage() {
  const [jobTitle, setJobTitle] = useState('Software Engineer');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [datePosted, setDatePosted] = useState<'24hours' | '3days' | '1week' | '2weeks'>('1week');
  const [maxPages, setMaxPages] = useState(5);
  const [sessionName, setSessionName] = useState('');

  const [fetchStatus, setFetchStatus] = useState<FetchStatus | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadSessions();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function loadSessions() {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // silently ignore — sessions table may not exist yet
    } finally {
      setSessionsLoading(false);
    }
  }

  async function startFetch() {
    setFetchLoading(true);
    setFetchStatus(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/jobs/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_area: jobTitle,
          location,
          remote_only: remoteOnly,
          date_posted: datePosted,
          max_page: maxPages,
          name: sessionName,
        }),
      });
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const { task_id } = await res.json();
      pollStatus(task_id);
    } catch (e) {
      setError(String(e));
      setFetchLoading(false);
    }
  }

  function pollStatus(taskId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/fetch/status/${taskId}`);
        if (!res.ok) return;
        const status: FetchStatus = await res.json();
        setFetchStatus(status);
        if (status.status === 'done' || status.status === 'error') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setFetchLoading(false);
          if (status.status === 'error') setError(status.error || 'Fetch failed');
          loadSessions();
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setFetchLoading(false);
      }
    }, 2000);
  }

  const fetchProgress = fetchStatus
    ? Math.round((fetchStatus.page / Math.max(fetchStatus.total_pages, 1)) * 100)
    : 0;

  function statusDot(s: Session['status']) {
    if (s === 'done') return 'bg-green-500';
    if (s === 'error') return 'bg-red-500';
    return 'bg-yellow-400 animate-pulse';
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 select-none">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Fetch Jobs</h1>
            <p className="text-gray-500 mt-1 text-sm">Pull jobs from JSearch into the database as a named session.</p>
          </div>
          <div className="flex gap-3 mt-1">
            <Link href="/job-match" className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
              Match Resume →
            </Link>
            <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
              ← Back
            </Link>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-red-900/40 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white ml-4">✕</button>
          </div>
        )}

        {/* Fetch form */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Job Title</label>
              <input
                type="text"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                disabled={fetchLoading}
                placeholder="e.g. Software Engineer"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Location <span className="text-gray-600">(optional)</span></label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                disabled={fetchLoading}
                placeholder="e.g. San Diego, CA"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Date Posted</label>
              <select
                value={datePosted}
                onChange={e => setDatePosted(e.target.value as typeof datePosted)}
                disabled={fetchLoading}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="24hours">Last 24 hours</option>
                <option value="3days">Last 3 days</option>
                <option value="1week">Last week</option>
                <option value="2weeks">Last 2 weeks</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Pages <span className="text-gray-400">({maxPages * 10} jobs max)</span></label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={1} max={10} value={maxPages}
                  onChange={e => setMaxPages(Number(e.target.value))}
                  disabled={fetchLoading}
                  className="flex-1 accent-blue-500"
                />
                <span className="text-sm text-white w-4 text-right">{maxPages}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs text-gray-500">Session Name <span className="text-gray-600">(optional — auto-generated if blank)</span></label>
              <input
                type="text"
                value={sessionName}
                onChange={e => setSessionName(e.target.value)}
                disabled={fetchLoading}
                placeholder={`${jobTitle || 'Software Engineer'}${location ? ' · ' + location : ''} · 1wk`}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={startFetch}
              disabled={fetchLoading || !jobTitle.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {fetchLoading ? 'Fetching…' : 'Fetch Jobs'}
            </button>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => !fetchLoading && setRemoteOnly(r => !r)}
                className={`w-9 h-5 rounded-full transition-colors ${remoteOnly ? 'bg-blue-600' : 'bg-gray-700'} ${fetchLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${remoteOnly ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-gray-400">Remote only</span>
            </label>

            {fetchStatus && (
              <div className="flex-1 min-w-[200px]">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>
                    {fetchStatus.status === 'done'
                      ? `Done — ${fetchStatus.fetched} jobs cached`
                      : fetchStatus.status === 'error'
                      ? `Error: ${fetchStatus.error}`
                      : `Page ${fetchStatus.page} / ${fetchStatus.total_pages} · ${fetchStatus.fetched} jobs`}
                  </span>
                  <span>{fetchProgress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${fetchStatus.status === 'error' ? 'bg-red-500' : fetchStatus.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${fetchProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Session history */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Search Sessions</p>
            <button onClick={loadSessions} disabled={sessionsLoading} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              {sessionsLoading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>

          {sessions.length === 0 ? (
            <div className="px-5 py-10 text-center text-gray-600 text-sm">
              {sessionsLoading ? 'Loading sessions…' : 'No sessions yet — run a fetch above.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-right font-medium">Jobs</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={s.id} className={`${i < sessions.length - 1 ? 'border-b border-gray-800/60' : ''} hover:bg-gray-800/40 transition-colors`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(s.status)}`} />
                        <span className="text-white truncate max-w-[220px]">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{s.job_count}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.status === 'done' && s.job_count > 0 && (
                        <Link
                          href={`/job-match?session_id=${s.id}&session_name=${encodeURIComponent(s.name)}`}
                          className="text-xs text-violet-400 hover:text-violet-300 transition-colors font-medium"
                        >
                          Match →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </main>
  );
}
