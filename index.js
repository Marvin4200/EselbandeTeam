const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3014;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`[team] Running on port ${PORT}`);
});
