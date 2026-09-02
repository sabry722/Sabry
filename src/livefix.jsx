import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const WS_ENDPOINTS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.binaryws.com/websockets/v3',
];

const MARKETS = [
  ['1HZ100V','Volatility 100 (1s) Index'], ['1HZ75V','Volatility 75 (1s) Index'],
  ['1HZ50V','Volatility 50 (1s) Index'], ['1HZ25V','Volatility 25 (1s) Index'],
  ['1HZ10V','Volatility 10 (1s) Index'], ['R_100','Volatility 100 Index'],
  ['R_75','Volatility 75 Index'], ['R_50','Volatility 50 Index'],
  ['R_25','Volatility 25 Index'], ['R_10','Volatility 10 Index'],
  ['frxEURUSD','EUR/USD'], ['frxGBPUSD','GBP/USD'], ['frxUSDJPY','USD/JPY'],
  ['frxAUDUSD','AUD/USD'], ['frxUSDCAD','USD/CAD'], ['frxUSDCHF','USD/CHF'],
  ['frxEURGBP','EUR/GBP'], ['frxNZDUSD','NZD/USD'], ['cryBTCUSD','BTC/USD'],
  ['cryETHUSD','ETH/USD'], ['XAUUSD','Gold/USD'],
];
const MARKET_NAMES = Object.fromEntries(MARKETS);
const TICK_COUNTS = [1,2,3,5,10,25,50,100,200,500];
const DURATIONS = [4,5,10,15,30,60];

function getDigit(quote, pipSize) {
  const n = Number(quote);
  if (!Number.isFinite(n)) return null;
  let decimals = Number.isFinite(Number(pipSize)) && Number(pipSize) > 0
    ? Math.max(0, Math.round(-Math.log10(Number(pipSize))))
    : ((String(quote).split('.')[1] || '').length);
  if (decimals > 10) decimals = 10;
  const text = n.toFixed(decimals);
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits[digits.length - 1]);
}

function normalizeTick(tick) {
  if (!tick || tick.quote == null) return null;
  const digit = getDigit(tick.quote, tick.pip_size);
  if (digit == null) return null;
  return {
    quote: Number(tick.quote),
    digit,
    epoch: Number(tick.epoch) || Date.now() / 1000,
  };
}

function App() {
  const [symbol, setSymbol] = useState('1HZ100V');
  const [ticks, setTicks] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [endpointLabel, setEndpointLabel] = useState('Connecting to Deriv public market data…');
  const [count, setCount] = useState(10);
  const [duration, setDuration] = useState(4);
  const [mode, setMode] = useState('Standard');
  const [contract, setContract] = useState('MATCHES');
  const [view, setView] = useState('dashboard');
  const [result, setResult] = useState(null);
  const [prediction, setPrediction] = useState('');
  const [proActive, setProActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);
  const attemptRef = useRef(0);
  const generationRef = useRef(0);
  const countRef = useRef(count);
  const symbolRef = useRef(symbol);

  useEffect(() => { countRef.current = count; setTicks(v => v.slice(-count)); }, [count]);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  const connect = useCallback((requested) => {
    const market = requested || symbolRef.current;
    const generation = ++generationRef.current;
    const attempt = attemptRef.current++;
    const endpointIndex = attempt % WS_ENDPOINTS.length;
    const endpoint = WS_ENDPOINTS[endpointIndex];
    setStatus('connecting');
    setError('');
    setEndpointLabel(endpointIndex === 0 ? 'Deriv Public WebSocket (current)' : 'Deriv Public WebSocket (legacy fallback)');
    setTicks([]);
    setResult(null);
    setPrediction('');

    if (socketRef.current) {
      try { socketRef.current.close(); } catch (_) {}
      socketRef.current = null;
    }

    let socket;
    try {
      socket = new WebSocket(endpoint);
    } catch (_) {
      setStatus('offline');
      setError('This browser could not create a WebSocket connection.');
      return;
    }
    socketRef.current = socket;
    let receivedData = false;
    let opened = false;
    const timeout = setTimeout(() => {
      if (generation !== generationRef.current || receivedData) return;
      try { socket.close(); } catch (_) {}
      if (endpointIndex < WS_ENDPOINTS.length - 1) {
        setTimeout(() => connect(market), 250);
      } else {
        setStatus('offline');
        setError('Deriv connection opened but no market data arrived. Tap Reconnect.');
      }
    }, 9000);

    socket.onopen = () => {
      opened = true;
      if (generation !== generationRef.current) return;
      // Both public endpoints support ticks. The current endpoint no longer accepts
      // the legacy product_type filter, so only send it to the legacy endpoint.
      socket.send(JSON.stringify({ ticks: market, subscribe: 1, req_id: 201 }));
      socket.send(JSON.stringify({ ticks_history: market, count: Math.max(1, Math.min(500, countRef.current)), end: 'latest', style: 'ticks', req_id: 202 }));
      socket.send(JSON.stringify(endpointIndex === 1
        ? { active_symbols: 'brief', product_type: 'basic', req_id: 203 }
        : { active_symbols: 'brief', req_id: 203 }));
      socket.send(JSON.stringify({ ping: 1, req_id: 204 }));
    };

    socket.onmessage = (event) => {
      if (generation !== generationRef.current) return;
      let data;
      try { data = JSON.parse(event.data); } catch (_) { return; }

      if (data.error) {
        const message = data.error.message || data.error.code || 'Deriv returned an API error.';
        setError(message);
        // A validation error from one endpoint should trigger the other endpoint.
        if (!receivedData && endpointIndex < WS_ENDPOINTS.length - 1) {
          clearTimeout(timeout);
          try { socket.close(); } catch (_) {}
          setTimeout(() => connect(market), 250);
        }
        return;
      }

      if (data.msg_type === 'history' && Array.isArray(data.history?.prices)) {
        const times = Array.isArray(data.history.times) ? data.history.times : [];
        const history = data.history.prices.map((price, i) => normalizeTick({ quote: price, epoch: times[i] })).filter(Boolean);
        if (history.length) {
          receivedData = true;
          clearTimeout(timeout);
          setTicks(history.slice(-countRef.current));
          setStatus('live');
          setError('');
        }
      }

      if (data.msg_type === 'tick' && data.tick) {
        const item = normalizeTick(data.tick);
        if (item) {
          receivedData = true;
          clearTimeout(timeout);
          setTicks(previous => [...previous, item].slice(-countRef.current));
          setStatus('live');
          setError('');
        }
      }
    };

    socket.onerror = () => {
      clearTimeout(timeout);
      if (generation !== generationRef.current) return;
      if (!receivedData) {
        setError('WebSocket network error. Trying the alternate Deriv public endpoint…');
        try { socket.close(); } catch (_) {}
      }
    };

    socket.onclose = () => {
      clearTimeout(timeout);
      if (generation !== generationRef.current) return;
      if (!receivedData && endpointIndex < WS_ENDPOINTS.length - 1) {
        setTimeout(() => connect(market), 250);
      } else if (!receivedData) {
        setStatus('offline');
        if (!opened) setError('Could not open the Deriv public market-data connection.');
      } else {
        setStatus('offline');
      }
    };
  }, []);

  useEffect(() => {
    connect('1HZ100V');
    return () => {
      generationRef.current++;
      if (socketRef.current) { try { socketRef.current.close(); } catch (_) {} }
    };
  }, [connect]);

  const frequency = useMemo(() => {
    const f = Array(10).fill(0);
    ticks.forEach(t => { if (Number.isInteger(t.digit)) f[t.digit]++; });
    return f;
  }, [ticks]);

  const analyze = () => {
    if (!ticks.length) {
      setError('No live ticks received. The analyzer will not invent a digit. Wait for LIVE status.');
      return;
    }
    if (mode === 'Pro' && !proActive) {
      setError('Activate Pro Analysis before running the Pro analyzer.');
      return;
    }
    setBusy(true);
    const now = Date.now() / 1000;
    let sample = ticks.filter(t => now - t.epoch <= duration).slice(-count);
    if (!sample.length) sample = ticks.slice(-count);
    const raw = Array(10).fill(0);
    const weighted = Array(10).fill(0);
    sample.forEach((t, i) => {
      raw[t.digit] += 1;
      weighted[t.digit] += 1 + (i / Math.max(1, sample.length - 1)) * 1.5;
    });
    const score = mode === 'Pro' ? weighted : raw;
    const ranking = [...Array(10).keys()].sort((a,b) => score[b] - score[a] || raw[b] - raw[a] || a-b);
    const lowRanking = [...Array(10).keys()].sort((a,b) => score[a] - score[b] || a-b);
    const matches = ranking[0];
    const differs = lowRanking[0];
    const output = contract === 'MATCHES' ? matches : differs;
    const total = sample.length;
    const share = total ? raw[matches] / total : 0;
    const confidence = Math.round(Math.min(99, 50 + Math.abs(share - 0.1) * 500));
    const item = { matches, differs, confidence, total, duration, frequency: raw, generatedAt: Date.now() };
    setResult(item);
    setPrediction(String(output));
    setBusy(false);
  };

  const changeMarket = (next) => {
    setSymbol(next);
    attemptRef.current = 0;
    connect(next);
  };

  const reset = () => {
    setResult(null);
    setPrediction('');
    setTicks([]);
    setError('');
  };

  const statusText = status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  const last = ticks[ticks.length - 1];
  const name = MARKET_NAMES[symbol] || symbol;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div><div style={styles.logo}>◉ Deriv Pro Analyser</div><div style={styles.sub}>Live digit market intelligence</div></div>
        <div style={{...styles.status, ...(status === 'live' ? styles.live : {})}}><span style={styles.statusDot}/>{statusText}</div>
      </header>

      <div style={styles.marketBar}>
        <div><span style={styles.label}>ACTIVE MARKET</span><strong>{name}</strong></div>
        <select value={symbol} onChange={e => changeMarket(e.target.value)} style={styles.selectSmall}>
          {Object.entries(MARKET_NAMES).map(([s,n]) => <option key={s} value={s}>{n}</option>)}
        </select>
      </div>

      <nav style={styles.nav}>
        <button onClick={() => setView('dashboard')} style={view==='dashboard'?styles.navActive:styles.navBtn}>Dashboard</button>
        <button onClick={() => setView('analysis')} style={view==='analysis'?styles.navActive:styles.navBtn}>Digit Analysis</button>
        <button onClick={() => setView('settings')} style={view==='settings'?styles.navActive:styles.navBtn}>Settings</button>
      </nav>

      {error && <div style={styles.error}><b>Connection / Analysis:</b> {error}</div>}

      {view === 'settings' && (
        <section style={styles.card}>
          <h2>Analysis Settings</h2>
          <p style={styles.muted}>Live controls are applied immediately to the analyzer.</p>
          <div style={styles.grid}>
            <label style={styles.field}>Number of ticks<select value={count} onChange={e=>setCount(Number(e.target.value))} style={styles.select}>{TICK_COUNTS.map(n=><option key={n}>{n}</option>)}</select></label>
            <label style={styles.field}>Analysis duration<select value={duration} onChange={e=>setDuration(Number(e.target.value))} style={styles.select}>{DURATIONS.map(n=><option key={n} value={n}>~{n} seconds</option>)}</select></label>
          </div>
          <div style={styles.field}>Analysis mode<div style={styles.segment}><button onClick={()=>setMode('Standard')} style={mode==='Standard'?styles.segActive:styles.seg}>Standard</button><button onClick={()=>setMode('Pro')} style={mode==='Pro'?styles.segActive:styles.seg}>Pro</button></div></div>
          {mode==='Pro' && <div style={styles.proBox}><strong>PRO ANALYSIS</strong><p>Uses recency-weighted live digits from the selected market and duration.</p><button onClick={()=>setProActive(v=>!v)} style={proActive?styles.danger:styles.primary}>{proActive?'Deactivate Pro':'Activate Pro Analysis'}</button></div>}
          <button onClick={reset} style={styles.secondary}>Reset analysis</button>
        </section>
      )}

      {view === 'dashboard' && (
        <>
          <section style={styles.hero}>
            <div><span style={styles.eyebrow}>MARKET DATA CONNECTION</span><h1>{statusText === 'LIVE' ? 'Live ticks are running' : statusText}</h1><p>{endpointLabel}</p></div>
            <button onClick={()=>{attemptRef.current=0;connect(symbol)}} style={styles.primary}>↻ Reconnect</button>
          </section>
          <section style={styles.stats}>
            <div style={styles.stat}><span>Ticks received</span><b>{ticks.length}</b></div>
            <div style={styles.stat}><span>Last digit</span><b>{last ? last.digit : '—'}</b></div>
            <div style={styles.stat}><span>Last quote</span><b>{last ? last.quote : '—'}</b></div>
            <div style={styles.stat}><span>Stream</span><b>{statusText}</b></div>
          </section>
          <section style={styles.card}>
            <div style={styles.row}><div><h2>Live Digit Frequency</h2><p style={styles.muted}>{ticks.length} ticks buffered for {name}</p></div><button onClick={()=>setView('analysis')} style={styles.secondary}>Open analyzer</button></div>
            <div style={styles.bars}>{frequency.map((n,d)=><div key={d} style={styles.barWrap}><span>{n}</span><div style={styles.barTrack}><div style={{...styles.bar,height:`${Math.max(4, n/(Math.max(...frequency,1))*100)}%`}}/></div><b>{d}</b></div>)}</div>
          </section>
        </>
      )}

      {view === 'analysis' && (
        <section style={styles.card}>
          <div style={styles.row}><div><span style={styles.eyebrow}>LIVE DIGIT ANALYSIS</span><h2>Prediction Engine</h2><p style={styles.muted}>{ticks.length} ticks • {duration}s window • {mode}</p></div><span style={{...styles.status, ...(status==='live'?styles.live:{})}}>{statusText}</span></div>
          <div style={styles.analysisGrid}>{frequency.map((n,d)=><div key={d} style={styles.digitCard}><b>{d}</b><span>{n} hits</span><small>{ticks.length?Math.round(n/ticks.length*100):0}%</small></div>)}</div>
          <div style={styles.proBox}>
            <div style={styles.row}><strong>Prediction input</strong><div style={styles.segment}><button onClick={()=>{setContract('MATCHES'); if(result)setPrediction(String(result.matches));}} style={contract==='MATCHES'?styles.segActive:styles.seg}>MATCHES</button><button onClick={()=>{setContract('DIFFERS'); if(result)setPrediction(String(result.differs));}} style={contract==='DIFFERS'?styles.segActive:styles.seg}>DIFFERS</button></div></div>
            <p style={styles.muted}>The output is calculated from the current live sample when you press Analyze.</p>
            <div style={styles.prediction}>{prediction || '—'}</div>
            <button disabled={busy || status!=='live' || !ticks.length} onClick={analyze} style={{...styles.primary, opacity:(busy||status!=='live'||!ticks.length)?0.5:1}}>{busy?'Analyzing…':'Analyze current live data'}</button>
            {result && <div style={styles.result}><b>MATCHES: {result.matches}</b><b>DIFFERS: {result.differs}</b><b>Score: {result.confidence}%</b><span>{result.total} ticks used in {result.duration}s window</span></div>}
            <p style={styles.warning}>Statistical analysis only. Digit outcomes are random and past frequency cannot guarantee the next digit.</p>
          </div>
        </section>
      )}

      <footer>Public market-data connection • No trading orders are sent from this analyzer.</footer>
    </div>
  );
}

const styles = {
  app:{minHeight:'100vh',background:'#f4f8f8',color:'#122329',fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',paddingBottom:30},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px',background:'#fff',borderBottom:'1px solid #dce7e8',position:'sticky',top:0,zIndex:3},
  logo:{fontWeight:800,fontSize:18},sub:{fontSize:12,color:'#718286',marginTop:3},status:{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 10px',borderRadius:999,background:'#edf1f2',fontSize:12,fontWeight:800},live:{background:'#dff7ed',color:'#126b4d'},statusDot:{width:7,height:7,borderRadius:'50%',background:'#88979a'},
  marketBar:{margin:'14px 12px 0',padding:14,background:'#fff',border:'1px solid #dce7e8',borderRadius:14,display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'},label:{display:'block',fontSize:10,color:'#7b8b8f',fontWeight:800,letterSpacing:'.08em',marginBottom:4},selectSmall:{maxWidth:'52%',padding:'10px',borderRadius:10,border:'1px solid #cbd9db',background:'#fff'},
  nav:{display:'flex',gap:8,padding:'12px',overflowX:'auto'},navBtn:{border:0,background:'#e8eff0',padding:'10px 13px',borderRadius:10,fontWeight:700,whiteSpace:'nowrap'},navActive:{border:0,background:'#0c8b7c',color:'#fff',padding:'10px 13px',borderRadius:10,fontWeight:800,whiteSpace:'nowrap'},
  error:{margin:'0 12px 12px',padding:12,borderRadius:12,background:'#fff0f0',border:'1px solid #f0c7c7',color:'#8b2525',fontSize:13},
  hero:{margin:'0 12px 12px',padding:18,borderRadius:16,background:'#e5f7f3',border:'1px solid #c8ebe3',display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'},eyebrow:{fontSize:10,fontWeight:900,letterSpacing:'.1em',color:'#0c8073'},hero h1:{fontSize:24,margin:'5px 0'},
  card:{margin:'0 12px 12px',padding:16,borderRadius:16,background:'#fff',border:'1px solid #dce7e8'},card h2:{margin:'0 0 4px',fontSize:20},muted:{color:'#718286',fontSize:13,margin:'5px 0 12px'},primary:{border:0,borderRadius:11,padding:'11px 14px',background:'#0c8b7c',color:'#fff',fontWeight:800},secondary:{border:'1px solid #cbd9db',borderRadius:11,padding:'10px 13px',background:'#fff',fontWeight:700},danger:{border:0,borderRadius:11,padding:'11px 14px',background:'#b43b3b',color:'#fff',fontWeight:800},
  stats:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,margin:'0 12px 12px'},stat:{background:'#fff',border:'1px solid #dce7e8',borderRadius:14,padding:14},row:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'},
  bars:{height:210,display:'flex',gap:7,alignItems:'stretch',paddingTop:10},barWrap:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:5,fontSize:12},barTrack:{flex:1,width:'100%',background:'#edf2f2',borderRadius:7,display:'flex',alignItems:'flex-end',overflow:'hidden'},bar:{width:'100%',background:'#0c8b7c',borderRadius:7,minHeight:4},
  grid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14},field:{display:'block',fontSize:13,fontWeight:800,marginBottom:14},select:{display:'block',width:'100%',boxSizing:'border-box',marginTop:7,padding:11,border:'1px solid #cbd9db',borderRadius:10,background:'#fff'},segment:{display:'flex',gap:6,marginTop:7},seg:{border:'1px solid #cbd9db',background:'#fff',padding:'9px 12px',borderRadius:9,fontWeight:700},segActive:{border:0,background:'#0c8b7c',color:'#fff',padding:'9px 12px',borderRadius:9,fontWeight:800},proBox:{marginTop:14,padding:14,borderRadius:13,background:'#f1f8f7',border:'1px solid #d4e9e5'},
  analysisGrid:{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,margin:'14px 0'},digitCard:{padding:10,border:'1px solid #dce7e8',borderRadius:10,textAlign:'center',display:'flex',flexDirection:'column',gap:3},prediction:{fontSize:42,fontWeight:900,textAlign:'center',padding:15,margin:'10px 0',background:'#fff',borderRadius:14,border:'1px dashed #b7cbcd'},result:{display:'flex',flexWrap:'wrap',gap:10,marginTop:12,padding:12,borderRadius:10,background:'#fff',border:'1px solid #dce7e8',fontSize:13},warning:{fontSize:11,color:'#7c6868',marginBottom:0},
};

createRoot(document.getElementById('root')).render(<App />);
