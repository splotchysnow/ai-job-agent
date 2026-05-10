'use client';

// This page is a simple interface to fetch and display job recommendations from the backend.
import { useState, useEffect } from 'react';
import Link from 'next/link';


// BASE for every API URL
const API_BASE = 'https://ai-job-agent-production-5cc3.up.railway.app';

// Structure of a job recommendation returned by the API
type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary?: string; // ? because not all APIs return salary info
  matchScore: number;
  matchReason: string;
  url: string;
  postedAt: string;
  description: string;
};

// Main page component
export default function JobFetchPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(60);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  // On mount, load API key and cached results from localStorage
  useEffect(() => {
    // Load API key from localStorage (if set in the agent interface)
    setApiKey(localStorage.getItem('apiKey') || '');
    // Load cached job results and timestamp
    const cached = localStorage.getItem('jobFetchResults');
    const ts = localStorage.getItem('jobFetchTimestamp');
    // If we have cached results, load them into state immediately
    if (cached) setJobs(JSON.parse(cached));
    if (ts) setLastFetched(ts);
  }, []);

  function apiHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  async function fetchJobs() {
    setLoading(true);
    const resumeBullets = localStorage.getItem('resumeBullets') || '';
    const jobArea = localStorage.getItem('jobArea') || 'Software Engineering';

    // TODO: replace with your actual endpoint
    const res = await fetch(`${API_BASE}/jobs/recommendations`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ resume_bullets: resumeBullets, job_area: jobArea }),
    });
    const data: Job[] = await res.json();

    const sorted = data.sort((a, b) => b.matchScore - a.matchScore);
    const ts = new Date().toLocaleString();
    setJobs(sorted);
    setLastFetched(ts);
    localStorage.setItem('jobFetchResults', JSON.stringify(sorted));
    localStorage.setItem('jobFetchTimestamp', ts);
    setLoading(false);
  }

  function scoreColor(score: number) {
    if (score >= 75) return 'text-green-400';
    if (score >= 55) return 'text-yellow-400';
    return 'text-red-400';
  }

  function scoreBg(score: number) {
    if (score >= 75) return 'bg-green-900/40 border-green-700/50';
    if (score >= 55) return 'bg-yellow-900/40 border-yellow-700/50';
    return 'bg-red-900/40 border-red-700/50';
  }

  const visible = jobs.filter(j => j.matchScore >= minScore);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 select-none">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Job Recommendations</h1>
            <p className="text-gray-500 mt-1 text-sm">Daily job matches from the last 2 weeks, ranked by resume fit.</p>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-white transition-colors mt-1"
          >
            ← Back to agent
          </Link>
        </div>

        {/* Control bar */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-6 flex flex-wrap items-center gap-6">
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            {loading ? 'Fetching…' : 'Fetch & Match Jobs'}
          </button>

          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
              Min Score: <span className="text-white">{minScore}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={minScore}
              onChange={e => setMinScore(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
          </div>

          <div className="text-right text-xs text-gray-500 whitespace-nowrap">
            {lastFetched ? (
              <>
                <span className="text-gray-400">{visible.length} match{visible.length !== 1 ? 'es' : ''}</span>
                <span className="mx-2 text-gray-700">·</span>
                last fetched {lastFetched}
              </>
            ) : (
              <span>No data yet — hit fetch to start</span>
            )}
          </div>
        </div>

        {/* Job list */}
        {visible.length === 0 && !loading && (
          <div className="text-center py-24 text-gray-600 text-sm">
            {jobs.length > 0
              ? `All ${jobs.length} jobs are below the ${minScore} score threshold. Lower the slider to see them.`
              : 'No jobs loaded yet. Click "Fetch & Match Jobs" above.'}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {visible.map(job => (
            <div
              key={job.id}
              className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
            >
              {/* Card header */}
              <div className="p-5 flex items-start gap-4">
                {/* Score badge */}
                <div className={`flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl border text-center ${scoreBg(job.matchScore)}`}>
                  <span className={`text-xl font-bold leading-none ${scoreColor(job.matchScore)}`}>{job.matchScore}</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">match</span>
                </div>

                {/* Main info */}
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
                    <span className="text-gray-500">{job.postedAt}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-2">{job.matchReason}</p>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
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

              {/* Expanded description */}
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
