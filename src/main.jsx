import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const FALLBACK_MARKETS = ['R_10','R_25','R_50','R_75','R_100','1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V'];

function App() {
  const [appId, setAppId] = useState('');
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [symbol, setSymbol] = useState('R_50');
  const [count, setCount] = useState(100);
  const [ticks, setTicks] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('Standard');
  const ws = useRef(null);

  const disconnect = useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    setConnected(false);
  }, []);

  const digitFromTick = (tick) => {
    const quote = String(tick.quote);
    const pipSize = Number(tick.pip_size);
    const decimals = Number.isFinite(pipSize) && pipSize > 0
      ? Math.max(0, Math.round(-Math.log10(pipSize)))
      : ((quote.split('.')[1] || '').length);
    const fixed = Number(tick.quote).toFixed(decimals);
    const digits = fixed.replace(/\D/g, '');
    return { digit: Number(digits.slice(-1)), quote: fixed };
  };

  const connect = useCallback(() => {
    if (!appId.trim()) {
      setError('Enter your Deriv App ID first.');
      return;
    }
    setError('');
    setTicks([]);
    disconnect();

    const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId.trim())}`);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ active_symbols: 'brief', req_id: 1 }));
    };

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        setError(data.error.message || 'Deriv API error');
        setConnected(false);
        return;
      }

      if (data.msg_type === 'active_symbols' && Array.isArray(data.active_symbols)) {
        const available = data.active_symbols
          .map((item) => ({
            symbol: item.underlying_symbol || item.symbol,
            name: item.underlying_symbol_name || item.display_name || item.underlying_symbol || item.symbol
          }))
          .filter((item) => item.symbol);
        const unique = [...new Map(available.map((item) => [item.symbol, item])).values()];
        if (unique.length) {
          setMarkets(unique.map((item) => item.symbol));
          if (!unique.some((item) => item.symbol === symbol)) setSymbol(unique[0].symbol);
        }
        socket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: 2 }));
        return;
      }

      if (data.msg_type === 'tick' && data.tick?.quote != null) {
        const { digit, quote } = digitFromTick(data.tick);
        setTicks((current) => [...current, { digit, quote, time: data.tick.epoch ? data.tick.epoch * 1000 : Date.now() }].slice(-Math.max(10, count)));
      }
    };

    socket.onerror = () => {
      setError('WebSocket connection failed. Check your App ID and internet connection.');
      setConnected(false);
    };

    socket.onclose = () => setConnected(false);
  }, [appId, count, disconnect, symbol]);

  const changeSymbol = (nextSymbol) => {
    setSymbol(nextSymbol);
    setTicks([]);
    setError('');
    setTimeout(connect, 0);
  };

  useEffect(() => () => disconnect(), [disconnect]);

  const freq = useMemo(
    () => Array.from({ length: 10 }, (_, digit) => ticks.filter((item) => item.digit === digit).length),
    [ticks]
  );

  const total = ticks.length;
  const standardMax = Math.max(...freq, 0);
  const weightedScores = useMemo(() => {
    if (!ticks.length) return Array(10).fill(0);
    const scores = Array(10).fill(0);
    ticks.forEach((item, index) => {
      const recencyWeight = 1 + (index / Math.max(ticks.length - 1, 1));
      scores[item.digit] += recencyWeight;
    });
    return scores;
  }, [ticks]);

  const analysisValues = mode === 'Pro' ? weightedScores : freq;
  const maxValue = Math.max(...analysisValues, 0);
  const minValue = total ? Math.min(...analysisValues) : 0;
  const match = total ? analysisValues.indexOf(maxValue) : null;
  const diff = total ? analysisValues.indexOf(minValue) : null;
  const confidence = total ? Math.min(99, Math.round(Math.abs((maxValue / analysisValues.reduce((a, b) => a + b, 0)) - 0.1) * 1000)) : 0;

  return (
    <main>
      <header>
        <div><b>DERIV PRO ANALYSER</b><small>Live digit frequency • display only</small></div>
        <span className={connected ? 'live' : ''}>● {connected ? 'LIVE' : 'OFFLINE'}</span>
      </header>

      {!appId ? (
        <section className="card setup">
          <h1>Connect to Deriv</h1>
          <p>Enter your Deriv App ID. It is kept only in this session.</p>
          <input placeholder="Deriv App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
          <button onClick={connect}>Connect</button>
          {error && <p className="err">{error}</p>}
        </section>
      ) : (
        <>
          <section className="controls">
            <label>Market<select value={symbol} onChange={(e) => changeSymbol(e.target.value)}>{markets.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label>Ticks<select value={count} onChange={(e) => setCount(Number(e.target.value))}><option>50</option><option>100</option><option>200</option><option>500</option></select></label>
            <button onClick={connect}>{connected ? 'Reconnect' : 'Connect'}</button>
            <button className="ghost" onClick={() => setTicks([])}>Reset</button>
          </section>

          <section className="hero">
            <div><small>LAST DIGIT</small><strong>{ticks.at(-1)?.digit ?? '—'}</strong></div>
            <div><small>SAMPLE</small><strong>{total}</strong></div>
            <div><small>MODE</small><strong>{mode}</strong></div>
          </section>

          <section className="card">
            <h2>Digit Frequency</h2>
            <div className="bars">
              {freq.map((n, digit) => (
                <div className="bar" key={digit}>
                  <div className="fill" style={{ height: `${total ? Math.max(3, (n / Math.max(standardMax, 1)) * 100) : 3}%` }}></div>
                  <b>{digit}</b><small>{n}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="pred">
            <div><small>MATCHES</small><b>{total ? match : '—'}</b><span>Highest observed score</span></div>
            <div><small>DIFFERS</small><b>{total ? diff : '—'}</b><span>Lowest observed score</span></div>
            <div><small>STATISTICAL SCORE</small><b>{total ? `${confidence}%` : '—'}</b><span>Not a future guarantee</span></div>
          </section>

          <section className="tabs">
            <button className={mode === 'Standard' ? 'active' : ''} onClick={() => setMode('Standard')}>Standard</button>
            <button className={mode === 'Pro' ? 'active' : ''} onClick={() => setMode('Pro')}>Pro</button>
          </section>

          {error && <p className="err">{error}</p>}
          <footer>⚠ Digits are RNG-based. Past frequency does not predict future results. This tool is for analysis/display only and does not place trades.</footer>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
