
function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sbOverlay').classList.toggle('show');
}

function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sbOverlay').classList.remove('show');
}

const pageNames = {
  analyze:'New Analysis',
  history:'History',
  ux:'UX Reports',
  growth:'Growth Plans',
  settings:'Settings',
  job:'Analysis Running'
};

const API_BASE = window.location.origin; // Temporary local build/testing mode: localhost dev server proxies to the VM backend.

function normalizeMessage(value, fallback){
  if(typeof value !== 'string') return fallback;
  const message = value.replace(/\s+/g, ' ').trim();
  return message || fallback;
}

function getErrorMessage(payload, fallback){
  if(payload && typeof payload === 'object'){
    return normalizeMessage(payload.error || payload.message, fallback);
  }
  return normalizeMessage(payload, fallback);
}

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readMockToggle(){
  const mockParam = new URLSearchParams(window.location.search).get('mock');
  if(mockParam == null) return true;
  return !['0', 'false', 'off', 'no'].includes(mockParam.toLowerCase());
}

function createApiError(message, status = 500, data = null){
  const error = new Error(normalizeMessage(message, 'Something went wrong. Please try again.'));
  error.status = status;
  error.data = data;
  return error;
}

async function fetchJson(url){
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw createApiError('Received an invalid response from the backend.', res.status);
  }

  if(!res.ok){
    throw createApiError(getErrorMessage(data, text || `Request failed (${res.status})`), res.status, data);
  }

  return data;
}

function uploadWithXhr(url, formData, onUploadProgress){
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if(onUploadProgress){
      xhr.upload.addEventListener('progress', e => {
        if(e.lengthComputable) onUploadProgress((e.loaded / e.total) * 100);
      });
    }
    xhr.onload = () => {
      const respText = xhr.responseText || '';
      let data;
      try {
        data = respText ? JSON.parse(respText) : {};
      } catch (e) {
        const fallback = xhr.status >= 400 ? `Server error (${xhr.status})` : 'Invalid response from backend';
        return reject(createApiError(getErrorMessage(respText, fallback), xhr.status));
      }

      if(xhr.status >= 200 && xhr.status < 300){
        resolve(data);
      } else {
        reject(createApiError(getErrorMessage(data, `Failed to start analysis (${xhr.status})`), xhr.status, data));
      }
    };
    xhr.onerror = () => reject(createApiError('Upload failed. Check that the local dev server is running on localhost:3000.'));
    xhr.send(formData);
  });
}

const USE_MOCK = readMockToggle();
const POLL_INTERVAL_MS = USE_MOCK ? 1200 : 5000;

if(USE_MOCK){
  console.info('[ProdScope] Mock mode active');
}

const mockJobs = new Map();
const MOCK_STAGES = [
  { afterMs: 0, status: 'queued', step: 1 },
  { afterMs: 2600, status: 'processing', step: 1 },
  { afterMs: 6600, status: 'processing', step: 2 },
  { afterMs: 10800, status: 'processing', step: 3 },
  { afterMs: 14800, status: 'processing', step: 4 },
  { afterMs: 18800, status: 'processing', step: 5 },
  { afterMs: 22800, status: 'complete', step: 5 }
];

function createMockReport(job){
  return JSON.stringify({
    overall_score: 84,
    summary: `Mock analysis for ${job.fileName} found a few UX issues and medium-priority bugs in the ${job.goldenPath || 'core flow'}.`,
    critical_bugs: [
      'Primary CTA appears below the fold on smaller devices during onboarding.',
      'Checkout confirmation state lacks a clear success affordance after payment.'
    ],
    ux_issues: [
      'New users have too much copy to scan before the first meaningful action.',
      'Search results feel dense and make comparison harder than it should be.'
    ],
    suggestions: [
      'Reduce friction in onboarding by revealing one key action at a time.',
      'Make the checkout summary sticky to reinforce confidence before payment.'
    ],
    quick_wins: [
      'Increase contrast on helper text inside form fields.',
      'Tighten empty-state copy so users understand the next step immediately.'
    ],
    detailed_findings: [
      {
        area: 'Onboarding',
        severity: 'medium',
        finding: 'The sign-up flow asks for too much context before showing value.'
      },
      {
        area: 'Checkout',
        severity: 'medium',
        finding: 'The review screen does not emphasize price, timing, and confirmation strongly enough.'
      }
    ],
    email: job.email,
    goals: job.goals,
    generatedAt: new Date().toISOString()
  }, null, 2);
}

function createMockJob(formData){
  const file = formData.get('apk');
  return {
    createdAt: Date.now(),
    email: formData.get('email') || '',
    credentials: formData.get('credentials') || '{}',
    goldenPath: formData.get('goldenPath') || '',
    painPoints: formData.get('painPoints') || '',
    goals: formData.get('goals') || '',
    fileName: file && typeof file === 'object' && 'name' in file ? file.name : 'mock-build.apk',
    steps: ['Uploading', 'Installing', 'Crawling', 'Analyzing', 'Generating Report', 'Sending Email'],
    screenshots: ['mock://screen/home', 'mock://screen/search', 'mock://screen/checkout']
  };
}

function getMockStage(job){
  const elapsed = Date.now() - job.createdAt;
  let stage = MOCK_STAGES[0];
  for(const candidate of MOCK_STAGES){
    if(elapsed >= candidate.afterMs){
      stage = candidate;
    } else {
      break;
    }
  }
  return stage;
}

async function simulateMockUpload(onUploadProgress){
  const checkpoints = [6, 14, 27, 41, 56, 69, 82, 93, 100];
  for(const pct of checkpoints){
    if(onUploadProgress) onUploadProgress(pct);
    await sleep(140 + Math.round(Math.random() * 120));
  }
}

function createMockApi(){
  return {
    async startJob({ formData, onUploadProgress }){
      await simulateMockUpload(onUploadProgress);
      const jobId = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const job = createMockJob(formData);
      job.jobId = jobId;
      job.report = createMockReport(job);
      mockJobs.set(jobId, job);
      return { jobId, status: 'queued' };
    },

    async getJobStatus(jobId){
      await sleep(180);
      const job = mockJobs.get(jobId);
      if(!job){
        throw createApiError('Job not found', 404);
      }

      const stage = getMockStage(job);
      return {
        status: stage.status,
        step: stage.step,
        currentStep: stage.step,
        steps: job.steps,
        screenshots: stage.status === 'complete' ? job.screenshots : [],
        report: stage.status === 'complete' ? job.report : null
      };
    }
  };
}

function createLiveApi(baseUrl){
  return {
    startJob({ formData, onUploadProgress }){
      return uploadWithXhr(`${baseUrl}/api/start-job`, formData, onUploadProgress);
    },

    getJobStatus(jobId){
      return fetchJson(`${baseUrl}/api/job-status/${encodeURIComponent(jobId)}`);
    }
  };
}

const api = USE_MOCK ? createMockApi() : createLiveApi(API_BASE);

function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));
  const nav = document.getElementById('nav-' + id);
  if(nav) nav.classList.add('active');
  document.getElementById('topCrumb').textContent = pageNames[id] || id;
  closeSidebar();
}

let uploadedFile = null;
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if(f && (f.name.endsWith('.apk') || f.name.endsWith('.aab'))){
    setFile(f);
  } else {
    alert('Please upload an .apk or .aab file');
  }
});

function handleFile(input){
  const f = input.files[0];
  if(f) setFile(f);
}

function setFile(f){
  uploadedFile = f;
  document.getElementById('fileName').textContent = f.name;
  document.getElementById('fileSize').textContent = (f.size / 1024 / 1024).toFixed(1) + ' MB';
  document.getElementById('filePrev').classList.add('show');
  dropZone.style.display = 'none';
}

function removeFile(){
  uploadedFile = null;
  document.getElementById('filePrev').classList.remove('show');
  dropZone.style.display = 'block';
  document.getElementById('apkFile').value = '';
}

let timerInterval = null;
let timerSeconds = 0;

function startTimer(){
  timerSeconds = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer(){
  if(timerInterval){
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay(){
  const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
  const s = (timerSeconds % 60).toString().padStart(2, '0');
  document.getElementById('jobTimer').textContent = m + ':' + s;
}

function resetJobSteps(){
  const __livePanel = document.getElementById('livePanel');
  if (__livePanel) __livePanel.classList.remove('show');

  for(let i = 1; i <= 6; i++){
    const el = document.getElementById('js' + i);
    el.classList.remove('active', 'done', 'failed');
    const jn = document.getElementById('jn' + i);
    jn.innerHTML = i;
  }
  document.getElementById('js1Detail').textContent = 'Transferring to secure cloud';
  document.getElementById('uploadProgressBar').style.display = 'none';
  document.getElementById('uploadProgressFill').style.width = '0%';
}

function setJobStep(step, state){
  const el = document.getElementById('js' + step);
  el.classList.remove('active', 'done', 'failed');
  el.classList.add(state);

  const jn = document.getElementById('jn' + step);
  if(state === 'done'){
    jn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
  } else {
    jn.textContent = step;
  }
}

function setUploadProgress(pct){
  const bar = document.getElementById('uploadProgressBar');
  const fill = document.getElementById('uploadProgressFill');
  const detail = document.getElementById('js1Detail');
  bar.style.display = 'block';
  fill.style.width = pct + '%';
  detail.textContent = 'Uploadingâ€¦ ' + Math.round(pct) + '%';
}

function failJobState(message, activeStep = 1){
  stopPolling();
  stopTimer();
  const step = Math.min(Math.max(activeStep, 1), 6);
  for(let i = 1; i < step; i++) setJobStep(i, 'done');
  setJobStep(step, 'failed');
  document.getElementById('jobOrb').classList.add('done');
  document.getElementById('jobTitle').textContent = 'Analysis Failed';
  document.getElementById('jobSub').textContent = normalizeMessage(message, 'Something went wrong. Please try again.').slice(0, 120);
}

let pollInterval = null;

function pollJobStatus(jobId){
  stopPolling();
  const checkStatus = async () => {
    try{
      const data = await api.getJobStatus(jobId);

      const status = data.status || data.state || '';
      const backendStep = data.currentStep != null ? data.currentStep : data.step;
      const currentStep = typeof backendStep === 'number' ? Math.max(backendStep + 1, 2) : 2;

      if(status === 'complete' || status === 'completed' || status === 'success'){
        stopPolling();
        stopTimer();
        for(let i = 1; i <= 6; i++) setJobStep(i, 'done');
        document.getElementById('jobOrb').classList.add('done');
        document.getElementById('jobTitle').textContent = 'Report Sent!';
        document.getElementById('jobSub').textContent = 'Check your inbox â€” your full analysis report has been emailed.';
        return;
      }

      if(status === 'failed' || status === 'error'){
        const activeStep = Math.min(Math.max(currentStep || 2, 1), 6);
        failJobState(getErrorMessage(data, 'Something went wrong. Please try again.'), activeStep);
        return;
      }

      const step = Math.min(Math.max(currentStep, 1), 6);
      for(let i = 1; i < step; i++) setJobStep(i, 'done');
      setJobStep(step, 'active');
    }catch(err){
      failJobState(getErrorMessage(err && err.data, err && err.message ? err.message : 'Lost connection while checking job status.'), 2);
    }
  };

  checkStatus();
  pollInterval = setInterval(checkStatus, POLL_INTERVAL_MS);
}

function stopPolling(){
  if(pollInterval){
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function startAnalysis(){
  if(!uploadedFile){
    alert('Please upload an APK or AAB file.');
    return;
  }

  const email = document.getElementById('reportEmail').value.trim();
  if(!email || !email.includes('@')){
    alert('Please enter a valid email address to receive your report.');
    return;
  }

  const goals = [...document.querySelectorAll('.g-chip.on')].map(c => c.textContent.trim()).join(', ');
  const painPoints = document.getElementById('painPoints').value || '';
  const goldenPath = document.getElementById('goldenPath').value || '';
  const credUser = document.getElementById('credUser').value || '';
  const credPass = document.getElementById('credPass').value || '';
  const credentials = { username: credUser, password: credPass };

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;

  document.getElementById('jobEmail').textContent = email;
  document.getElementById('jobOrb').classList.remove('done');
  document.getElementById('jobTitle').textContent = 'Analysis in Progress';
  document.getElementById('jobSub').textContent = 'Our AI is installing and testing your app right now';
  resetJobSteps();
  setJobStep(1, 'active');
  stopTimer();
  startTimer();
  showPage('job');

  try{
    const formData = new FormData();
    formData.append('apk', uploadedFile);
    formData.append('email', email);
    formData.append('credentials', JSON.stringify(credentials));
    formData.append('goldenPath', goldenPath);
    formData.append('painPoints', painPoints);
    formData.append('goals', goals);

    setUploadProgress(0);
    const startResult = await api.startJob({
      formData,
      onUploadProgress: setUploadProgress
    });
    const jobId = startResult && startResult.jobId;

    setJobStep(1, 'done');
    setJobStep(2, 'active');
    document.getElementById('js1Detail').textContent = 'Upload complete';
    document.getElementById('uploadProgressBar').style.display = 'none';

    if(!jobId) throw new Error('No job ID returned');
    pollJobStatus(jobId);
  }catch(err){
    failJobState(getErrorMessage(err && err.data, err && err.message ? err.message : 'Something went wrong. Please try again.'), 1);
  }finally{
    btn.disabled = false;
  }
}

function startNew(){
  stopTimer();
  stopPolling();
  removeFile();
  document.getElementById('painPoints').value = '';
  document.getElementById('goldenPath').value = '';
  document.getElementById('credUser').value = '';
  document.getElementById('credPass').value = '';
  document.getElementById('reportEmail').value = '';
  showPage('analyze');
}

function renderLivePreview(live, jobId) {
  const panel = document.getElementById('livePanel');
  if (!panel || !live) return;

  panel.classList.add('show');

  const phase = String(live.phase || 'running');
  const dot = document.getElementById('livePanelDot');
  const phaseEl = document.getElementById('livePanelPhase');
  const counterEl = document.getElementById('livePanelCounter');
  const activityEl = document.getElementById('livePanelActivity');
  const intentEl = document.getElementById('livePanelIntent');
  const actionEl = document.getElementById('livePanelAction');
  const captureEl = document.getElementById('livePanelCapture');
  const messageEl = document.getElementById('livePanelMessage');
  const thumbEl = document.getElementById('livePanelThumb');

  if (dot) dot.className = 'live-panel-dot ' + phase;
  if (phaseEl) phaseEl.textContent = phase.replace(/_/g, ' ');

  const stepPart = (live.rawStep != null && live.maxRawSteps != null)
    ? (live.rawStep + '/' + live.maxRawSteps)
    : ((live.countedUniqueScreens != null && live.targetUniqueScreens != null)
      ? (live.countedUniqueScreens + '/' + live.targetUniqueScreens)
      : '-');
  if (counterEl) counterEl.textContent = stepPart;

  if (activityEl) activityEl.textContent = live.activity || live.packageName || '-';
  if (intentEl) intentEl.textContent = live.intentType || '-';

  let actionText = '-';
  if (live.latestAction && typeof live.latestAction === 'object') {
    actionText = [
      live.latestAction.type,
      live.latestAction.description,
      live.latestAction.decisionSource
    ].filter(Boolean).join(': ');
  } else if (live.latestAction) {
    actionText = String(live.latestAction);
  }
  if (actionEl) actionEl.textContent = actionText;
  if (captureEl) captureEl.textContent = live.captureMode || (live.screenshotUnavailable ? 'xml_only' : '-');
  if (messageEl) messageEl.textContent = live.message || live.stopReason || 'Live progress update';

  const base = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : window.location.origin;

  if (thumbEl) {
    if (live.screenshotPath && !live.screenshotUnavailable) {
      const filename = String(live.screenshotPath).split('/').pop();
      thumbEl.innerHTML = '<img alt="Latest crawl screen">';
      const img = thumbEl.querySelector('img');
      img.onerror = function () {
        thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
      };
      img.src = base + '/api/job-screenshot/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(filename) + '?t=' + Date.now();
    } else {
      thumbEl.textContent = live.captureMode === 'xml_only' ? 'XML-only mode' : 'Preview unavailable';
    }
  }
}


