// ═══════════════════════════════════════════════════════════
//  RP SERVIDOR — Node.js v2.1
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
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' })); // aceita texto puro também

// Último estado por ticker
const marketState = {};
// Clientes WebSocket conectados
const clients = new Set();

// ── WEBSOCKET ──
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

// ── WEBHOOK — recebe do TradingView ──
app.post('/webhook', (req, res) => {
  try {
    let data = req.body;

    // TradingView às vezes envia como string — parse manual
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) {
        console.error('[WEBHOOK] Não foi possível parsear body string:', data);
        return res.status(400).json({ error: 'JSON inválido' });
      }
    }

    if (!data || typeof data !== 'object') {
      console.error('[WEBHOOK] Body inválido:', data);
      return res.status(400).json({ error: 'body inválido' });
    }

    // Normaliza ticker — pega de qualquer campo possível
    const ticker = (data.ticker || data.symbol || data.instrument || 'UNKNOWN')
      .toString().toUpperCase().trim();

    data.ticker     = ticker;
    data.server_ts  = Date.now();
    data.latency_ms = data.ts ? data.server_ts - Number(data.ts) : null;

    // Garante que campos numéricos são números
    ['close','open','high','low','volume','press_vend','press_comp',
     'nivel_pct','vol_micro','ma_fast','ma_slow','atr',
     'zone_sup','zone_mid','zone_inf'].forEach(k => {
      if (data[k] !== undefined) data[k] = parseFloat(data[k]) || 0;
    });

    marketState[ticker] = data;
    broadcast({ type: 'update', ticker, data });

    console.log(`[WEBHOOK] ${ticker} | tf=${data.tf} | close=${data.close} | vend=${data.press_vend}% | clientes=${clients.size}`);
    res.json({ ok: true, ticker, clients: clients.size });

  } catch (e) {
    console.error('[WEBHOOK] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ROTAS ──
app.get('/', (_, res) => res.send(`
  <html><body style="background:#05080f;color:#d4af37;font-family:monospace;padding:30px;line-height:2">
  <h2>✅ RP Server Online v2.1</h2>
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
server.listen(PORT, () => console.log(`RP Server v2.1 rodando na porta ${PORT}`));
