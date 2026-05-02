'use client';

import { useState } from 'react';
import { useEffect } from 'react';

export default function Home() {

  // Fields for user input and results on claude ai agents.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobArea, setJobArea] = useState('Software Engineering');
  const [jobDescription, setJobDescription] = useState('');
  const [resumeBullets, setResumeBullets] = useState('');
  const [tailoredBullets, setTailoredBullets] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [showBullets, setShowBullets] = useState(false);
  const [matchScore, setMatchScore] = useState<{score: number, reason: string} | null>(null);
  const [outputType, setOutputType] = useState<'email' | 'cover_letter'>('email');
  
  useEffect(() => {
    setFirstName(localStorage.getItem('firstName') || '');
    setLastName(localStorage.getItem('lastName') || '');
    setJobArea(localStorage.getItem('jobArea') || 'Software Engineering');
    setResumeBullets(localStorage.getItem('resumeBullets') || '');
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

  async function runAgent() {
    setLoading(true);
    setTailoredBullets('');
    setEmail('');
    setMatchScore(null);

    // Match score — always runs
    const matchRes = await fetch('https://ai-job-agent-production-5cc3.up.railway.app/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_description: jobDescription, resume_bullets: resumeBullets, job_area: jobArea })
    });
    const matchData = await matchRes.json();
    setMatchScore(matchData);

    // Tailored bullets — only if toggle is on
    let bullets = '';
    if (showBullets) {
      const tailorRes = await fetch('https://ai-job-agent-production-5cc3.up.railway.app/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_description: jobDescription, resume_bullets: resumeBullets, job_area: jobArea })
      });
      const tailorData = await tailorRes.json();
      bullets = tailorData.tailored_bullets;
      setTailoredBullets(bullets);
      setCached(tailorData.cached);
    }

    const draftRes = await fetch('https://ai-job-agent-production-5cc3.up.railway.app/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // body: JSON.stringify({ job_description: jobDescription, tailored_bullets: bullets, first_name: firstName, last_name: lastName, job_area: jobArea })
      body: JSON.stringify({ 
        job_description: jobDescription, 
        tailored_bullets: bullets, 
        first_name: firstName, 
        last_name: lastName, 
        job_area: jobArea,
        output_type: outputType
      })
      });
      const draftData = await draftRes.json();
      // Clean up the email get rid of the AI styles.
      const cleanEmail = draftData.email
        .replace(/^-{2,}\s*/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .trim();

      setEmail(cleanEmail);
      // setEmail(draftData.email);
      setLoading(false);
    }
    
    function copyToClipboard(text: string){
      navigator.clipboard.writeText(text);
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
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">First Name</label>
              <input
                className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                placeholder="Guan"
                value={firstName}
                onChange={e => handleFirstNameChange(e.target.value)}
              />
            </div>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">Last Name</label>
              <input
                className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-100 outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                placeholder="Li"
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

          {/* Input Grid */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 block">Job Description</label>
              <textarea
                className="w-full bg-gray-800 rounded-xl p-4 text-sm text-gray-100 resize-none outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                rows={10}
                placeholder="Paste the job description here..."
                value={jobDescription}
                onChange={e => setJobDescription(e.target.value)}
              />
            </div>
            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 block">Resume Bullets</label>
              <textarea
                className="w-full bg-gray-800 rounded-xl p-4 text-sm text-gray-100 resize-none outline-none border border-gray-700 focus:border-blue-500 transition-colors"
                rows={10}
                placeholder="Paste your master resume bullets here..."
                value={resumeBullets}
                onChange={e => handleResumeBulletsChange(e.target.value)}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowBullets(!showBullets)}
                className={`w-10 h-6 rounded-full transition-colors ${showBullets ? 'bg-blue-600' : 'bg-gray-700'} relative`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showBullets ? 'left-5' : 'left-1'}`} />
              </button>
              <span className="text-sm text-gray-400">Show tailored bullets</span>
            </div>
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
            disabled={loading || !jobDescription}
            className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-white transition-colors mb-6"
          >
            {loading ? 'Running agent...' : 'Run Agent'}
          </button>

          {/* Output */}
          {(matchScore || email) && (
            <div className="flex flex-col gap-6">

              {/* Match Score */}
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

        </div>
      </main>
    )
  }