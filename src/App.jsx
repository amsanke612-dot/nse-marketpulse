import { useState, useEffect, useRef, useCallback } from "react";

const NSE_STOCKS = [
  { symbol: "RELIANCE.NS", label: "RELIANCE", name: "Reliance Industries",      sector: "Energy",  fallback: { price: 1408.10, chg: -0.42, high: 1421.00, low: 1401.00, w52h: 1608.95, w52l: 1114.85 } },
  { symbol: "TCS.NS",       label: "TCS",       name: "Tata Consultancy Svcs",   sector: "IT",      fallback: { price: 3316.25, chg:  0.18, high: 3340.00, low: 3298.00, w52h: 4592.25, w52l: 3056.05 } },
  { symbol: "HDFCBANK.NS",  label: "HDFCBANK",  name: "HDFC Bank",               sector: "Banking", fallback: { price: 1882.55, chg: -0.31, high: 1896.00, low: 1874.00, w52h: 1880.00, w52l: 1430.15 } },
  { symbol: "INFY.NS",      label: "INFY",       name: "Infosys",                 sector: "IT",      fallback: { price: 1564.80, chg:  0.55, high: 1578.00, low: 1558.00, w52h: 2006.45, w52l: 1358.35 } },
  { symbol: "ICICIBANK.NS", label: "ICICIBANK",  name: "ICICI Bank",              sector: "Banking", fallback: { price: 1409.90, chg:  0.22, high: 1418.00, low: 1402.00, w52h: 1362.35, w52l: 1023.15 } },
  { symbol: "BAJFINANCE.NS",label: "BAJFINANCE", name: "Bajaj Finance",           sector: "Finance", fallback: { price: 8738.45, chg: -0.67, high: 8800.00, low: 8710.00, w52h: 7830.00, w52l: 6187.80 } },
  { symbol: "MARUTI.NS",    label: "MARUTI",     name: "Maruti Suzuki",           sector: "Auto",    fallback: { price: 11940.5, chg:  0.34, high: 12010.0, low: 11900.0, w52h: 13680.0, w52l: 10705.0 } },
  { symbol: "TATAMOTORS.NS",label: "TATAMOTORS", name: "Tata Motors",             sector: "Auto",    fallback: { price: 614.70,  chg: -1.12, high: 623.00,  low: 610.00,  w52h: 1179.00, w52l: 578.60  } },
  { symbol: "WIPRO.NS",     label: "WIPRO",      name: "Wipro",                   sector: "IT",      fallback: { price: 245.55,  chg:  0.09, high: 247.00,  low: 244.00,  w52h: 324.00,  w52l: 208.40  } },
  { symbol: "HINDUNILVR.NS",label: "HINDUNILVR", name: "Hindustan Unilever",      sector: "FMCG",    fallback: { price: 2268.85, chg: -0.23, high: 2280.00, low: 2260.00, w52h: 2778.80, w52l: 2172.50 } },
];

const INDICES = [
  { symbol: "^NSEI",    label: "NIFTY 50",   fallback: { price: 23519.35, chg: -0.28 } },
  { symbol: "^BSESN",   label: "SENSEX",     fallback: { price: 77414.92, chg: -0.31 } },
  { symbol: "^NSEBANK", label: "BANK NIFTY", fallback: { price: 50969.45, chg:  0.12 } },
];

const PROXIES = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const CACHE_KEY_QUOTES  = "nse_q2";
const CACHE_KEY_INDICES = "nse_i2";
const CACHE_KEY_TIME    = "nse_t2";

function saveCache(q, i) {
  try { localStorage.setItem(CACHE_KEY_QUOTES, JSON.stringify(q)); localStorage.setItem(CACHE_KEY_INDICES, JSON.stringify(i)); localStorage.setItem(CACHE_KEY_TIME, new Date().toISOString()); } catch (_) {}
}
function loadCache() {
  try { return { quotes: JSON.parse(localStorage.getItem(CACHE_KEY_QUOTES) || "null"), indices: JSON.parse(localStorage.getItem(CACHE_KEY_INDICES) || "null"), time: localStorage.getItem(CACHE_KEY_TIME) }; }
  catch (_) { return { quotes: null, indices: null, time: null }; }
}

function buildQuoteURL(syms) {
  return `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketState`;
}
function buildChartURL(sym) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=3mo`;
}

async function fetchWithProxies(url) {
  for (const makeProxy of PROXIES) {
    try {
      const res = await fetch(makeProxy(url), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data) return data;
    } catch (_) {}
  }
  return null;
}

function makeFallbackQuotes() {
  const q = {}, i = {};
  NSE_STOCKS.forEach(s => { q[s.symbol] = { regularMarketPrice: s.fallback.price, regularMarketChangePercent: s.fallback.chg, regularMarketChange: +(s.fallback.price * s.fallback.chg / 100).toFixed(2), regularMarketDayHigh: s.fallback.high, regularMarketDayLow: s.fallback.low, fiftyTwoWeekHigh: s.fallback.w52h, fiftyTwoWeekLow: s.fallback.w52l, marketState: "CLOSED", _isFallback: true }; });
  INDICES.forEach(s => { i[s.symbol] = { regularMarketPrice: s.fallback.price, regularMarketChangePercent: s.fallback.chg, _isFallback: true }; });
  return { q, i };
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) gains += d; else losses -= d; }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
function calcMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function getSignal(prices) {
  if (!prices || prices.length < 10) return { signal: "HOLD", rsi: "50.0", ma20: "0.00", ma50: "0.00" };
  const rsi = calcRSI(prices);
  const ma20 = calcMA(prices, Math.min(20, prices.length));
  const ma50 = calcMA(prices, Math.min(50, prices.length));
  const cur = prices[prices.length - 1];
  let score = 0;
  if (rsi < 30) score += 2; else if (rsi < 45) score += 1; else if (rsi > 70) score -= 2; else if (rsi > 60) score -= 1;
  if (ma20 > ma50 && cur > ma20) score += 2; else if (ma20 < ma50 && cur < ma20) score -= 2;
  return { signal: score >= 2 ? "BUY" : score <= -2 ? "SELL" : "HOLD", rsi: rsi.toFixed(1), ma20: ma20.toFixed(2), ma50: ma50.toFixed(2) };
}

function SparkLine({ prices, bullish }) {
  if (!prices || prices.length < 2) return <div style={{ width: 90, height: 34 }} />;
  const W = 90, H = 34, mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * W},${H - ((p - mn) / rng) * H * 0.85 - 2}`).join(" ");
  return <svg width={W} height={H} style={{ display: "block", flexShrink: 0 }}><polyline points={pts} fill="none" stroke={bullish ? "#22c55e" : "#ef4444"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" /></svg>;
}

function SignalBadge({ signal }) {
  const cfg = { BUY: { bg: "rgba(34,197,94,0.15)", border: "#22c55e", color: "#22c55e", icon: "▲" }, SELL: { bg: "rgba(239,68,68,0.15)", border: "#ef4444", color: "#ef4444", icon: "▼" }, HOLD: { bg: "rgba(234,179,8,0.15)", border: "#eab308", color: "#eab308", icon: "●" } }[signal] || { bg: "rgba(100,116,139,0.15)", border: "#64748b", color: "#64748b", icon: "–" };
  return <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{cfg.icon} {signal}</span>;
}

export default function App() {
  const cached = loadCache();
  const fb = makeFallbackQuotes();
  const [quotes,   setQuotes]   = useState(cached.quotes   || fb.q);
  const [indices,  setIndices]  = useState(cached.indices  || fb.i);
  const [history,  setHistory]  = useState({});
  const [selected, setSelected] = useState("RELIANCE.NS");
  const [tab,      setTab]      = useState("watch");
  const [loading,  setLoading]  = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [dataSource, setDataSource]   = useState(cached.quotes ? "cache" : "fallback");
  const [cacheTime,  setCacheTime]    = useState(cached.time);
  const [marketState, setMarketState] = useState("CLOSED");
  const [aiText,   setAiText]   = useState({});
  const [aiLoading,setAiLoading]= useState({});
  const [showWA,   setShowWA]   = useState(false);
  const [wa,       setWa]       = useState({ sid: "", token: "", to: "" });
  const [alertLog, setAlertLog] = useState([]);
  const prevSignals = useRef({});

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const allSyms = [...NSE_STOCKS.map(s => s.symbol), ...INDICES.map(s => s.symbol)].join(",");
      const data = await fetchWithProxies(buildQuoteURL(allSyms));
      const results = data?.quoteResponse?.result || [];
      if (results.length === 0) throw new Error("empty");
      const newQ = {}, newI = {};
      results.forEach(q => {
        if (INDICES.some(i => i.symbol === q.symbol)) newI[q.symbol] = q;
        else newQ[q.symbol] = q;
        if (q.marketState) setMarketState(q.marketState);
      });
      setQuotes(newQ); setIndices(newI);
      setDataSource("live"); setCacheTime(new Date().toISOString());
      saveCache(newQ, newI);
    } catch (_) {
      if (cached.quotes) { setQuotes(cached.quotes); setIndices(cached.indices); setDataSource("cache"); }
      else { setQuotes(fb.q); setIndices(fb.i); setDataSource("fallback"); }
    }
    setLoading(false);
  }, []);

  const fetchHistory = useCallback(async (symbol) => {
    if (history[symbol]) return;
    setHistLoading(true);
    try {
      const data = await fetchWithProxies(buildChartURL(symbol));
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
      if (closes.length > 0) setHistory(prev => ({ ...prev, [symbol]: closes }));
    } catch (_) {}
    setHistLoading(false);
  }, [history]);

  useEffect(() => { fetchQuotes(); }, []);
  useEffect(() => {
    const id = setInterval(fetchQuotes, marketState === "REGULAR" ? 30000 : 180000);
    return () => clearInterval(id);
  }, [fetchQuotes, marketState]);
  useEffect(() => { if (selected) fetchHistory(selected); }, [selected]);

  useEffect(() => {
    if (!Object.keys(quotes).length) return;
    NSE_STOCKS.forEach(s => {
      const h = history[s.symbol] || [], q = quotes[s.symbol];
      if (!q) return;
      const prices = [...h, q.regularMarketPrice].filter(Boolean);
      const sig = getSignal(prices);
      const prev = prevSignals.current[s.symbol];
      if (prev && prev !== sig.signal) {
        const entry = { key: `${s.symbol}-${Date.now()}`, time: new Date().toLocaleTimeString("en-IN"), stock: s.label, signal: sig.signal, price: q.regularMarketPrice?.toFixed(2), sent: !!(wa.sid && wa.token && wa.to) };
        setAlertLog(p => [entry, ...p.slice(0, 29)]);
        if (wa.sid && wa.token && wa.to) sendWA(s, sig, q);
      }
      prevSignals.current[s.symbol] = sig.signal;
    });
  }, [quotes, history]);

  const sendWA = async (s, sig, q) => {
    const emoji = { BUY: "GREEN", SELL: "RED", HOLD: "YELLOW" }[sig.signal] || "WHITE";
    const body = `[${emoji}] NSE MarketPulse\n\n${s.label} - ${s.name}\nSignal: ${sig.signal}\nPrice: Rs.${q.regularMarketPrice?.toFixed(2)}\nChange: ${q.regularMarketChangePercent?.toFixed(2)}%\nRSI: ${sig.rsi} | MA20: Rs.${sig.ma20}\nTime: ${new Date().toLocaleTimeString("en-IN")}\n\nPowered by NSE MarketPulse`;
    try {
      const fd = new URLSearchParams();
      fd.append("From", "whatsapp:+14155238886"); fd.append("To", `whatsapp:${wa.to}`); fd.append("Body", body);
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${wa.sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${wa.sid}:${wa.token}`), "Content-Type": "application/x-www-form-urlencoded" }, body: fd });
    } catch (_) {}
  };

  const getAI = async (sym) => {
    const stock = NSE_STOCKS.find(s => s.symbol === sym), q = quotes[sym], h = history[sym] || [];
    if (!stock || !q) return;
    setAiLoading(p => ({ ...p, [sym]: true }));
    try {
      const prices = [...h.slice(-15), q.regularMarketPrice].filter(Boolean);
      const sig = getSignal(prices);
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: `You are a SEBI-registered Indian market analyst.\n\nStock: ${stock.label} (${stock.name})\nSector: ${stock.sector}\nPrice: Rs.${q.regularMarketPrice?.toFixed(2)}\nDay Change: ${q.regularMarketChangePercent?.toFixed(2)}%\nHigh/Low: Rs.${q.regularMarketDayHigh?.toFixed(2)} / Rs.${q.regularMarketDayLow?.toFixed(2)}\n52W H/L: Rs.${q.fiftyTwoWeekHigh?.toFixed(2)} / Rs.${q.fiftyTwoWeekLow?.toFixed(2)}\nRSI: ${sig.rsi} | MA20: Rs.${sig.ma20} | MA50: Rs.${sig.ma50}\nSignal: ${sig.signal}\n\nProvide:\n1. 2-sentence analysis for the ${sig.signal} signal\n2. Key sector risk\n3. Short-term target Rs.X to Rs.Y\n4. Confidence: Low/Medium/High\n\nUnder 100 words. India-specific.` }] }) });
      const d = await res.json();
      setAiText(p => ({ ...p, [sym]: d.content?.[0]?.text || "Analysis unavailable." }));
    } catch { setAiText(p => ({ ...p, [sym]: "AI analysis failed. Please retry." })); }
    setAiLoading(p => ({ ...p, [sym]: false }));
  };

  const selStock = NSE_STOCKS.find(s => s.symbol === selected);
  const selQ = quotes[selected];
  const selH = history[selected] || [];
  const selPrices = selQ ? [...selH, selQ.regularMarketPrice].filter(Boolean) : selH;
  const selSig = getSignal(selPrices);
  const sigColor = { BUY: "#22c55e", SELL: "#ef4444", HOLD: "#eab308" }[selSig.signal] || "#64748b";
  const isOpen = marketState === "REGULAR";
  const sourceBadge = dataSource === "live" ? { label: "LIVE", color: "#22c55e" } : dataSource === "cache" ? { label: "CACHED", color: "#60a5fa" } : { label: "DEMO DATA", color: "#eab308" };

  return (
    <div style={{ minHeight: "100vh", background: "#080c18", color: "#e2e8f0", fontFamily: "'DM Sans','Segoe UI',sans-serif", display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <header style={{ background: "#0d1117", borderBottom: "1px solid #161b25", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            <span style={{ fontSize: 18 }}>&#128200;</span>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>NSE MarketPulse</div>
            <div style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: sourceBadge.color, display: "inline-block" }} />
              <span style={{ color: sourceBadge.color, fontWeight: 600 }}>{sourceBadge.label}</span>
              <span style={{ color: "#374151" }}> · Yahoo Finance + Fallback</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          {INDICES.map(idx => {
            const q = indices[idx.symbol];
            const chg = q?.regularMarketChangePercent?.toFixed(2) || "0.00";
            const price = q?.regularMarketPrice?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) || "—";
            return (
              <div key={idx.symbol} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>{idx.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{price}</div>
                <div style={{ fontSize: 10, color: parseFloat(chg) >= 0 ? "#22c55e" : "#ef4444" }}>{parseFloat(chg) >= 0 ? "+" : ""}{chg}%</div>
              </div>
            );
          })}
          <button onClick={fetchQuotes} disabled={loading} style={{ background: "#161b25", border: "1px solid #1f2937", borderRadius: 8, padding: "7px 12px", color: loading ? "#374151" : "#94a3b8", cursor: "pointer", fontSize: 11 }}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button onClick={() => setShowWA(true)} style={{ background: "#25d366", border: "none", borderRadius: 8, padding: "7px 14px", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            WhatsApp
          </button>
        </div>
      </header>

      {/* DATA SOURCE BANNER */}
      {dataSource !== "live" && (
        <div style={{ background: dataSource === "cache" ? "#0d1a2d" : "#1a1400", borderBottom: `1px solid ${dataSource === "cache" ? "#1e3a5f" : "#3a2e00"}`, padding: "7px 18px", fontSize: 11, color: dataSource === "cache" ? "#60a5fa" : "#eab308", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>
            {dataSource === "cache" ? "Cached Data" : "Demo Data (Approximate)"}
          </span>
          <span style={{ color: "#475569" }}>
            {dataSource === "cache"
              ? `Last fetched: ${cacheTime ? new Date(cacheTime).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "previous session"}`
              : "Could not reach Yahoo Finance. Showing approximate last closing prices. Signals and charts are still functional."}
          </span>
          <button onClick={fetchQuotes} style={{ marginLeft: "auto", background: "#1f2937", border: "1px solid #374151", borderRadius: 6, padding: "3px 12px", color: "#94a3b8", cursor: "pointer", fontSize: 10 }}>
            Retry Live Data
          </button>
        </div>
      )}
      {!isOpen && (
        <div style={{ background: "#140e00", borderBottom: "1px solid #2a1800", padding: "5px 18px", fontSize: 10, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
          <span>NSE is CLOSED</span>
          <span style={{ color: "#374151" }}>Market hours: Mon-Fri 9:15 AM - 3:30 PM IST</span>
          {cacheTime && <span style={{ marginLeft: "auto", color: "#374151" }}>Prices as of: {new Date(cacheTime).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>}
        </div>
      )}

      {/* TICKER */}
      <div style={{ background: "#0a0e1a", borderBottom: "1px solid #161b25", padding: "5px 0", overflow: "hidden", whiteSpace: "nowrap" }}>
        <div style={{ display: "inline-flex", gap: 28, animation: "marquee 45s linear infinite", padding: "0 20px" }}>
          {[...NSE_STOCKS, ...NSE_STOCKS].map((s, i) => {
            const q = quotes[s.symbol];
            const chg = q?.regularMarketChangePercent?.toFixed(2) || "0.00";
            return (
              <span key={i} style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setSelected(s.symbol)}>
                <span style={{ color: "#818cf8", fontWeight: 600 }}>{s.label}</span>
                <span style={{ color: "#94a3b8", margin: "0 5px" }}>Rs.{q?.regularMarketPrice?.toFixed(2) || s.fallback.price.toFixed(2)}</span>
                <span style={{ color: parseFloat(chg) >= 0 ? "#22c55e" : "#ef4444" }}>{parseFloat(chg) >= 0 ? "+" : ""}{chg}%</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #161b25", display: "flex", alignItems: "center", padding: "0 18px" }}>
        {[["watch","Watchlist"],["ai","AI Analysis"],["alerts",`Alerts${alertLog.length ? ` (${alertLog.length})` : ""}`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", padding: "12px 16px", cursor: "pointer", color: tab === id ? "#818cf8" : "#374151", fontWeight: tab === id ? 600 : 400, borderBottom: tab === id ? "2px solid #6366f1" : "2px solid transparent", fontSize: 12 }}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 10 }}>
          <span style={{ color: sourceBadge.color }}>● </span>
          <span style={{ color: "#374151" }}>{sourceBadge.label}{cacheTime ? " · " + new Date(cacheTime).toLocaleTimeString("en-IN") : ""}</span>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 520 }}>

        {/* LEFT */}
        <div style={{ width: 330, flexShrink: 0, borderRight: "1px solid #161b25", overflowY: "auto", background: "#0b0f1a" }}>
          <div style={{ padding: 10 }}>

            {tab === "watch" && NSE_STOCKS.map(s => {
              const q = quotes[s.symbol];
              const h = history[s.symbol] || [];
              const price = q?.regularMarketPrice || s.fallback.price;
              const chgPct = q?.regularMarketChangePercent || s.fallback.chg;
              const prices = [...h.slice(-20), price].filter(Boolean);
              const sig = getSignal(prices);
              const isSel = selected === s.symbol;
              const bull = chgPct >= 0;
              return (
                <div key={s.symbol} onClick={() => setSelected(s.symbol)} style={{ background: isSel ? "rgba(99,102,241,0.10)" : "rgba(255,255,255,0.015)", border: `1px solid ${isSel ? "#6366f1" : "#161b25"}`, borderRadius: 10, padding: "11px 12px", marginBottom: 7, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: "#374151", marginTop: 1 }}>{s.name}</div>
                      <div style={{ fontSize: 9, color: "#4f46e5", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.sector}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#f1f5f9" }}>Rs.{price.toFixed(2)}</div>
                      <div style={{ fontSize: 10, color: bull ? "#22c55e" : "#ef4444" }}>{bull ? "+" : ""}{chgPct.toFixed(2)}%</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <SparkLine prices={prices} bullish={bull} />
                    <SignalBadge signal={sig.signal} />
                  </div>
                </div>
              );
            })}

            {tab === "ai" && NSE_STOCKS.map(s => {
              const q = quotes[s.symbol];
              const price = q?.regularMarketPrice || s.fallback.price;
              return (
                <div key={s.symbol} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid #161b25", borderRadius: 10, padding: "11px 12px", marginBottom: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: aiText[s.symbol] ? 8 : 0 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{s.label}</span>
                      <span style={{ fontSize: 10, color: "#374151", marginLeft: 7 }}>Rs.{price.toFixed(2)}</span>
                    </div>
                    <button onClick={() => { setSelected(s.symbol); getAI(s.symbol); }} disabled={aiLoading[s.symbol]} style={{ background: aiLoading[s.symbol] ? "#1f2937" : "#6366f1", border: "none", borderRadius: 6, padding: "5px 11px", color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                      {aiLoading[s.symbol] ? "Analysing..." : "AI Analyse"}
                    </button>
                  </div>
                  {aiText[s.symbol] && <div style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>{aiText[s.symbol]}</div>}
                </div>
              );
            })}

            {tab === "alerts" && (
              alertLog.length === 0
                ? <div style={{ textAlign: "center", padding: "30px 16px", color: "#1f2937", fontSize: 12 }}>No signal changes yet.<br />Alerts fire when BUY/SELL/HOLD changes.</div>
                : alertLog.map((a, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid #161b25", borderRadius: 9, padding: "10px 12px", marginBottom: 7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontWeight: 700, color: "#818cf8", fontSize: 12 }}>{a.stock}</span>
                      <span style={{ fontSize: 10, color: "#374151" }}>{a.time}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <SignalBadge signal={a.signal} />
                      <span style={{ fontSize: 11, color: "#475569" }}>Rs.{a.price}</span>
                    </div>
                    <div style={{ marginTop: 5, fontSize: 10, color: a.sent ? "#22c55e" : "#374151" }}>
                      {a.sent ? "WhatsApp sent" : "Logged — configure WhatsApp to send alerts"}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* RIGHT DETAIL */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#080c18" }}>
          {selStock ? (() => {
            const q = selQ;
            const price = q?.regularMarketPrice || selStock.fallback.price;
            const chgPct = q?.regularMarketChangePercent || selStock.fallback.chg;
            const chgAmt = q?.regularMarketChange || +(price * chgPct / 100).toFixed(2);
            const high   = q?.regularMarketDayHigh  || selStock.fallback.high;
            const low    = q?.regularMarketDayLow   || selStock.fallback.low;
            const w52h   = q?.fiftyTwoWeekHigh      || selStock.fallback.w52h;
            const w52l   = q?.fiftyTwoWeekLow       || selStock.fallback.w52l;
            const bull   = chgPct >= 0;
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: -0.5 }}>{selStock.label}</div>
                    <div style={{ fontSize: 13, color: "#475569" }}>{selStock.name}</div>
                    <div style={{ fontSize: 10, color: "#4f46e5", marginTop: 3, textTransform: "uppercase", letterSpacing: 1 }}>NSE · {selStock.sector} · {sourceBadge.label}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 30, fontWeight: 800, color: "#f1f5f9" }}>Rs.{price.toFixed(2)}</div>
                    <div style={{ fontSize: 14, color: bull ? "#22c55e" : "#ef4444" }}>
                      {bull ? "+" : ""}{chgPct.toFixed(2)}%
                      <span style={{ fontSize: 11, color: "#374151", marginLeft: 6 }}>({bull ? "+" : ""}{chgAmt.toFixed(2)})</span>
                    </div>
                  </div>
                </div>

                {/* Signal */}
                <div style={{ background: `rgba(${selSig.signal === "BUY" ? "34,197,94" : selSig.signal === "SELL" ? "239,68,68" : "234,179,8"},0.07)`, border: `1.5px solid ${sigColor}40`, borderRadius: 14, padding: "18px 22px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Technical Signal (RSI + MA Crossover)</div>
                    <div style={{ fontSize: 34, fontWeight: 900, color: sigColor, letterSpacing: 2 }}>{selSig.signal === "BUY" ? "▲ BUY" : selSig.signal === "SELL" ? "▼ SELL" : "● HOLD"}</div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 6, maxWidth: 320 }}>
                      {selSig.signal === "BUY" ? "RSI oversold + bullish MA crossover — potential accumulation zone" : selSig.signal === "SELL" ? "RSI overbought + bearish MA crossover — consider profit booking" : "Neutral — hold position, wait for directional breakout"}
                    </div>
                  </div>
                  <div style={{ fontSize: 44, opacity: 0.7 }}>{selSig.signal === "BUY" ? "🟢" : selSig.signal === "SELL" ? "🔴" : "🟡"}</div>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "Day High",  val: `Rs.${high.toFixed(2)}` },
                    { label: "Day Low",   val: `Rs.${low.toFixed(2)}` },
                    { label: "52W High",  val: `Rs.${w52h.toFixed(2)}`, col: "#22c55e" },
                    { label: "52W Low",   val: `Rs.${w52l.toFixed(2)}`, col: "#ef4444" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 9, padding: "11px 14px" }}>
                      <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.col || "#f1f5f9" }}>{item.val}</div>
                    </div>
                  ))}
                </div>

                {/* Indicators */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "RSI (14)", val: selSig.rsi, note: parseFloat(selSig.rsi) < 30 ? "Oversold" : parseFloat(selSig.rsi) > 70 ? "Overbought" : "Neutral", col: parseFloat(selSig.rsi) < 30 ? "#22c55e" : parseFloat(selSig.rsi) > 70 ? "#ef4444" : "#64748b" },
                    { label: "MA 20",    val: `Rs.${selSig.ma20}`, note: price > parseFloat(selSig.ma20) ? "Price above MA" : "Price below MA", col: price > parseFloat(selSig.ma20) ? "#22c55e" : "#ef4444" },
                    { label: "MA 50",    val: `Rs.${selSig.ma50}`, note: parseFloat(selSig.ma20) > parseFloat(selSig.ma50) ? "Golden Cross" : "Death Cross", col: parseFloat(selSig.ma20) > parseFloat(selSig.ma50) ? "#22c55e" : "#ef4444" },
                  ].map((ind, i) => (
                    <div key={i} style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 10, padding: "13px 16px" }}>
                      <div style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>{ind.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 3 }}>{ind.val}</div>
                      <div style={{ fontSize: 10, color: ind.col }}>{ind.note}</div>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
                    <span>3-Month Price History</span>
                    {histLoading && <span style={{ color: "#6366f1" }}>Loading chart...</span>}
                  </div>
                  {selPrices.length > 5 ? (() => {
                    const W = 540, H = 120, mn = Math.min(...selPrices), mx = Math.max(...selPrices), rng = mx - mn || 1;
                    const pts = selPrices.map((p, i) => `${(i / (selPrices.length - 1)) * W},${H - ((p - mn) / rng) * H * 0.88 - 6}`).join(" ");
                    const cx = W, cy = H - ((selPrices[selPrices.length - 1] - mn) / rng) * H * 0.88 - 6;
                    return (
                      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
                        <defs><linearGradient id="cg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sigColor} stopOpacity="0.28" /><stop offset="100%" stopColor={sigColor} stopOpacity="0" /></linearGradient></defs>
                        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#cg3)" />
                        <polyline points={pts} fill="none" stroke={sigColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx={cx} cy={cy} r="4.5" fill={sigColor} />
                        <circle cx={cx} cy={cy} r="9" fill={sigColor} opacity="0.2" />
                      </svg>
                    );
                  })() : <div style={{ textAlign: "center", padding: 20, color: "#1f2937", fontSize: 11 }}>Click a stock to load chart data</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "#1f2937" }}>
                    <span>3 months ago</span>
                    <span>High: Rs.{selPrices.length ? Math.max(...selPrices).toFixed(2) : "—"}</span>
                    <span>Today: Rs.{price.toFixed(2)}</span>
                  </div>
                </div>

                {/* AI */}
                <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#818cf8" }}>Claude AI Expert Analysis</div>
                    <button onClick={() => getAI(selected)} disabled={aiLoading[selected]} style={{ background: aiLoading[selected] ? "#1f2937" : "#6366f1", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                      {aiLoading[selected] ? "Analysing..." : "Get AI Analysis"}
                    </button>
                  </div>
                  {aiText[selected]
                    ? <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.75, padding: 12, background: "rgba(99,102,241,0.05)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.12)" }}>{aiText[selected]}</div>
                    : <div style={{ fontSize: 11, color: "#1f2937", textAlign: "center", padding: 16 }}>Click "Get AI Analysis" for expert view on {selStock.label}</div>}
                </div>
              </>
            );
          })() : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 10 }}>
              <div style={{ fontSize: 13, color: "#374151" }}>Select a stock from the watchlist</div>
            </div>
          )}
        </div>
      </div>

      {/* WHATSAPP MODAL */}
      {showWA && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 16, padding: 28, width: 410 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>WhatsApp Alert Setup</div>
              <button onClick={() => setShowWA(false)} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 20 }}>X</button>
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 18, lineHeight: 1.7, background: "rgba(37,211,102,0.07)", border: "1px solid rgba(37,211,102,0.15)", borderRadius: 8, padding: "10px 12px" }}>
              Uses Twilio WhatsApp Sandbox (free at twilio.com). Alerts send when BUY/SELL/HOLD changes. First send "join [code]" to +1 415 523 8886 on WhatsApp.
            </div>
            {[
              { label: "Twilio Account SID", key: "sid", ph: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
              { label: "Twilio Auth Token",   key: "token", ph: "Your auth token", type: "password" },
              { label: "Your WhatsApp (+91)", key: "to",    ph: "+91XXXXXXXXXX" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: "#475569", display: "block", marginBottom: 5 }}>{f.label}</label>
                <input type={f.type || "text"} placeholder={f.ph} value={wa[f.key]} onChange={e => setWa(p => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: "100%", background: "#080c18", border: "1px solid #161b25", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <button onClick={() => setShowWA(false)} style={{ width: "100%", background: "#25d366", border: "none", borderRadius: 10, padding: 12, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14, marginTop: 4 }}>
              Save and Enable WhatsApp Alerts
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #080c18; }
        ::-webkit-scrollbar-thumb { background: #161b25; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );