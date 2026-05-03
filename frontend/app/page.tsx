'use client';

import { useState, useEffect, useRef } from 'react';

const API_BASE = 'https://ai-job-agent-production-5cc3.up.railway.app';

type HistoryEntry = {
  id: string;
  jobTitle: string;
  company: string;
  date: string;
  score: number;
  reason: string;
  email: string;
  outputType: 'email' | 'cover_letter';
  jobDescription: string;
  tailoredBullets: string;
  companyResearch: string | null;
};

export default function Home() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobArea, setJobArea] = useState('Software Engineering');
  const [jobDescription, setJobDescription] = useState('');
  const [resumeBullets, setResumeBullets] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [autoExtract, setAutoExtract] = useState(true);
  const [tailoredBullets, setTailoredBullets] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [showBullets, setShowBullets] = useState(false);
  const [matchScore, setMatchScore] = useState<{ score: number; reason: string } | null>(null);
  const [outputType, setOutputType] = useState<'email' | 'cover_letter'>('email');
  const [companyResearch, setCompanyResearch] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const HISTORY_PAGE_SIZE = 10;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFirstName(localStorage.getItem('firstName') || '');
    setLastName(localStorage.getItem('lastName') || '');
    setJobArea(localStorage.getItem('jobArea') || 'Software Engineering');
    setResumeBullets(localStorage.getItem('resumeBullets') || '');
    setApiKey(localStorage.getItem('apiKey') || '');
    const saved = localStorage.getItem('jobHistory');
    if (saved) setHistory(JSON.parse(saved));
    const ae = localStorage.getItem('autoExtract');
    if (ae !== null) setAutoExtract(ae === 'true');
  }, []);

  function handleFirstNameChange(val: string) {
    setFirstName(val);
    localStorage.setItem('firstName', val);
  }

  function handleLastNameChange(val: string) {
    setLastName(val);
    localStorage.setItem('lastName', val);
  }

  function handleJobAreaChange(val: string) {
    setJobArea(val);
    localStorage.setItem('jobArea', val);
  }

  function handleResumeBulletsChange(val: string) {
    setResumeBullets(val);
    localStorage.setItem('resumeBullets', val);
  }

  function handleApiKeyChange(val: string) {
    setApiKey(val);
    localStorage.setItem('apiKey', val);
  }

  function apiHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  async function extractJobInfo() {
    if (!autoExtract) return;
    if (jobDescription.length < 100) return;
    setExtracting(true);
    const res = await fetch(`${API_BASE}/extract-job-info`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ job_description: jobDescription }),
    });
    const data = await res.json();
    if (data.job_title) setJobTitle(data.job_title);
    if (data.company_name) setCompanyName(data.company_name);
    setExtracting(false);
  }

  async function researchCompany() {
    if (!companyName) return;
    setResearching(true);
    setCompanyResearch(null);
    const res = await fetch(`${API_BASE}/research`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ company_name: companyName, job_area: jobArea }),
    });
    const data = await res.json();
    setCompanyResearch(data.summary);
    setResearching(false);
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    const res = await fetch(`${API_BASE}/extract`, { method: 'POST', headers, body: formData });
    const data = await res.json();
    handleResumeBulletsChange(data.text);
    setImporting(false);
    e.target.value = '';
  }

  async function runAgent() {
    setLoading(true);
    setTailoredBullets('');
    setEmail('');
    setMatchScore(null);

    const matchRes = await fetch(`${API_BASE}/match`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ job_description: jobDescription, resume_bullets: resumeBullets, job_area: jobArea }),
    });
    const matchData = await matchRes.json();
    setMatchScore(matchData);

    let bullets = '';
    if (showBullets) {
      const tailorRes = await fetch(`${API_BASE}/tailor`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ job_description: jobDescription, resume_bullets: resumeBullets, job_area: jobArea }),
      });
      const tailorData = await tailorRes.json();
      bullets = tailorData.tailored_bullets;
      setTailoredBullets(bullets);
      setCached(tailorData.cached);
    }

    const draftRes = await fetch(`${API_BASE}/draft`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        job_description: jobDescription,
        tailored_bullets: bullets || resumeBullets,
        first_name: firstName,
        last_name: lastName,
        job_area: jobArea,
        output_type: outputType,
        company_research: companyResearch ?? undefined,
      }),
    });
    const draftData = await draftRes.json();
    const cleanEmail = draftData.email
      .replace(/^-{2,}\s*/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .trim();

    setEmail(cleanEmail);
    setLoading(false);

    const entry: HistoryEntry = {
      id: Date.now().toString(),
      jobTitle: jobTitle || 'Untitled',
      company: companyName || '',
      date: new Date().toLocaleDateString(),
      score: matchData.score,
      reason: matchData.reason,
      email: cleanEmail,
      outputType,
      jobDescription,
      tailoredBullets: bullets,
      companyResearch,
    };
    const newHistory = [entry, ...history].slice(0, 100);
    setHistory(newHistory);
    setHistoryPage(0);
    localStorage.setItem('jobHistory', JSON.stringify(newHistory));
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function clearHistory() {
    setHistory([]);
    setHistoryPage(0);
    localStorage.removeItem('jobHistory');
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Job Application Agent</h1>
          <p className="text-gray-400 mt-1">Paste a job description and get tailored bullets and an outreach email instantly.</p>
        </div>

        {/* User Info Row */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">First Name</label>
            <input
              className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
              placeholder="first_name_here"
              value={firstName}
              onChange={e => handleFirstNameChange(e.target.value)}
            />
          </div>
          <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">Last Name</label>
            <input
              className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
              placeholder="last_name_here"
              value={lastName}
              onChange={e => handleLastNameChange(e.target.value)}
            />
          </div>
          <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">Job Area</label>
            <select
              className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
              value={jobArea}
              onChange={e => handleJobAreaChange(e.target.value)}
            >
              <option>Software Engineering</option>
              <option>Product Management</option>
              <option>Data Science</option>
              <option>Design</option>
              <option>DevOps</option>
              <option>Marketing</option>
              <option>Sales</option>
              <option>Finance</option>
            </select>
          </div>
        </div>

        {/* API Key Row */}
        <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-6">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">
            Anthropic API Key <span className="text-gray-600 normal-case font-normal tracking-normal">(optional — uses shared key if blank)</span>
          </label>
          <input
            className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors font-mono"
            placeholder="sk-ant-..."
            type="password"
            value={apiKey}
            onChange={e => handleApiKeyChange(e.target.value)}
          />
        </div>

        {/* Input Grid */}
        <div className="grid grid-cols-2 gap-6 mb-4">

          {/* Job Description */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 block">Job Description</label>
            <textarea
              className="w-full bg-gray-800 rounded-xl p-4 text-sm text-gray-100 resize-none outline-none border border-gray-700 focus:border-blue-500 transition-colors"
              rows={10}
              placeholder="Paste the job description here..."
              value={jobDescription}
              onChange={e => setJobDescription(e.target.value)}
              onBlur={extractJobInfo}
            />
            {/* Extracted job metadata */}
            <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">
                  Job Title {extracting && <span className="text-gray-600">· detecting...</span>}
                </label>
                <input
                  className="w-full bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                  placeholder="auto-detected"
                  value={jobTitle}
                  onChange={e => setJobTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">
                  Company {extracting && <span className="text-gray-600">· detecting...</span>}
                </label>
                <input
                  className="w-full bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                  placeholder="auto-detected"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Resume Bullets */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Resume Bullets</label>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors"
              >
                {importing ? 'importing...' : 'Import PDF / DOCX'}
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleFileImport} />
            </div>
            <textarea
              className="w-full bg-gray-800 rounded-xl p-4 text-sm text-gray-100 resize-none outline-none border border-gray-700 focus:border-blue-500 transition-colors"
              rows={10}
              placeholder="Paste your master resume bullets here..."
              value={resumeBullets}
              onChange={e => handleResumeBulletsChange(e.target.value)}
            />
          </div>
        </div>

        {/* Company Research Panel */}
        {companyResearch && (
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-4">
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                Company Research — {companyName}
              </label>
              <button onClick={() => setCompanyResearch(null)} className="text-xs text-gray-500 hover:text-gray-400 transition-colors">dismiss</button>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed">{companyResearch}</p>
          </div>
        )}

        {/* Toggles */}
        <div className="flex items-center gap-6 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBullets(!showBullets)}
              className={`w-10 h-6 rounded-full transition-colors ${showBullets ? 'bg-blue-600' : 'bg-gray-700'} relative`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showBullets ? 'left-5' : 'left-1'}`} />
            </button>
            <span className="text-sm text-gray-400">Show tailored bullets</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const next = !autoExtract;
                setAutoExtract(next);
                localStorage.setItem('autoExtract', String(next));
              }}
              className={`w-10 h-6 rounded-full transition-colors ${autoExtract ? 'bg-blue-600' : 'bg-gray-700'} relative`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoExtract ? 'left-5' : 'left-1'}`} />
            </button>
            <span className="text-sm text-gray-400">Auto-extract job info</span>
          </div>
          <button
            onClick={researchCompany}
            disabled={researching || !companyName}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-900 border border-gray-800 text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {researching ? 'Researching...' : 'Research Company'}
          </button>
          <div className="flex items-center gap-2 bg-gray-900 rounded-xl p-1 border border-gray-800">
            <button
              onClick={() => setOutputType('email')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${outputType === 'email' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Email
            </button>
            <button
              onClick={() => setOutputType('cover_letter')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${outputType === 'cover_letter' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Cover Letter
            </button>
          </div>
        </div>

        {/* Run Button */}
        <button
          onClick={runAgent}
          disabled={loading || extracting || !jobDescription}
          className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-white transition-colors mb-6"
        >
          {loading ? 'Running agent...' : extracting ? 'Detecting job info...' : 'Run Agent'}
        </button>

        {/* Output */}
        {(matchScore || email) && (
          <div className="flex flex-col gap-6">
            {matchScore && (
              <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4 block">Match Score</label>
                <div className="flex items-center gap-6">
                  <div className={`text-5xl font-bold ${matchScore.score >= 70 ? 'text-green-400' : matchScore.score >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {matchScore.score}%
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{matchScore.reason}</p>
                </div>
              </div>
            )}

            <div className={`grid gap-6 ${showBullets ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {showBullets && tailoredBullets && (
                <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                      Tailored Bullets {cached && <span className="ml-2 text-green-400">● cached</span>}
                    </label>
                    <button onClick={() => copyToClipboard(tailoredBullets)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                  </div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{tailoredBullets}</p>
                </div>
              )}

              {email && (
                <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                      {outputType === 'cover_letter' ? 'Cover Letter' : 'Outreach Email'}
                    </label>
                    <button onClick={() => copyToClipboard(email)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                  </div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{email}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-10">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">History</h2>
                <span className="text-xs text-gray-500">{history.length} run{history.length !== 1 ? 's' : ''}</span>
              </div>
              <button onClick={clearHistory} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Clear all</button>
            </div>
            <div className="flex flex-col gap-3">
              {history.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE).map(entry => (
                <div key={entry.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-800 transition-colors"
                    onClick={() => setExpandedHistory(expandedHistory === entry.id ? null : entry.id)}
                  >
                    <div>
                      <span className="font-medium text-white">{entry.jobTitle}</span>
                      {entry.company && <span className="ml-2 text-sm text-gray-400">at {entry.company}</span>}
                      <span className="ml-3 text-xs text-gray-500">{entry.date}</span>
                      <span className="ml-3 text-xs text-gray-500 capitalize">{entry.outputType.replace('_', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold ${entry.score >= 70 ? 'text-green-400' : entry.score >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {entry.score}%
                      </span>
                      <span className="text-gray-600 text-xs">{expandedHistory === entry.id ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {expandedHistory === entry.id && (
                    <div className="px-6 pb-6 border-t border-gray-800 flex flex-col gap-5">
                      <p className="text-xs text-gray-400 mt-4">{entry.reason}</p>

                      {entry.companyResearch && (
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Company Research</label>
                            <button onClick={() => copyToClipboard(entry.companyResearch!)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed">{entry.companyResearch}</p>
                        </div>
                      )}

                      {entry.tailoredBullets && (
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Tailored Bullets</label>
                            <button onClick={() => copyToClipboard(entry.tailoredBullets)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                          </div>
                          <p className="text-sm text-gray-300 whitespace-pre-wrap">{entry.tailoredBullets}</p>
                        </div>
                      )}

                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                            {entry.outputType === 'cover_letter' ? 'Cover Letter' : 'Outreach Email'}
                          </label>
                          <button onClick={() => copyToClipboard(entry.email)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                        </div>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap">{entry.email}</p>
                      </div>

                      {entry.jobDescription && (
                        <div>
                          <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">Job Description</label>
                          <p className="text-xs text-gray-500 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">{entry.jobDescription}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {history.length > HISTORY_PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                  disabled={historyPage === 0}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-500">
                  {historyPage * HISTORY_PAGE_SIZE + 1}–{Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, history.length)} of {history.length}
                </span>
                <button
                  onClick={() => setHistoryPage(p => p + 1)}
                  disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= history.length}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
