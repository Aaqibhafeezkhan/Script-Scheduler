const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SCRIPTS_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'scripts'));
const LOGS_DIR = path.resolve(process.env.LOGS_DIR || path.join(DATA_DIR, 'logs'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'scheduler.db'));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '100kb' }));

const db = new sqlite3.Database(DB_PATH);
const activeJobs = new Map();

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(error) {
    if (error) return reject(error);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});

function problem(res, status, detail) {
  return res.status(status).json({
    type: 'about:blank',
    title: status === 400 ? 'Bad Request' : status === 404 ? 'Not Found' : 'Internal Server Error',
    status,
    detail,
  });
}

function frequencyToCron(type, value) {
  if (type === 'minutes') {
    if (value > 59) throw new Error('Minute frequency must be 1-59');
    return `*/${value} * * * *`;
  }
  if (type === 'hours') {
    if (value > 23) throw new Error('Hour frequency must be 1-23');
    return `0 */${value} * * *`;
  }
  if (type === 'days') {
    if (value > 31) throw new Error('Day frequency must be 1-31');
    return `0 0 */${value} * *`;
  }
  throw new Error('Invalid frequency type');
}

function nextRunAt(schedule) {
  const frequencyMs = schedule.frequency_value * ({ minutes: 60000, hours: 3600000, days: 86400000 })[schedule.frequency_type];
  if (schedule.last_run) {
    const next = new Date(schedule.last_run).getTime() + frequencyMs;
    return new Date(next).toISOString();
  }
  if (schedule.run_immediately) return new Date().toISOString();
  if (schedule.start_time) return new Date(schedule.start_time).toISOString();
  return new Date(Date.now() + frequencyMs).toISOString();
}

async function init() {
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });

  await run('PRAGMA foreign_keys = ON');
  await run(`CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL,
    frequency_type TEXT NOT NULL,
    frequency_value INTEGER NOT NULL,
    start_time DATETIME,
    end_time DATETIME,
    run_immediately BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    cron_expression TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE CASCADE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    stdout TEXT,
    stderr TEXT,
    exit_code INTEGER,
    FOREIGN KEY (schedule_id) REFERENCES schedules (id) ON DELETE CASCADE
  )`);
}

const storage = multer.diskStorage({
  destination: SCRIPTS_DIR,
  filename: (req, file, cb) => {
    const scriptId = uuidv4();
    req.scriptId = scriptId;
    cb(null, `${scriptId}_${path.basename(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.sh', '.bat'].includes(ext));
  }
});

async function executeScript(scheduleId, scriptPath, scriptType) {
  const executionId = uuidv4();
  const startTime = new Date().toISOString();
  await run('INSERT INTO executions (id, schedule_id, status, started_at) VALUES (?, ?, ?, ?)', [executionId, scheduleId, 'running', startTime]);

  return new Promise(resolve => {
    const windowsBatch = scriptType === 'bat';
    const command = windowsBatch || process.platform === 'win32' ? 'cmd' : 'bash';
    const args = windowsBatch || process.platform === 'win32' ? ['/c', scriptPath] : [scriptPath];
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });

    child.on('error', async error => {
      const finishedAt = new Date().toISOString();
      await run('UPDATE executions SET status = ?, finished_at = ?, stderr = ? WHERE id = ?', ['failed', finishedAt, error.message, executionId]);
      resolve({ executionId, status: 'failed', stdout, stderr: error.message });
    });

    child.on('close', async code => {
      const finishedAt = new Date().toISOString();
      const status = code === 0 ? 'success' : 'failed';
      await run('UPDATE executions SET status = ?, finished_at = ?, stdout = ?, stderr = ?, exit_code = ? WHERE id = ?', [status, finishedAt, stdout, stderr, code, executionId]);
      resolve({ executionId, status, code, stdout, stderr });
    });
  });
}

async function loadSchedule(schedule) {
  const script = await get('SELECT * FROM scripts WHERE id = ?', [schedule.script_id]);
  if (!script || !schedule.is_active) return;

  const job = cron.schedule(schedule.cron_expression, async () => {
    const now = Date.now();
    const start = schedule.start_time ? new Date(schedule.start_time).getTime() : null;
    const end = schedule.end_time ? new Date(schedule.end_time).getTime() : null;
    if (start && now < start) return;
    if (end && now > end) {
      if (activeJobs.has(schedule.id)) {
        activeJobs.get(schedule.id).stop();
        activeJobs.delete(schedule.id);
      }
      await run('UPDATE schedules SET is_active = 0 WHERE id = ?', [schedule.id]);
      return;
    }
    await executeScript(schedule.id, path.join(SCRIPTS_DIR, script.filename), script.type);
  });

  activeJobs.set(schedule.id, job);

  if (schedule.run_immediately && !schedule.last_run) {
    await executeScript(schedule.id, path.join(SCRIPTS_DIR, script.filename), script.type);
    await run('UPDATE schedules SET run_immediately = 0 WHERE id = ?', [schedule.id]);
  }
}

app.post('/api/scripts', upload.single('script'), async (req, res, next) => {
  try {
    if (!req.file) return problem(res, 400, 'A .sh or .bat script up to 1MB is required');
    const scriptId = req.scriptId;
    const name = String(req.body?.name || req.file.originalname).trim();
    const type = path.extname(req.file.originalname).toLowerCase().slice(1);
    await run('INSERT INTO scripts (id, name, filename, type) VALUES (?, ?, ?, ?)', [scriptId, name || req.file.originalname, req.file.filename, type]);
    res.status(201).json({ id: scriptId, name: name || req.file.originalname, type });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scripts', async (req, res, next) => {
  try {
    res.json(await all('SELECT id, name, type, created_at as createdAt FROM scripts ORDER BY created_at DESC'));
  } catch (error) {
    next(error);
  }
});

app.post('/api/schedules', async (req, res, next) => {
  try {
    const { scriptId, frequencyType, frequencyValue, startTime, endTime, runImmediately, platform } = req.body || {};
    if (!scriptId || !frequencyType || !Number.isInteger(Number(frequencyValue)) || Number(frequencyValue) < 1) return problem(res, 400, 'scriptId, frequencyType, and a positive frequencyValue are required');
    if (!['minutes', 'hours', 'days'].includes(frequencyType)) return problem(res, 400, 'frequencyType must be minutes, hours, or days');
    if (startTime && endTime && new Date(endTime) <= new Date(startTime)) return problem(res, 400, 'endTime must be later than startTime');
    const script = await get('SELECT * FROM scripts WHERE id = ?', [scriptId]);
    if (!script) return problem(res, 404, 'Script not found');
    if (platform && !['linux', 'windows'].includes(platform)) return problem(res, 400, 'platform must be linux or windows');

    const cronExpression = frequencyToCron(frequencyType, Number(frequencyValue));
    const id = uuidv4();
    await run(`INSERT INTO schedules (id, script_id, frequency_type, frequency_value, start_time, end_time, run_immediately, cron_expression)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, scriptId, frequencyType, Number(frequencyValue), startTime || null, endTime || null, runImmediately ? 1 : 0, cronExpression]);

    const schedule = await get('SELECT * FROM schedules WHERE id = ?', [id]);
    await loadSchedule(schedule);
    res.status(201).json({
      id,
      scriptId,
      scriptName: script.name,
      scriptType: script.type,
      platform: platform || (script.type === 'bat' ? 'windows' : 'linux'),
      frequency: `${frequencyValue} ${frequencyType}`,
      frequencyType,
      frequencyValue: Number(frequencyValue),
      startTime: startTime || null,
      endTime: endTime || null,
      runImmediately: Boolean(runImmediately),
      cronExpression,
      nextRun: nextRunAt(schedule),
      isActive: true,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/schedules', async (req, res, next) => {
  try {
    const rows = await all(`SELECT s.*, sc.name as script_name, sc.type as script_type,
      (SELECT e.status FROM executions e WHERE e.schedule_id = s.id ORDER BY e.started_at DESC LIMIT 1) as last_status,
      (SELECT e.finished_at FROM executions e WHERE e.schedule_id = s.id ORDER BY e.started_at DESC LIMIT 1) as last_run
      FROM schedules s JOIN scripts sc ON s.script_id = sc.id WHERE s.is_active = 1 ORDER BY s.created_at DESC`);
    res.json(rows.map(row => ({
      id: row.id,
      scriptId: row.script_id,
      scriptName: row.script_name,
      scriptType: row.script_type,
      frequency: `${row.frequency_value} ${row.frequency_type}`,
      frequencyType: row.frequency_type,
      frequencyValue: row.frequency_value,
      startTime: row.start_time,
      endTime: row.end_time,
      runImmediately: row.run_immediately === 1,
      cronExpression: row.cron_expression,
      lastStatus: row.last_status,
      lastRun: row.last_run,
      nextRun: nextRunAt({ ...row, last_run: row.last_run }),
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/schedules/:id/logs', async (req, res, next) => {
  try {
    const schedule = await get('SELECT id FROM schedules WHERE id = ?', [req.params.id]);
    if (!schedule) return problem(res, 404, 'Schedule not found');
    const rows = await all('SELECT id, status, started_at, finished_at, stdout, stderr, exit_code FROM executions WHERE schedule_id = ? ORDER BY started_at DESC LIMIT 20', [req.params.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/schedules/:id/cancel', async (req, res, next) => {
  try {
    const result = await run('UPDATE schedules SET is_active = 0 WHERE id = ?', [req.params.id]);
    if (!result.changes) return problem(res, 404, 'Schedule not found');
    if (activeJobs.has(req.params.id)) {
      activeJobs.get(req.params.id).stop();
      activeJobs.delete(req.params.id);
    }
    res.json({ message: 'Schedule cancelled successfully' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/schedules/:id', async (req, res, next) => {
  try {
    if (activeJobs.has(req.params.id)) {
      activeJobs.get(req.params.id).stop();
      activeJobs.delete(req.params.id);
    }
    const result = await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    if (!result.changes) return problem(res, 404, 'Schedule not found');
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', async (req, res, next) => {
  try {
    await get('SELECT 1 as ok');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => problem(res, 404, `Route ${req.method} ${req.originalUrl} not found`));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(500).json({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'An unexpected error occurred' });
});

async function startServer() {
  await init();
  const schedules = await all('SELECT * FROM schedules WHERE is_active = 1');
  for (const schedule of schedules) await loadSchedule(schedule);
  app.listen(PORT, () => console.log(`Script Scheduler API running on port ${PORT}`));
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
