// Recruiter App — AI Job Assistant
const API_BASE       = 'https://aijobassistant-production.up.railway.app';
const SUPABASE_URL   = 'https://fqwocsqfzzkqbdmzadhz.supabase.co';
const SUPABASE_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxd29jc3FmenprcWJkbXphZGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjE0NjUsImV4cCI6MjA5MDA5NzQ2NX0.EAZUXOhI_Ia-vSuVE1saOnumI_Vt-p4d7ulnOZ9HeC4';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────────────────────────
let sessionSearched = false;
let currentUser     = null;
let currentResults  = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const searchForm    = document.getElementById('searchForm');
const jdInput       = document.getElementById('jdInput');
const searchBtn     = document.getElementById('searchBtn');
const searchBtnText = document.getElementById('searchBtnText');
const searchSpinner = document.getElementById('searchSpinner');
const resultsSection = document.getElementById('resultsSection');
const resultsBody   = document.getElementById('resultsBody');
const resultsCount  = document.getElementById('resultsCount');
const emptyState    = document.getElementById('emptyState');
const signinBtn     = document.getElementById('signinBtn');
const signoutBtn    = document.getElementById('signoutBtn');
const userInfo      = document.getElementById('userInfo');
const userAvatar    = document.getElementById('userAvatar');
const userName      = document.getElementById('userName');
const eventsBadge   = document.getElementById('eventsBadge');
const signinModal   = document.getElementById('signinModal');
const modalClose    = document.getElementById('modalClose');
const modalSignin   = document.getElementById('modalSignin');
const modalDesc     = document.getElementById('modalDesc');

// ── Auth ──────────────────────────────────────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user || null;
  updateAuthUI();
  if (currentUser) await refreshEvents();
});

async function signIn() {
  await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  updateAuthUI();
}

function updateAuthUI() {
  if (currentUser) {
    signinBtn.classList.add('hidden');
    userInfo.classList.remove('hidden');
    userAvatar.src = currentUser.user_metadata?.avatar_url || '';
    userName.textContent = currentUser.user_metadata?.full_name?.split(' ')[0] || 'Recruiter';
  } else {
    signinBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
    eventsBadge.classList.add('hidden');
  }
}

async function refreshEvents() {
  if (!currentUser) return;
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${API_BASE}/api/v1/recruiter/events`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const rem  = data.events_remaining;
      eventsBadge.textContent = `${rem} free action${rem !== 1 ? 's' : ''} left`;
      eventsBadge.classList.remove('hidden', 'low');
      if (rem <= 3) eventsBadge.classList.add('low');
    }
  } catch (_) {}
}

// ── Search ────────────────────────────────────────────────────────────────────
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const jd = jdInput.value.trim();
  if (!jd) return;

  // Second search requires auth
  if (sessionSearched && !currentUser) {
    showModal('Sign in to run more searches and unlock candidate details.');
    return;
  }

  setSearchLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/v1/recruiter/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd, session_searched: sessionSearched })
    });

    if (res.status === 401) {
      showModal('Sign in to continue searching.');
      return;
    }

    const data = await res.json();
    currentResults = data.results || [];
    sessionSearched = true;
    renderResults(currentResults, jd);
  } catch (err) {
    alert('Search failed. Please try again.');
  } finally {
    setSearchLoading(false);
  }
});

function setSearchLoading(loading) {
  searchBtn.disabled = loading;
  searchBtnText.classList.toggle('hidden', loading);
  searchSpinner.classList.toggle('hidden', !loading);
}

// ── Quick starters ────────────────────────────────────────────────────────────
document.querySelectorAll('.qs-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    jdInput.value = btn.dataset.q;
    searchForm.dispatchEvent(new Event('submit'));
  });
});

// ── Render results ────────────────────────────────────────────────────────────
function renderResults(results, jd) {
  resultsSection.classList.remove('hidden');
  emptyState.classList.add('hidden');

  if (!results.length) {
    resultsSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  resultsCount.textContent = `${results.length} candidate${results.length !== 1 ? 's' : ''} found`;
  resultsBody.innerHTML = '';

  results.forEach(r => {
    const skills = (r.skills || '').split(',').slice(0, 5).map(s =>
      `<span class="skill-tag">${s.trim()}</span>`
    ).join('');

    const rankClass = r.rank <= 3 ? `rank-${r.rank}` : 'rank-other';
    const rankEmoji = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank;
    const scoreW    = Math.min(100, Math.max(0, r.match_score));

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="rank-badge ${rankClass}">${rankEmoji}</span></td>
      <td><div class="role-title">${r.role_title}</div><div style="font-size:11px;color:var(--dim);margin-top:2px">${r.location}</div></td>
      <td><div class="skills-wrap">${skills}</div></td>
      <td style="white-space:nowrap">${r.location}</td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar"><div class="score-fill" style="width:${scoreW}%"></div></div>
          <span class="score-num">${r.match_score}%</span>
        </div>
      </td>
      <td><p class="reasoning-text">${r.ai_reasoning}</p></td>
      <td id="contact-${r.candidate_id}">
        <div class="pii-masked">🔒 Hidden</div>
        <button class="btn-unmask" data-id="${r.candidate_id}">Reveal Contact</button>
      </td>`;
    resultsBody.appendChild(tr);
  });

  // Wire unmask buttons
  document.querySelectorAll('.btn-unmask').forEach(btn => {
    btn.addEventListener('click', () => unmask(btn.dataset.id));
  });

  // Scroll to results
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Unmask PII ────────────────────────────────────────────────────────────────
async function unmask(candidateId) {
  if (!currentUser) {
    showModal('Sign in to view candidate contact details. It\'s free — no credit card needed.');
    return;
  }

  const cell = document.getElementById(`contact-${candidateId}`);
  cell.innerHTML = '<span style="color:var(--dim);font-size:12px">Loading...</span>';

  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${API_BASE}/api/v1/recruiter/unmask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ candidate_id: candidateId })
    });

    if (res.status === 402) {
      cell.innerHTML = '<span style="color:#ea580c;font-size:12px">Free limit reached</span>';
      return;
    }
    if (!res.ok) throw new Error();

    const data = await res.json();
    cell.innerHTML = `
      <div class="pii-revealed">
        <span>👤 ${data.name || '—'}</span>
        <span>✉️ ${data.email || '—'}</span>
        <span>📞 ${data.phone || '—'}</span>
      </div>`;
    await refreshEvents();
  } catch (_) {
    cell.innerHTML = '<span style="color:red;font-size:12px">Failed to load</span>';
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal(desc) {
  modalDesc.textContent = desc;
  signinModal.classList.remove('hidden');
}

modalClose.addEventListener('click', () => signinModal.classList.add('hidden'));
signinModal.addEventListener('click', (e) => { if (e.target === signinModal) signinModal.classList.add('hidden'); });
signinBtn.addEventListener('click', signIn);
modalSignin.addEventListener('click', signIn);
signoutBtn.addEventListener('click', signOut);
