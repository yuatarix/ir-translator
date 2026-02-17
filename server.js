/**
 * IR Translator — Server
 * Node.js + Express + JWT Authentication
 * v3: User registration + admin approval system
 */

require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ============================================================
// Email Transporter (SMTP)
// ============================================================
let mailTransporter = null;
if (process.env.SMTP_HOST) {
    const smtpConfig = {
        host: process.env.SMTP_HOST || 'smtp.googlemail.com', // Try googlemail
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        // Render/Gmail specific settings
        family: 4, // Force IPv4 to avoid IPv6 timeout issues
        logger: true, // Enable logging
        debug: true, // Show debug output
        connectionTimeout: 30000, // 30s connection timeout
        socketTimeout: 30000, // 30s socket timeout
    };

    mailTransporter = nodemailer.createTransport(smtpConfig);

    console.log('  📧 Email notifications enabled');
    console.log(`  🔧 SMTP Config: Host=${smtpConfig.host}, Port=${smtpConfig.port}, Secure=${smtpConfig.secure}, User=${smtpConfig.auth.user}`);
} else {
    console.log('  📧 Email notifications disabled (no SMTP_HOST in .env)');
}

async function sendApprovalEmail(user) {
    if (!mailTransporter || !user.email) return;
    try {
        const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: '【IR Translator】アカウントが承認されました',
            html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #6366f1;">🌐 IR Translator</h2>
                    <p>${user.displayName || user.username} 様</p>
                    <p>アカウントの登録申請が<strong>承認</strong>されました。<br>
                    以下のリンクからログインしてご利用いただけます。</p>
                    <p style="margin: 24px 0;"><a href="${appUrl}" style="display: inline-block; padding: 12px 28px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">ログインする</a></p>
                    <p style="color: #888; font-size: 0.85em;">ユーザー名: ${user.username}</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #aaa; font-size: 0.75em;">IR Translator — 国際政治学 論文翻訳ツール</p>
                </div>
            `,
        });
        console.log(`  📧 Approval email sent to ${user.email}`);
    } catch (err) {
        console.error('  ❌ Failed to send approval email:', err.message);
    }
}

async function sendRejectionEmail(user) {
    if (!mailTransporter || !user.email) return;
    try {
        await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: '【IR Translator】アカウント登録について',
            html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #6366f1;">🌐 IR Translator</h2>
                    <p>${user.displayName || user.username} 様</p>
                    <p>アカウントの登録申請について、今回は承認を見送らせていただきました。</p>
                    <p>ご不明な点がございましたら管理者にお問い合わせください。</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #aaa; font-size: 0.75em;">IR Translator — 国際政治学 論文翻訳ツール</p>
                </div>
            `,
        });
        console.log(`  📧 Rejection email sent to ${user.email}`);
    } catch (err) {
        console.error('  ❌ Failed to send rejection email:', err.message);
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ir_translator_secret_key_change_in_production';

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Data paths
const USERS_PATH = path.join(__dirname, 'data', 'users.json');
const TERMS_PATH = path.join(__dirname, 'data', 'terms.json');

// ============================================================
// Helpers
// ============================================================
function readJSON(filepath) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
        return filepath.includes('users') ? [] : { terms: [] };
    }
}

function writeJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// Auto-Setup: Create admin user on first run
// ============================================================
async function ensureAdminExists() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, '[]');
    if (!fs.existsSync(TERMS_PATH)) fs.writeFileSync(TERMS_PATH, '{"terms":[]}');

    const users = readJSON(USERS_PATH);
    const hasAdmin = users.some(u => u.role === 'admin');
    if (!hasAdmin) {
        const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
        const hash = await bcrypt.hash(adminPass, 10);
        users.push({
            username: 'admin',
            passwordHash: hash,
            role: 'admin',
            status: 'approved',
            displayName: '管理者',
            createdAt: new Date().toISOString(),
        });
        writeJSON(USERS_PATH, users);
        console.log('  ✅ Admin user created (username: admin)');
    }
}

// ============================================================
// Auth Middleware
// ============================================================
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '認証が必要です' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'トークンが無効または期限切れです' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: '管理者権限が必要です' });
    }
    next();
}

// ============================================================
// Auth Routes
// ============================================================

// POST /api/register — New user registration
app.post('/api/register', async (req, res) => {
    const { username, password, displayName, email } = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({ error: 'ユーザー名、メールアドレス、パスワードを入力してください' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'ユーザー名は3〜20文字で入力してください' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'パスワードは6文字以上で入力してください' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'ユーザー名は英数字とアンダースコアのみ使用可能です' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
    }

    const users = readJSON(USERS_PATH);
    const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) {
        return res.status(409).json({ error: 'このユーザー名は既に使用されています' });
    }
    const emailExists = users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (emailExists) {
        return res.status(409).json({ error: 'このメールアドレスは既に使用されています' });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUser = {
        username: username.trim(),
        passwordHash: hash,
        email: email.trim().toLowerCase(),
        role: 'user',
        status: 'pending',
        displayName: (displayName || username).trim(),
        createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeJSON(USERS_PATH, users);

    res.status(201).json({
        message: 'アカウントを作成しました。承認後、メールでお知らせします。',
        user: {
            username: newUser.username,
            displayName: newUser.displayName,
            status: newUser.status,
        }
    });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
    }

    const users = readJSON(USERS_PATH);
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
    }

    // Check approval status
    if (user.status === 'pending') {
        return res.status(403).json({
            error: 'アカウントは承認待ちです。管理者の承認をお待ちください。',
            status: 'pending',
        });
    }
    if (user.status === 'rejected') {
        return res.status(403).json({
            error: 'アカウントの登録が拒否されました。管理者にお問い合わせください。',
            status: 'rejected',
        });
    }

    const token = jwt.sign(
        { username: user.username, role: user.role, displayName: user.displayName },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.json({
        token,
        user: {
            username: user.username,
            role: user.role,
            displayName: user.displayName,
            status: user.status,
        }
    });
});

// GET /api/me — get current user info
app.get('/api/me', authenticate, (req, res) => {
    res.json({ user: req.user });
});

// ============================================================
// Admin: User Management Routes
// ============================================================

// GET /api/admin/users — list all users
app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
    const users = readJSON(USERS_PATH);
    // Return users without password hashes
    const safe = users.map(u => ({
        username: u.username,
        email: u.email || '',
        role: u.role,
        status: u.status,
        displayName: u.displayName,
        createdAt: u.createdAt,
    }));
    res.json(safe);
});

// PUT /api/admin/users/:username/approve
app.put('/api/admin/users/:username/approve', authenticate, requireAdmin, async (req, res) => {
    const users = readJSON(USERS_PATH);
    const user = users.find(u => u.username === req.params.username);

    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (user.role === 'admin') return res.status(400).json({ error: '管理者のステータスは変更できません' });

    user.status = 'approved';
    user.approvedAt = new Date().toISOString();
    user.approvedBy = req.user.username;
    writeJSON(USERS_PATH, users);

    // Send approval email notification
    await sendApprovalEmail(user);

    res.json({ message: `${user.displayName}を承認しました`, username: user.username, status: 'approved' });
});

// PUT /api/admin/users/:username/reject
app.put('/api/admin/users/:username/reject', authenticate, requireAdmin, async (req, res) => {
    const users = readJSON(USERS_PATH);
    const user = users.find(u => u.username === req.params.username);

    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (user.role === 'admin') return res.status(400).json({ error: '管理者のステータスは変更できません' });

    user.status = 'rejected';
    user.rejectedAt = new Date().toISOString();
    user.rejectedBy = req.user.username;
    writeJSON(USERS_PATH, users);

    // Send rejection email notification
    await sendRejectionEmail(user);

    res.json({ message: `${user.displayName}を拒否しました`, username: user.username, status: 'rejected' });
});

// DELETE /api/admin/users/:username
app.delete('/api/admin/users/:username', authenticate, requireAdmin, (req, res) => {
    const users = readJSON(USERS_PATH);
    const idx = users.findIndex(u => u.username === req.params.username);

    if (idx === -1) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (users[idx].role === 'admin') return res.status(400).json({ error: '管理者は削除できません' });

    const removed = users.splice(idx, 1)[0];
    writeJSON(USERS_PATH, users);

    res.json({ message: `${removed.displayName}を削除しました` });
});

// ============================================================
// Terms Routes
// ============================================================

// GET /api/terms — get all custom terms
app.get('/api/terms', authenticate, (req, res) => {
    const data = readJSON(TERMS_PATH);
    res.json(data);
});

// POST /api/terms — add a new term (all authenticated users)
app.post('/api/terms', authenticate, (req, res) => {
    const { en, ja, category, note, reference } = req.body;

    if (!en || !ja) {
        return res.status(400).json({ error: '英語と日本語訳は必須です' });
    }

    const data = readJSON(TERMS_PATH);
    const exists = data.terms.some(t => t.en.toLowerCase() === en.toLowerCase());
    if (exists) {
        return res.status(409).json({ error: 'この用語は既に登録されています' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const newTerm = {
        id,
        en: en.trim(),
        ja: ja.trim(),
        category: category || 'custom',
        note: note || '',
        reference: reference || '',
        addedBy: req.user.username,
        addedAt: new Date().toISOString(),
    };

    data.terms.push(newTerm);
    writeJSON(TERMS_PATH, data);

    res.status(201).json(newTerm);
});

// POST /api/terms/bulk — bulk import (admin only)
app.post('/api/terms/bulk', authenticate, requireAdmin, (req, res) => {
    const { terms } = req.body;
    if (!Array.isArray(terms) || terms.length === 0) {
        return res.status(400).json({ error: 'インポートする用語の配列が必要です' });
    }

    const data = readJSON(TERMS_PATH);
    let imported = 0, skipped = 0;

    for (const term of terms) {
        if (!term.en || !term.ja) { skipped++; continue; }
        const exists = data.terms.some(t => t.en.toLowerCase() === term.en.toLowerCase());
        if (exists) { skipped++; continue; }

        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        data.terms.push({
            id,
            en: term.en.trim(),
            ja: term.ja.trim(),
            category: term.category || 'custom',
            note: term.note || '',
            reference: term.reference || '',
            addedBy: req.user.username,
            addedAt: new Date().toISOString(),
        });
        imported++;
    }

    writeJSON(TERMS_PATH, data);
    res.json({ imported, skipped, total: data.terms.length });
});

// DELETE /api/terms/:id — delete a term (admin only)
app.delete('/api/terms/:id', authenticate, requireAdmin, (req, res) => {
    const data = readJSON(TERMS_PATH);
    const idx = data.terms.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '用語が見つかりません' });

    const removed = data.terms.splice(idx, 1)[0];
    writeJSON(TERMS_PATH, data);
    res.json({ removed });
});

// PUT /api/terms/:id — update a term (admin only)
app.put('/api/terms/:id', authenticate, requireAdmin, (req, res) => {
    const data = readJSON(TERMS_PATH);
    const idx = data.terms.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '用語が見つかりません' });

    const { en, ja, category, note, reference } = req.body;
    if (en) data.terms[idx].en = en.trim();
    if (ja) data.terms[idx].ja = ja.trim();
    if (category) data.terms[idx].category = category;
    if (note !== undefined) data.terms[idx].note = note;
    if (reference !== undefined) data.terms[idx].reference = reference;
    data.terms[idx].updatedBy = req.user.username;
    data.terms[idx].updatedAt = new Date().toISOString();

    writeJSON(TERMS_PATH, data);
    res.json(data.terms[idx]);
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// Start
// ============================================================
console.log('🔄 Server process starting...');
console.log(`  🕒 Time: ${new Date().toISOString()}`);
console.log(`  🔧 PORT: ${PORT}`);
console.log(`  🔧 Node Version: ${process.version}`);

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
    process.exit(1);
});

ensureAdminExists()
    .then(() => {
        console.log('✅ Admin check complete. Starting Express server...');
        // Explicitly bind to 0.0.0.0 for Render
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n  🌐 IR Translator server running at http://0.0.0.0:${PORT}`);
            console.log(`  📁 Data directory: ${path.join(__dirname, 'data')}`);
            console.log(`  🔑 Default admin: admin / ${process.env.ADMIN_PASSWORD || 'admin123'}\n`);
        });
    })
    .catch(err => {
        console.error('❌ FATAL ERROR during server startup:', err);
        process.exit(1);
    });
