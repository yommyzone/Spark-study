let sparkClient = null;
let authMode = 'signin';

if (window.supabase && window.SPARK_SUPABASE_URL && window.SPARK_SUPABASE_PUBLISHABLE_KEY) {
  sparkClient = window.supabase.createClient(window.SPARK_SUPABASE_URL, window.SPARK_SUPABASE_PUBLISHABLE_KEY);
  sparkClient.auth.getSession().then(({ data }) => { updateAuthUI(data.session); loadDashboardData(data.session); });
  sparkClient.auth.onAuthStateChange((event, session) => { updateAuthUI(session); loadDashboardData(session); if (event === 'PASSWORD_RECOVERY') openPasswordReset(); });
}

const authModal = document.getElementById('authModal');
const authForm = document.getElementById('authForm');
const authStatus = document.getElementById('authStatus');
const authTitle = document.getElementById('authTitle');
const authCopy = document.getElementById('authCopy');
const authSubmit = document.getElementById('authSubmit');
const switchAuth = document.getElementById('switchAuth');

function updateAuthUI(session) {
  const openAuth = document.getElementById('openAuth');
  const avatar = document.getElementById('accountAvatar');
  if (!openAuth || !avatar) return;
  if (session?.user) {
    openAuth.textContent = 'Sign out';
    avatar.textContent = (session.user.email || 'AO').slice(0, 2).toUpperCase();
    openAuth.onclick = async () => { await sparkClient.auth.signOut(); showToast('Signed out of Spark Study.'); };
    avatar.onclick = openAuth.onclick;
  } else {
    openAuth.textContent = 'Sign in';
    openAuth.onclick = () => authModal.classList.add('show');
    avatar.onclick = openAuth.onclick;
  }
}

async function loadDashboardData(session) {
  if (!session || !sparkClient) return;
  const { data: sessions, error } = await sparkClient.from('study_sessions').select('*').order('completed_at', { ascending: false }).limit(50);
  if (error || !sessions) return;
  const questions = sessions.reduce((sum, item) => sum + (item.total_questions || 0), 0);
  const correct = sessions.reduce((sum, item) => sum + (item.score || 0), 0);
  const mastery = questions ? Math.round((correct / questions) * 100) : 0;
  const seconds = sessions.reduce((sum, item) => sum + (item.duration_seconds || 0), 0);
  const minutes = Math.round(seconds / 60);
  const uniqueDays = [...new Set(sessions.map(item => new Date(item.completed_at).toDateString()))];
  const thisWeek = sessions.filter(item => Date.now() - new Date(item.completed_at).getTime() < 7 * 86400000).length;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('statTime', minutes ? `${minutes}m` : '0m');
  set('statTimeFoot', minutes ? `${thisWeek} session${thisWeek === 1 ? '' : 's'} this week` : 'Session time will appear here');
  set('statQuestions', questions);
  set('statQuestionsFoot', `${sessions.length} completed session${sessions.length === 1 ? '' : 's'}`);
  set('statCorrect', correct);
  set('statCorrectFoot', questions ? `${Math.round((correct / questions) * 100)}% accuracy` : 'Answer questions to build recall');
  set('statStreak', `${uniqueDays.length} day${uniqueDays.length === 1 ? '' : 's'}`);
  set('statMastery', `${mastery}%`);
  set('statMasteryFoot', questions ? `${correct} correct answer${correct === 1 ? '' : 's'} recorded` : 'Your first score starts here');
  const activity = document.querySelector('.activity-list');
  if (activity && sessions.length) activity.innerHTML = sessions.slice(0, 3).map(item => {
    const score = `${item.score || 0}/${item.total_questions || 0}`;
    const percent = item.total_questions ? Math.round((item.score / item.total_questions) * 100) : 0;
    const date = new Date(item.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="activity-row"><div class="activity-icon biology">⌬</div><div class="activity-copy"><strong>Biology session</strong><span>Quiz completed · ${date}</span></div><div class="activity-score"><strong>${score}</strong><span>${percent}%</span></div><div class="mini-progress"><span style="width:${percent}%"></span></div></div>`;
  }).join('');
}

function openPasswordReset() {
  authMode = 'reset';
  authModal.classList.add('show');
  authTitle.textContent = 'Set a new password.';
  authCopy.textContent = 'Choose a new password for your Spark Study account.';
  authSubmit.innerHTML = 'Update password <span>→</span>';
  document.getElementById('authEmailLabel').style.display = 'none';
  document.getElementById('authEmail').required = false;
  document.getElementById('forgotPassword').style.display = 'none';
  switchAuth.style.display = 'none';
  document.getElementById('googleAuth').style.display = 'none';
  document.querySelector('.auth-divider').style.display = 'none';
}

document.getElementById('closeAuth').addEventListener('click', () => authModal.classList.remove('show'));
authModal.addEventListener('click', e => { if (e.target === authModal) authModal.classList.remove('show'); });
switchAuth.addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  authTitle.textContent = authMode === 'signin' ? 'Welcome back.' : 'Create your account.';
  authCopy.textContent = authMode === 'signin' ? 'Sign in to save your sessions, streaks and progress across devices.' : 'Create a free account and keep your study progress wherever you go.';
  authSubmit.innerHTML = authMode === 'signin' ? 'Sign in <span>→</span>' : 'Create account <span>→</span>';
  switchAuth.textContent = authMode === 'signin' ? 'New to Spark Study? Create an account' : 'Already have an account? Sign in';
  authStatus.textContent = '';
});
document.getElementById('forgotPassword').addEventListener('click', async () => {
  if (!sparkClient) { authStatus.textContent = 'Supabase is not connected yet.'; return; }
  const email = document.getElementById('authEmail').value.trim();
  if (!email) { authStatus.textContent = 'Enter your email first, then click Forgot password.'; return; }
  const { error } = await sparkClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  authStatus.textContent = error ? error.message : 'Password reset email sent. Check your inbox.';
});

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  authStatus.textContent = '';
  if (!sparkClient) { authStatus.textContent = 'Supabase is not connected yet.'; return; }
  authSubmit.disabled = true;
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const result = authMode === 'reset'
    ? await sparkClient.auth.updateUser({ password })
    : authMode === 'signin'
      ? await sparkClient.auth.signInWithPassword({ email, password })
      : await sparkClient.auth.signUp({ email, password });
  authSubmit.disabled = false;
  if (result.error) { authStatus.textContent = result.error.message; return; }
  if (authMode === 'signup' && !result.data.session) authStatus.textContent = 'Account created. Check your email to confirm, then sign in.';
  else { authModal.classList.remove('show'); showToast('Welcome to Spark Study ✦'); }
});
document.getElementById('googleAuth').addEventListener('click', async () => {
  if (!sparkClient) { authStatus.textContent = 'Supabase is not connected yet.'; return; }
  const { error } = await sparkClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
  if (error) authStatus.textContent = error.message;
});

const modal = document.getElementById('modal');
const toast = document.getElementById('toast');
const sidebar = document.getElementById('sidebar');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.getElementById('startSession').addEventListener('click', () => modal.classList.add('show'));
document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
document.getElementById('later').addEventListener('click', () => modal.classList.remove('show'));
const quizQuestions = [
  { topic: 'Cell structure', question: 'Which organelle is known as the powerhouse of the cell?', options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Cell wall'], answer: 1, explanation: 'Mitochondria produce most of the cell’s ATP, the usable energy that powers cellular work.' },
  { topic: 'Cell structure', question: 'What is the main function of the cell membrane?', options: ['Produce proteins', 'Store genetic material', 'Control what enters and leaves the cell', 'Release energy from glucose'], answer: 2, explanation: 'The selectively permeable cell membrane regulates movement of substances into and out of the cell.' },
  { topic: 'Cell division', question: 'During which stage of mitosis do chromosomes line up at the cell’s equator?', options: ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'], answer: 1, explanation: 'In metaphase, chromosomes align across the middle of the cell before being separated.' },
  { topic: 'Genetics', question: 'What molecule carries hereditary information in most living organisms?', options: ['ATP', 'DNA', 'Glucose', 'Lipase'], answer: 1, explanation: 'DNA stores the genetic instructions used for growth, development and reproduction.' }
];
let quizState = { index: 0, score: 0, answered: false };

document.getElementById('begin').addEventListener('click', () => {
  modal.classList.remove('show');
  quizState = { index: 0, score: 0, answered: false };
  renderQuiz();
});

function renderQuiz() {
  const q = quizQuestions[quizState.index];
  const pct = Math.round((quizState.index / quizQuestions.length) * 100);
  document.getElementById('app').innerHTML = `<div class="quiz-view">
    <div class="quiz-header"><button class="back-button" id="backToOverview">← Back to overview</button><div class="quiz-title"><span class="session-tag"><span class="live-dot"></span> BIOLOGY SESSION</span><strong>Cell structure</strong></div><span class="quiz-count">${quizState.index + 1} <small>/ ${quizQuestions.length}</small></span></div>
    <div class="quiz-progress"><span style="width:${pct}%"></span></div>
    <div class="quiz-card"><div class="question-topic">${q.topic}</div><h1>${q.question}</h1><div class="options">${q.options.map((option, i) => `<button class="option ${quizState.answered && i === q.answer ? 'correct' : ''}" data-option="${i}" ${quizState.answered ? 'disabled' : ''}><span>${String.fromCharCode(65 + i)}</span>${option}</button>`).join('')}</div><div class="answer-feedback" id="feedback"></div></div>
    <div class="quiz-footer"><span>Take your time. Recall is how memory gets stronger.</span><button class="primary-button next-button" id="nextQuestion" disabled>Next question <span>→</span></button></div>
  </div>`;
  document.getElementById('backToOverview').addEventListener('click', renderOverview);
  document.querySelectorAll('.option').forEach(button => button.addEventListener('click', () => chooseAnswer(Number(button.dataset.option))));
  document.getElementById('nextQuestion').addEventListener('click', nextQuestion);
}

function chooseAnswer(selected) {
  if (quizState.answered) return;
  quizState.answered = true;
  const q = quizQuestions[quizState.index];
  const isCorrect = selected === q.answer;
  if (isCorrect) quizState.score++;
  document.querySelectorAll('.option').forEach((button, i) => {
    button.disabled = true;
    if (i === q.answer) button.classList.add('correct');
    if (i === selected && !isCorrect) button.classList.add('incorrect');
  });
  const feedback = document.getElementById('feedback');
  feedback.className = `answer-feedback show ${isCorrect ? 'right' : 'wrong'}`;
  feedback.innerHTML = `<strong>${isCorrect ? 'Correct — nice work!' : 'Not quite this time.'}</strong><span>${q.explanation}</span>`;
  const next = document.getElementById('nextQuestion');
  next.disabled = false;
  next.innerHTML = quizState.index === quizQuestions.length - 1 ? 'See results <span>→</span>' : 'Next question <span>→</span>';
}

function nextQuestion() {
  if (!quizState.answered) return;
  if (quizState.index === quizQuestions.length - 1) return renderResults();
  quizState.index++;
  quizState.answered = false;
  renderQuiz();
}

async function saveSessionToSupabase(score, totalQuestions) {
  const { data: userData, error: userError } = await sparkClient.auth.getUser();
  if (userError || !userData.user) { showToast('Please sign in again before saving this session.'); return; }
  const { error } = await sparkClient.from('study_sessions').insert({ user_id: userData.user.id, score, total_questions: totalQuestions, duration_seconds: 0 });
  if (error) {
    console.error('Spark Study session save failed:', error);
    showToast(`Could not save session: ${error.message}`);
  } else {
    showToast('Session saved to your Spark progress ✦');
  }
}

function renderResults() {
  const pct = Math.round((quizState.score / quizQuestions.length) * 100);
  const stored = JSON.parse(localStorage.getItem('sparkSessions') || '[]');
  stored.push({ date: new Date().toISOString(), score: quizState.score, total: quizQuestions.length });
  localStorage.setItem('sparkSessions', JSON.stringify(stored.slice(-20)));
  if (sparkClient) saveSessionToSupabase(quizState.score, quizQuestions.length);
  
  document.getElementById('app').innerHTML = `<div class="results-view"><div class="result-spark">✦</div><p class="eyebrow">SESSION COMPLETE</p><h1>That’s a spark<br><em>in the right direction.</em></h1><p class="result-copy">You finished your Biology session. Every question you answer makes your next session smarter.</p><div class="result-score"><strong>${pct}%</strong><span>session mastery</span><div class="result-bar"><span style="width:${pct}%"></span></div><small>${quizState.score} of ${quizQuestions.length} answers correct</small></div><div class="result-actions"><button class="secondary-button" id="reviewOverview">Back to overview</button><button class="primary-button" id="tryAgain">Try again <span>↗</span></button></div></div>`;
  document.getElementById('reviewOverview').addEventListener('click', renderOverview);
  document.getElementById('tryAgain').addEventListener('click', () => { quizState = { index: 0, score: 0, answered: false }; renderQuiz(); });
}

async function renderLibrary() {
  const { data: sessionData } = sparkClient ? await sparkClient.auth.getSession() : { data: {} };
  if (!sessionData.session) { document.getElementById('openAuth').click(); return; }
  const { data: materials = [] } = await sparkClient.from('materials').select('*').order('created_at', { ascending: false });
  document.getElementById('app').innerHTML = `<div class="library-view"><div class="library-heading"><div><p class="eyebrow">YOUR KNOWLEDGE BASE</p><h1>My library</h1><p>Bring your study material together. Spark will help you turn it into something you remember.</p></div><button class="primary-button" id="libraryUploadButton">Add material <span>+</span></button></div><div class="upload-drop" id="uploadDrop"><input type="file" id="materialInput" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" hidden><div class="upload-icon">↑</div><strong>Drop a file here, or <u>browse</u></strong><span>PDF, Word, text and Markdown files · Max 20 MB</span></div><div class="library-toolbar"><h2>Saved materials <small>${materials.length}</small></h2><span>Link reading is a Spark Premium feature</span></div><div class="materials-grid">${materials.length ? materials.map(materialCard).join('') : '<div class="empty-library"><div>✦</div><strong>Your library is waiting.</strong><span>Upload your first set of notes to get started.</span></div>'}</div></div>`;
  const input = document.getElementById('materialInput');
  document.getElementById('libraryUploadButton').addEventListener('click', () => input.click());
  document.getElementById('uploadDrop').addEventListener('click', e => { if (e.target.tagName !== 'INPUT') input.click(); });
  document.getElementById('uploadDrop').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragging'); });
  document.getElementById('uploadDrop').addEventListener('dragleave', e => e.currentTarget.classList.remove('dragging'));
  document.getElementById('uploadDrop').addEventListener('drop', e => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); handleMaterialUpload(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => input.files[0] && handleMaterialUpload(input.files[0]));
}

function materialCard(material) {
  const size = material.size_bytes > 1048576 ? `${(material.size_bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(material.size_bytes / 1024))} KB`;
  const ext = material.file_name.split('.').pop().toUpperCase();
  return `<div class="material-card"><div class="file-badge">${ext}</div><div class="material-info"><strong>${escapeHtml(material.title)}</strong><span>${size} · Uploaded ${new Date(material.created_at).toLocaleDateString()}</span></div><span class="material-status">Uploaded</span></div>`;
}

function escapeHtml(value) { return String(value).replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#039;' }[char])); }

async function extractMaterialText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.text();
  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('Word reader is still loading.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF reader is still loading.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\\n\\n');
  }
  return '';
}

async function handleMaterialUpload(file) {
  if (!file || !sparkClient) return;
  if (file.size > 20 * 1024 * 1024) { showToast('That file is larger than 20 MB.'); return; }
  const { data: userData } = await sparkClient.auth.getUser();
  if (!userData.user) { showToast('Please sign in before uploading.'); return; }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
  showToast('Reading and uploading your material…');
  let extractedText = '';
  try { extractedText = await extractMaterialText(file); } catch (error) { console.warn('Text extraction failed:', error); }
  const { error: uploadError } = await sparkClient.storage.from('study-materials').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadError) { showToast(`Upload failed: ${uploadError.message}`); return; }
  const { error: rowError } = await sparkClient.from('materials').insert({ user_id: userData.user.id, title: file.name.replace(/\.[^/.]+$/, ''), file_name: file.name, storage_path: path, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, status: extractedText ? 'ready' : 'uploaded', extracted_text: extractedText });
  if (rowError) { showToast(`File uploaded, but metadata failed: ${rowError.message}`); return; }
  showToast('Material added to your library ✦');
  renderLibrary();
}

async function startPaystackCheckout(planId) {
  if (!window.PaystackPop) { showToast('Paystack is still loading. Try again in a moment.'); return; }
  if (!sparkClient) { showToast('Please connect your Spark account first.'); return; }
  const { data } = await sparkClient.auth.getUser();
  if (!data.user?.email) { showToast('Please sign in before choosing Premium.'); return; }
  const plan = (window.SPARK_PRICING || []).find(item => item.id === planId);
  if (!plan) return;
  const reference = `spark_${plan.id}_${Date.now()}`;
  const popup = new window.PaystackPop();
  popup.newTransaction({
    key: window.SPARK_PAYSTACK_PUBLIC_KEY,
    email: data.user.email,
    amount: plan.amountNgn * 100,
    currency: 'NGN',
    reference,
    metadata: { plan_id: plan.id, months: plan.months, user_id: data.user.id },
    onSuccess: transaction => {
      localStorage.setItem('sparkPendingPayment', JSON.stringify({ reference: transaction.reference, planId: plan.id, email: data.user.email }));
      showToast('Payment received in Test Mode. Verification is the next step.');
    },
    onCancel: () => showToast('Payment window closed.')
  });
}

function renderSettings() {
  const plans = (window.SPARK_PRICING || []).map(plan => `<div class="plan-card ${plan.popular ? 'featured' : ''}">${plan.popular ? '<span class="plan-badge">MOST POPULAR</span>' : ''}<p>${plan.label}</p><strong>₦${plan.amountNgn.toLocaleString()}</strong><span>Premium access</span><button class="secondary-button plan-button" data-plan="${plan.id}">Choose plan</button></div>`).join('');
  document.getElementById('app').innerHTML = `<div class="settings-view"><div class="settings-heading"><p class="eyebrow">YOUR ACCOUNT</p><h1>Settings</h1><p>Manage your Spark Study account and choose a Premium plan when you’re ready.</p></div><div class="settings-section"><div><p class="eyebrow">SPARK PREMIUM</p><h2>Study without limits.</h2><p>Free users can keep up to 10 active materials. Premium unlocks higher limits, faster processing and more study capacity.</p></div><div class="plans-grid">${plans}</div></div><button class="back-button settings-back" id="settingsBack">← Back to overview</button></div>`;
  document.getElementById('settingsBack').addEventListener('click', renderOverview);
  document.querySelectorAll('.plan-button').forEach(button => button.addEventListener('click', () => startPaystackCheckout(button.dataset.plan)));
}

function renderOverview() { window.location.reload(); }
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

document.getElementById('openMenu').addEventListener('click', () => sidebar.classList.add('open'));
document.getElementById('closeMenu').addEventListener('click', () => sidebar.classList.remove('open'));

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (button.classList.contains('nav-item')) button.classList.add('active');
    sidebar.classList.remove('open');
    const view = button.dataset.view;
    if (view === 'sessions') { const start = document.getElementById('startSession'); if (start) start.click(); else if (typeof renderQuiz === 'function') renderQuiz(); }
    else if (view === 'library') renderLibrary();
    else if (view === 'progress') showToast('Detailed progress reports are coming next.');
    else if (view === 'settings') renderSettings();
    else if (view === 'overview') showToast('You’re already on your overview.');
  });
});

document.getElementById('addSubject').addEventListener('click', () => showToast('Subject creation will be available in the next Spark update.'));
document.querySelector('.icon-button').addEventListener('click', () => showToast('You’re all caught up.'));
