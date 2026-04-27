// ═══════════════════════════════════════════════════════════
//  RP SERVIDOR — Node.js
//  Recebe dados do TradingView via Webhook POST /webhook
//  Distribui para todos os Dashboards via WebSocket
// ═══════════════════════════════════════════════════════════

const express = require('express');
const { WebSocketServer } = require('ws');
const cors   = require('cors');
const http   = require('http');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const marketState = {};
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  console.log(`[WS] +cliente | total: ${clients.size}`);
  if (Object.keys(marketState).length > 0) {
    ws.send(JSON.stringify({ type: 'snapshot', data: marketState }));
  }
  ws.on('close', () => { clients.delete(ws); });
  ws.on('error', ()  => { clients.delete(ws); });
});

function broadcast(msg) {
  const p = JSON.stringify(msg);
  clients.forEach(c => { if (c.readyState === 1) c.send(p); });
}

app.post('/webhook', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.ticker) return res.status(400).json({ error: 'falta ticker' });
    data.server_ts  = Date.now();
    data.latency_ms = data.ts ? data.server_ts - Number(data.ts) : null;
    marketState[data.ticker] = data;
    broadcast({ type: 'update', ticker: data.ticker, data });
    console.log(`[WEBHOOK] ${data.ticker} ${data.tf} | close=${data.close} | sinal=${data.sinal} | clientes=${clients.size}`);
    res.json({ ok: true, clients: clients.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_, res) => res.send(`
  <html><body style="background:#05080f;color:#d4af37;font-family:monospace;padding:30px;line-height:2">
  <h2>✅ RP Server Online</h2>
  <p>Clientes conectados: <b>${clients.size}</b></p>
  <p>Tickers ativos: <b>${Object.keys(marketState).join(', ') || 'nenhum ainda'}</b></p>
  <p>Uptime: <b>${Math.round(process.uptime())}s</b></p>
  <hr style="border-color:#1e2d42;margin:16px 0">
  <p style="color:#fff">Endpoints:</p>
  <p>POST <b>/webhook</b> — recebe dados do TradingView</p>
  <p>GET  <b>/status</b>  — status JSON</p>
  <p>GET  <b>/data</b>    — último dado de todos os tickers</p>
  </body></html>
`));

app.get('/status', (_, res) => res.json({
  status: 'online',
  clients: clients.size,
  tickers: Object.keys(marketState),
  uptime_s: Math.round(process.uptime()),
}));

app.get('/data', (_, res) => res.json(marketState));
app.get('/data/:ticker', (req, res) => {
  const d = marketState[req.params.ticker.toUpperCase()];
  d ? res.json(d) : res.status(404).json({ error: 'ticker não encontrado' });
});

app.get('/ping', (_, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`RP Server rodando na porta ${PORT}`));
