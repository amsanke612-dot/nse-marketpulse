import { useState, useEffect, useRef, useCallback } from "react";

// ── CONFIG ───────────────────────────────────────────────────────
const NSE_STOCKS = [
  { symbol: "RELIANCE.NS",  label: "RELIANCE",  name: "Reliance Industries",       sector: "Energy"       },
  { symbol: "TCS.NS",       label: "TCS",        name: "Tata Consultancy Services", sector: "IT"           },
  { symbol: "HDFCBANK.NS",  label: "HDFCBANK",   name: "HDFC Bank",                 sector: "Banking"      },
  { symbol: "INFY.NS",      label: "INFY",        name: "Infosys",                   sector: "IT"           },
  { symbol: "ICICIBANK.NS", label: "ICICIBANK",   name: "ICICI Bank",                sector: "Banking"      },
  { symbol: "BAJFINANCE.NS",label: "BAJFINANCE",  name: "Bajaj Finance",             sector: "Finance"      },
  { symbol: "MARUTI.NS",    label: "MARUTI",      name: "Maruti Suzuki",             sector: "Auto"         },
  { symbol: "TATAMOTORS.NS",label: "TATAMOTORS",  name: "Tata Motors",               sector: "Auto"         },
  { symbol: "WIPRO.NS",     label: "WIPRO",       name: "Wipro",                     sector: "IT"           },
  { symbol: "HINDUNILVR.NS",label: "HINDUNILVR",  name: "Hindustan Unilever",        sector: "FMCG"         },
  { symbol: "ADANIENT.NS",  label: "ADANIENT",    name: "Adani Enterprises",         sector: "Conglomerate" },
  { symbol: "SUNPHARMA.NS", label: "SUNPHARMA",   name: "Sun Pharmaceutical",        sector: "Pharma"       },
];

const INDICES = [
  { symbol: "^NSEI",    label: "NIFTY 50"   },
  { symbol: "^BSESN",   label: "SENSEX"     },
  { symbol: "^NSEBANK", label: "BANK NIFTY" },
];

const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

// ── MARKET HOURS (NSE: Mon-Fri 09:15-15:30 IST) ──────────────────
function getMarketStatus() {
  const ist  = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day  = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (day === 0 || day === 6) return "CLOSED";
  if (mins >= 555 && mins <= 930) return "OPEN";
  if (mins >= 540 && mins < 555) return "PRE";
  return "CLOSED";
}

function nextOpenText() {
  const ist  = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day  = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (day >= 1 && day <= 5 && mins < 555) return "today at 9:15 AM IST";
  if (day === 5 || day === 6) return "Monday at 9:15 AM IST";
  return "tomorrow at 9:15 AM IST";
}

// 10s when open, 5min when closed
function getPollSec(status) {
  return status === "OPEN" ? 10 : 300;
}

// ── API ───────────────────────────────────────────────────────────
function quoteURL(syms) {
  return (
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + syms +
    "&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange," +
    "regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh," +
    "regularMarketDayLow,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketState"
  );
}
function chartURL(sym) {
  return "https://query1.finance.yahoo.com/v8/finance/chart/" + sym + "?interval=1d&range=3mo";
}

async function fetchYF(rawUrl) {
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(PROXIES[i](rawUrl), { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      if (json) return json;
    } catch (_) {}
  }
  return null;
}

// ── PRICE DISPLAY LOGIC ───────────────────────────────────────────
// OPEN  → live regularMarketPrice
// CLOSED → regularMarketPreviousClose
function displayPrice(q, status) {
  if (!q) return null;
  if (status === "OPEN" || status === "PRE") {
    return q.regularMarketPrice ?? q.regularMarketPreviousClose ?? null;
  }
  return q.regularMarketPreviousClose ?? q.regularMarketPrice ?? null;
}

function displayChange(q, status) {
  if (!q || status !== "OPEN") return { pct: 0, amt: 0 };
  return { pct: q.regularMarketChangePercent ?? 0, amt: q.regularMarketChange ?? 0 };
}

// ── INDICATORS ────────────────────────────────────────────────────
function calcRSI(prices, n = 14) {
  if (prices.length < n + 1) return 50;
  let g = 0, l = 0;
  for (let i = prices.length - n; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  const al = l / n;
  return al === 0 ? 100 : 100 - 100 / (1 + g / n / al);
}
function calcMA(prices, n) {
  if (prices.length < n) return prices[prices.length - 1] || 0;
  return prices.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function calcBB(prices, n = 20) {
  if (prices.length < n) return null;
  const sl  = prices.slice(-n);
  const mid = sl.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / n);
  return { upper: mid + 2 * std, lower: mid - 2 * std, mid };
}
function getSignal(prices) {
  if (!prices || prices.length < 10) {
    return { signal: "HOLD", rsi: "50.0", ma20: "0.00", ma50: "0.00", bb: null };
  }
  const rsi  = calcRSI(prices);
  const ma20 = calcMA(prices, Math.min(20, prices.length));
  const ma50 = calcMA(prices, Math.min(50, prices.length));
  const bb   = calcBB(prices);
  const cur  = prices[prices.length - 1];
  let sc = 0;
  if (rsi < 30) sc += 2; else if (rsi < 45) sc += 1;
  else if (rsi > 70) sc -= 2; else if (rsi > 60) sc -= 1;
  if (ma20 > ma50 && cur > ma20) sc += 2;
  else if (ma20 < ma50 && cur < ma20) sc -= 2;
  if (bb) {
    if (cur < bb.lower) sc += 1;
    else if (cur > bb.upper) sc -= 1;
  }
  return {
    signal: sc >= 2 ? "BUY" : sc <= -2 ? "SELL" : "HOLD",
    rsi: rsi.toFixed(1),
    ma20: ma20.toFixed(2),
    ma50: ma50.toFixed(2),
    bb,
  };
}

// ── SMALL UI COMPONENTS ───────────────────────────────────────────
function SparkLine({ prices, bullish }) {
  if (!prices || prices.length < 2) return <div style={{ width: 88, height: 32 }} />;
  const W = 88, H = 32;
  const mn  = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W;
    const y = H - ((p - mn) / rng) * (H - 4) - 2;
    return x + "," + y;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={bullish ? "#22c55e" : "#ef4444"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignalBadge({ signal }) {
  const map = {
    BUY:  { bg: "rgba(34,197,94,.15)",  border: "#22c55e", color: "#22c55e", icon: "▲" },
    SELL: { bg: "rgba(239,68,68,.15)",   border: "#ef4444", color: "#ef4444", icon: "▼" },
    HOLD: { bg: "rgba(234,179,8,.15)",   border: "#eab308", color: "#eab308", icon: "●" },
  };
  const c = map[signal] || { bg: "rgba(100,116,139,.15)", border: "#64748b", color: "#64748b", icon: "–" };
  return (
    <span style={{ background: c.bg, border: "1px solid " + c.border, color: c.color, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {c.icon} {signal}
    </span>
  );
}

function FlashPrice({ value, prefix }) {
  const pfx = prefix !== undefined ? prefix : "₹";
  const [flash, setFlash] = useState(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== null && value !== null && prev.current !== value) {
      setFlash(value > prev.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  const bg = flash === "up" ? "rgba(34,197,94,.28)" : flash === "down" ? "rgba(239,68,68,.28)" : "transparent";
  return (
    <span style={{ background: bg, borderRadius: 4, padding: "0 3px", transition: "background .15s" }}>
      {pfx}{value != null ? value.toFixed(2) : "—"}
    </span>
  );
}

function CountdownRing({ val, max }) {
  const r = 9, circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, val) / max);
  return (
    <svg width={24} height={24} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={12} cy={12} r={r} fill="none" stroke="#1e2d40" strokeWidth={2.5} />
      <circle cx={12} cy={12} r={r} fill="none" stroke="#6366f1" strokeWidth={2.5}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1s linear" }} />
    </svg>
  );
}

// ── PRICE CHART ───────────────────────────────────────────────────
function PriceChart({ prices, sigColor, bb }) {
  if (!prices || prices.length < 5) {
    return <div style={{ textAlign: "center", padding: 24, color: "#1e2d40", fontSize: 12 }}>Loading chart…</div>;
  }
  const W = 560, H = 130;
  const mn  = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const xp  = (i) => (i / (prices.length - 1)) * W;
  const yp  = (p)  => H - ((p - mn) / rng) * (H - 14) - 7;
  const pts = prices.map((p, i) => xp(i) + "," + yp(p)).join(" ");
  const ma20pts = prices.map((_, i) => {
    if (i < 19) return null;
    return xp(i) + "," + yp(calcMA(prices.slice(0, i + 1), 20));
  }).filter(Boolean).join(" ");

  return (
    <svg width="100%" viewBox={"0 0 " + W + " " + H}>
      <defs>
        <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sigColor} stopOpacity=".22" />
          <stop offset="100%" stopColor={sigColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {bb && (
        <>
          <line x1={0} y1={yp(bb.upper)} x2={W} y2={yp(bb.upper)} stroke="#818cf8" strokeWidth=".8" strokeDasharray="4,4" opacity=".5" />
          <line x1={0} y1={yp(bb.lower)} x2={W} y2={yp(bb.lower)} stroke="#818cf8" strokeWidth=".8" strokeDasharray="4,4" opacity=".5" />
          <line x1={0} y1={yp(bb.mid)}   x2={W} y2={yp(bb.mid)}   stroke="#818cf8" strokeWidth=".5" strokeDasharray="2,5" opacity=".3" />
        </>
      )}
      {ma20pts && <polyline points={ma20pts} fill="none" stroke="#f59e0b" strokeWidth="1.1" strokeDasharray="3,3" opacity=".75" />}
      <polygon points={"0," + H + " " + pts + " " + W + "," + H} fill="url(#areafill)" />
      <polyline points={pts} fill="none" stroke={sigColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xp(prices.length - 1)} cy={yp(prices[prices.length - 1])} r="4.5" fill={sigColor} />
      <circle cx={xp(prices.length - 1)} cy={yp(prices[prices.length - 1])} r="9"   fill={sigColor} opacity=".18" />
    </svg>
  );
}

// ── DETAIL PANEL (separate component avoids IIFE-in-JSX build error) ──
function DetailPanel({ stock, q, prices, sig, sigColor, histLoading, status, aiText, aiLoading, onGetAI, sym }) {
  if (!stock) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12, color: "#374151" }}>
        <span style={{ fontSize: 40 }}>📊</span>
        <span>Select a stock from the watchlist</span>
      </div>
    );
  }

  const dp     = displayPrice(q, status);
  const ch     = displayChange(q, status);
  const isOpen = status === "OPEN";
  const bull   = ch.pct >= 0;

  return (
    <>
      {/* Title row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", letterSpacing: -0.5 }}>{stock.label}</div>
          <div style={{ fontSize: 13, color: "#475569" }}>{stock.name}</div>
          <div style={{ fontSize: 9, color: "#4f46e5", marginTop: 3, textTransform: "uppercase", letterSpacing: 1 }}>
            NSE · {stock.sector} · {isOpen ? "Live Price" : "Prev Close"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#f1f5f9" }}>
            <FlashPrice value={dp} />
          </div>
          {isOpen && (
            <div style={{ fontSize: 14, color: bull ? "#22c55e" : "#ef4444" }}>
              {bull ? "▲" : "▼"} {Math.abs(ch.pct).toFixed(2)}%
              <span style={{ fontSize: 11, color: "#374151", marginLeft: 6 }}>
                ({ch.amt >= 0 ? "+" : ""}{ch.amt.toFixed(2)})
              </span>
            </div>
          )}
          {!isOpen && <div style={{ fontSize: 11, color: "#eab308", marginTop: 3 }}>● Previous Close</div>}
          {isOpen && q?.regularMarketVolume && (
            <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>
              Vol: {q.regularMarketVolume.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </div>

      {/* Signal */}
      <div style={{ background: "rgba(" + (sig.signal === "BUY" ? "34,197,94" : sig.signal === "SELL" ? "239,68,68" : "234,179,8") + ",.07)", border: "1.5px solid " + sigColor + "40", borderRadius: 14, padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
            Technical Signal · RSI + MA + Bollinger
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: sigColor, letterSpacing: 2 }}>
            {sig.signal === "BUY" ? "▲ BUY" : sig.signal === "SELL" ? "▼ SELL" : "● HOLD"}
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 5, maxWidth: 320 }}>
            {sig.signal === "BUY"
              ? "RSI oversold + bullish MA crossover — potential accumulation zone"
              : sig.signal === "SELL"
              ? "RSI overbought + bearish crossover — consider profit booking"
              : "Neutral — hold position, wait for directional confirmation"}
          </div>
        </div>
        <div style={{ fontSize: 40, opacity: 0.65 }}>
          {sig.signal === "BUY" ? "🟢" : sig.signal === "SELL" ? "🔴" : "🟡"}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 9, marginBottom: 12 }}>
        {[
          { l: "Prev Close", v: q?.regularMarketPreviousClose ? "₹" + q.regularMarketPreviousClose.toFixed(2) : "—" },
          { l: "Open",       v: isOpen && q?.regularMarketOpen ? "₹" + q.regularMarketOpen.toFixed(2) : "—" },
          { l: "Day High",   v: isOpen && q?.regularMarketDayHigh ? "₹" + q.regularMarketDayHigh.toFixed(2) : "—", c: "#22c55e" },
          { l: "Day Low",    v: isOpen && q?.regularMarketDayLow  ? "₹" + q.regularMarketDayLow.toFixed(2)  : "—", c: "#ef4444" },
          { l: "52W High",   v: q?.fiftyTwoWeekHigh ? "₹" + q.fiftyTwoWeekHigh.toFixed(2) : "—", c: "#22c55e" },
          { l: "52W Low",    v: q?.fiftyTwoWeekLow  ? "₹" + q.fiftyTwoWeekLow.toFixed(2)  : "—", c: "#ef4444" },
          { l: "BB Upper",   v: sig.bb ? "₹" + sig.bb.upper.toFixed(2) : "—" },
          { l: "BB Lower",   v: sig.bb ? "₹" + sig.bb.lower.toFixed(2) : "—" },
        ].map((x, i) => (
          <div key={i} style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 9, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{x.l}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: x.c || "#f1f5f9" }}>{x.v}</div>
          </div>
        ))}
      </div>

      {/* Indicators */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 9, marginBottom: 12 }}>
        {[
          {
            l: "RSI (14)", v: sig.rsi,
            n: +sig.rsi < 30 ? "Oversold ↑" : +sig.rsi > 70 ? "Overbought ↓" : "Neutral",
            c: +sig.rsi < 30 ? "#22c55e" : +sig.rsi > 70 ? "#ef4444" : "#64748b",
          },
          {
            l: "MA 20", v: "₹" + sig.ma20,
            n: dp > +sig.ma20 ? "Price above ✓" : "Price below ✗",
            c: dp > +sig.ma20 ? "#22c55e" : "#ef4444",
          },
          {
            l: "MA 50", v: "₹" + sig.ma50,
            n: +sig.ma20 > +sig.ma50 ? "Golden Cross ✓" : "Death Cross ✗",
            c: +sig.ma20 > +sig.ma50 ? "#22c55e" : "#ef4444",
          },
        ].map((x, i) => (
          <div key={i} style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 9, padding: "13px 15px" }}>
            <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>{x.l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 3 }}>{x.v}</div>
            <div style={{ fontSize: 10, color: x.c }}>{x.n}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 12, padding: 15, marginBottom: 13 }}>
        <div style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 9, display: "flex", justifyContent: "space-between" }}>
          <span>3-Month Price History · Daily Closes</span>
          <span style={{ color: histLoading ? "#6366f1" : "#1e2d40" }}>
            {histLoading ? "Loading…" : prices.length + " pts"}
          </span>
        </div>
        <PriceChart prices={prices} sigColor={sigColor} bb={sig.bb} />
        <div style={{ display: "flex", gap: 14, marginTop: 7, fontSize: 9, color: "#374151" }}>
          <span style={{ color: sigColor }}>— Price</span>
          <span style={{ color: "#f59e0b" }}>– – MA20</span>
          <span style={{ color: "#818cf8" }}>· · Bollinger</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#1e2d40" }}>
          <span>3mo ago · ₹{prices[0]?.toFixed(2) || "—"}</span>
          <span>Now · ₹{prices[prices.length - 1]?.toFixed(2) || "—"}</span>
        </div>
      </div>

      {/* AI */}
      <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 12, padding: 15 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#818cf8" }}>🤖 Claude AI Expert Analysis</div>
          <button
            onClick={() => onGetAI(sym)}
            disabled={aiLoading[sym]}
            style={{ background: aiLoading[sym] ? "#1e2d40" : "#6366f1", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
          >
            {aiLoading[sym] ? "⏳ Analysing…" : "Get AI Analysis"}
          </button>
        </div>
        {aiText[sym]
          ? <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8, padding: 12, background: "rgba(99,102,241,.05)", borderRadius: 8, border: "1px solid rgba(99,102,241,.13)" }}>{aiText[sym]}</div>
          : <div style={{ fontSize: 11, color: "#1e2d40", textAlign: "center", padding: 16 }}>Click "Get AI Analysis" for Claude's expert view on {stock.label}</div>
        }
      </div>
    </>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────
export default function App() {
  const [quotes,      setQuotes]      = useState({});
  const [indices,     setIndices]     = useState({});
  const [history,     setHistory]     = useState({});
  const [selected,    setSelected]    = useState("RELIANCE.NS");
  const [tab,         setTab]         = useState("watch");
  const [loading,     setLoading]     = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [fetchError,  setFetchError]  = useState("");
  const [updatedAt,   setUpdatedAt]   = useState(null);
  const [countdown,   setCountdown]   = useState(10);
  const [fetchCount,  setFetchCount]  = useState(0);
  const [aiText,      setAiText]      = useState({});
  const [aiLoading,   setAiLoading]   = useState({});
  const [showWA,      setShowWA]      = useState(false);
  const [wa,          setWa]          = useState({ sid: "", token: "", to: "" });
  const [alertLog,    setAlertLog]    = useState([]);

  const prevSig  = useRef({});
  const pollRef  = useRef(null);
  const cntRef   = useRef(null);

  const mktStatus = getMarketStatus();
  const isOpen    = mktStatus === "OPEN";
  const isPre     = mktStatus === "PRE";
  const pollSec   = getPollSec(mktStatus);
  const statusDot = isOpen ? "#22c55e" : isPre ? "#eab308" : "#ef4444";
  const statusLbl = isOpen ? "LIVE" : isPre ? "PRE-OPEN" : "CLOSED";

  // ── fetch ──
  const fetchQuotes = useCallback(async () => {
    try {
      const syms = [...NSE_STOCKS.map(s => s.symbol), ...INDICES.map(i => i.symbol)].join(",");
      const data  = await fetchYF(quoteURL(syms));
      const res   = data?.quoteResponse?.result || [];
      if (!res.length) throw new Error("empty");
      const q = {}, idx = {};
      res.forEach(r => {
        if (INDICES.some(i => i.symbol === r.symbol)) idx[r.symbol] = r;
        else q[r.symbol] = r;
      });
      setQuotes(q);
      setIndices(idx);
      setUpdatedAt(new Date());
      setFetchError("");
      setFetchCount(n => n + 1);
    } catch (_) {
      setFetchError("Fetch failed — retrying…");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (sym) => {
    if (history[sym]) return;
    setHistLoading(true);
    try {
      const data   = await fetchYF(chartURL(sym));
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
      if (closes.length) setHistory(prev => ({ ...prev, [sym]: closes }));
    } catch (_) {}
    setHistLoading(false);
  }, [history]);

  // ── polling ──
  useEffect(() => {
    fetchQuotes();
    setCountdown(pollSec);
    clearInterval(pollRef.current);
    clearInterval(cntRef.current);
    pollRef.current = setInterval(() => { fetchQuotes(); setCountdown(pollSec); }, pollSec * 1000);
    cntRef.current  = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(cntRef.current); };
  }, [mktStatus]);

  useEffect(() => { if (selected) fetchHistory(selected); }, [selected]);

  // ── signal alerts ──
  useEffect(() => {
    if (!Object.keys(quotes).length) return;
    NSE_STOCKS.forEach(s => {
      const h  = history[s.symbol] || [];
      const q  = quotes[s.symbol];
      if (!q) return;
      const dp = displayPrice(q, mktStatus);
      const { signal } = getSignal([...h, dp].filter(Boolean));
      const prev = prevSig.current[s.symbol];
      if (prev && prev !== signal) {
        setAlertLog(a => [{
          key: s.symbol + "-" + Date.now(),
          time: new Date().toLocaleTimeString("en-IN"),
          label: s.label, signal,
          price: dp?.toFixed(2),
        }, ...a.slice(0, 29)]);
      }
      prevSig.current[s.symbol] = signal;
    });
  }, [quotes, history]);

  // ── AI ──
  const getAI = async (sym) => {
    const stock = NSE_STOCKS.find(s => s.symbol === sym);
    const q     = quotes[sym];
    const h     = history[sym] || [];
    if (!stock || !q) return;
    setAiLoading(p => ({ ...p, [sym]: true }));
    try {
      const dp     = displayPrice(q, mktStatus);
      const prices = [...h.slice(-20), dp].filter(Boolean);
      const sig    = getSignal(prices);
      const res    = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content:
              "You are a SEBI-registered Indian market analyst. Analyse concisely:\n\n" +
              "Stock: " + stock.label + " (" + stock.name + ")\n" +
              "Sector: " + stock.sector + "\n" +
              "Market: " + (isOpen ? "LIVE" : "CLOSED — showing previous close") + "\n" +
              "Price: ₹" + dp?.toFixed(2) + "\n" +
              "52W High/Low: ₹" + q.fiftyTwoWeekHigh?.toFixed(2) + " / ₹" + q.fiftyTwoWeekLow?.toFixed(2) + "\n" +
              "RSI(14): " + sig.rsi + " | MA20: ₹" + sig.ma20 + " | MA50: ₹" + sig.ma50 + "\n" +
              (sig.bb ? "Bollinger: ₹" + sig.bb.upper.toFixed(2) + " / ₹" + sig.bb.lower.toFixed(2) + "\n" : "") +
              "Signal: " + sig.signal + "\n\n" +
              "Provide:\n1. 2-sentence " + sig.signal + " analysis\n" +
              "2. Key sector risk\n3. Short-term target ₹X–₹Y\n4. Confidence: Low/Medium/High\n\n" +
              "Under 100 words. India-specific.",
          }],
        }),
      });
      const d = await res.json();
      setAiText(p => ({ ...p, [sym]: d.content?.[0]?.text || "Analysis unavailable." }));
    } catch (_) {
      setAiText(p => ({ ...p, [sym]: "AI analysis failed — please retry." }));
    }
    setAiLoading(p => ({ ...p, [sym]: false }));
  };

  // ── derived ──
  const selStock  = NSE_STOCKS.find(s => s.symbol === selected);
  const selQ      = quotes[selected];
  const selH      = history[selected] || [];
  const selDP     = displayPrice(selQ, mktStatus);
  const selPrices = selDP ? [...selH, selDP].filter(Boolean) : selH;
  const selSig    = getSignal(selPrices);
  const sigColor  = selSig.signal === "BUY" ? "#22c55e" : selSig.signal === "SELL" ? "#ef4444" : "#eab308";

  return (
    <div style={{ minHeight: "100vh", background: "#080c18", color: "#e2e8f0", fontFamily: "'DM Sans','Inter','Segoe UI',sans-serif", display: "flex", flexDirection: "column", fontSize: 13 }}>

      {/* HEADER */}
      <header style={{ background: "#0d1117", borderBottom: "1px solid #161b25", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📈</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>NSE MarketPulse</div>
            <div style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot, display: "inline-block", boxShadow: isOpen ? "0 0 6px " + statusDot : "none" }} />
              <span style={{ color: statusDot, fontWeight: 600 }}>{statusLbl}</span>
              <span style={{ color: "#374151" }}>
                · {isOpen ? "Refresh every " + pollSec + "s" : "Previous close · opens " + nextOpenText()}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          {INDICES.map(idx => {
            const q   = indices[idx.symbol];
            const dp  = displayPrice(q, mktStatus);
            const chg = isOpen ? (q?.regularMarketChangePercent || 0) : 0;
            return (
              <div key={idx.symbol} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>{idx.label}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>
                  <FlashPrice value={dp} />
                </div>
                {isOpen && (
                  <div style={{ fontSize: 10, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                    {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CountdownRing val={countdown} max={pollSec} />
            <div style={{ fontSize: 10, color: "#374151" }}>
              <div>{countdown}s</div>
              <div style={{ color: "#1e2d40" }}>#{fetchCount}</div>
            </div>
          </div>

          <button onClick={() => { fetchQuotes(); setCountdown(pollSec); }} style={{ background: "#161b25", border: "1px solid #1f2937", borderRadius: 8, padding: "7px 12px", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>
            ⟳ Refresh
          </button>
          <button onClick={() => setShowWA(true)} style={{ background: "#25d366", border: "none", borderRadius: 8, padding: "7px 13px", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            💬 WA Alerts
          </button>
        </div>
      </header>

      {/* STATUS BANNER */}
      {!isOpen && !loading && (
        <div style={{ background: "#130e02", borderBottom: "1px solid #2a1800", padding: "6px 18px", fontSize: 11, color: "#92400e", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>⚠</span>
          <span>NSE is <strong style={{ color: "#f59e0b" }}>{statusLbl}</strong> — showing <strong>previous closing prices</strong>.{!isPre && " Opens " + nextOpenText() + "."}</span>
          {updatedAt && <span style={{ marginLeft: "auto", color: "#374151" }}>Fetched: {updatedAt.toLocaleTimeString("en-IN")}</span>}
        </div>
      )}
      {fetchError && (
        <div style={{ background: "#120808", borderBottom: "1px solid #2a0f0f", padding: "6px 18px", fontSize: 11, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
          ⚠ {fetchError}
          <button onClick={fetchQuotes} style={{ background: "#7f1d1d", border: "none", borderRadius: 4, padding: "2px 8px", color: "#fca5a5", cursor: "pointer", fontSize: 10, marginLeft: 6 }}>Retry</button>
        </div>
      )}

      {/* TICKER */}
      {!loading && Object.keys(quotes).length > 0 && (
        <div style={{ background: "#090d18", borderBottom: "1px solid #161b25", padding: "5px 0", overflow: "hidden", whiteSpace: "nowrap" }}>
          <div style={{ display: "inline-flex", gap: 28, animation: "ticker 60s linear infinite" }}>
            {[...NSE_STOCKS, ...NSE_STOCKS].map((s, i) => {
              const q   = quotes[s.symbol];
              const dp  = displayPrice(q, mktStatus);
              const chg = isOpen ? (q?.regularMarketChangePercent || 0) : 0;
              return (
                <span key={i} style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setSelected(s.symbol)}>
                  <strong style={{ color: "#818cf8" }}>{s.label}</strong>
                  <span style={{ color: "#94a3b8", margin: "0 5px" }}>₹{dp?.toFixed(2) || "—"}</span>
                  {isOpen
                    ? <span style={{ color: chg >= 0 ? "#22c55e" : "#ef4444" }}>{chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%</span>
                    : <span style={{ color: "#374151" }}>●</span>
                  }
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* TABS */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #161b25", display: "flex", alignItems: "center", padding: "0 18px" }}>
        {[
          ["watch", "📊 Watchlist"],
          ["ai",    "🤖 AI Analysis"],
          ["alerts", "🔔 Alerts" + (alertLog.length ? " (" + alertLog.length + ")" : "")],
        ].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", padding: "12px 16px", cursor: "pointer", fontSize: 12, color: tab === id ? "#818cf8" : "#374151", fontWeight: tab === id ? 700 : 400, borderBottom: tab === id ? "2px solid #6366f1" : "2px solid transparent" }}>
            {lbl}
          </button>
        ))}
        {updatedAt && (
          <div style={{ marginLeft: "auto", fontSize: 10, color: "#1e2d40" }}>
            <span style={{ color: statusDot }}>●</span> {updatedAt.toLocaleTimeString("en-IN")}
          </div>
        )}
      </div>

      {/* BODY */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14 }}>
          <div style={{ width: 36, height: 36, border: "3px solid #161b25", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
          <div style={{ fontSize: 12, color: "#374151" }}>Fetching NSE data from Yahoo Finance…</div>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* LEFT */}
          <div style={{ width: 308, flexShrink: 0, borderRight: "1px solid #161b25", overflowY: "auto", background: "#0b0f1a" }}>
            <div style={{ padding: 9 }}>

              {tab === "watch" && NSE_STOCKS.map(s => {
                const q    = quotes[s.symbol];
                const dp   = displayPrice(q, mktStatus);
                const chg  = isOpen ? (q?.regularMarketChangePercent || 0) : 0;
                const h    = history[s.symbol] || [];
                const px   = [...h.slice(-20), dp].filter(Boolean);
                const sig  = getSignal(px);
                const isSel = selected === s.symbol;
                const bull  = chg >= 0;
                return (
                  <div key={s.symbol} onClick={() => setSelected(s.symbol)}
                    style={{ background: isSel ? "rgba(99,102,241,.10)" : "rgba(255,255,255,.015)", border: "1px solid " + (isSel ? "#6366f1" : "#161b25"), borderRadius: 10, padding: "11px 12px", marginBottom: 7, cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 7 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{s.label}</div>
                        <div style={{ fontSize: 9, color: "#374151", marginTop: 1 }}>{s.name}</div>
                        <div style={{ fontSize: 8, color: "#4f46e5", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.sector}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, color: "#f1f5f9" }}><FlashPrice value={dp} /></div>
                        {isOpen
                          ? <div style={{ fontSize: 10, color: bull ? "#22c55e" : "#ef4444" }}>{bull ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</div>
                          : <div style={{ fontSize: 9, color: "#374151" }}>Prev Close</div>
                        }
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <SparkLine prices={px} bullish={bull} />
                      <SignalBadge signal={sig.signal} />
                    </div>
                  </div>
                );
              })}

              {tab === "ai" && NSE_STOCKS.map(s => {
                const q  = quotes[s.symbol];
                const dp = displayPrice(q, mktStatus);
                return (
                  <div key={s.symbol} style={{ background: "rgba(255,255,255,.015)", border: "1px solid #161b25", borderRadius: 10, padding: "11px 12px", marginBottom: 7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: aiText[s.symbol] ? 8 : 0 }}>
                      <div>
                        <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{s.label}</span>
                        <span style={{ fontSize: 10, color: "#374151", marginLeft: 6 }}>₹{dp?.toFixed(2) || "—"}</span>
                      </div>
                      <button onClick={() => { setSelected(s.symbol); getAI(s.symbol); }} disabled={aiLoading[s.symbol]}
                        style={{ background: aiLoading[s.symbol] ? "#1e2d40" : "#6366f1", border: "none", borderRadius: 6, padding: "5px 10px", color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
                        {aiLoading[s.symbol] ? "⏳" : "🤖 Analyse"}
                      </button>
                    </div>
                    {aiText[s.symbol] && (
                      <div style={{ background: "rgba(99,102,241,.07)", border: "1px solid rgba(99,102,241,.18)", borderRadius: 7, padding: "8px 10px", fontSize: 10, color: "#94a3b8", lineHeight: 1.6 }}>
                        {aiText[s.symbol]}
                      </div>
                    )}
                  </div>
                );
              })}

              {tab === "alerts" && (
                alertLog.length === 0
                  ? (
                    <div style={{ textAlign: "center", padding: "32px 16px", color: "#1e2d40", fontSize: 12 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
                      No signal changes yet.<br />
                      <span style={{ fontSize: 10, color: "#374151" }}>Fires when BUY / SELL / HOLD flips.</span>
                    </div>
                  )
                  : alertLog.map(a => (
                    <div key={a.key} style={{ background: "rgba(255,255,255,.015)", border: "1px solid #161b25", borderRadius: 9, padding: "10px 12px", marginBottom: 7 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <strong style={{ color: "#818cf8", fontSize: 12 }}>{a.label}</strong>
                        <span style={{ fontSize: 10, color: "#374151" }}>{a.time}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <SignalBadge signal={a.signal} />
                        <span style={{ fontSize: 11, color: "#475569" }}>₹{a.price}</span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#080c18" }}>
            <DetailPanel
              stock={selStock} q={selQ} prices={selPrices} sig={selSig}
              sigColor={sigColor} histLoading={histLoading} status={mktStatus}
              aiText={aiText} aiLoading={aiLoading} onGetAI={getAI} sym={selected}
            />
          </div>
        </div>
      )}

      {/* WHATSAPP MODAL */}
      {showWA && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#0d1117", border: "1px solid #161b25", borderRadius: 16, padding: 28, width: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>💬 WhatsApp Alert Setup</div>
              <button onClick={() => setShowWA(false)} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 20 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 18, lineHeight: 1.7, background: "rgba(37,211,102,.07)", border: "1px solid rgba(37,211,102,.2)", borderRadius: 8, padding: "10px 12px" }}>
              Uses <strong style={{ color: "#25d366" }}>Twilio WhatsApp Sandbox</strong> (free at twilio.com).<br />
              First send <em style={{ color: "#f1f5f9" }}>"join [your-code]"</em> to <strong>+1 415 523 8886</strong> on WhatsApp.
            </div>
            {[
              { l: "Twilio Account SID",      k: "sid",   p: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
              { l: "Twilio Auth Token",        k: "token", p: "Your auth token", t: "password" },
              { l: "Your WhatsApp No. (+91…)", k: "to",    p: "+91XXXXXXXXXX" },
            ].map(f => (
              <div key={f.k} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: "#475569", display: "block", marginBottom: 5 }}>{f.l}</label>
                <input type={f.t || "text"} placeholder={f.p} value={wa[f.k]} onChange={e => setWa(p => ({ ...p, [f.k]: e.target.value }))}
                  style={{ width: "100%", background: "#080c18", border: "1px solid #161b25", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <button onClick={() => setShowWA(false)} style={{ width: "100%", background: "#25d366", border: "none", borderRadius: 10, padding: 12, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
              ✅ Save & Enable WhatsApp Alerts
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#080c18}
        ::-webkit-scrollbar-thumb{background:#161b25;border-radius:2px}
        *{box-sizing:border-box}
      `}</style>
    </div>
  );
}