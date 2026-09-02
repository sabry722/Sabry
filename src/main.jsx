import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BarChart3,
  ChevronDown,
  Clock3,
  Gauge,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import './style.css';

const ENDPOINTS = [
  'wss://ws.binaryws.com/websockets/v3',
  'wss://ws.derivws.com/websockets/v3',
];

const FALLBACK_MARKETS = [
  '1HZ100V',
  '1HZ75V',
  '1HZ50V',
  '1HZ25V',
  '1HZ10V',
  'R_100',
  'R_75',
  'R_50',
  'R_25',
  'R_10',
];

const MARKET_NAMES = {
  '1HZ100V': 'Volatility 100 (1s) Index',
  '1HZ75V': 'Volatility 75 (1s) Index',
  '1HZ50V': 'Volatility 50 (1s) Index',
  '1HZ25V': 'Volatility 25 (1s) Index',
  '1HZ10V': 'Volatility 10 (1s) Index',
  R_100: 'Volatility 100 Index',
  R_75: 'Volatility 75 Index',
  R_50: 'Volatility 50 Index',
  R_25: 'Volatility 25 Index',
  R_10: 'Volatility 10 Index',
};

const TICK_OPTIONS = [1, 2, 3, 5, 10, 25, 50, 100, 200, 500];
const DURATION_OPTIONS = [4, 5, 10, 15, 30, 60];

function getMarketName(symbol) {
  return MARKET_NAMES[symbol] || symbol;
}

function digitFromTick(tick) {
  const quote = Number(tick?.quote);
  if (!Number.isFinite(quote)) return null;

  const pip = Number(tick?.pip_size);
  const raw = String(tick.quote);
  const decimals = Number.isFinite(pip) && pip > 0
    ? Math.max(0, Math.round(-Math.log10(pip)))
    : (raw.split('.')[1] || '').length;

  const fixed = quote.toFixed(decimals);
  const digits = fixed.replace(/\D/g, '');
  if (!digits) return null;

  return {
    digit: Number(digits.at(-1)),
    quote: fixed,
    time: Number(tick?.epoch || Date.now() / 1000) * 1000,
  };
}

function App() {
  const [draftId, setDraftId] = useState('');
  const [appId, setAppId] = useState('');
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [symbol, setSymbol] = useState('1HZ100V');
  const [count, setCount] = useState(10);
  const [duration, setDuration] = useState(4);
  const [ticks, setTicks] = useState([]);
  const [status, setStatus] = useState('offline');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('Standard');
  const [view, setView] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(4);
  const [lastUpdate, setLastUpdate] = useState(null);

  const ws = useRef(null);
  const countRef = useRef(count);
  const generation = useRef(0);
  const endpointIndex = useRef(0);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    countRef.current = count;
    setTicks((items) => items.slice(-count));
  }, [count]);

  useEffect(() => {
    setSecondsLeft(duration);
  }, [duration]);

  const closeSocket = useCallback(() => {
    generation.current += 1;
    clearTimeout(reconnectTimer.current);
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.onclose = null;
      try { ws.current.close(); } catch (_) {}
      ws.current = null;
    }
  }, []);

  const connect = useCallback((market = symbol) => {
    closeSocket();
    setError('');
    setTicks([]);
    setLastUpdate(null);
    setStatus('connecting');

    const myGeneration = ++generation.current;
    let index = endpointIndex.current % ENDPOINTS.length;

    const tryEndpoint = () => {
      if (myGeneration !== generation.current) return;
      if (index >= ENDPOINTS.length) {
        setStatus('offline');
        setError('Unable to receive Deriv market data. Check your internet connection and tap Reconnect.');
        return;
      }

      const endpoint = ENDPOINTS[index++];
      endpointIndex.current = index;
      let socket;

      try {
        socket = new WebSocket(endpoint);
      } catch (_) {
        tryEndpoint();
        return;
      }

      ws.current = socket;
      let received = false;
      let finished = false;

      const failTimer = setTimeout(() => {
        if (!received && !finished && myGeneration === generation.current) {
          finished = true;
          try { socket.close(); } catch (_) {}
          tryEndpoint();
        }
      }, 7000);

      socket.onopen = () => {
        if (myGeneration !== generation.current) return;
        setStatus('connecting');

        socket.send(JSON.stringify({
          ticks: market,
          subscribe: 1,
          req_id: 101,
        }));

        socket.send(JSON.stringify({
          ticks_history: market,
          count: Math.max(1, countRef.current),
          end: 'latest',
          style: 'ticks',
          req_id: 102,
        }));

        socket.send(JSON.stringify({
          active_symbols: 'brief',
          product_type: 'basic',
          req_id: 103,
        }));
      };

      socket.onmessage = (event) => {
        if (myGeneration !== generation.current) return;

        let data;
        try {
          data = JSON.parse(event.data);
        } catch (_) {
          return;
        }

        if (data.error) {
          const message = data.error.message || 'Deriv returned an error.';
          if (!received) {
            clearTimeout(failTimer);
            try { socket.close(); } catch (_) {}
            tryEndpoint();
          } else {
            setError(message);
          }
          return;
        }

        if (data.msg_type === 'active_symbols' && Array.isArray(data.active_symbols)) {
          const list = data.active_symbols
            .map((item) => item.underlying_symbol || item.symbol)
            .filter(Boolean);
          const unique = [...new Set(list)];
          if (unique.length) setMarkets(unique);
        }

        if (data.msg_type === 'history' && Array.isArray(data.history?.prices)) {
          const times = Array.isArray(data.history.times) ? data.history.times : [];
          const history = data.history.prices
            .map((price, i) => digitFromTick({ quote: price, epoch: times[i] }))
            .filter(Boolean);

          if (history.length) {
            received = true;
            clearTimeout(failTimer);
            setTicks(history.slice(-Math.max(1, countRef.current)));
            setLastUpdate(Date.now());
            setStatus('live');
          }
        }

        if (data.msg_type === 'tick' && data.tick?.quote != null) {
          const item = digitFromTick(data.tick);
          if (item) {
            received = true;
            clearTimeout(failTimer);
            setTicks((items) => [...items, item].slice(-Math.max(1, countRef.current)));
            setLastUpdate(Date.now());
            setStatus('live');
          }
        }
      };

      socket.onerror = () => {
        clearTimeout(failTimer);
        if (!received && myGeneration === generation.current) {
          try { socket.close(); } catch (_) {}
          tryEndpoint();
        } else if (myGeneration === generation.current) {
          setStatus('offline');
          setError('The live tick stream was interrupted. Tap Reconnect to try again.');
        }
      };

      socket.onclose = () => {
        clearTimeout(failTimer);
        if (myGeneration !== generation.current) return;
        if (!received) {
          tryEndpoint();
        } else {
          setStatus('offline');
        }
      };
    };

    tryEndpoint();
  }, [closeSocket, symbol]);

  const submit = () => {
    const clean = draftId.trim();
    setAppId(clean);
    connect(symbol);
  };

  const changeSymbol = (next) => {
    setSymbol(next);
    setTicks([]);
    setError('');
    connect(next);
  };

  const reset = () => {
    setTicks([]);
    setSecondsLeft(duration);
    setLastUpdate(null);
    setError('');
  };

  useEffect(() => () => closeSocket(), [closeSocket]);

  useEffect(() => {
    if (status !== 'live') return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((value) => value <= 1 ? duration : value - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [status, duration]);

  const frequency = useMemo(
    () => Array.from({ length: 10 }, (_, digit) => ticks.filter((item) => item.digit === digit).length),
    [ticks],
  );

  const total = ticks.length;
  const weighted = useMemo(() => {
    const scores = Array(10).fill(0);
    ticks.forEach((item, index) => {
      scores[item.digit] += 1 + index / Math.max(ticks.length - 1, 1);
    });
    return scores;
  }, [ticks]);

  const values = mode === 'Pro' ? weighted : frequency;
  const max = Math.max(...values, 0);
  const min = total ? Math.min(...values) : 0;
  const match = total ? values.indexOf(max) : null;
  const differ = total ? values.indexOf(min) : null;
  const sum = values.reduce((a, b) => a + b, 0);
  const score = total && sum
    ? Math.min(99, Math.round(Math.abs(max / sum - 0.1) * 1000))
    : 0;
  const last = ticks.at(-1);
  const statusText = status === 'live' ? 'CONNECTED' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  const age = lastUpdate ? Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000)) : null;

  if (!appId && status === 'offline') {
    return (
      <main>
        <header className="topbar">
          <div className="brand">
            <div className="brandmark"><Signal size={18} /></div>
            <div><b>Deriv Pro Analyser</b><small>Live market intelligence</small></div>
          </div>
          <span className="status-pill"><i />OFFLINE</span>
        </header>

        <section className="connect-card">
          <div className="connect-icon"><Wifi /></div>
          <h1>Connect to live data</h1>
          <p>App ID is optional for this read-only market analyser. Public Deriv tick data does not require account authentication.</p>
          <input
            placeholder="Deriv App ID (optional)"
            value={draftId}
            onChange={(event) => { setDraftId(event.target.value); setError(''); }}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
          <button className="primary" onClick={submit}>Connect to market data</button>
          {error && <p className="err">{error}</p>}
        </section>

        <div className="notice">
          <ShieldCheck size={17} />
          <span>No orders, trades, balance access, account actions, or automatic execution.</span>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <div className="brandmark"><Signal size={18} /></div>
          <div><b>Deriv Pro Analyser</b><small>Live market intelligence</small></div>
        </div>
        <div className="top-actions">
          <span className={status === 'live' ? 'status-pill online' : 'status-pill'}><i />{statusText}</span>
          <button className="icon-btn" onClick={() => setMenuOpen((value) => !value)}><Menu size={20} /></button>
        </div>
      </header>

      {menuOpen && (
        <div className="menu-card">
          <button onClick={() => { setView('dashboard'); setMenuOpen(false); }}><LayoutDashboard size={16} />Dashboard</button>
          <button onClick={() => { setView('analysis'); setMenuOpen(false); }}><BarChart3 size={16} />Digit Analysis</button>
          <button onClick={() => { setView('settings'); setMenuOpen(false); }}><Settings2 size={16} />Analysis Settings</button>
        </div>
      )}

      <section className="summary-strip">
        <div><small>System</small><b><i className="dot online-dot" /> {status === 'live' ? 'ONLINE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</b></div>
        <div><small>Market Data</small><b><i className="dot" /> {status === 'live' ? 'CONNECTED' : status === 'connecting' ? 'WAITING' : 'OFFLINE'}</b></div>
        <div className="market-chip"><Activity size={16} /><span><small>Active Market</small><b>{getMarketName(symbol)}</b></span><ChevronDown size={15} /></div>
      </section>

      {view === 'settings' ? (
        <section className="page card">
          <div className="page-head">
            <div><small>ANALYSIS SETTINGS</small><h1>Analysis Settings</h1><p>Ticks can start at 1. Analysis duration defaults to approximately 4 seconds.</p></div>
            <SlidersHorizontal size={22} />
          </div>

          <div className="settings-grid">
            <Setting title="Number of ticks" icon={<BarChart3 />}>
              <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {TICK_OPTIONS.map((number) => <option key={number} value={number}>{number} {number === 1 ? 'tick' : 'ticks'}</option>)}
              </select>
            </Setting>

            <Setting title="Analysis duration" icon={<Clock3 />}>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                {DURATION_OPTIONS.map((number) => <option key={number} value={number}>~{number} seconds</option>)}
              </select>
            </Setting>

            <Setting title="Analysis mode" icon={<Gauge />}>
              <div className="seg">
                <button className={mode === 'Standard' ? 'active' : ''} onClick={() => setMode('Standard')}>Standard</button>
                <button className={mode === 'Pro' ? 'active' : ''} onClick={() => setMode('Pro')}>Pro</button>
              </div>
            </Setting>

            <Setting title="Market" icon={<Activity />}>
              <select value={symbol} onChange={(event) => changeSymbol(event.target.value)}>
                {markets.map((market) => <option key={market} value={market}>{getMarketName(market)}</option>)}
              </select>
            </Setting>
          </div>

          <div className="settings-actions">
            <button className="primary" onClick={() => { setView('dashboard'); connect(symbol); }}><RefreshCw size={16} /> Apply & reconnect</button>
            <button className="secondary" onClick={reset}>Reset sample</button>
          </div>
        </section>
      ) : view === 'analysis' ? (
        <section className="page card">
          <div className="page-head">
            <div><small>DIGIT ANALYSIS</small><h1>Live Digit Analysis</h1><p>Current sample: {total} of {count} configured ticks • {duration}s window.</p></div>
            <BarChart3 size={22} />
          </div>

          <div className="analysis-list">
            {frequency.map((number, digit) => (
              <div className={digit === match ? 'analysis-row selected' : 'analysis-row'} key={digit}>
                <b>Digit {digit}</b><span>{number} hits</span><strong>{total ? Math.round(number / total * 100) : 0}%</strong>
              </div>
            ))}
          </div>

          <div className="analysis-actions">
            <button className="primary" onClick={() => connect(symbol)}><RefreshCw size={16} /> Reconnect</button>
            <button className="secondary" onClick={reset}>Clear sample</button>
          </div>
        </section>
      ) : (
        <>
          <section className="hero-card">
            <div className="hero-copy">
              <span className="eyebrow">LIVE DIGIT FREQUENCY</span>
              <h1>{getMarketName(symbol)}</h1>
              <p>{total} ticks received • next analysis window in {secondsLeft}s{age !== null ? ` • last update ${age}s ago` : ''}</p>
            </div>
            <div className="last-digit"><small>LAST DIGIT</small><strong>{last?.digit ?? '—'}</strong></div>
          </section>

          <section className="quick-controls">
            <button className="market-select" onClick={() => setView('settings')}><Activity size={17} /><span><small>MARKET</small><b>{getMarketName(symbol)}</b></span><ChevronDown size={16} /></button>
            <button className="tick-select" onClick={() => setView('settings')}><BarChart3 size={17} /><span><small>NUMBER OF TICKS</small><b>{count} {count === 1 ? 'tick' : 'ticks'}</b></span><ChevronDown size={16} /></button>
            <button className="settings-open" onClick={() => setView('settings')}><Settings2 size={18} />Settings</button>
          </section>

          <section className="card">
            <div className="section-title">
              <div><h2>Digit Frequency</h2><p>Distribution of last digits across the current sample</p></div>
              <span className="live-label"><i /> {status === 'live' ? 'LIVE' : 'WAITING'}</span>
            </div>

            <div className="legend"><span><i />High</span><span><i />Low</span><span><i />Normal</span></div>

            <div className="bars">
              {frequency.map((number, digit) => {
                const percentage = total ? Math.round(number / total * 100) : 0;
                const height = total ? Math.max(5, number / Math.max(...frequency, 1) * 100) : 5;
                return <div className={digit === match ? 'bar hot' : 'bar'} key={digit}>
                  <div className="fill" style={{ height: `${height}%` }} />
                  <b>{digit}</b><small>{percentage}%</small><em>{number}</em>
                </div>;
              })}
            </div>
          </section>

          <section className="pred-grid">
            <div className="pred-card match"><small>MATCHES</small><strong>{total ? match : '—'}</strong><span>Highest observed score</span></div>
            <div className="pred-card differ"><small>DIFFERS</small><strong>{total ? differ : '—'}</strong><span>Lowest observed score</span></div>
            <div className="pred-card score"><small>STATISTICAL SCORE</small><strong>{total ? `${score}%` : '—'}</strong><span>Not a future guarantee</span></div>
          </section>

          <section className="mode-tabs">
            <button className={mode === 'Standard' ? 'active' : ''} onClick={() => setMode('Standard')}>Standard</button>
            <button className={mode === 'Pro' ? 'active' : ''} onClick={() => setMode('Pro')}>Pro Analysis</button>
          </section>

          <section className="analysis-note">
            <div><Gauge size={18} /><div><b>{mode} mode</b><span>{mode === 'Pro' ? 'Recent ticks receive more influence.' : 'Balanced frequency count across the current sample.'}</span></div></div>
            <button onClick={() => setView('analysis')}>Open analysis</button>
          </section>
        </>
      )}

      {error && view === 'dashboard' && <p className="err">{error}</p>}

      <footer><ShieldCheck size={14} /> Digits are RNG-based. Past frequency does not predict future results. Display-only analysis; no trades are placed.</footer>

      <nav className="bottom-nav">
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><LayoutDashboard size={18} /><span>Dashboard</span></button>
        <button className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}><BarChart3 size={18} /><span>Analysis</span></button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings2 size={18} /><span>Settings</span></button>
      </nav>
    </main>
  );
}

function Setting({ title, icon, children }) {
  return <label className="setting"><span className="setting-title"><span className="setting-icon">{icon}</span>{title}</span>{children}</label>;
}

createRoot(document.getElementById('root')).render(<App />);
