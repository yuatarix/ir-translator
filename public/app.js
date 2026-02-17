/**
 * IR Translator — 国際政治学 論文翻訳ツール
 * Main Application Logic (v3: Online Web App with API)
 */

// ============================================================
// State
// ============================================================
let allTerms = [...IR_DICTIONARY];
let serverTerms = [];
let activeCategory = null;
let termsCollapsed = false;
let currentUser = null; // { username, role, displayName }
let authToken = null;

const API_BASE = '';  // Same origin

// ============================================================
// API Helper
// ============================================================
async function api(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json();
    if (!res.ok) {
        const err = new Error(data.error || 'APIエラーが発生しました');
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Check saved token
    const savedToken = localStorage.getItem('ir_token');
    const savedUser = localStorage.getItem('ir_user');
    if (savedToken && savedUser) {
        authToken = savedToken;
        try {
            currentUser = JSON.parse(savedUser);
            showApp();
        } catch {
            clearAuth();
        }
    }

    initAuthForms();
});

// ============================================================
// Authentication
// ============================================================
function initAuthForms() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('login-form').style.display = target === 'login' ? 'block' : 'none';
            document.getElementById('register-form').style.display = target === 'register' ? 'block' : 'none';
            // Clear errors
            document.getElementById('login-error').style.display = 'none';
            document.getElementById('register-error').style.display = 'none';
            document.getElementById('register-success').style.display = 'none';
        });
    });

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('login-error');
        errorEl.style.display = 'none';

        const username = document.getElementById('login-user').value.trim();
        const password = document.getElementById('login-pass').value;

        try {
            const data = await api('POST', '/api/login', { username, password });
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('ir_token', authToken);
            localStorage.setItem('ir_user', JSON.stringify(currentUser));
            showApp();
        } catch (err) {
            if (err.data && err.data.status === 'pending') {
                showPendingScreen();
            } else {
                errorEl.textContent = err.message;
                errorEl.style.display = 'block';
            }
        }
    });

    // Register
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('register-error');
        const successEl = document.getElementById('register-success');
        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        const username = document.getElementById('reg-user').value.trim();
        const displayName = document.getElementById('reg-display').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-pass').value;
        const confirm = document.getElementById('reg-pass-confirm').value;

        if (password !== confirm) {
            errorEl.textContent = 'パスワードが一致しません';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const data = await api('POST', '/api/register', { username, password, displayName, email });
            successEl.textContent = data.message;
            successEl.style.display = 'block';
            // Clear form
            document.getElementById('reg-user').value = '';
            document.getElementById('reg-display').value = '';
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-pass').value = '';
            document.getElementById('reg-pass-confirm').value = '';
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = 'block';
        }
    });

    // Pending logout
    document.getElementById('btn-pending-logout').addEventListener('click', () => {
        clearAuth();
        document.getElementById('pending-overlay').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
    });
}

function showPendingScreen() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('pending-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function clearAuth() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('ir_token');
    localStorage.removeItem('ir_user');
}

function showApp() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('pending-overlay').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    // Update user info badge
    const badge = document.getElementById('user-badge');
    const roleLabel = currentUser.role === 'admin' ? '👑 管理者' : '👤 ユーザー';
    badge.textContent = `${roleLabel}: ${currentUser.displayName || currentUser.username}`;

    // Show/hide admin features
    document.getElementById('nav-custom').style.display = 'flex';
    document.getElementById('nav-users').style.display = currentUser.role === 'admin' ? 'flex' : 'none';

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        clearAuth();
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('login-user').value = '';
        document.getElementById('login-pass').value = '';
        document.getElementById('login-error').style.display = 'none';
    });

    // Load server-side custom terms
    loadServerTerms();

    initNavigation();
    initTranslator();
    initDictionary();
    initCustomDictionary();
    if (currentUser.role === 'admin') {
        initAdminPanel();
    }
}

// ============================================================
// Load server custom terms
// ============================================================
async function loadServerTerms() {
    try {
        const data = await api('GET', '/api/terms');
        serverTerms = data.terms || [];
        allTerms = [...IR_DICTIONARY, ...serverTerms];
        renderDictionary();
    } catch (err) {
        console.warn('Failed to load server terms:', err);
        // Token might be expired
        if (err.status === 401) {
            clearAuth();
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('auth-overlay').style.display = 'flex';
            showToast('セッションが期限切れです。再ログインしてください。', 'warning');
        }
    }
}

// ============================================================
// Navigation
// ============================================================
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`view-${viewId}`).classList.add('active');

            // Refresh data when switching to admin panel
            if (viewId === 'users' && currentUser.role === 'admin') {
                loadUsers();
            }
        });
    });
}

// ============================================================
// Translator
// ============================================================
function initTranslator() {
    const inputEl = document.getElementById('input-text');
    const btnTranslate = document.getElementById('btn-translate');
    const btnClear = document.getElementById('btn-clear');
    const btnPaste = document.getElementById('btn-paste');
    const wordCountEl = document.getElementById('word-count');

    inputEl.addEventListener('input', () => {
        const text = inputEl.value.trim();
        const count = text ? text.split(/\s+/).length : 0;
        wordCountEl.textContent = `${count} words`;
    });

    btnTranslate.addEventListener('click', () => {
        const text = inputEl.value.trim();
        if (!text) { showToast('テキストを入力してください', 'warning'); return; }
        processText(text);
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') btnTranslate.click();
    });

    btnClear.addEventListener('click', () => {
        inputEl.value = '';
        wordCountEl.textContent = '0 words';
        document.getElementById('output-area').innerHTML = `
      <div class="placeholder-message">
        <div class="placeholder-icon">📚</div>
        <p>左のテキストエリアに英語テキストを入力し、<br>「用語を検出」ボタンをクリックしてください。</p>
        <p class="placeholder-sub">専門用語がハイライト表示され、<br>ホバーで和訳・解説・<strong>参照先</strong>が表示されます。</p>
      </div>`;
        document.getElementById('terms-summary').style.display = 'none';
        document.getElementById('detected-count').textContent = '';
    });

    btnPaste.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input'));
            showToast('クリップボードから貼り付けました', 'success');
        } catch { showToast('クリップボードの読み取りに失敗しました', 'error'); }
    });

    const btnCollapse = document.getElementById('btn-collapse-terms');
    if (btnCollapse) {
        btnCollapse.addEventListener('click', () => {
            const grid = document.getElementById('terms-grid');
            const icon = document.getElementById('collapse-icon');
            termsCollapsed = !termsCollapsed;
            grid.style.display = termsCollapsed ? 'none' : 'grid';
            icon.textContent = termsCollapsed ? '▶' : '▼';
        });
    }
}

// ============================================================
// Text Processing & Highlighting
// ============================================================
function processText(text) {
    allTerms = [...IR_DICTIONARY, ...serverTerms];
    const sortedTerms = [...allTerms].sort((a, b) => b.en.length - a.en.length);

    const matches = [];
    const lowerText = text.toLowerCase();

    for (const term of sortedTerms) {
        const termLower = term.en.toLowerCase();
        let searchStart = 0;

        while (searchStart < lowerText.length) {
            const idx = lowerText.indexOf(termLower, searchStart);
            if (idx === -1) break;

            const before = idx > 0 ? lowerText[idx - 1] : ' ';
            const after = idx + termLower.length < lowerText.length ? lowerText[idx + termLower.length] : ' ';
            const isBoundaryBefore = /[\s,.;:!?()\[\]{}"'\-\/]/.test(before) || idx === 0;
            const isBoundaryAfter = /[\s,.;:!?()\[\]{}"'\-\/]/.test(after) || (idx + termLower.length) === lowerText.length;

            if (isBoundaryBefore && isBoundaryAfter) {
                const overlaps = matches.some(m =>
                    (idx >= m.start && idx < m.end) || (idx + termLower.length > m.start && idx + termLower.length <= m.end)
                );
                if (!overlaps) {
                    matches.push({
                        start: idx,
                        end: idx + termLower.length,
                        term,
                        original: text.substring(idx, idx + termLower.length),
                    });
                }
            }
            searchStart = idx + 1;
        }
    }

    matches.sort((a, b) => a.start - b.start);

    let html = '';
    let lastEnd = 0;
    for (const match of matches) {
        if (match.start > lastEnd) html += escapeHtml(text.substring(lastEnd, match.start));
        html += `<span class="term-highlight" data-category="${match.term.category}" data-en="${escapeAttr(match.term.en)}" data-ja="${escapeAttr(match.term.ja)}" data-note="${escapeAttr(match.term.note || '')}" data-reference="${escapeAttr(match.term.reference || '')}" data-cat-label="${escapeAttr(CATEGORIES[match.term.category]?.label || '')}">${escapeHtml(match.original)}</span>`;
        lastEnd = match.end;
    }
    if (lastEnd < text.length) html += escapeHtml(text.substring(lastEnd));
    html = html.replace(/\n/g, '<br>');

    document.getElementById('output-area').innerHTML = html;

    const uniqueTerms = [...new Map(matches.map(m => [m.term.en.toLowerCase(), m.term])).values()];
    document.getElementById('detected-count').textContent = `${uniqueTerms.length} 用語検出`;
    updateTermsSummary(uniqueTerms);
    attachTooltipListeners();

    if (matches.length === 0) {
        showToast('専門用語が検出されませんでした', 'warning');
    } else {
        showToast(`${uniqueTerms.length} 個の専門用語を検出しました`, 'success');
    }
}

function updateTermsSummary(terms) {
    const container = document.getElementById('terms-summary');
    const grid = document.getElementById('terms-grid');
    if (terms.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    grid.innerHTML = terms.map(t => `
    <div class="term-card" data-category="${t.category}">
      <span class="term-card-en">${escapeHtml(t.en)}</span>
      <span class="term-card-arrow">→</span>
      <span class="term-card-ja">${escapeHtml(t.ja)}</span>
      ${t.reference ? `<span class="term-card-ref" title="${escapeAttr(t.reference)}">📚</span>` : ''}
    </div>
  `).join('');
}

// ============================================================
// Tooltip
// ============================================================
function attachTooltipListeners() {
    const tooltip = document.getElementById('tooltip');
    document.querySelectorAll('.term-highlight').forEach(el => {
        el.addEventListener('mouseenter', (e) => {
            document.getElementById('tooltip-en').textContent = el.dataset.en;
            document.getElementById('tooltip-ja').textContent = el.dataset.ja;
            document.getElementById('tooltip-note').textContent = el.dataset.note;
            document.getElementById('tooltip-cat').textContent = el.dataset.catLabel;

            const refEl = document.getElementById('tooltip-ref');
            const refText = document.getElementById('tooltip-ref-text');
            if (el.dataset.reference) {
                refText.textContent = el.dataset.reference;
                refEl.style.display = 'block';
            } else {
                refEl.style.display = 'none';
            }

            tooltip.style.display = 'block';
            positionTooltip(e, tooltip);
        });
        el.addEventListener('mousemove', (e) => positionTooltip(e, tooltip));
        el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    });
}

function positionTooltip(e, tooltip) {
    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - pad) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = e.clientY - rect.height - pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

// ============================================================
// Dictionary View
// ============================================================
function initDictionary() {
    renderCategoryFilters();
    renderDictionary();

    const searchEl = document.getElementById('dict-search');
    const clearEl = document.getElementById('dict-search-clear');
    searchEl.addEventListener('input', () => {
        clearEl.style.display = searchEl.value ? 'block' : 'none';
        renderDictionary();
    });
    clearEl.addEventListener('click', () => {
        searchEl.value = '';
        clearEl.style.display = 'none';
        renderDictionary();
    });
}

function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'cat-filter active';
    allBtn.textContent = 'すべて';
    allBtn.dataset.cat = 'all';
    allBtn.addEventListener('click', () => {
        activeCategory = null;
        document.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'));
        allBtn.classList.add('active');
        renderDictionary();
    });
    container.appendChild(allBtn);

    for (const [key, cat] of Object.entries(CATEGORIES)) {
        if (key === 'custom' && currentUser?.role !== 'admin') continue;
        const btn = document.createElement('button');
        btn.className = 'cat-filter';
        btn.dataset.cat = key;
        btn.textContent = `${cat.icon} ${cat.label}`;
        btn.addEventListener('click', () => {
            activeCategory = key;
            document.querySelectorAll('.cat-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDictionary();
        });
        container.appendChild(btn);
    }
}

function renderDictionary() {
    const searchQuery = (document.getElementById('dict-search')?.value || '').toLowerCase().trim();
    allTerms = [...IR_DICTIONARY, ...serverTerms];

    let filtered = allTerms;
    if (activeCategory) filtered = filtered.filter(t => t.category === activeCategory);
    if (searchQuery) {
        filtered = filtered.filter(t =>
            t.en.toLowerCase().includes(searchQuery) ||
            t.ja.includes(searchQuery) ||
            (t.note && t.note.includes(searchQuery)) ||
            (t.reference && t.reference.toLowerCase().includes(searchQuery))
        );
    }
    filtered.sort((a, b) => a.en.localeCompare(b.en));

    const tbody = document.getElementById('dict-tbody');
    const emptyEl = document.getElementById('dict-empty');

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
    } else {
        emptyEl.style.display = 'none';
        tbody.innerHTML = filtered.map(t => {
            const cat = CATEGORIES[t.category] || CATEGORIES.custom;
            const refHtml = t.reference
                ? `<span class="ref-text">${escapeHtml(t.reference)}</span>`
                : '<span class="ref-empty">—</span>';
            return `<tr>
        <td class="td-en">${escapeHtml(t.en)}</td>
        <td class="td-ja">${escapeHtml(t.ja)}</td>
        <td class="td-cat"><span class="cat-badge">${cat.icon} ${cat.label}</span></td>
        <td class="td-note">${escapeHtml(t.note || '')}</td>
        <td class="td-ref">${refHtml}</td>
      </tr>`;
        }).join('');
    }

    document.getElementById('dict-total-count').textContent = `${filtered.length} / ${allTerms.length} 語`;
}

// ============================================================
// Custom Dictionary (Admin only) — API-based
// ============================================================
function initCustomDictionary() {
    document.getElementById('add-term-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addCustomTerm();
    });

    document.getElementById('bulk-toggle').addEventListener('click', () => {
        const body = document.getElementById('bulk-body');
        const icon = document.getElementById('bulk-toggle-icon');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        icon.classList.toggle('open', !isOpen);
    });

    document.getElementById('btn-bulk-import').addEventListener('click', bulkImport);
    document.getElementById('btn-export-custom').addEventListener('click', exportCustomTerms);
    renderCustomTerms();

    initTranslationSuggestions();
}

async function addCustomTerm() {
    const en = document.getElementById('custom-en').value.trim();
    const ja = document.getElementById('custom-ja').value.trim();
    const category = document.getElementById('custom-category').value;
    const note = document.getElementById('custom-note').value.trim();
    const reference = document.getElementById('custom-reference').value.trim();

    if (!en || !ja) { showToast('英語と日本語訳を入力してください', 'warning'); return; }

    try {
        const newTerm = await api('POST', '/api/terms', { en, ja, category, note, reference });
        serverTerms.push(newTerm);
        allTerms = [...IR_DICTIONARY, ...serverTerms];

        document.getElementById('custom-en').value = '';
        document.getElementById('custom-ja').value = '';
        document.getElementById('custom-note').value = '';
        document.getElementById('custom-reference').value = '';
        document.getElementById('custom-category').value = 'custom';
        hideSuggestions();

        renderCustomTerms();
        renderDictionary();
        showToast(`「${en}」を追加しました`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function removeCustomTerm(id, en) {
    try {
        await api('DELETE', `/api/terms/${id}`);
        serverTerms = serverTerms.filter(t => t.id !== id);
        allTerms = [...IR_DICTIONARY, ...serverTerms];
        renderCustomTerms();
        renderDictionary();
        showToast(`「${en}」を削除しました`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function bulkImport() {
    const raw = document.getElementById('bulk-input').value.trim();
    if (!raw) { showToast('インポートするデータを入力してください', 'warning'); return; }

    const lines = raw.split('\n').filter(l => l.trim());
    const terms = [];

    for (const line of lines) {
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');
        if (parts.length < 2) continue;
        terms.push({
            en: parts[0].trim(),
            ja: parts[1].trim(),
            category: (parts[2] || 'custom').trim(),
            note: (parts[3] || '').trim(),
            reference: (parts[4] || '').trim(),
        });
    }

    if (terms.length === 0) { showToast('有効なデータがありません', 'warning'); return; }

    try {
        const result = await api('POST', '/api/terms/bulk', { terms });
        await loadServerTerms();
        renderCustomTerms();
        document.getElementById('bulk-input').value = '';
        showToast(`${result.imported} 語をインポート（スキップ: ${result.skipped}）`, result.imported > 0 ? 'success' : 'warning');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function exportCustomTerms() {
    if (serverTerms.length === 0) { showToast('エクスポートする用語がありません', 'warning'); return; }
    const csv = serverTerms.map(t => `${t.en}, ${t.ja}, ${t.category}, ${t.note || ''}, ${t.reference || ''}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ir_custom_dictionary.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('辞書をエクスポートしました', 'success');
}

function renderCustomTerms() {
    const list = document.getElementById('custom-terms-list');
    document.getElementById('custom-count').textContent = `${serverTerms.length} 語`;

    if (serverTerms.length === 0) {
        list.innerHTML = `
      <div class="placeholder-message">
        <div class="placeholder-icon">📝</div>
        <p>追加された用語はありません。</p>
        <p class="placeholder-sub">左のフォームから用語を追加してください。</p>
      </div>`;
        return;
    }

    list.innerHTML = serverTerms.map(t => `
    <div class="custom-term-item">
      <div class="custom-term-info">
        <span class="custom-term-en">${escapeHtml(t.en)}</span>
        <span class="custom-term-ja">${escapeHtml(t.ja)}</span>
        ${t.reference ? `<span class="custom-term-ref">📚 ${escapeHtml(t.reference)}</span>` : ''}
      </div>
      <button class="custom-term-delete" data-id="${t.id}" data-en="${escapeAttr(t.en)}" title="削除">🗑️</button>
    </div>
  `).join('');

    list.querySelectorAll('.custom-term-delete').forEach(btn => {
        btn.addEventListener('click', () => removeCustomTerm(btn.dataset.id, btn.dataset.en));
    });
}

// ============================================================
// Translation Suggestions (API + IR Context)
// ============================================================
let suggestionTimer = null;
const SUGGESTION_DEBOUNCE_MS = 600;

const IR_CONTEXT_MAP = {
    'interest': ['国益', '利益'],
    'interests': ['国益', '利益'],
    'national interest': ['国益'],
    'state': ['国家'],
    'states': ['国家', '諸国'],
    'power': ['権力', 'パワー', '大国'],
    'powers': ['大国', '列強'],
    'regime': ['レジーム', '体制', '政権'],
    'order': ['秩序', '国際秩序'],
    'system': ['体制', '体系', '国際体系'],
    'actor': ['アクター', '行為主体'],
    'actors': ['アクター', '行為主体'],
    'agent': ['行為主体', 'エージェント'],
    'balance': ['均衡', 'バランス'],
    'security': ['安全保障', 'セキュリティ'],
    'engagement': ['関与', 'エンゲージメント'],
    'capacity': ['能力', 'キャパシティ'],
    'institution': ['制度', '機構'],
    'institutions': ['制度', '国際機構'],
    'framework': ['枠組み', 'フレームワーク'],
    'structure': ['構造', '体制'],
    'norm': ['規範', 'ノーム'],
    'norms': ['規範'],
    'identity': ['アイデンティティ', '同一性'],
    'discourse': ['言説', 'ディスコース'],
    'governance': ['ガバナンス', '統治'],
    'sphere': ['圏', '領域', '勢力圏'],
    'bloc': ['ブロック', '陣営'],
    'commitment': ['コミットメント', '関与'],
    'credibility': ['信頼性', '信用'],
    'leverage': ['レバレッジ', '影響力'],
    'deterrent': ['抑止力'],
    'threat': ['脅威'],
    'crisis': ['危機'],
    'stability': ['安定', '安定性'],
    'rivalry': ['対抗関係', 'ライバル関係'],
    'cooperation': ['協力', '国際協力'],
    'intervention': ['介入', '干渉'],
    'sovereignty': ['主権'],
    'hegemony': ['覇権'],
    'polarity': ['極性'],
    'status quo': ['現状維持', 'ステータスクオ'],
    'doctrine': ['ドクトリン', '政策方針'],
    'strategy': ['戦略'],
    'sanctions': ['制裁', '経済制裁'],
    'treaty': ['条約'],
    'resolution': ['決議'],
    'proliferation': ['拡散', '核拡散'],
    'escalation': ['エスカレーション', '段階的拡大'],
    'bandwagoning': ['バンドワゴニング'],
    'entrapment': ['巻き込まれ'],
    'signaling': ['シグナリング'],
};

function initTranslationSuggestions() {
    const enInput = document.getElementById('custom-en');
    enInput.addEventListener('input', () => {
        clearTimeout(suggestionTimer);
        const query = enInput.value.trim();
        if (query.length < 2) { hideSuggestions(); return; }
        suggestionTimer = setTimeout(() => fetchTranslationSuggestions(query), SUGGESTION_DEBOUNCE_MS);
    });
}

async function fetchTranslationSuggestions(query) {
    const container = document.getElementById('translation-suggestions');
    const listEl = document.getElementById('suggestions-list');
    const loadingEl = document.getElementById('suggestions-loading');

    container.style.display = 'block';
    loadingEl.style.display = 'inline-flex';
    listEl.innerHTML = '';

    const suggestions = [];
    const seen = new Set();
    const addSuggestion = (text, source, priority) => {
        if (!text || seen.has(text) || text === query) return;
        seen.add(text);
        suggestions.push({ text, source, priority });
    };

    const queryLower = query.toLowerCase();

    // Layer 1: Dictionary exact match
    allTerms.forEach(t => {
        if (t.en.toLowerCase() === queryLower) addSuggestion(t.ja, '📖 辞書（完全一致）', 100);
    });

    // Layer 2: IR context map
    if (IR_CONTEXT_MAP[queryLower]) {
        IR_CONTEXT_MAP[queryLower].forEach(ja => addSuggestion(ja, '🎯 IR専門訳', 90));
    }

    // Layer 3: Fuzzy dictionary match
    allTerms.forEach(t => {
        const tLower = t.en.toLowerCase();
        if (tLower !== queryLower && tLower.includes(queryLower))
            addSuggestion(t.ja, `📖 関連: ${t.en}`, 60);
    });
    allTerms.forEach(t => {
        const tLower = t.en.toLowerCase();
        if (tLower !== queryLower && queryLower.includes(tLower) && tLower.length >= 4)
            addSuggestion(t.ja, `📖 部分: ${t.en}`, 50);
    });

    // Layer 4: API with IR context
    try {
        const irQuery = `${query} (international relations)`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(irQuery)}&langpair=en|ja`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.responseData?.translatedText) {
                let main = data.responseData.translatedText;
                main = main.replace(/[（(]国際関係[）)]/g, '').replace(/[（(]international relations[）)]/gi, '').trim();
                if (main && main !== query) addSuggestion(main, '🌐 API (IR文脈)', 70);
            }
        }
        const url2 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=en|ja`;
        const res2 = await fetch(url2);
        if (res2.ok) {
            const data2 = await res2.json();
            if (data2.responseData?.translatedText) {
                addSuggestion(data2.responseData.translatedText, '🌐 API (一般)', 30);
            }
        }
    } catch (err) {
        console.warn('Translation API error:', err);
    }

    loadingEl.style.display = 'none';

    if (suggestions.length === 0) {
        listEl.innerHTML = '<span class="suggestion-empty">翻訳候補が見つかりませんでした</span>';
        return;
    }

    suggestions.sort((a, b) => b.priority - a.priority);
    const top = suggestions.slice(0, 6);

    listEl.innerHTML = top.map((s, i) => {
        const isIR = s.priority >= 70;
        const chipClass = isIR ? 'suggestion-chip suggestion-chip-ir' : 'suggestion-chip';
        return `<button type="button" class="${chipClass}" data-index="${i}" data-text="${escapeAttr(s.text)}" title="${escapeAttr(s.source)}">
            <span class="suggestion-text">${escapeHtml(s.text)}</span>
            <span class="suggestion-source">${escapeHtml(s.source)}</span>
        </button>`;
    }).join('');

    listEl.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.getElementById('custom-ja').value = chip.dataset.text;
            showToast(`「${chip.dataset.text}」を選択しました`, 'success');
        });
    });
}

function hideSuggestions() {
    const container = document.getElementById('translation-suggestions');
    if (container) container.style.display = 'none';
}

// ============================================================
// Admin Panel: User Management
// ============================================================
function initAdminPanel() {
    document.getElementById('btn-refresh-users').addEventListener('click', loadUsers);
    loadUsers();
}

async function loadUsers() {
    try {
        const users = await api('GET', '/api/admin/users');
        renderUsers(users);
    } catch (err) {
        showToast('ユーザー一覧の取得に失敗しました', 'error');
    }
}

function renderUsers(users) {
    const pendingList = document.getElementById('pending-users-list');
    const tbody = document.getElementById('users-tbody');
    const pendingBadge = document.getElementById('pending-count-badge');

    // Pending users
    const pending = users.filter(u => u.status === 'pending');
    pendingBadge.textContent = pending.length;
    pendingBadge.style.display = pending.length > 0 ? 'inline-flex' : 'none';

    if (pending.length === 0) {
        pendingList.innerHTML = '<div class="users-empty">承認待ちのユーザーはいません</div>';
    } else {
        pendingList.innerHTML = pending.map(u => `
      <div class="pending-user-card">
        <div class="pending-user-info">
          <span class="pending-user-name">${escapeHtml(u.displayName || u.username)}</span>
          <span class="pending-user-id">@${escapeHtml(u.username)}</span>
          <span class="pending-user-date">${formatDate(u.createdAt)}</span>
        </div>
        <div class="pending-user-actions">
          <button class="btn btn-approve" data-username="${escapeAttr(u.username)}" title="承認">
            ✅ 承認
          </button>
          <button class="btn btn-reject" data-username="${escapeAttr(u.username)}" title="拒否">
            ❌ 拒否
          </button>
        </div>
      </div>
    `).join('');

        pendingList.querySelectorAll('.btn-approve').forEach(btn => {
            btn.addEventListener('click', () => approveUser(btn.dataset.username));
        });
        pendingList.querySelectorAll('.btn-reject').forEach(btn => {
            btn.addEventListener('click', () => rejectUser(btn.dataset.username));
        });
    }

    // All users table
    tbody.innerHTML = users.map(u => {
        const statusBadge = getStatusBadge(u.status);
        const roleBadge = u.role === 'admin' ? '<span class="role-badge role-admin">👑 管理者</span>' : '<span class="role-badge role-user">👤 ユーザー</span>';
        const emailDisplay = u.email ? `<a href="mailto:${escapeAttr(u.email)}" style="color:var(--accent-light);font-size:0.8rem;">${escapeHtml(u.email)}</a>` : '<span style="color:var(--text-muted)">—</span>';
        const actions = u.role === 'admin'
            ? '<span class="action-na">—</span>'
            : `<div class="user-actions">
                ${u.status !== 'approved' ? `<button class="btn-sm btn-approve-sm" data-username="${escapeAttr(u.username)}">承認</button>` : ''}
                ${u.status !== 'rejected' ? `<button class="btn-sm btn-reject-sm" data-username="${escapeAttr(u.username)}">拒否</button>` : ''}
                <button class="btn-sm btn-delete-sm" data-username="${escapeAttr(u.username)}">削除</button>
              </div>`;
        return `<tr>
      <td><strong>@${escapeHtml(u.username)}</strong></td>
      <td>${escapeHtml(u.displayName || '—')}</td>
      <td>${emailDisplay}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td>${actions}</td>
    </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-approve-sm').forEach(btn => {
        btn.addEventListener('click', () => approveUser(btn.dataset.username));
    });
    tbody.querySelectorAll('.btn-reject-sm').forEach(btn => {
        btn.addEventListener('click', () => rejectUser(btn.dataset.username));
    });
    tbody.querySelectorAll('.btn-delete-sm').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.dataset.username));
    });
}

async function approveUser(username) {
    try {
        const result = await api('PUT', `/api/admin/users/${username}/approve`);
        showToast(result.message, 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function rejectUser(username) {
    try {
        const result = await api('PUT', `/api/admin/users/${username}/reject`);
        showToast(result.message, 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteUser(username) {
    if (!confirm(`「@${username}」を削除しますか？この操作は取り消せません。`)) return;
    try {
        const result = await api('DELETE', `/api/admin/users/${username}`);
        showToast(result.message, 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function getStatusBadge(status) {
    switch (status) {
        case 'approved': return '<span class="status-badge status-approved">✅ 承認済み</span>';
        case 'pending': return '<span class="status-badge status-pending">⏳ 承認待ち</span>';
        case 'rejected': return '<span class="status-badge status-rejected">❌ 拒否</span>';
        default: return '<span class="status-badge">不明</span>';
    }
}

function formatDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', warning: '⚠️', error: '❌' };
    toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
