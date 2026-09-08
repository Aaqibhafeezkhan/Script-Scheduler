import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, FileText, Play, Search, Trash2, Upload, XCircle } from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

function App() {
  const [tab, setTab] = useState('upload');
  const [scripts, setScripts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('linux');
  const [frequencyType, setFrequencyType] = useState('minutes');
  const [frequencyValue, setFrequencyValue] = useState(5);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [runImmediately, setRunImmediately] = useState(false);
  const [selectedScript, setSelectedScript] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logs, setLogs] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || 'Request failed');
    return data;
  }

  async function loadData() {
    try {
      const [scriptData, scheduleData] = await Promise.all([request('/scripts'), request('/schedules')]);
      setScripts(scriptData);
      setSchedules(scheduleData);
      if (!selectedScript && scriptData.length) setSelectedScript(scriptData[0].id);
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, []);

  function showMessage(text, type = 'info') {
    setMessage(text);
    setMessageType(type);
    window.setTimeout(() => setMessage(''), 4000);
  }

  function resetUpload() {
    setFile(null);
    setName('');
  }

  async function uploadScript(event) {
    event.preventDefault();
    if (!file) return showMessage('Choose a .sh or .bat file first.', 'error');
    if (!/\.(sh|bat)$/i.test(file.name)) return showMessage('Only .sh and .bat files are supported.', 'error');
    if (file.size > 1024 * 1024) return showMessage('Maximum script size is 1MB.', 'error');

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('script', file);
      formData.append('name', name.trim() || file.name);
      const created = await request('/scripts', { method: 'POST', body: formData });
      setScripts(current => [created, ...current]);
      setSelectedScript(created.id);
      resetUpload();
      setTab('schedule');
      showMessage('Script uploaded successfully.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createSchedule(event) {
    event.preventDefault();
    if (!selectedScript) return showMessage('Choose a script first.', 'error');
    if (!frequencyValue || Number(frequencyValue) < 1) return showMessage('Frequency must be at least 1.', 'error');
    if (startTime && endTime && new Date(endTime) <= new Date(startTime)) return showMessage('End time must be later than start time.', 'error');

    setLoading(true);
    try {
      await request('/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: selectedScript, frequencyType, frequencyValue: Number(frequencyValue), startTime: startTime || null, endTime: endTime || null, runImmediately, platform })
      });
      setStartTime('');
      setEndTime('');
      setRunImmediately(false);
      setFrequencyValue(5);
      await loadData();
      setTab('jobs');
      showMessage('Schedule created successfully.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function cancelSchedule(id) {
    try {
      await request(`/schedules/${id}/cancel`, { method: 'POST' });
      await loadData();
      showMessage('Schedule cancelled.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  async function deleteSchedule(id) {
    if (!window.confirm('Delete this schedule and its execution history?')) return;
    try {
      await request(`/schedules/${id}`, { method: 'DELETE' });
      setLogs(current => { const next = { ...current }; delete next[id]; return next; });
      await loadData();
      showMessage('Schedule deleted.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  async function loadLogs(id) {
    try {
      const data = await request(`/schedules/${id}/logs`);
      setLogs(current => ({ ...current, [id]: data }));
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  const filteredSchedules = useMemo(() => schedules.filter(schedule => {
    const matchesSearch = !search || schedule.scriptName.toLowerCase().includes(search.toLowerCase()) || schedule.frequency.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || schedule.lastStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }), [schedules, search, statusFilter]);

  function statusIcon(status) {
    if (status === 'success') return <CheckCircle2 size={18} />;
    if (status === 'failed') return <XCircle size={18} />;
    if (status === 'running') return <Clock3 size={18} className="spin" />;
    return <AlertCircle size={18} />;
  }

  function date(value) {
    return value ? new Date(value).toLocaleString() : 'Never';
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Automation workspace</p>
          <h1>Script Scheduler</h1>
        </div>
        <div className="tabs">
          <button className={tab === 'upload' ? 'tab active' : 'tab'} onClick={() => setTab('upload')}><Upload size={17} /> Upload</button>
          <button className={tab === 'schedule' ? 'tab active' : 'tab'} onClick={() => setTab('schedule')}><CalendarClock size={17} /> Schedule</button>
          <button className={tab === 'jobs' ? 'tab active' : 'tab'} onClick={() => setTab('jobs')}><FileText size={17} /> My Jobs <span className="count">{schedules.length}</span></button>
        </div>
      </header>

      <main>
        {message && <div className={`notice ${messageType}`}>{message}</div>}

        {tab === 'upload' && (
          <section className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Step 1</p><h2>Upload a script</h2><p>Store a shell or batch script on the scheduler and keep its metadata with the job.</p></div>
            </div>
            <form onSubmit={uploadScript} className="form-grid">
              <label className="dropzone">
                <Upload size={30} />
                <strong>{file ? file.name : 'Choose a .sh or .bat file'}</strong>
                <span>Maximum 1MB</span>
                <input type="file" accept=".sh,.bat" onChange={event => setFile(event.target.files?.[0] || null)} />
              </label>
              <div className="form-stack">
                <label>Script name<input value={name} onChange={event => setName(event.target.value)} placeholder="Nightly backup" /></label>
                <label>Platform<select value={platform} onChange={event => setPlatform(event.target.value)}><option value="linux">Linux / macOS</option><option value="windows">Windows</option></select></label>
                <button className="primary" disabled={loading || !file}>{loading ? 'Uploading…' : 'Upload script'}</button>
              </div>
            </form>
          </section>
        )}

        {tab === 'schedule' && (
          <section className="panel">
            <div className="panel-heading"><div><p className="eyebrow">Step 2</p><h2>Create a schedule</h2><p>Combine recurring execution with start/end windows and optional immediate execution.</p></div></div>
            <form onSubmit={createSchedule} className="form-stack wide">
              <label>Script<select value={selectedScript} onChange={event => setSelectedScript(event.target.value)}><option value="">Choose a script…</option>{scripts.map(script => <option key={script.id} value={script.id}>{script.name} (.{script.type})</option>)}</select></label>
              <div className="two-col">
                <label>Frequency type<select value={frequencyType} onChange={event => setFrequencyType(event.target.value)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label>
                <label>Every<input type="number" min="1" value={frequencyValue} onChange={event => setFrequencyValue(event.target.value)} /></label>
              </div>
              <div className="two-col">
                <label>Start at<input type="datetime-local" value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
                <label>End at<input type="datetime-local" value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
              </div>
              <label className="checkbox"><input type="checkbox" checked={runImmediately} onChange={event => setRunImmediately(event.target.checked)} /> Run immediately after scheduling</label>
              <button className="primary" disabled={loading || !selectedScript}><Play size={17} /> {loading ? 'Creating…' : 'Create schedule'}</button>
            </form>
          </section>
        )}

        {tab === 'jobs' && (
          <section>
            <div className="jobs-toolbar">
              <div><p className="eyebrow">Operations</p><h2>My Jobs</h2></div>
              <div className="filters"><label className="search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search jobs" /></label><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All status</option><option value="success">Success</option><option value="failed">Failed</option><option value="running">Running</option></select></div>
            </div>
            <div className="job-list">
              {filteredSchedules.length === 0 && <div className="empty">No matching schedules.</div>}
              {filteredSchedules.map(schedule => (
                <article className="job-card" key={schedule.id}>
                  <div className="job-top"><div><h3>{schedule.scriptName}</h3><p>{schedule.scriptType === 'bat' ? 'Windows' : 'Linux / macOS'} · Every {schedule.frequency}</p></div><div className="status">{statusIcon(schedule.lastStatus)}<span>{schedule.lastStatus || 'pending'}</span></div></div>
                  <div className="job-meta"><span><strong>Next run</strong>{date(schedule.nextRun)}</span><span><strong>Last run</strong>{date(schedule.lastRun)}</span><span><strong>Window</strong>{schedule.startTime ? date(schedule.startTime) : 'Immediate'}{schedule.endTime ? ` → ${date(schedule.endTime)}` : ''}</span></div>
                  <div className="job-actions"><button onClick={() => loadLogs(schedule.id)}>View logs</button><button onClick={() => cancelSchedule(schedule.id)} className="muted">Cancel</button><button onClick={() => deleteSchedule(schedule.id)} className="danger"><Trash2 size={15} /> Delete</button></div>
                  {logs[schedule.id] && <div className="logs">{logs[schedule.id].map(log => <div className="log" key={log.id}><div>{statusIcon(log.status)}<strong>{log.status}</strong><span>{date(log.started_at)}</span></div>{log.stdout && <pre>{log.stdout}</pre>}{log.stderr && <pre className="stderr">{log.stderr}</pre>}</div>)}</div>}
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
