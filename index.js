const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

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
