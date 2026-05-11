'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE = 'https://ai-job-agent-production-5cc3.up.railway.app';

type Session = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  job_count: number;
  created_at: string;
};

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary?: string;
  score: number;
  url: string;
  posted_at: string;
  description: string;
};

function JobMatchContent() {
  const params = useSearchParams();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [resume, setResume] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [minScore, setMinScore] = useState(60);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [matchLoading, setMatchLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMatched, setLastMatched] = useState<string | null>(null);
  const [resumeHash, setResumeHash] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('resume');
    if (saved) setResume(saved);

    loadSessions(params.get('session_id') ?? undefined);
  }, [params]);

  useEffect(() => {
    localStorage.setItem('resume', resume);
  }, [resume]);

  async function loadSessions(preselectId?: string) {
    try {
      const res = await fetch(`${API_BASE}/jobs/sessions`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Session[] = (data.sessions ?? []).filter((s: Session) => s.status === 'done' && s.job_count > 0);
      setSessions(list);

      if (preselectId) {
        const found = list.find(s => s.id === preselectId);
        if (found) setSelectedSession(found);
      } else if (list.length > 0) {
        setSelectedSession(list[0]);
      }
    } catch {
      // silently ignore
    }
  }

  async function runMatch() {
    if (!selectedSession) return;
    if (!resume.trim()) {
      setError('Paste your resume text first.');
      return;
    }
    setMatchLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/jobs/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_bullets: resume, session_id: selectedSession.id }),
      });
      if (!res.ok) throw new Error(`Match failed (${res.status})`);
      const { resume_hash } = await res.json();
      const ts = new Date().toLocaleString();
      setResumeHash(resume_hash);
      setLastMatched(ts);
      await loadResults(resume_hash, selectedSession.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setMatchLoading(false);
    }
  }

  async function loadResults(hash: string, sessionId: string) {
    setResultsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/jobs/results?resume_hash=${hash}&session_id=${sessionId}&min_score=0`
      );
      if (!res.ok) throw new Error(`Results failed (${res.status})`);
      const data = await res.json();
      setJobs(data.jobs);
    } catch (e) {
      setError(String(e));
    } finally {
      setResultsLoading(false);
    }
  }

  function scoreColor(s: number) {
    if (s >= 75) return 'text-green-400';
    if (s >= 55) return 'text-yellow-400';
    return 'text-red-400';
  }

  function scoreBg(s: number) {
    if (s >= 75) return 'bg-green-900/40 border-green-700/50';
    if (s >= 55) return 'bg-yellow-900/40 border-yellow-700/50';
    return 'bg-red-900/40 border-red-700/50';
  }

  const visible = jobs.filter(j => j.score >= minScore);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 select-none">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Match Resume</h1>
            <p className="text-gray-500 mt-1 text-sm">Select a session, paste your resume, and score every job.</p>
          </div>
          <Link href="/job-fetch" className="text-sm text-gray-400 hover:text-white transition-colors mt-1">
            ← Fetch Jobs
          </Link>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-red-900/40 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white ml-4">✕</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Session picker */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Select Session</p>
            </div>
            {sessions.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-600 text-sm flex-1">
                No completed sessions yet.{' '}
                <Link href="/job-fetch" className="text-blue-400 hover:text-blue-300">Fetch jobs first.</Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-800 flex-1 overflow-y-auto max-h-64">
                {sessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSession(s); setJobs([]); setLastMatched(null); setResumeHash(null); }}
                    className={`w-full px-5 py-3 text-left transition-colors flex items-center justify-between gap-3 ${selectedSession?.id === s.id ? 'bg-violet-900/30 border-l-2 border-violet-500' : 'hover:bg-gray-800/50'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{s.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{s.job_count} jobs</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Resume textarea */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Your Resume</p>
              {resume && <span className="text-xs text-gray-600">{resume.length} chars</span>}
            </div>
            <textarea
              value={resume}
              onChange={e => setResume(e.target.value)}
              placeholder="Paste your resume text here…"
              className="flex-1 bg-transparent px-5 py-4 text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none min-h-[200px] select-text"
            />
          </div>
        </div>

        {/* Match controls */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={runMatch}
              disabled={matchLoading || resultsLoading || !selectedSession || !resume.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 disabled:text-violet-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {matchLoading ? 'Scoring…' : resultsLoading ? 'Loading…' : 'Match My Resume'}
            </button>

            {resumeHash && selectedSession && !matchLoading && (
              <button
                onClick={() => loadResults(resumeHash, selectedSession.id)}
                disabled={resultsLoading}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                ↻ Refresh results
              </button>
            )}

            <div className="text-xs text-gray-600">
              {selectedSession
                ? lastMatched
                  ? <>Matched <span className="text-gray-400">{lastMatched}</span> · <span className="text-gray-500">{selectedSession.name}</span></>
                  : <>Ready to score <span className="text-gray-400">{selectedSession.job_count} jobs</span> from <span className="text-gray-500">{selectedSession.name}</span></>
                : 'Select a session above.'}
            </div>
          </div>
        </div>

        {/* Score filter */}
        {jobs.length > 0 && (
          <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-6 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                Min Score: <span className="text-white">{minScore}</span>
              </label>
              <input
                type="range" min={0} max={100} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                className="flex-1 accent-violet-500"
              />
            </div>
            <span className="text-xs text-gray-500">{visible.length} of {jobs.length} jobs shown</span>
          </div>
        )}

        {/* Empty state */}
        {visible.length === 0 && !matchLoading && !resultsLoading && (
          <div className="text-center py-24 text-gray-600 text-sm">
            {jobs.length > 0
              ? `All ${jobs.length} jobs are below the ${minScore} score threshold. Lower the slider.`
              : 'Select a session and click "Match My Resume" to score jobs.'}
          </div>
        )}

        {/* Job list */}
        <div className="flex flex-col gap-4">
          {visible.map(job => (
            <div key={job.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              <div className="p-5 flex items-start gap-4">
                <div className={`flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl border text-center ${scoreBg(job.score)}`}>
                  <span className={`text-xl font-bold leading-none ${scoreColor(job.score)}`}>{job.score}</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">match</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-white truncate">{job.title}</h2>
                    {job.salary && (
                      <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-lg">{job.salary}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {job.company}
                    <span className="mx-1.5 text-gray-700">·</span>
                    {job.location}
                    <span className="mx-1.5 text-gray-700">·</span>
                    <span className="text-gray-500">{job.posted_at}</span>
                  </p>
                </div>

                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <a
                    href={job.url} target="_blank" rel="noopener noreferrer"
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    Apply
                  </a>
                  <button
                    onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {expanded === job.id ? 'Hide details' : 'Show details'}
                  </button>
                </div>
              </div>

              {expanded === job.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Job Description</p>
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed select-text font-sans">
                    {job.description}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}

export default function JobMatchPage() {
  return (
    <Suspense>
      <JobMatchContent />
    </Suspense>
  );
}
