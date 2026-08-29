const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');


// ── Admin-Log ─────────────────────────────────────────────────────────────────
// Faengt praktisch alles ab: nicht nur Abstuerze, sondern auch die vielen
// try/catch-Stellen im Code, die einen Fehler bisher nur lokal geloggt haben.
// console.error/console.warn werden global umgeleitet - jeder Aufruf,
// egal wo im Prozess, geht jetzt zusaetzlich an admin.eselbande.com.
const ADMIN_LOG_URL = (process.env.ADMIN_LOG_URL || '').replace(/\/+$/, '');
const LOG_INGEST_TOKEN = process.env.LOG_INGEST_TOKEN || '';

// Ratenbegrenzung: waehrend eines Fehlersturms (z.B. eine haengende
// Verbindung, die minuetlich denselben Fehler wirft) soll admin-dashboard
// nicht mit hunderten Anfragen pro Minute geflutet werden. Token-Bucket:
// 30 Log-Sendungen sofort verfuegbar, danach eine neue alle 2 Sekunden.
let _logTokens = 30;
setInterval(() => { _logTokens = Math.min(30, _logTokens + 1); }, 2000);
let _logSuppressedSince = 0;

async function logAdmin(type, title, description, color, fields) {
    if (!ADMIN_LOG_URL || !LOG_INGEST_TOKEN) return;
    if (_logTokens <= 0) { _logSuppressedSince++; return; }
    _logTokens--;
    if (_logSuppressedSince > 0) {
        const n = _logSuppressedSince;
        _logSuppressedSince = 0;
        logAdmin('SYSTEM', '\u{1F507} Logs gedrosselt', `${n} weitere Meldungen in kurzer Zeit wurden nicht einzeln gesendet (Ratenbegrenzung).`, 0xF59E0B);
    }
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        await fetch(`${ADMIN_LOG_URL}/api/logs/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Log-Token': LOG_INGEST_TOKEN },
            body: JSON.stringify({ source: 'team', type, title, description, color, fields }),
            signal: controller.signal,
        }).catch(() => {});
        clearTimeout(timer);
    } catch { /* ein Log-Sendefehler darf den Dienst selbst nie beeintraechtigen */ }
}

function _fmtConsoleArgs(args) {
    return args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(' ').slice(0, 4000);
}

const _origConsoleError = console.error.bind(console);
const _origConsoleWarn = console.warn.bind(console);
console.error = (...args) => {
    _origConsoleError(...args);
    logAdmin('ERRORS', '\u{26A0}\u{FE0F} Fehler', _fmtConsoleArgs(args), 0xED4245);
};
console.warn = (...args) => {
    _origConsoleWarn(...args);
    logAdmin('WARNINGS', '\u{26A0}\u{FE0F} Warnung', _fmtConsoleArgs(args), 0xF59E0B);
};

process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});
logAdmin('SYSTEM', '\u{1F680} team gestartet', `Prozess laeuft, PID ${process.pid}.`, 0x57F287);



const app = express();
const PORT = process.env.PORT || 3014;

// ── Fahrstuhl Bot API (localhost only) ───────────────────────────────────────
const FAHRSTUHL_API = process.env.FAHRSTUHL_API_URL || 'http://localhost:3002';

// Simple in-memory cache — refreshes every 5 minutes
let teamCache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchTeamFromBot() {
    return new Promise((resolve, reject) => {
        const url = `${FAHRSTUHL_API}/guild/team`;
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 8000 }, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { reject(new Error('Invalid JSON from bot API')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Bot API timeout')); });
    });
}

async function getTeam() {
    if (teamCache.data && Date.now() - teamCache.fetchedAt < CACHE_TTL_MS) {
        return teamCache.data;
    }
    const result = await fetchTeamFromBot();
    teamCache = { data: result, fetchedAt: Date.now() };
    return result;
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/team', async (_req, res) => {
    try {
        const data = await getTeam();
        res.json(data);
    } catch (err) {
        console.error('[team] Failed to fetch from bot API:', err.message);
        res.status(503).json({ success: false, error: 'Bot API nicht erreichbar' });
    }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`[team] Running on port ${PORT}`);
});
