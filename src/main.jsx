import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, BarChart3, CheckCircle2, ChevronDown, Clock3, Gauge, LayoutDashboard, Menu, RefreshCw, Settings2, ShieldCheck, Signal, SlidersHorizontal, Sparkles, Wifi, X } from 'lucide-react';
import './style.css';

const ENDPOINTS = ['wss://ws.binaryws.com/websockets/v3', 'wss://ws.derivws.com/websockets/v3'];
const MARKET_CATALOG = [
  ['1HZ100V','Volatility 100 (1s) Index'],['1HZ75V','Volatility 75 (1s) Index'],['1HZ50V','Volatility 50 (1s) Index'],['1HZ25V','Volatility 25 (1s) Index'],['1HZ10V','Volatility 10 (1s) Index'],
  ['R_100','Volatility 100 Index'],['R_75','Volatility 75 Index'],['R_50','Volatility 50 Index'],['R_25','Volatility 25 Index'],['R_10','Volatility 10 Index'],
  ['frxEURUSD','EUR/USD'],['frxGBPUSD','GBP/USD'],['frxUSDJPY','USD/JPY'],['frxAUDUSD','AUD/USD'],['frxUSDCAD','USD/CAD'],['frxUSDCHF','USD/CHF'],['frxEURGBP','EUR/GBP'],['frxNZDUSD','NZD/USD'],
  ['cryBTCUSD','BTC/USD'],['cryETHUSD','ETH/USD'],['XAUUSD','Gold/USD'],
];
const FALLBACK_MARKETS = MARKET_CATALOG.map(([symbol]) => symbol);
const MARKET_NAMES = Object.fromEntries(MARKET_CATALOG);
const TICK_OPTIONS = [1,2,3,5,10,25,50,100,200,500];
const DURATION_OPTIONS = [4,5,10,15,30,60];

function marketName(symbol){ return MARKET_NAMES[symbol] || symbol; }
function digitFromTick(tick){
  const quote = Number(tick?.quote);
  if(!Number.isFinite(quote)) return null;
  const pip = Number(tick?.pip_size);
  const raw = String(tick.quote);
  const decimals = Number.isFinite(pip) && pip > 0 ? Math.max(0, Math.round(-Math.log10(pip))) : (raw.split('.')[1] || '').length;
  const fixed = quote.toFixed(decimals);
  const onlyDigits = fixed.replace(/\D/g,'');
  if(!onlyDigits) return null;
  return { digit:Number(onlyDigits.slice(-1)), quote:fixed, time:Number(tick?.epoch || Date.now()/1000)*1000 };
}

function App(){
  const [markets,setMarkets] = useState(FALLBACK_MARKETS);
  const [names,setNames] = useState(MARKET_NAMES);
  const [symbol,setSymbol] = useState('1HZ100V');
  const [count,setCount] = useState(10);
  const [duration,setDuration] = useState(4);
  const [mode,setMode] = useState('Standard');
  const [ticks,setTicks] = useState([]);
  const [status,setStatus] = useState('connecting');
  const [error,setError] = useState('');
  const [view,setView] = useState('dashboard');
  const [menuOpen,setMenuOpen] = useState(false);
  const [lastUpdate,setLastUpdate] = useState(null);
  const [secondsLeft,setSecondsLeft] = useState(4);
  const [proActive,setProActive] = useState(false);
  const [proNotice,setProNotice] = useState('');
  const [result,setResult] = useState(null);
  const [contract,setContract] = useState('MATCHES');
  const [predictionDigit,setPredictionDigit] = useState('');
  const [analyzing,setAnalyzing] = useState(false);
  const [appId,setAppId] = useState('');

  const ws = useRef(null);
  const generation = useRef(0);
  const endpointIndex = useRef(0);
  const countRef = useRef(count);
  const symbolRef = useRef(symbol);

  useEffect(()=>{ countRef.current=count; setTicks(v=>v.slice(-count)); },[count]);
  useEffect(()=>{ symbolRef.current=symbol; },[symbol]);
  useEffect(()=>{ setSecondsLeft(duration); },[duration]);

  const closeSocket = useCallback(()=>{
    generation.current += 1;
    if(ws.current){ ws.current.onopen=null; ws.current.onmessage=null; ws.current.onerror=null; ws.current.onclose=null; try{ws.current.close();}catch(_){} ws.current=null; }
  },[]);

  const connect = useCallback((requestedSymbol)=>{
    const market = requestedSymbol || symbolRef.current;
    closeSocket();
    setStatus('connecting'); setError(''); setLastUpdate(null); setTicks([]);
    const myGen = ++generation.current;
    const endpoint = ENDPOINTS[endpointIndex.current % ENDPOINTS.length];
    endpointIndex.current = (endpointIndex.current + 1) % ENDPOINTS.length;
    let socket;
    try{ socket = new WebSocket(endpoint); }catch(e){ setStatus('offline'); setError('Your browser could not open a WebSocket connection.'); return; }
    ws.current=socket;
    let gotData=false;
    const timeout=setTimeout(()=>{
      if(!gotData && myGen===generation.current){ try{socket.close();}catch(_){} if(endpointIndex.current!==0) setTimeout(()=>connect(market),150); else {setStatus('offline');setError('Deriv did not return market data. Tap Reconnect.');} }
    },8000);

    socket.onopen=()=>{
      if(myGen!==generation.current) return;
      socket.send(JSON.stringify({ticks:market,subscribe:1,req_id:101}));
      socket.send(JSON.stringify({ticks_history:market,count:Math.max(1,Math.min(500,countRef.current)),end:'latest',style:'ticks',req_id:102}));
      socket.send(JSON.stringify({active_symbols:'brief',product_type:'basic',req_id:103}));
      setStatus('connecting');
    };
    socket.onmessage=(event)=>{
      if(myGen!==generation.current) return;
      let data; try{data=JSON.parse(event.data);}catch(_){return;}
      if(data.error){
        const msg=data.error.message || 'Deriv returned an error.';
        if(!gotData){ clearTimeout(timeout); try{socket.close();}catch(_){} setError(msg); if(endpointIndex.current!==0) setTimeout(()=>connect(market),150); else setStatus('offline'); }
        else setError(msg);
        return;
      }
      if(data.msg_type==='active_symbols' && Array.isArray(data.active_symbols)){
        const nextNames={...MARKET_NAMES};
        const dynamic=[];
        data.active_symbols.forEach(item=>{
          const s=item.underlying_symbol || item.symbol;
          if(!s) return;
          dynamic.push(s);
          nextNames[s]=item.underlying_symbol_name || item.display_name || MARKET_NAMES[s] || s;
        });
        setNames(nextNames);
        if(dynamic.length) setMarkets(prev=>Array.from(new Set([...prev,...dynamic])));
      }
      if(data.msg_type==='history' && Array.isArray(data.history?.prices)){
        const times=Array.isArray(data.history.times)?data.history.times:[];
        const history=data.history.prices.map((price,i)=>digitFromTick({quote:price,epoch:times[i]})).filter(Boolean);
        if(history.length){ gotData=true; clearTimeout(timeout); setTicks(history.slice(-Math.max(1,countRef.current))); setLastUpdate(Date.now()); setStatus('live'); }
      }
      if(data.msg_type==='tick' && data.tick?.quote!=null){
        const item=digitFromTick(data.tick);
        if(item){ gotData=true; clearTimeout(timeout); setTicks(prev=>[...prev,item].slice(-Math.max(1,countRef.current))); setLastUpdate(Date.now()); setStatus('live'); }
      }
    };
    socket.onerror=()=>{
      clearTimeout(timeout);
      if(myGen!==generation.current) return;
      if(!gotData){ try{socket.close();}catch(_){} setStatus('offline'); setError('Live connection failed. Tap Reconnect to retry.'); }
    };
    socket.onclose=()=>{
      clearTimeout(timeout);
      if(myGen!==generation.current) return;
      if(!gotData){ setStatus('offline'); setError('Connection closed before market data arrived.'); }
      else setStatus('offline');
    };
  },[closeSocket]);

  useEffect(()=>{ connect('1HZ100V'); return ()=>closeSocket(); },[connect,closeSocket]);

  const changeSymbol=(next)=>{ setSymbol(next); setResult(null); setPredictionDigit(''); connect(next); };
  const reset=()=>{ setTicks([]); setResult(null); setPredictionDigit(''); setProNotice(''); setSecondsLeft(duration); };
  const togglePro=()=>{
    if(mode==='Pro'){
      if(!proActive){ setProNotice('Pro Bot is ready. Activate it to enable the synchronized Analyze button.'); }
      else setProNotice('Pro Bot is active and synchronized with the live stream.');
    }
    setMode('Pro');
  };
  const activatePro=()=>{ setProActive(true); setProNotice('Pro Bot activated — synchronized with the selected live market.'); };
  const deactivatePro=()=>{ setProActive(false); setProNotice('Pro Bot deactivated.'); setResult(null); setPredictionDigit(''); };

  const analyze=()=>{
    if(mode==='Pro' && !proActive){ setProNotice('Activate Pro Bot first.'); return; }
    if(!ticks.length){ setError('No live ticks are available yet. Wait for LIVE status and try again.'); return; }
    setAnalyzing(true); setError('');
    const now=Date.now();
    const windowStart=now-duration*1000;
    let sample=ticks.filter(t=>t.time>=windowStart).slice(-count);
    if(!sample.length) sample=ticks.slice(-count);
    const freq=Array(10).fill(0);
    sample.forEach(t=>{ if(Number.isInteger(t.digit)) freq[t.digit]+=1; });
    const weighted=Array(10).fill(0);
    sample.forEach((t,i)=>{ weighted[t.digit]+=1+(i/Math.max(sample.length-1,1))*1.5; });
    const scores=mode==='Pro'?weighted:freq;
    const ranked=[...Array(10).keys()].sort((a,b)=>scores[b]-scores[a] || freq[b]-freq[a] || a-b);
    const match=ranked[0];
    const differs=[...Array(10).keys()].sort((a,b)=>scores[a]-scores[b] || a-b)[0];
    const total=sample.length;
    const confidence=total?Math.round(Math.min(99,50+Math.abs(scores[match]/Math.max(scores.reduce((a,b)=>a+b,0),1)-0.1)*500)):0;
    const output=contract==='MATCHES'?match:differs;
    const item={match,differs,confidence,total,window:duration,sample,frequency:freq,time:Date.now()};
    setResult(item); setPredictionDigit(String(output));
    setSecondsLeft(duration); setAnalyzing(false);
  };

  useEffect(()=>{
    if(status!=='live') return;
    const id=setInterval(()=>setSecondsLeft(v=>v<=1?duration:v-1),1000);
    return ()=>clearInterval(id);
  },[status,duration]);

  const frequency=useMemo(()=>Array.from({length:10},(_,d)=>ticks.filter(t=>t.digit===d).length),[ticks]);
  const total=ticks.length;
  const max=Math.max(...frequency,0);
  const last=ticks[ticks.length-1];
  const age=lastUpdate?Math.max(0,Math.floor((Date.now()-lastUpdate)/1000)):null;
  const displayName=names[symbol] || marketName(symbol);
  const statusText=status==='live'?'CONNECTED':status==='connecting'?'CONNECTING':'OFFLINE';

  const navigate=(v)=>{setView(v);setMenuOpen(false);};

  return <main>
    <header className="topbar">
      <div className="brand"><div className="brandmark"><Signal size={18}/></div><div><b>Deriv Pro Analyser</b><small>Live market intelligence</small></div></div>
      <div className="top-actions"><span className={status==='live'?'status-pill online':'status-pill'}><i/>{statusText}</span><button className="icon-btn" onClick={()=>setMenuOpen(v=>!v)}><Menu size={20}/></button></div>
    </header>
    {menuOpen&&<div className="menu-card"><button onClick={()=>navigate('dashboard')}><LayoutDashboard size={16}/>Dashboard</button><button onClick={()=>navigate('analysis')}><BarChart3 size={16}/>Digit Analysis</button><button onClick={()=>navigate('settings')}><Settings2 size={16}/>Analysis Settings</button></div>}

    <section className="summary-strip">
      <div><small>System</small><b><i className="dot online-dot"/> {status==='live'?'ONLINE':status==='connecting'?'CONNECTING':'OFFLINE'}</b></div>
      <div><small>Market Data</small><b><i className="dot"/> {status==='live'?'LIVE STREAM':status==='connecting'?'WAITING':'OFFLINE'}</b></div>
      <div className="market-chip"><Activity size={16}/><span><small>Active Market</small><b>{displayName}</b></span><ChevronDown size={15}/></div>
    </section>

    {view==='settings'&&<section className="page card">
      <div className="page-head"><div><small>ANALYSIS SETTINGS</small><h1>Analysis Settings</h1><p>All controls are live. Tick count starts at 1 and duration starts at ~4 seconds.</p></div><SlidersHorizontal size={22}/></div>
      <div className="settings-grid">
        <div className="setting"><div className="setting-title"><span className="setting-icon"><BarChart3/></span>Number of ticks</div><select value={count} onChange={e=>setCount(Number(e.target.value))}>{TICK_OPTIONS.map(n=><option key={n} value={n}>{n} {n===1?'tick':'ticks'}</option>)}</select></div>
        <div className="setting"><div className="setting-title"><span className="setting-icon"><Clock3/></span>Analysis duration</div><select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{DURATION_OPTIONS.map(n=><option key={n} value={n}>~{n} seconds</option>)}</select></div>
        <div className="setting"><div className="setting-title"><span className="setting-icon"><Gauge/></span>Analysis mode</div><div className="seg"><button className={mode==='Standard'?'active':''} onClick={()=>setMode('Standard')}>Standard</button><button className={mode==='Pro'?'active':''} onClick={togglePro}>Pro</button></div></div>
        <div className="setting"><div className="setting-title"><span className="setting-icon"><Activity/></span>Market</div><select value={symbol} onChange={e=>changeSymbol(e.target.value)}>{markets.map(s=><option key={s} value={s}>{names[s]||marketName(s)}</option>)}</select></div>
      </div>
      {mode==='Pro'&&<ProPanel active={proActive} notice={proNotice} onActivate={activatePro} onDeactivate={deactivatePro}/>} 
      <div className="settings-actions"><button className="primary" onClick={()=>{connect(symbol);setView('dashboard')}}><RefreshCw size={16}/> Apply & reconnect</button><button className="secondary" onClick={reset}>Reset sample</button></div>
    </section>}

    {view==='analysis'&&<section className="page card">
      <div className="page-head"><div><small>LIVE DIGIT ANALYSIS</small><h1>Digit Analysis</h1><p>{total} live ticks buffered • {duration}s rolling window • {mode} mode.</p></div><BarChart3 size={22}/></div>
      <div className="analysis-list">{frequency.map((n,d)=><div className={result?.match===d?'analysis-row selected':'analysis-row'} key={d}><b>Digit {d}</b><span>{n} hits</span><strong>{total?Math.round(n/total*100):0}%</strong></div>)}</div>
      {mode==='Pro'&&<ProPanel active={proActive} notice={proNotice} onActivate={activatePro} onDeactivate={deactivatePro}/>} 
      <AnalysisBox mode={mode} active={proActive} contract={contract} setContract={setContract} predictionDigit={predictionDigit} result={result} analyzing={analyzing} onAnalyze={analyze}/>
    </section>}

    {view==='dashboard'&&<>
      <section className="hero-card"><div className="hero-copy"><span className="eyebrow">LIVE DIGIT FREQUENCY</span><h1>{displayName}</h1><p>{total} ticks received • next window in {secondsLeft}s{age!==null?` • last update ${age}s ago`:''}</p></div><div className="last-digit"><small>LAST DIGIT</small><strong>{last?.digit??'—'}</strong></div></section>
      {error&&<div className="err">{error}</div>}
      <section className="quick-controls"><button className="market-select" onClick={()=>setView('settings')}><Activity size={17}/><span><small>MARKET</small><b>{displayName}</b></span><ChevronDown size={16}/></button><button className="tick-select" onClick={()=>setView('settings')}><BarChart3 size={17}/><span><small>NUMBER OF TICKS</small><b>{count} {count===1?'tick':'ticks'}</b></span><ChevronDown size={16}/></button><button className="settings-open" onClick={()=>setView('settings')}><Settings2 size={18}/>Settings</button></section>
      <section className="card"><div className="section-title"><div><h2>Digit Frequency</h2><p>Live last-digit distribution from the selected Deriv market</p></div><span className="live-label"><i/> {status==='live'?'LIVE':'WAITING'}</span></div><div className="bars">{frequency.map((n,d)=>{const h=total?Math.max(5,n/Math.max(max,1)*100):5;return <div className={result?.match===d?'bar hot':'bar'} key={d}><div className="fill" style={{height:`${h}%`}}/><b>{d}</b><small>{total?Math.round(n/total*100):0}%</small><em>{n}</em></div>})}</div></section>
      <section className="pred-grid"><div className="pred-card match"><small>MATCHES</small><strong>{result?result.match:'—'}</strong><span>{result?'Pro/Standard analysis output':'Press Analyze to calculate'}</span></div><div className="pred-card differ"><small>DIFFERS</small><strong>{result?result.differs:'—'}</strong><span>{result?'Lowest observed score':'Press Analyze to calculate'}</span></div><div className="pred-card score"><small>ANALYSIS SCORE</small><strong>{result?`${result.confidence}%`:'—'}</strong><span>Statistical signal, not a guarantee</span></div></section>
      <section className="mode-tabs"><button className={mode==='Standard'?'active':''} onClick={()=>setMode('Standard')}>Standard</button><button className={mode==='Pro'?'active':''} onClick={togglePro}>Pro Analysis</button></section>
      {mode==='Pro'&&<ProPanel active={proActive} notice={proNotice} onActivate={activatePro} onDeactivate={deactivatePro}/>} 
      <AnalysisBox mode={mode} active={proActive} contract={contract} setContract={setContract} predictionDigit={predictionDigit} result={result} analyzing={analyzing} onAnalyze={analyze}/>
    </>}

    <nav className="bottom-nav"><button className={view==='dashboard'?'active':''} onClick={()=>navigate('dashboard')}><LayoutDashboard size={16}/><span>Dashboard</span></button><button className={view==='analysis'?'active':''} onClick={()=>navigate('analysis')}><BarChart3 size={16}/><span>Analysis</span></button><button className={view==='settings'?'active':''} onClick={()=>navigate('settings')}><Settings2 size={16}/><span>Settings</span></button></nav>
    <footer><ShieldCheck size={13}/>Read-only analysis. No trade execution, orders, balance access, or automatic trading. Digit frequency is descriptive; it cannot guarantee the next digit.</footer>
  </main>;
}

function ProPanel({active,notice,onActivate,onDeactivate}){
  return <section className="pro-panel"><div className="pro-title"><div className="pro-icon"><Sparkles size={18}/></div><div><b>Synchronized Pro Bot</b><span>Uses the current live tick stream, selected market, tick count and duration.</span></div><span className={active?'bot-state on':'bot-state'}>{active?'ACTIVE':'READY'}</span></div>{notice&&<div className="pro-notice">{notice}</div>}<button className={active?'secondary pro-button':'primary pro-button'} onClick={active?onDeactivate:onActivate}>{active?<><X size={16}/> Deactivate Pro Bot</>:<><CheckCircle2 size={16}/> Activate Pro Bot</>}</button></section>;
}

function AnalysisBox({mode,active,contract,setContract,predictionDigit,result,analyzing,onAnalyze}){
  const locked=mode==='Pro'&&!active;
  return <section className="analysis-box"><div className="analysis-box-head"><div><small>PREDICTION INPUT</small><h2>Run live analysis</h2><p>Each press recalculates from the latest live market sample.</p></div><Gauge size={21}/></div><div className="contract-tabs"><button className={contract==='MATCHES'?'active':''} onClick={()=>setContract('MATCHES')}>MATCHES</button><button className={contract==='DIFFERS'?'active':''} onClick={()=>setContract('DIFFERS')}>DIFFERS</button></div><div className="prediction-field"><span>Digit input</span><strong>{predictionDigit||'—'}</strong></div><button className="analyze-button" disabled={locked||analyzing} onClick={onAnalyze}>{analyzing?<><RefreshCw size={17} className="spin"/>Analyzing live data…</>:locked?<><ShieldCheck size={17}/>Activate Pro Bot first</>:<><Sparkles size={17}/>Analyze current live data</>}</button>{result&&<div className="result-meta"><span>{result.total} ticks used</span><span>{result.window}s window</span><span>Updated {new Date(result.time).toLocaleTimeString()}</span></div>}<p className="analysis-warning">The displayed digit is a calculation from observed ticks, not a guaranteed prediction of a random future digit.</p></section>;
}

createRoot(document.getElementById('root')).render(<App/>);
