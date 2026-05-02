'use client';

import { useState } from 'react';

export default function Home() {

  // Fields for user input and results on claude ai agents.
  const [jobDescription, setJobDescription] = useState('');
  const [resumeBullets, setResumeBullets] = useState('');
  const [tailoredBullets, setTailoredBullets] = useState('');

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);

  async function runAgent(){
    setLoading(true);
    setTailoredBullets('');
    setEmail('');
    // setCached(false);

    const tailorRes = await fetch('https://ai-job-agent-production-5cc3.up.railway.app/tailor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_description: jobDescription,
        resume_bullets: resumeBullets
      })
    });
    
    const tailorData = await tailorRes.json();
    setTailoredBullets(tailorData.tailored_bullets);
    setCached(tailorData.cached);

    const draftRes = await fetch('https://ai-job-agent-production-5cc3.up.railway.app/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_description: jobDescription,
        tailored_bullets: tailorData.tailored_bullets
      })
    });

    const draftData = await draftRes.json();
    setEmail(draftData.email);
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
                onChange={e => setResumeBullets(e.target.value)}
              />
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

          {/* Output Grid */}
          {(tailoredBullets || email) && (
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    Tailored Bullets {cached && <span className="ml-2 text-green-400">● cached</span>}
                  </label>
                  <button onClick={() => copyToClipboard(tailoredBullets)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{tailoredBullets}</p>
              </div>
              <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Outreach Email</label>
                  <button onClick={() => copyToClipboard(email)} className="text-xs text-blue-400 hover:text-blue-300">copy</button>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{email}</p>
              </div>
            </div>
          )}

        </div>
      </main>
    )
  }