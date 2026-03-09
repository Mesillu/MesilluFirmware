/* ═══════════════════════════════════════════
   MESILLU FIRMWARE — MAIN JS
   ═══════════════════════════════════════════ */

const API_URL = '/api/snippets';

/* ── TOAST ── */
let toastTimer;
function showToast(msg, isError = false) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  toastTimer = setTimeout(() => { t.className = t.className.replace(' show', ''); }, 3000);
}

/* ── COPY CODE ── */
async function copyCode(btn, code) {
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = '✓ COPIED';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'COPY';
      btn.classList.remove('copied');
    }, 2000);
    showToast('Code copied to clipboard');
  } catch {
    showToast('Copy failed — try selecting manually', true);
  }
}

/* ── FORMAT DATE ── */
function formatDate(str) {
  if (!str) return 'Unknown';
  try {
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return str;
  }
}

/* ── ESCAPE HTML ── */
function escapeHtml(str) {
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  return (str || '').replace(/[&<>"']/g, c => map[c]);
}

/* ── BUILD CARD ── */
function buildCard(snippet, idx) {
  const card = document.createElement('div');
  card.className = 'code-card';
  card.style.animationDelay = `${Math.min(idx * 0.07, 0.5)}s`;

  // Detect language from title or description
  const raw = (snippet.code || '').trim();
  const lang = detectLang(snippet.title, raw);

  const safeTitle = escapeHtml(snippet.title);
  const safeDesc  = escapeHtml(snippet.description);
  const safeDate  = escapeHtml(formatDate(snippet.date));
  const escapedCode = escapeHtml(raw);

  card.innerHTML = `
    <div class="card-header">
      <div class="card-meta">
        <div class="card-title">${safeTitle}</div>
        ${safeDesc ? `<div class="card-desc">${safeDesc}</div>` : ''}
        <div class="card-date">${safeDate}</div>
      </div>
    </div>
    <div class="card-code-wrap">
      <pre class="language-${lang}"><code class="language-${lang}">${escapedCode}</code></pre>
    </div>
    <div class="card-footer">
      <button class="glow-btn" onclick="copyCode(this, ${JSON.stringify(raw)})">COPY</button>
    </div>
  `;

  return card;
}

/* ── DETECT LANGUAGE ── */
function detectLang(title, code) {
  const t = (title || '').toLowerCase();
  const c = (code || '').slice(0, 200).toLowerCase();
  if (t.includes('python') || c.includes('def ') || c.includes('import ')) return 'python';
  if (t.includes('javascript') || t.includes('js') || c.includes('function ') || c.includes('const ') || c.includes('=>')) return 'javascript';
  if (t.includes('bash') || t.includes('shell') || c.startsWith('#!') || c.includes('echo ')) return 'bash';
  if (t.includes('css') || c.includes('{') && c.includes(':') && c.includes(';')) return 'css';
  if (t.includes('html') || c.includes('<!doctype') || c.includes('<html')) return 'html';
  if (t.includes('c++') || t.includes('cpp') || c.includes('#include')) return 'cpp';
  if (t.includes('rust') || c.includes('fn main') || c.includes('let mut')) return 'rust';
  if (t.includes('json') || (c.startsWith('{') || c.startsWith('['))) return 'json';
  if (t.includes('sql') || c.includes('select ') || c.includes('create table')) return 'sql';
  return 'javascript';
}

/* ── FETCH & RENDER SNIPPETS (Index page) ── */
async function loadSnippets(filter = '') {
  const container = document.getElementById('snippets-grid');
  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">LOADING SNIPPETS...</div>
    </div>`;

  try {
    const res  = await fetch(API_URL);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Fetch failed');

    const snippets = (data.snippets || []).filter(s => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (s.title || '').toLowerCase().includes(q)
          || (s.description || '').toLowerCase().includes(q);
    });

    // Update count
    const badge = document.getElementById('snippet-count');
    if (badge) badge.textContent = `${snippets.length} SNIPPET${snippets.length !== 1 ? 'S' : ''}`;

    container.innerHTML = '';

    if (!snippets.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">◈</span>
          <strong>NO SNIPPETS FOUND</strong>
          <p>${filter ? 'No results match your search.' : 'No snippets have been added yet.'}</p>
        </div>`;
      return;
    }

    snippets.forEach((s, i) => container.appendChild(buildCard(s, i)));

    // Prism highlight
    if (window.Prism) {
      Prism.highlightAllUnder(container);
    }

  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠</span>
        <strong>CONNECTION FAILED</strong>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
    console.error(err);
  }
}

/* ── SEARCH ── */
function initSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadSnippets(input.value.trim()), 260);
  });
}

/* ═══════════════════════════════════════════
   ADMIN PAGE LOGIC
═══════════════════════════════════════════ */

const ADMIN_PASSWORD_KEY = 'mf_admin_auth';
const ADMIN_KEY_HEADER   = 'x-admin-key';

/* ── ADMIN STATE ── */
let adminKey = null;

function getStoredKey() {
  return sessionStorage.getItem(ADMIN_PASSWORD_KEY);
}

function storeKey(key) {
  sessionStorage.setItem(ADMIN_PASSWORD_KEY, key);
}

function clearKey() {
  sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
}

/* ── LOGIN ── */
function initAdminLogin() {
  if (!document.getElementById('auth-screen')) return;

  const stored = getStoredKey();
  if (stored) {
    adminKey = stored;
    showAdminPanel();
    return;
  }

  const form  = document.getElementById('login-form');
  const input = document.getElementById('pw-input');
  const err   = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;

    // Validate against backend
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [ADMIN_KEY_HEADER]: val
        },
        body: JSON.stringify({ __validate: true })
      });

      if (res.status === 401) {
        err.textContent = 'ACCESS DENIED — INVALID KEY';
        err.style.display = 'block';
        input.value = '';
        input.focus();
        return;
      }

      adminKey = val;
      storeKey(val);
      showAdminPanel();
    } catch (e) {
      err.textContent = 'CONNECTION ERROR — RETRY';
      err.style.display = 'block';
    }
  });
}

/* ── SHOW ADMIN PANEL ── */
async function showAdminPanel() {
  document.getElementById('auth-screen').style.display = 'none';
  document.querySelector('.admin-wrap').classList.add('visible');
  await loadAdminSnippets();
}

/* ── LOGOUT ── */
function adminLogout() {
  clearKey();
  adminKey = null;
  document.getElementById('auth-screen').style.display = 'flex';
  document.querySelector('.admin-wrap').classList.remove('visible');
  document.getElementById('pw-input').value = '';
}

/* ── LOAD SNIPPETS (admin list) ── */
async function loadAdminSnippets() {
  const list = document.getElementById('admin-list');
  if (!list) return;

  list.innerHTML = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">LOADING...</div></div>`;

  try {
    const res  = await fetch(API_URL);
    const data = await res.json();
    const snippets = data.snippets || [];

    list.innerHTML = '';

    if (!snippets.length) {
      list.innerHTML = `<div style="text-align:center;padding:2rem;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted)">NO SNIPPETS YET</div>`;
      return;
    }

    snippets.forEach(s => {
      const row = document.createElement('div');
      row.className = 'admin-snippet-row';
      row.innerHTML = `
        <div class="admin-row-inner">
          <div class="admin-row-info">
            <div class="admin-row-title">${escapeHtml(s.title)}</div>
            <div class="admin-row-date">${escapeHtml(formatDate(s.date))}</div>
          </div>
          <button class="glow-btn danger" onclick="deleteSnippet(${s.id}, this)">DELETE</button>
        </div>`;
      list.appendChild(row);
    });

  } catch (err) {
    list.innerHTML = `<div style="padding:2rem;color:var(--neon-red);font-family:var(--font-mono);font-size:0.78rem">ERROR: ${escapeHtml(err.message)}</div>`;
  }
}

/* ── ADD SNIPPET ── */
async function submitSnippet(e) {
  e.preventDefault();

  const title = document.getElementById('f-title').value.trim();
  const desc  = document.getElementById('f-desc').value.trim();
  const date  = document.getElementById('f-date').value || new Date().toISOString().split('T')[0];
  const code  = document.getElementById('f-code').value.trim();

  if (!title) { showToast('Title is required', true); return; }
  if (!code)  { showToast('Code is required', true);  return; }

  const btn = document.getElementById('submit-btn');
  const original = btn.textContent;
  btn.textContent = 'SENDING...';
  btn.disabled = true;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ADMIN_KEY_HEADER]: adminKey
      },
      body: JSON.stringify({ title, description: desc, date, code })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        clearKey();
        showToast('Session expired — please re-login', true);
        adminLogout();
      } else {
        showToast(data.error || 'Failed to add snippet', true);
      }
      return;
    }

    showToast('Snippet added successfully');
    document.getElementById('snippet-form').reset();
    document.getElementById('file-name-display').textContent = '';
    await loadAdminSnippets();

  } catch (err) {
    showToast('Network error: ' + err.message, true);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

/* ── DELETE SNIPPET ── */
async function deleteSnippet(id, btn) {
  if (!confirm('Delete this snippet? This cannot be undone.')) return;

  btn.textContent = '...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}?id=${id}`, {
      method: 'DELETE',
      headers: { [ADMIN_KEY_HEADER]: adminKey }
    });

    if (res.status === 401) {
      clearKey();
      showToast('Session expired', true);
      adminLogout();
      return;
    }

    if (!res.ok) {
      const d = await res.json();
      showToast(d.error || 'Delete failed', true);
      btn.textContent = 'DELETE';
      btn.disabled = false;
      return;
    }

    showToast('Snippet deleted');
    btn.closest('.admin-snippet-row').remove();

  } catch (err) {
    showToast('Error: ' + err.message, true);
    btn.textContent = 'DELETE';
    btn.disabled = false;
  }
}

/* ── FILE UPLOAD ── */
function initFileUpload() {
  const input   = document.getElementById('file-upload');
  const display = document.getElementById('file-name-display');
  const codeTA  = document.getElementById('f-code');
  if (!input) return;

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    display.textContent = file.name;

    const reader = new FileReader();
    reader.onload = e => { codeTA.value = e.target.result; };
    reader.readAsText(file);
  });
}

/* ── SET DEFAULT DATE ── */
function setDefaultDate() {
  const dateInput = document.getElementById('f-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Index page
  if (document.getElementById('snippets-grid')) {
    loadSnippets();
    initSearch();
  }

  // Admin page
  if (document.getElementById('auth-screen')) {
    initAdminLogin();
    setDefaultDate();
    initFileUpload();

    const form = document.getElementById('snippet-form');
    if (form) form.addEventListener('submit', submitSnippet);
  }
});
