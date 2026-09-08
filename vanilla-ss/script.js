// --- Utility & State ---
const lsKey = 'scriptSchedulerJobs';
let jobs = JSON.parse(localStorage.getItem(lsKey) || '[]');
const toasts = document.getElementById('toast');

// show toast
function toast(msg) {
  toasts.textContent = msg;
  toasts.classList.add('show');
  setTimeout(() => toasts.classList.remove('show'), 2000);
}

// save & reschedule all jobs
function persistAndSchedule() {
  localStorage.setItem(lsKey, JSON.stringify(jobs));
  // clear existing timers
  jobs.forEach(job => {
    if (job._timer) clearTimeout(job._timer);
  });
  // schedule next runs
  jobs.forEach(scheduleJob);
}

// simulate execution
function executeJob(job) {
  const now = new Date();
  let stdout = `--- Executed at ${now.toLocaleString()} ---\n`;
  stdout += job.content.split('\n').map(l => `> ${l}`).join('\n');
  // store log
  job.lastRun = now.toISOString();
  job.lastStatus = 'success';
  job.logs = stdout;
  persistAndSchedule();
}

// schedule single job
function scheduleJob(job) {
  const freqMs = job.freqNum *
    ({ minutes:60000, hours:3600000, days:86400000 })[job.freqUnit];
  const start = job.runNow
    ? Date.now()
    : Math.max(new Date(job.startTime).getTime(), Date.now());
  const next = start + freqMs;
  const delay = next - Date.now();
  job._timer = setTimeout(() => {
    // end-time check
    if (job.endTime && Date.now() > new Date(job.endTime).getTime()) {
      return; // expired
    }
    executeJob(job);
    scheduleJob(job);
  }, delay);
}

// on load, schedule stored jobs
jobs.forEach(scheduleJob);

// --- Tab Switching ---
const tabUpload = document.getElementById('tab-upload');
const tabJobs   = document.getElementById('tab-jobs');
const secUp     = document.getElementById('section-upload');
const secJobs   = document.getElementById('section-jobs');
tabUpload.onclick = () => {
  tabUpload.classList.add('active');
  tabJobs.classList.remove('active');
  secUp.classList.remove('hidden');
  secJobs.classList.add('hidden');
};
tabJobs.onclick = () => {
  tabJobs.classList.add('active');
  tabUpload.classList.remove('active');
  secJobs.classList.remove('hidden');
  secUp.classList.add('hidden');
  renderJobs();
};

// --- Upload Form ---
const uploadForm = document.getElementById('upload-form');
const fileInput  = document.getElementById('file-input');
const nameInput  = document.getElementById('script-name');
const platSelect = document.getElementById('platform');
uploadForm.onsubmit = e => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  if (!/\.(sh|bat)$/i.test(file.name)) {
    return showError('upload-error','Invalid type');
  }
  if (file.size > 1024*1024) {
    return showError('upload-error','Max size 1 MB');
  }
  clearError('upload-error');
  const reader = new FileReader();
  reader.onload = () => {
    nameInput.value = nameInput.value || file.name;
    // store temp
    uploadForm.dataset.content = reader.result;
    uploadForm.dataset.name = nameInput.value;
    uploadForm.dataset.platform = platSelect.value;
    // show schedule form
    document.getElementById('schedule-form').classList.remove('hidden');
    toast('Script ready to schedule');
  };
  reader.readAsText(file);
};

// --- Schedule Form ---
const schedForm = document.getElementById('schedule-form');
schedForm.onsubmit = e => {
  e.preventDefault();
  const job = {
    id: Date.now(),
    name: uploadForm.dataset.name,
    content: uploadForm.dataset.content,
    platform: uploadForm.dataset.platform,
    freqNum: +document.getElementById('freq-num').value,
    freqUnit: document.getElementById('freq-unit').value,
    startTime: document.getElementById('start-time').value,
    endTime: document.getElementById('end-time').value,
    runNow: document.getElementById('run-now').checked,
    lastRun: null,
    lastStatus: null,
    logs: ''
  };
  jobs.push(job);
  persistAndSchedule();
  toast('Scheduled!');
  schedForm.reset();
  uploadForm.reset();
  schedForm.classList.add('hidden');
};

// show error helper
function showError(id,msg){
  document.getElementById(id).textContent = msg;
}
function clearError(id){
  document.getElementById(id).textContent = '';
}

// --- Render Jobs ---
function renderJobs() {
  const container = document.getElementById('jobs-container');
  container.innerHTML = '';
  if (!jobs.length) {
    container.textContent = 'No jobs yet.';
    return;
  }
  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <h3>${job.name}</h3>
      <p>Every ${job.freqNum} ${job.freqUnit}</p>
      <p>Last run: ${job.lastRun||'–'}</p>
      <p>Next run: ${calcNext(job)||'–'}</p>
      <span class="status ${job.lastStatus||''}">${job.lastStatus||''}</span>
      <button class="view-logs">View Logs</button>
      <button class="cancel-job">Cancel</button>
      <button class="delete-job">Delete</button>
    `;
    // view logs
    card.querySelector('.view-logs').onclick = () => {
      document.getElementById('log-output').textContent = job.logs || 'No logs yet';
      document.getElementById('modal').classList.remove('hidden');
    };
    // cancel
    card.querySelector('.cancel-job').onclick = () => {
      clearTimeout(job._timer);
      job.endTime = new Date().toISOString(); // expire
      persistAndSchedule();
      renderJobs();
      toast('Canceled');
    };
    // delete
    card.querySelector('.delete-job').onclick = () => {
      jobs = jobs.filter(j=>j.id!==job.id);
      persistAndSchedule();
      renderJobs();
      toast('Deleted');
    };
    container.appendChild(card);
  });
}

// Next-run calculator
function calcNext(job) {
  if (!job.lastRun) return job.runNow
    ? 'imminent'
    : new Date(job.startTime).toLocaleString();
  const freqMs = job.freqNum *
    ({ minutes:60000, hours:3600000, days:86400000 })[job.freqUnit];
  return new Date(new Date(job.lastRun).getTime() + freqMs)
    .toLocaleString();
}

// --- Modal Close ---
document.getElementById('close-modal').onclick = () => {
  document.getElementById('modal').classList.add('hidden');
};
