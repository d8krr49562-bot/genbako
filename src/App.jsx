import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, ChevronLeft, ChevronRight, ChevronDown, X, Check, FileText, Pencil, Loader2, Trash2, Zap, Search, Settings } from "lucide-react";

const yen = (n) => `¥${Number(n || 0).toLocaleString()}`;
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthKey = (y, m) => `${y}-${pad(m)}`;
const todayObj = new Date();

const STORAGE_KEY = "invoice-app-data-v2";

// 諸経費リストの合計金額
const expensesTotal = (expenses) => (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
// 昔のバージョンで「諸経費」として保存されてしまった交通費・燃料費・高速代を判定(表示の振り分け用)
const isTransportLikeLabel = (label) => /交通費|燃料|高速/.test(label || "");
// expensesを「移動経費っぽいもの」と「それ以外の諸経費」に振り分ける
const splitLegacyTransportExpenses = (expenses) => {
  const transportLike = [];
  const other = [];
  (expenses || []).forEach((e) => (isTransportLikeLabel(e.label) ? transportLike.push(e) : other.push(e)));
  return { transportLike, other };
};
// 燃料費1件分の金額(距離×単価、往復で×2)
const transportItemTotal = (t) => {
  if (t.__legacyAmount !== undefined) return Number(t.__legacyAmount || 0);
  const fuel = Number(t.km || 0) * Number(t.ratePerKm || 0) * (t.roundTripKm ? 2 : 1);
  // 昔のデータ(高速代が同じ項目に混ざっていたもの)への後方互換
  const legacyHighway = t.useHighway ? Number(t.highwayOneWay || 0) * (t.roundTrip ? 2 : 1) : 0;
  return Math.round(fuel + legacyHighway);
};
// 燃料費リストの合計金額
const transportsTotal = (transports) => (transports || []).reduce((s, t) => s + transportItemTotal(t), 0);
// 高速代1件分の金額(金額×往復)
const highwayItemTotal = (h) => Math.round(Number(h.amount || 0) * (h.roundTrip ? 2 : 1));
// 高速代リストの合計金額
const highwaysTotal = (highways) => (highways || []).reduce((s, h) => s + highwayItemTotal(h), 0);
// 税金の金額計算(人工・残業代・諸経費それぞれで使う)
const ninkuTaxAmount = (p) => (p.taxEnabled ? Math.round((p.ninku || 0) * (Number(p.taxRate || 0) / 100)) : 0);
const overtimeTaxAmount = (p) => (p.taxEnabled ? Math.round((p.overtimeAmount || 0) * (Number(p.taxRate || 0) / 100)) : 0);
const expensesTaxAmount = (p) => (p.taxEnabled ? Math.round(expensesTotal(p.expenses) * (Number(p.taxRate || 0) / 100)) : 0);
const totalTax = (p) => ninkuTaxAmount(p) + overtimeTaxAmount(p) + expensesTaxAmount(p);
// 1件分の仕事の合計金額(本人分 + 追加の人数分をすべて含む)
const personAmount = (p) => (p.ninku || 0) + (p.overtimeAmount || 0) + expensesTotal(p.expenses) + transportsTotal(p.transports) + highwaysTotal(p.highways) + totalTax(p);
const jobTotal = (j) => personAmount(j) + (j.extraPeople || []).reduce((s, p) => s + personAmount(p), 0);
// その日全体(複数件)の合計金額
const dayTotal = (jobs) => (jobs || []).reduce((s, j) => s + jobTotal(j), 0);

// 諸経費のよく使う項目名プリセット
const EXPENSE_LABEL_PRESETS = ["宿泊費"];

const emptyTransport = () => ({ id: Date.now() + Math.random(), memo: "", km: "", ratePerKm: "20", roundTripKm: false });
const emptyHighway = () => ({ id: Date.now() + Math.random(), fromIC: "", toIC: "", amount: "", roundTrip: false });

const emptyJob = () => ({
  company: "", site: "", siteAddress: "", personName: "", ninku: 0, overtimeMode: "time", overtimeMin: 0,
  overtimeRatePerHour: 2500, overtimeAmount: 0, expenses: [], transports: [], highways: [], extraPeople: [], memo: "",
  taxEnabled: false, taxRate: 10,
});

export default function InvoiceApp() {
  const [year, setYear] = useState(todayObj.getFullYear());
  const [month, setMonth] = useState(todayObj.getMonth() + 1);
  const [view, setView] = useState("calendar"); // calendar | dayJobs | jobEdit | invoice
  const [selectedDate, setSelectedDate] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null); // どの仕事を編集中か(nullなら新規追加)
  const [prefillJob, setPrefillJob] = useState(null); // 「人を追加する」で使う、会社・現場だけ引き継いだ下書き
  const [peekDate, setPeekDate] = useState(null);

  const [entries, setEntries] = useState({}); // { "2026-08-07": [job, job, ...] }
  const [companies, setCompanies] = useState(["A社", "B社"]);
  const [sitePresets, setSitePresets] = useState([]); // 現場名プリセット
  const [namePresets, setNamePresets] = useState([]); // 名前プリセット
  const [ninkuPresets, setNinkuPresets] = useState([25000, 20000, 18000]);
  const [overtimeRatePresets, setOvertimeRatePresets] = useState([2500]); // 時給換算プリセット
  const [comboPresets, setComboPresets] = useState([]); // セットプリセット
  const [routes, setRoutes] = useState([]); // 燃料費プリセット { id, label, km }
  const [highwayPresets, setHighwayPresets] = useState([]); // 高速代プリセット { id, label, amount }
  const [profile, setProfile] = useState({ issuerName: "", bankInfo: "", closingDay: "末日", invoiceNumber: "" }); // 発行者名・振込先・締め日・登録番号(共通設定)
  const [paymentStatus, setPaymentStatus] = useState({}); // { "2026-8-A社": true, ... } 入金済みかどうか
  const [pdfLayout, setPdfLayout] = useState("portrait"); // "portrait"(縦表示・今の形) | "landscape"(横表示・日付が横並び)

  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setEntries(data.entries || {});
        setCompanies(data.companies || ["A社", "B社"]);
        setSitePresets(data.sitePresets || []);
        setNamePresets(data.namePresets || []);
        setNinkuPresets(data.ninkuPresets || [25000, 20000, 18000]);
        setOvertimeRatePresets(data.overtimeRatePresets || [2500]);
        setComboPresets(data.comboPresets || []);
        setRoutes(data.routes || []);
        setHighwayPresets(data.highwayPresets || []);
        setProfile(data.profile || { issuerName: "", bankInfo: "", closingDay: "末日", invoiceNumber: "" });
        setPaymentStatus(data.paymentStatus || {});
        setPdfLayout(data.pdfLayout || "portrait");
      }
    } catch (e) {
      // 初回起動、または読み込み失敗。初期状態のまま進める
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    setSaveStatus("saving");
    try {
      const payload = JSON.stringify({ entries, companies, sitePresets, namePresets, ninkuPresets, overtimeRatePresets, comboPresets, routes, highwayPresets, profile, paymentStatus, pdfLayout });
      localStorage.setItem(STORAGE_KEY, payload);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e && e.message ? e.message : String(e));
    }
  }, [entries, companies, sitePresets, namePresets, ninkuPresets, overtimeRatePresets, comboPresets, routes, highwayPresets, profile, paymentStatus, pdfLayout, loading]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  const monthTotal = useMemo(() => {
    let t = 0;
    Object.entries(entries).forEach(([k, jobs]) => {
      if (k.startsWith(monthKey(year, month))) t += dayTotal(jobs);
    });
    return t;
  }, [entries, year, month]);

  // カレンダー画面の「今月の合計」に出す入金状況バッジ用
  const monthCompaniesForPayment = useMemo(() => {
    const set = new Set();
    Object.entries(entries).forEach(([k, jobs]) => {
      if (k.startsWith(monthKey(year, month))) (jobs || []).forEach((j) => set.add(j.company || "全体"));
    });
    return Array.from(set);
  }, [entries, year, month]);
  const paymentKeyForCalendar = (companyName) => `${year}-${month}-${companyName}`;
  const paidCompaniesCount = monthCompaniesForPayment.filter((c) => paymentStatus[paymentKeyForCalendar(c)]).length;
  const paymentBadge =
    monthCompaniesForPayment.length === 0 ? null :
    paidCompaniesCount === monthCompaniesForPayment.length ? { text: "入金済み", color: "#2E7D4F", bg: "rgba(46,125,79,0.85)" } :
    paidCompaniesCount > 0 ? { text: "一部入金済み", color: "#8A6A1E", bg: "rgba(245,166,35,0.85)" } :
    null;
  const toggleSingleCompanyPaidFromCalendar = (e) => {
    if (monthCompaniesForPayment.length !== 1) return; // 複数会社ある月は請求内容画面で個別に管理
    e.stopPropagation();
    const key = paymentKeyForCalendar(monthCompaniesForPayment[0]);
    setPaymentStatus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y); setPeekDate(null);
  };

  const tapDay = (k) => setPeekDate((prev) => (prev === k ? null : k));

  const openDayJobs = (k) => { setSelectedDate(k); setView("dayJobs"); };

  const addJobToDay = (dateKey, job) => {
    setEntries((prev) => {
      const list = prev[dateKey] ? [...prev[dateKey]] : [];
      list.push(job);
      return { ...prev, [dateKey]: list };
    });
  };
  const updateJobInDay = (dateKey, idx, job) => {
    setEntries((prev) => {
      const list = prev[dateKey] ? [...prev[dateKey]] : [];
      list[idx] = job;
      return { ...prev, [dateKey]: list };
    });
  };
  const removeJobFromDay = (dateKey, idx) => {
    setEntries((prev) => {
      const list = (prev[dateKey] || []).filter((_, i) => i !== idx);
      return { ...prev, [dateKey]: list };
    });
  };

  const addComboPreset = (job) => {
    setComboPresets((prev) => [...prev, { ...job, id: Date.now() }]);
  };
  const removeComboPreset = (id) => {
    setComboPresets((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#1C1F26", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={28} color="#F5A623" style={{ animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
      </div>
    );
  }

  if (view === "dayJobs" && selectedDate) {
    return (
      <DayJobsView
        dateKey={selectedDate}
        jobs={entries[selectedDate] || []}
        comboPresets={comboPresets}
        sitePresets={sitePresets}
        companies={companies}
        ninkuPresets={ninkuPresets}
        onBack={() => { setView("calendar"); setPeekDate(selectedDate); }}
        onAddQuick={(preset) => {
          const { id, ...job } = preset;
          addJobToDay(selectedDate, { ...job });
        }}
        onCreateCombo={addComboPreset}
        onOpenNew={() => { setEditingIndex(null); setPrefillJob(null); setView("jobEdit"); }}
        onOpenEdit={(idx) => { setEditingIndex(idx); setView("jobEdit"); }}
        onRemove={(idx) => removeJobFromDay(selectedDate, idx)}
        onRemoveCombo={removeComboPreset}
        onSetSite={(idx, site) => {
          const jobs = entries[selectedDate] || [];
          if (!jobs[idx]) return;
          updateJobInDay(selectedDate, idx, { ...jobs[idx], site });
        }}
        setSitePresets={setSitePresets}
      />
    );
  }

  if (view === "jobEdit" && selectedDate) {
    const jobs = entries[selectedDate] || [];
    const initial = editingIndex !== null ? jobs[editingIndex] : (prefillJob || emptyJob());
    return (
      <JobDetail
        dateKey={selectedDate}
        job={initial}
        onSave={(jobsArray) => {
          // jobsArray: [本人分, 追加した人の分, ...]
          if (editingIndex !== null) {
            updateJobInDay(selectedDate, editingIndex, jobsArray[0]);
            jobsArray.slice(1).forEach((j) => addJobToDay(selectedDate, j));
          } else {
            jobsArray.forEach((j) => addJobToDay(selectedDate, j));
          }
          setPrefillJob(null);
          setView("dayJobs");
        }}
        onBack={() => { setPrefillJob(null); setView("dayJobs"); }}
        companies={companies}
        setCompanies={setCompanies}
        sitePresets={sitePresets}
        setSitePresets={setSitePresets}
        namePresets={namePresets}
        setNamePresets={setNamePresets}
        ninkuPresets={ninkuPresets}
        setNinkuPresets={setNinkuPresets}
        overtimeRatePresets={overtimeRatePresets}
        setOvertimeRatePresets={setOvertimeRatePresets}
        onSaveCombo={addComboPreset}
        comboPresets={comboPresets}
        routes={routes}
        setRoutes={setRoutes}
        highwayPresets={highwayPresets}
        setHighwayPresets={setHighwayPresets}
        entries={entries}
      />
    );
  }

  if (view === "invoice") {
    return (
      <InvoiceView
        year={year} month={month} entries={entries}
        onBack={() => setView("calendar")}
        profile={profile} setProfile={setProfile}
        paymentStatus={paymentStatus} setPaymentStatus={setPaymentStatus}
        pdfLayout={pdfLayout}
        onOpenDate={(k) => { setSelectedDate(k); setView("dayJobs"); }}
      />
    );
  }

  if (view === "bulkAdd") {
    return (
      <BulkAddView
        initialYear={year}
        initialMonth={month}
        entries={entries}
        comboPresets={comboPresets}
        sitePresets={sitePresets}
        onBack={() => setView("calendar")}
        onApply={(dateKeys, job) => {
          setEntries((prev) => {
            const next = { ...prev };
            dateKeys.forEach((k) => {
              const list = next[k] ? [...next[k]] : [];
              list.push(job);
              next[k] = list;
            });
            return next;
          });
          setView("calendar");
        }}
        onBulkDelete={(dateKeys) => {
          setEntries((prev) => {
            const next = { ...prev };
            dateKeys.forEach((k) => {
              delete next[k];
            });
            return next;
          });
          setView("calendar");
        }}
        onBulkTax={(dateKeys, enabled, rate) => {
          setEntries((prev) => {
            const next = { ...prev };
            dateKeys.forEach((k) => {
              if (!next[k]) return;
              next[k] = next[k].map((j) => ({
                ...j,
                taxEnabled: enabled,
                taxRate: rate,
                extraPeople: (j.extraPeople || []).map((p) => ({ ...p, taxEnabled: enabled, taxRate: rate })),
              }));
            });
            return next;
          });
          setView("calendar");
        }}
      />
    );
  }

  if (view === "history") {
    return (
      <HistoryView
        entries={entries}
        companies={companies}
        sitePresets={sitePresets}
        onBack={() => setView("calendar")}
        onOpenDate={(k) => { setSelectedDate(k); setView("dayJobs"); }}
      />
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        pdfLayout={pdfLayout}
        setPdfLayout={setPdfLayout}
        onBack={() => setView("calendar")}
      />
    );
  }


  const peekJobs = peekDate ? (entries[peekDate] || []) : [];
  const peekHasData = peekJobs.length > 0;
  const peekTotal = dayTotal(peekJobs);

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 40px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ color: "#F5A623", fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: 0.5 }}>現場帳</h1>
          <SaveIndicator status={saveStatus} error={saveError} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#242832", borderRadius: 14, padding: "10px 14px", marginTop: 16, border: "1px solid #333846" }}>
          <button onClick={() => changeMonth(-1)} style={iconBtnStyle}><ChevronLeft size={20} color="#F5A623" /></button>
          <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{year}年 {month}月</div>
          <button onClick={() => changeMonth(1)} style={iconBtnStyle}><ChevronRight size={20} color="#F5A623" /></button>
        </div>

        <button
          onClick={() => setView("invoice")}
          style={{ marginTop: 12, width: "100%", textAlign: "left", cursor: "pointer", background: "linear-gradient(135deg,#F5A623,#E8871E)", border: "none", borderRadius: 14, padding: "14px 18px", position: "relative" }}
        >
          {paymentBadge && (
            <span
              onClick={toggleSingleCompanyPaidFromCalendar}
              style={{
                position: "absolute", top: 10, right: 14, background: paymentBadge.bg, color: "#fff",
                fontSize: 10, fontWeight: 800, borderRadius: 20, padding: "3px 9px",
                cursor: monthCompaniesForPayment.length === 1 ? "pointer" : "default",
              }}
            >
              {paymentBadge.text}
            </span>
          )}
          <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>今月の合計（タップで請求内容を確認）</div>
          <div style={{ color: "#1C1F26", fontSize: 26, fontWeight: 800 }}>{yen(monthTotal)}</div>
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginTop: 20, marginBottom: 6 }}>
          {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, color: i === 0 ? "#E85D5D" : i === 6 ? "#5D9CE8" : "#8A8F9C", fontWeight: 700 }}>{d}</div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
          {Array.from({ length: firstWeekday }).map((_, i) => <div key={"empty" + i} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const k = keyOf(year, month, day);
            const jobs = entries[k] || [];
            const hasData = jobs.length > 0;
            const total = dayTotal(jobs);
            const isToday = year === todayObj.getFullYear() && month === todayObj.getMonth() + 1 && day === todayObj.getDate();
            const isPeeking = peekDate === k;
            return (
              <button
                key={day}
                onClick={() => tapDay(k)}
                style={{
                  aspectRatio: "1", borderRadius: 10,
                  border: isPeeking ? "1.5px solid #F5A623" : isToday ? "1.5px solid #6B7280" : "1px solid #2E323C",
                  background: isPeeking ? "rgba(245,166,35,0.18)" : hasData ? "#2E3A2E" : "#242832",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", padding: 2, gap: 1, position: "relative",
                }}
              >
                <span style={{ color: isPeeking ? "#F5A623" : hasData ? "#8FD19E" : "#C7CBD4", fontSize: 13, fontWeight: isToday || isPeeking ? 800 : 600 }}>{day}</span>
                {hasData && <span style={{ color: isPeeking ? "#F5A623" : "#8FD19E", fontSize: 8, fontWeight: 700 }}>{total >= 10000 ? `${Math.round(total / 1000)}k` : total}</span>}
                {jobs.length > 1 && (
                  <span style={{ position: "absolute", top: 2, right: 2, background: "#F5A623", color: "#1C1F26", fontSize: 7, fontWeight: 800, borderRadius: 6, padding: "0 3px" }}>
                    {jobs.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {peekDate && (
          <div style={{ marginTop: 14, background: "#242832", border: "1px solid #F5A623", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: peekHasData ? 10 : 0 }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>{month}月{Number(peekDate.split("-")[2])}日</span>
              <span style={{ color: "#F5A623", fontSize: 16, fontWeight: 800 }}>{yen(peekTotal)}</span>
            </div>
            {peekHasData && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {peekJobs.map((j, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", background: "#1C1F26", borderRadius: 8, padding: "6px 10px" }}>
                    <span style={{ color: "#C7CBD4", fontSize: 12 }}>{j.company || "未設定"}{j.site ? `　${j.site}` : ""}</span>
                    <span style={{ color: "#8FD19E", fontSize: 12, fontWeight: 700 }}>{yen(jobTotal(j))}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => openDayJobs(peekDate)}
              style={{ width: "100%", background: "#F5A623", border: "none", borderRadius: 10, padding: "10px", color: "#1C1F26", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
            >
              {peekHasData ? "詳しく見る・修正する" : "入力する"}
            </button>
          </div>
        )}

        <button
          onClick={() => setView("bulkAdd")}
          style={{ marginTop: 14, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 12, padding: "11px", color: "#F5A623", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Zap size={14} /> まとめて予定を編集する
        </button>
        <button
          onClick={() => setView("history")}
          style={{ marginTop: 8, width: "100%", background: "#242832", border: "1px dashed #6B7280", borderRadius: 12, padding: "11px", color: "#8A8F9C", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Search size={14} /> 会社ごとの履歴を見る
        </button>
        <button
          onClick={() => setView("settings")}
          style={{ marginTop: 8, width: "100%", background: "#242832", border: "1px dashed #6B7280", borderRadius: 12, padding: "11px", color: "#8A8F9C", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Settings size={14} /> 設定
        </button>

        <p style={{ color: "#5A5F6B", fontSize: 11, textAlign: "center", marginTop: 20 }}>
          日付をタップするとその場で金額を確認できます。1日に複数件の仕事も追加できます。
        </p>
      </div>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { width: 100%; overflow-x: hidden; }
        input, textarea, button { max-width: 100%; }
      `}</style>
    </div>
  );
}

function SaveIndicator({ status, error }) {
  const map = {
    idle: { text: "", color: "#5A5F6B" },
    saving: { text: "保存中…", color: "#8A8F9C" },
    saved: { text: "保存済み", color: "#8FD19E" },
    error: { text: "保存に失敗", color: "#E85D5D" },
  };
  const s = map[status] || map.idle;
  if (!s.text) return <span />;
  return <span style={{ color: s.color, fontSize: 11, fontWeight: 600 }} title={error || ""}>{s.text}</span>;
}

const iconBtnStyle = { background: "transparent", border: "none", padding: 6, cursor: "pointer", display: "flex" };

// ------------------- その日の仕事一覧画面 -------------------
function DayJobsView({ dateKey, jobs, comboPresets, sitePresets, companies, ninkuPresets, onBack, onAddQuick, onCreateCombo, onOpenNew, onOpenEdit, onRemove, onRemoveCombo, onSetSite, setSitePresets }) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const total = dayTotal(jobs);
  const [editingCombos, setEditingCombos] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const [confirmRemoveCombo, setConfirmRemoveCombo] = useState(null);
  const [siteQuickIdx, setSiteQuickIdx] = useState(null); // 現場名をワンタップ設定中の仕事のインデックス
  const [showPickJobForSite, setShowPickJobForSite] = useState(false); // 現場を変更する仕事を選ぶ画面
  const [showCreateCombo, setShowCreateCombo] = useState(false);
  const [newComboCompany, setNewComboCompany] = useState("");
  const [newComboSite, setNewComboSite] = useState("");
  const [newComboNinku, setNewComboNinku] = useState(0);

  const createComboFromScratch = () => {
    if (!newComboCompany) return;
    onCreateCombo({
      company: newComboCompany, site: newComboSite, siteAddress: "", personName: "",
      ninku: Number(newComboNinku), overtimeMode: "manual", overtimeMin: 0, overtimeRatePerHour: 0, overtimeAmount: 0,
      expenses: [], transports: [], highways: [], extraPeople: [], memo: "",
    });
    setShowCreateCombo(false);
    setNewComboCompany("");
    setNewComboSite("");
    setNewComboNinku(0);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div>
            <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>{m}月{d}日</div>
            <div style={{ color: "#6B7280", fontSize: 11 }}>{y}年</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              <Zap size={13} color="#F5A623" /> ワンタップで追加
            </div>
            {comboPresets.length > 0 && (
              <button
                onClick={() => setEditingCombos((v) => !v)}
                style={{
                  background: editingCombos ? "#F5A623" : "#242832",
                  border: "1px solid #F5A623",
                  borderRadius: 8,
                  color: editingCombos ? "#1C1F26" : "#F5A623",
                  fontSize: 12, fontWeight: 800, cursor: "pointer", padding: "6px 12px",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <Pencil size={12} />
                {editingCombos ? "完了" : "編集"}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {comboPresets.map((p) => (
              <div key={p.id} style={{ position: "relative" }}>
                <button
                  onClick={() => (editingCombos ? null : onAddQuick(p))}
                  style={{
                    padding: "10px 14px", borderRadius: 12, border: "1px solid #F5A623",
                    background: "rgba(245,166,35,0.1)", color: "#F5A623", fontSize: 12, fontWeight: 700,
                    cursor: editingCombos ? "default" : "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  <span>{p.company || "会社未設定"}{p.site ? `　${p.site}` : ""}</span>
                  <span style={{ color: "#C7CBD4", fontWeight: 500, fontSize: 11 }}>{yen(jobTotal(p))}</span>
                </button>
                {editingCombos && (
                  <button
                    onClick={() => setConfirmRemoveCombo(p.id)}
                    style={{
                      position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: 11,
                      background: "#E85D5D", border: "2px solid #1C1F26", color: "#fff", fontSize: 13, fontWeight: 800,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {!editingCombos && (
              <button
                onClick={() => setShowCreateCombo(true)}
                style={{
                  padding: "10px 14px", borderRadius: 12, border: "1px dashed #F5A623",
                  background: "#242832", color: "#F5A623", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <Plus size={14} /> 新規登録
              </button>
            )}
          </div>
          {jobs.length > 0 && (
            <button
              onClick={() => (jobs.length === 1 ? setSiteQuickIdx(0) : setShowPickJobForSite(true))}
              style={{
                marginTop: 10, width: "100%", background: "#242832", border: "1px solid #F5A623", borderRadius: 10,
                color: "#F5A623", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "9px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Zap size={13} /> 現場を変更する
            </button>
          )}
        </div>

        <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>この日の仕事（{jobs.length}件）</div>

        {jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#5A5F6B", fontSize: 13 }}>まだ入力がありません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {jobs.map((j, idx) => (
              <div key={idx} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={() => onOpenEdit(idx)} style={{ background: "none", border: "none", textAlign: "left", flex: 1, cursor: "pointer", padding: 0 }}>
                    <div style={{ color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      {j.company || "未設定"}{j.site ? `　${j.site}` : ""}
                      {j.extraPeople && j.extraPeople.length > 0 && (
                        <span style={{ background: "#F5A623", color: "#1C1F26", fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "1px 6px" }}>
                          {j.extraPeople.length + 1}人
                        </span>
                      )}
                    </div>
                    {(j.personName || (j.extraPeople && j.extraPeople.some((p) => p.name))) && (
                      <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 2 }}>
                        {[j.personName, ...(j.extraPeople || []).map((p) => p.name)].filter(Boolean).join("・")}
                      </div>
                    )}
                    <div style={{ color: "#6B7280", fontSize: 11, marginTop: 2 }}>人工{yen(j.ninku)} ／ 残業{yen(j.overtimeAmount)} ／ 燃料費{yen(transportsTotal(j.transports) + expensesTotal(splitLegacyTransportExpenses(j.expenses).transportLike))} ／ 高速代{yen(highwaysTotal(j.highways))} ／ 諸経費{yen(expensesTotal(splitLegacyTransportExpenses(j.expenses).other))}{totalTax(j) > 0 ? ` ／ 税金${yen(totalTax(j))}` : ""}</div>
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "#F5A623", fontSize: 14, fontWeight: 800 }}>{yen(jobTotal(j))}</span>
                    <button onClick={() => setConfirmRemoveIdx(idx)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                      <Trash2 size={15} color="#5A5F6B" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onOpenNew}
          style={{ width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 12, padding: "12px", color: "#F5A623", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Plus size={16} /> 仕事を追加する
        </button>

        <div style={{ marginTop: 18, background: "linear-gradient(135deg,#F5A623,#E8871E)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>この日の合計</div>
          <div style={{ color: "#1C1F26", fontSize: 24, fontWeight: 800 }}>{yen(total)}</div>
        </div>
      </div>

      {confirmRemoveIdx !== null && (
        <Modal onClose={() => setConfirmRemoveIdx(null)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>この仕事を削除しますか？</div>
          <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 16 }}>
            {jobs[confirmRemoveIdx]?.company || "未設定"}（{yen(jobTotal(jobs[confirmRemoveIdx] || {}))}）
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmRemoveIdx(null)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => { onRemove(confirmRemoveIdx); setConfirmRemoveIdx(null); }}
              style={{ flex: 1, background: "#E85D5D", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}

      {confirmRemoveCombo !== null && (
        <Modal onClose={() => setConfirmRemoveCombo(null)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>このワンタップボタンを削除しますか？</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmRemoveCombo(null)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => { onRemoveCombo(confirmRemoveCombo); setConfirmRemoveCombo(null); }}
              style={{ flex: 1, background: "#E85D5D", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}

      {siteQuickIdx !== null && (
        <SitePickModal
          sitePresets={sitePresets}
          setSitePresets={setSitePresets}
          onPick={(s) => { onSetSite(siteQuickIdx, s); setSiteQuickIdx(null); }}
          onClose={() => setSiteQuickIdx(null)}
        />
      )}

      {showPickJobForSite && (
        <Modal onClose={() => setShowPickJobForSite(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>どの仕事の現場を変えますか？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {jobs.map((j, idx) => (
              <button
                key={idx}
                onClick={() => { setShowPickJobForSite(false); setSiteQuickIdx(idx); }}
                style={{
                  width: "100%", textAlign: "left", background: "#242832", border: "1px solid #333846", borderRadius: 10,
                  padding: "10px 12px", color: "#fff", fontSize: 13, cursor: "pointer",
                }}
              >
                {j.company || "未設定"}{j.site ? `　${j.site}` : ""}
                {j.personName ? `（${j.personName}）` : ""}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showCreateCombo && (
        <Modal onClose={() => setShowCreateCombo(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>ワンタップ登録を新規作成</div>

          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 6 }}>会社</div>
          <ChipRow>
            {companies.map((c) => (
              <Chip key={c} active={newComboCompany === c} onClick={() => setNewComboCompany(c)}>{c}</Chip>
            ))}
          </ChipRow>
          <div style={{ marginTop: 8 }}>
            <input value={newComboCompany} onChange={(e) => setNewComboCompany(e.target.value)} placeholder="会社名を直接入力" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          </div>

          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 14, marginBottom: 6 }}>現場名（任意）</div>
          <ChipRow>
            {sitePresets.map((s) => (
              <Chip key={s} active={newComboSite === s} onClick={() => setNewComboSite(s)}>{s}</Chip>
            ))}
          </ChipRow>
          <div style={{ marginTop: 8 }}>
            <input value={newComboSite} onChange={(e) => setNewComboSite(e.target.value)} placeholder="現場名を直接入力" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          </div>

          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 14, marginBottom: 6 }}>人工</div>
          <ChipRow>
            {ninkuPresets.map((v) => (
              <Chip key={v} active={Number(newComboNinku) === v} onClick={() => setNewComboNinku(v)}>{yen(v)}</Chip>
            ))}
          </ChipRow>
          <div style={{ marginTop: 8 }}>
            <input type="text" inputMode="numeric" value={newComboNinku === 0 ? "" : String(newComboNinku)} onChange={(e) => setNewComboNinku(e.target.value.replace(/[^0-9]/g, ""))} placeholder="金額を直接入力" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          </div>

          <p style={{ color: "#5A5F6B", fontSize: 11, marginTop: 10 }}>残業代・交通費など詳しい内容は、登録後に一度使ってから通常の入力画面で調整できます。</p>

          <button onClick={createComboFromScratch} style={modalBtnStyle}>登録する</button>
        </Modal>
      )}
    </div>
  );
}

// ------------------- 1件分の入力/編集画面 -------------------
// ------------------- 現場を選ぶ/手入力するモーダル(プリセットが無くても使える) -------------------
function SitePickModal({ sitePresets, setSitePresets, onPick, onClose }) {
  const [text, setText] = useState("");
  return (
    <Modal onClose={onClose}>
      <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>現場を選ぶ</div>
      {sitePresets.length > 0 ? (
        <ChipRow>
          {sitePresets.map((s) => (
            <Chip key={s} onClick={() => onPick(s)}>{s}</Chip>
          ))}
        </ChipRow>
      ) : (
        <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 8 }}>まだ現場名のプリセットがありません。下に直接入力できます。</div>
      )}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="現場名を直接入力"
          style={{ ...inputStyle, flex: 1, minWidth: 0, boxSizing: "border-box" }}
        />
      </div>
      <button
        onClick={() => {
          if (!text.trim()) return;
          if (!sitePresets.includes(text.trim())) setSitePresets((prev) => [...prev, text.trim()]);
          onPick(text.trim());
        }}
        style={modalBtnStyle}
      >
        この現場名にする
      </button>
    </Modal>
  );
}

function JobDetail({ dateKey, job, onSave, onBack, companies, setCompanies, sitePresets, setSitePresets, namePresets, setNamePresets, ninkuPresets, setNinkuPresets, overtimeRatePresets, setOvertimeRatePresets, onSaveCombo, comboPresets, routes, setRoutes, highwayPresets, setHighwayPresets, entries }) {
  const [company, setCompany] = useState(job.company || "");
  const [site, setSite] = useState(job.site || "");
  const [siteAddress, setSiteAddress] = useState(job.siteAddress || "");
  const [personName, setPersonName] = useState(job.personName || (namePresets.length > 0 ? namePresets[0] : ""));
  const [ninku, setNinku] = useState(job.ninku || 0);
  const [overtimeMode, setOvertimeMode] = useState(job.overtimeMode || "time");
  const [overtimeMinStr, setOvertimeMinStr] = useState(job.overtimeMin ? String(job.overtimeMin) : "");
  const [overtimeRateStr, setOvertimeRateStr] = useState(job.overtimeRatePerHour ? String(job.overtimeRatePerHour) : (overtimeRatePresets.length > 0 ? String(overtimeRatePresets[0]) : "2500"));
  const [overtimeManual, setOvertimeManual] = useState(job.overtimeAmount || 0);
  const [expenses, setExpenses] = useState(job.expenses && job.expenses.length ? job.expenses : []);
  const [transports, setTransports] = useState(job.transports && job.transports.length ? job.transports : []);
  const [highways, setHighways] = useState(job.highways && job.highways.length ? job.highways : []);
  const [memo, setMemo] = useState(job.memo || "");

  const [taxEnabled, setTaxEnabled] = useState(!!job.taxEnabled);
  const [taxRateStr, setTaxRateStr] = useState(job.taxRate ? String(job.taxRate) : "10");

  // ---- 同じ現場でもう1人分(コンパクトな追加ブロック。保存時は1つの記録にまとめられる) ----
  const [extraPeople, setExtraPeople] = useState(
    (job.extraPeople || []).map((p) => ({
      id: Date.now() + Math.random(),
      name: p.name || "",
      ninku: p.ninku || 0,
      overtimeMode: p.overtimeMode || "manual",
      overtimeMinStr: p.overtimeMin ? String(p.overtimeMin) : "",
      overtimeRateStr: p.overtimeRatePerHour ? String(p.overtimeRatePerHour) : (overtimeRatePresets.length > 0 ? String(overtimeRatePresets[0]) : "2500"),
      overtimeManual: p.overtimeAmount || 0,
      transports: p.transports || [],
      highways: p.highways || [],
      expenses: p.expenses || [],
      taxEnabled: !!p.taxEnabled,
      taxRateStr: p.taxRate ? String(p.taxRate) : "10",
    }))
  );
  const addPerson = () => {
    setExtraPeople((prev) => [...prev, {
      id: Date.now() + Math.random(), name: "", ninku: 0,
      overtimeMode: "time", overtimeMinStr: "", overtimeRateStr: (overtimeRatePresets.length > 0 ? String(overtimeRatePresets[0]) : "2500"), overtimeManual: 0,
      transports: [], highways: [], expenses: [],
      taxEnabled: false, taxRateStr: "10",
    }]);
  };
  const removePerson = (id) => setExtraPeople((prev) => prev.filter((p) => p.id !== id));
  const updatePerson = (id, patch) => setExtraPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const personOvertimeAmount = (p) =>
    p.overtimeMode === "time"
      ? Math.round((Number(p.overtimeMinStr || 0) / 60) * Number(p.overtimeRateStr || 0))
      : Number(p.overtimeManual || 0);

  const addPersonTransport = (personId, memo, km) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, transports: [...p.transports, { ...emptyTransport(), id: Date.now() + Math.random(), memo: memo || "", km: km !== undefined ? String(km) : "" }] } : p)));
  };
  const updatePersonTransport = (personId, transportId, patch) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, transports: p.transports.map((t) => (t.id === transportId ? { ...t, ...patch } : t)) } : p)));
  };
  const removePersonTransport = (personId, transportId) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, transports: p.transports.filter((t) => t.id !== transportId) } : p)));
  };

  const addPersonHighway = (personId, fromIC, toIC, amount) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, highways: [...p.highways, { ...emptyHighway(), id: Date.now() + Math.random(), fromIC: fromIC || "", toIC: toIC || "", amount: amount !== undefined ? String(amount) : "" }] } : p)));
  };
  const updatePersonHighway = (personId, highwayId, patch) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, highways: p.highways.map((h) => (h.id === highwayId ? { ...h, ...patch } : h)) } : p)));
  };
  const removePersonHighway = (personId, highwayId) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, highways: p.highways.filter((h) => h.id !== highwayId) } : p)));
  };

  const addPersonExpense = (id, label) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === id ? { ...p, expenses: [...p.expenses, { id: Date.now() + Math.random(), label, amount: 0 }] } : p)));
  };
  const updatePersonExpense = (personId, expId, patch) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, expenses: p.expenses.map((e) => (e.id === expId ? { ...e, ...patch } : e)) } : p)));
  };
  const removePersonExpense = (personId, expId) => {
    setExtraPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, expenses: p.expenses.filter((e) => e.id !== expId) } : p)));
  };
  const personTotal = (p) => Number(p.ninku || 0) + personOvertimeAmount(p) + transportsTotal(p.transports) + highwaysTotal(p.highways) + expensesTotal(p.expenses) + personTaxAmount(p);
  const personTaxAmount = (p) => (p.taxEnabled ? Math.round((Number(p.ninku || 0) + personOvertimeAmount(p) + expensesTotal(p.expenses)) * (Number(p.taxRateStr || 0) / 100)) : 0);

  // 追加の人の「+その他」諸経費モーダル用(nullなら非表示、値があれば対象の人のID)
  const [showAddExpenseForPerson, setShowAddExpenseForPerson] = useState(null);
  const [newPersonExpenseLabel, setNewPersonExpenseLabel] = useState("");
  const [newPersonExpenseAmount, setNewPersonExpenseAmount] = useState("");
  const addCustomPersonExpense = () => {
    if (!newPersonExpenseLabel.trim() || showAddExpenseForPerson === null) return;
    setExtraPeople((prev) => prev.map((p) => (p.id === showAddExpenseForPerson ? { ...p, expenses: [...p.expenses, { id: Date.now() + Math.random(), label: newPersonExpenseLabel.trim(), amount: Number(newPersonExpenseAmount || 0) }] } : p)));
    setShowAddExpenseForPerson(null);
    setNewPersonExpenseLabel("");
    setNewPersonExpenseAmount("");
  };

  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [showAddName, setShowAddName] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [showAddNinku, setShowAddNinku] = useState(false);
  const [newNinkuValue, setNewNinkuValue] = useState("");
  const [showAddOvertimeRate, setShowAddOvertimeRate] = useState(false);
  const [newOvertimeRateValue, setNewOvertimeRateValue] = useState("");
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpenseLabel, setNewExpenseLabel] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState("");
  const [comboSaved, setComboSaved] = useState(false);

  // ---- プリセットの編集(削除)モード ----
  const [editingCompanies, setEditingCompanies] = useState(false);
  const [editingSites, setEditingSites] = useState(false);
  const [editingNames, setEditingNames] = useState(false);
  const [editingNinku, setEditingNinku] = useState(false);
  const [editingOvertimeRate, setEditingOvertimeRate] = useState(false);
  const [editingRoutes, setEditingRoutes] = useState(false);
  const [editingHighwayPresets, setEditingHighwayPresets] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type, value, label }
  const [confirmItemDelete, setConfirmItemDelete] = useState(null); // { label, onConfirm }
  const requestItemDelete = (label, onConfirm) => setConfirmItemDelete({ label, onConfirm });

  const removeCompanyPreset = (c) => setCompanies((prev) => prev.filter((x) => x !== c));
  const removeSitePreset = (s) => setSitePresets((prev) => prev.filter((x) => x !== s));
  const removeNamePreset = (n) => setNamePresets((prev) => prev.filter((x) => x !== n));
  const removeNinkuPreset = (v) => setNinkuPresets((prev) => prev.filter((x) => x !== v));
  const removeOvertimeRatePreset = (v) => setOvertimeRatePresets((prev) => prev.filter((x) => x !== v));
  const removeRoutePreset = (id) => setRoutes((prev) => prev.filter((r) => r.id !== id));
  const removeHighwayPreset = (id) => setHighwayPresets((prev) => prev.filter((h) => h.id !== id));

  const requestDelete = (type, value, label) => setConfirmDelete({ type, value, label });
  const confirmDeleteNow = () => {
    if (!confirmDelete) return;
    const { type, value } = confirmDelete;
    if (type === "company") removeCompanyPreset(value);
    if (type === "site") removeSitePreset(value);
    if (type === "name") removeNamePreset(value);
    if (type === "ninku") removeNinkuPreset(value);
    if (type === "overtimeRate") removeOvertimeRatePreset(value);
    if (type === "route") removeRoutePreset(value);
    if (type === "highwayPreset") removeHighwayPreset(value);
    setConfirmDelete(null);
  };

  const overtimeMin = Number(overtimeMinStr || 0);
  const overtimeRatePerHour = Number(overtimeRateStr || 0);
  const overtimeAmount = overtimeMode === "time" ? Math.round((overtimeMin / 60) * overtimeRatePerHour) : Number(overtimeManual || 0);
  const expensesSum = expensesTotal(expenses);
  const transportsSum = transportsTotal(transports);
  const highwaysSum = highwaysTotal(highways);
  const ninkuTaxYen = taxEnabled ? Math.round(Number(ninku || 0) * (Number(taxRateStr || 0) / 100)) : 0;
  const overtimeTaxYen = taxEnabled ? Math.round(overtimeAmount * (Number(taxRateStr || 0) / 100)) : 0;
  const expensesTaxYen = taxEnabled ? Math.round(expensesSum * (Number(taxRateStr || 0) / 100)) : 0;
  const total = Number(ninku || 0) + overtimeAmount + expensesSum + transportsSum + highwaysSum + ninkuTaxYen + overtimeTaxYen + expensesTaxYen;
  const [y, m, d] = dateKey.split("-").map(Number);
  const thisMonthKey = `${y}-${pad(m)}`;

  // ---- この月に実際に使った会社・現場名だけを最初に表示する(多くなりすぎ防止) ----
  const [showAllCompanies, setShowAllCompanies] = useState(false);
  const [showAllSites, setShowAllSites] = useState(false);
  const monthCompanies = useMemo(() => {
    const set = new Set();
    Object.entries(entries || {}).forEach(([k, jobs]) => {
      if (k.startsWith(thisMonthKey)) (jobs || []).forEach((j) => { if (j.company) set.add(j.company); });
    });
    return companies.filter((c) => set.has(c));
  }, [entries, thisMonthKey, companies]);
  const monthSites = useMemo(() => {
    const set = new Set();
    Object.entries(entries || {}).forEach(([k, jobs]) => {
      if (k.startsWith(thisMonthKey)) (jobs || []).forEach((j) => { if (j.site) set.add(j.site); });
    });
    return sitePresets.filter((s) => set.has(s));
  }, [entries, thisMonthKey, sitePresets]);

  const visibleCompanies = showAllCompanies || monthCompanies.length === 0 ? companies : monthCompanies;
  const visibleSites = showAllSites || monthSites.length === 0 ? sitePresets : monthSites;

  // 現在の入力内容を正規化(比較用)。会社・現場名・人工・残業代・燃料費・高速代・諸経費の中身がすべて一致した時だけ「重複」とみなす
  const normalizeForCompare = (o) => JSON.stringify({
    company: o.company || "",
    site: o.site || "",
    ninku: Number(o.ninku || 0),
    overtimeMode: o.overtimeMode,
    overtimeMin: Number(o.overtimeMin || 0),
    overtimeRatePerHour: Number(o.overtimeRatePerHour || 0),
    overtimeAmount: Number(o.overtimeAmount || 0),
    expenses: (o.expenses || []).map((e) => ({ label: e.label, amount: Number(e.amount || 0) })),
    transports: (o.transports || []).map((t) => ({ memo: t.memo, km: Number(t.km || 0), ratePerKm: Number(t.ratePerKm || 0), roundTripKm: !!t.roundTripKm })),
    highways: (o.highways || []).map((h) => ({ fromIC: h.fromIC, toIC: h.toIC, amount: Number(h.amount || 0), roundTrip: !!h.roundTrip })),
  });
  const currentComboSignature = normalizeForCompare({ company, site, ninku, overtimeMode, overtimeMin, overtimeRatePerHour, overtimeAmount, expenses, transports, highways });
  const isDuplicateCombo = comboPresets.some((p) => normalizeForCompare(p) === currentComboSignature);

  const buildStoredPerson = (p) => ({
    name: p.name || "", ninku: Number(p.ninku || 0),
    overtimeMode: p.overtimeMode, overtimeMin: Number(p.overtimeMinStr || 0), overtimeRatePerHour: Number(p.overtimeRateStr || 0),
    overtimeAmount: personOvertimeAmount(p),
    transports: p.transports, highways: p.highways, expenses: p.expenses,
    taxEnabled: p.taxEnabled, taxRate: Number(p.taxRateStr || 0),
  });
  const buildJob = () => ({
    company, site, siteAddress, personName, ninku: Number(ninku), overtimeMode, overtimeMin, overtimeRatePerHour, overtimeAmount,
    expenses, transports, highways, extraPeople: extraPeople.map(buildStoredPerson), memo,
    taxEnabled, taxRate: Number(taxRateStr || 0),
  });
  const save = () => {
    onSave([buildJob()]);
  };

  const addExpenseQuick = (label) => {
    setExpenses((prev) => [...prev, { id: Date.now(), label, amount: 0 }]);
  };
  const updateExpenseAmount = (id, amountStr) => {
    const amount = Number(amountStr.replace(/[^0-9]/g, "") || 0);
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, amount } : e)));
  };
  const updateExpenseLabel = (id, label) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, label } : e)));
  };
  const removeExpense = (id) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };
  const addCustomExpense = () => {
    if (!newExpenseLabel.trim()) return;
    setExpenses((prev) => [...prev, { id: Date.now(), label: newExpenseLabel.trim(), amount: Number(newExpenseAmount || 0) }]);
    setShowAddExpense(false);
    setNewExpenseLabel("");
    setNewExpenseAmount("");
  };

  // ---- 燃料費(距離×単価。何回でも追加できる) ----
  const addTransport = (memo, km) => {
    setTransports((prev) => [...prev, { ...emptyTransport(), id: Date.now() + Math.random(), memo: memo || "", km: km !== undefined ? String(km) : "" }]);
  };
  const updateTransport = (id, patch) => {
    setTransports((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const removeTransport = (id) => {
    setTransports((prev) => prev.filter((t) => t.id !== id));
  };

  // ---- 高速代(金額。何回でも追加できる) ----
  const addHighway = (fromIC, toIC, amount) => {
    setHighways((prev) => [...prev, { ...emptyHighway(), id: Date.now() + Math.random(), fromIC: fromIC || "", toIC: toIC || "", amount: amount !== undefined ? String(amount) : "" }]);
  };
  const updateHighway = (id, patch) => {
    setHighways((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  };
  const removeHighway = (id) => {
    setHighways((prev) => prev.filter((h) => h.id !== id));
  };

  // ---- ルート(燃料費)プリセット：呼び名+距離(km)を登録。タップで燃料費を1件追加 ----
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [newRouteMemo, setNewRouteMemo] = useState("");
  const [newRouteKm, setNewRouteKm] = useState("");

  const registerRoute = () => {
    if (!newRouteMemo.trim()) return;
    const r = { id: Date.now(), label: newRouteMemo.trim(), km: newRouteKm ? Number(newRouteKm) : "" };
    setRoutes((prev) => [...prev, r]);
    setShowAddRoute(false);
    setNewRouteMemo("");
    setNewRouteKm("");
  };

  // ---- 高速代プリセット：〇〇IC〜〇〇IC+金額を登録。タップで高速代を1件追加 ----
  const [showAddHighwayPreset, setShowAddHighwayPreset] = useState(false);
  const [newHighwayFromIC, setNewHighwayFromIC] = useState("");
  const [newHighwayToIC, setNewHighwayToIC] = useState("");
  const [newHighwayAmount, setNewHighwayAmount] = useState("");

  const registerHighwayPreset = () => {
    if (!newHighwayFromIC.trim() || !newHighwayToIC.trim()) return;
    const h = { id: Date.now(), fromIC: newHighwayFromIC.trim(), toIC: newHighwayToIC.trim(), amount: newHighwayAmount ? Number(newHighwayAmount) : 0 };
    setHighwayPresets((prev) => [...prev, h]);
    setShowAddHighwayPreset(false);
    setNewHighwayFromIC("");
    setNewHighwayToIC("");
    setNewHighwayAmount("");
  };


  const addCompany = () => { if (!newCompanyName.trim()) return; setCompany(newCompanyName.trim()); setShowAddCompany(false); setNewCompanyName(""); };
  const registerCompanyPreset = () => { if (company && !companies.includes(company)) setCompanies([...companies, company]); };
  const addSite = () => { if (!newSiteName.trim()) return; setSite(newSiteName.trim()); setShowAddSite(false); setNewSiteName(""); };
  const registerSitePreset = () => { if (site && !sitePresets.includes(site)) setSitePresets([...sitePresets, site]); };
  const addNamePresetDirect = () => { if (!newPersonName.trim()) return; setNamePresets((prev) => prev.includes(newPersonName.trim()) ? prev : [...prev, newPersonName.trim()]); setPersonName(newPersonName.trim()); setShowAddName(false); setNewPersonName(""); };
  const addNinku = () => { const v = Number(newNinkuValue); if (!v) return; setNinku(v); setShowAddNinku(false); setNewNinkuValue(""); };
  const registerNinkuPreset = () => { if (ninku && !ninkuPresets.includes(Number(ninku))) setNinkuPresets([...ninkuPresets, Number(ninku)]); };
  const addOvertimeRatePreset = () => {
    const v = Number(newOvertimeRateValue);
    if (!v) return;
    setOvertimeRateStr(String(v));
    if (!overtimeRatePresets.includes(v)) setOvertimeRatePresets([...overtimeRatePresets, v]);
    setShowAddOvertimeRate(false);
    setNewOvertimeRateValue("");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div>
            <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>{m}月{d}日 の仕事を入力</div>
            <div style={{ color: "#6B7280", fontSize: 11 }}>{y}年</div>
          </div>
        </div>

        <Section label="名前（任意）">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            {namePresets.length > 0 && <EditToggleButton editing={editingNames} onClick={() => setEditingNames((v) => !v)} />}
          </div>
          <ChipRow>
            {namePresets.map((n) => (
              <ChipWithDelete key={n} editing={editingNames} onDelete={() => requestDelete("name", n, n)}>
                <Chip active={personName === n} onClick={() => (editingNames ? null : setPersonName(n))}>{n}</Chip>
              </ChipWithDelete>
            ))}
            {!editingNames && <Chip onClick={() => setShowAddName(true)} isAdd><Plus size={14} /></Chip>}
          </ChipRow>
          {personName && !namePresets.includes(personName) && (
            <PresetPrompt label={`「${personName}」をプリセットに追加する？`} onYes={() => setNamePresets((prev) => [...prev, personName])} />
          )}
          <ManualInput placeholder="例: 山田" value={personName} onChange={setPersonName} />
        </Section>

        <Section label="税金">
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 8 }}>ONにすると、人工・残業代・諸経費すべてに一括で税率がかかります</div>
          <Chip active={taxEnabled} onClick={() => setTaxEnabled((v) => !v)}>税金を適用する{taxEnabled ? "✓" : ""}</Chip>
          {taxEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <input type="text" inputMode="numeric" value={taxRateStr} onChange={(e) => setTaxRateStr(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...inputStyle, width: 70, boxSizing: "border-box" }} />
              <span style={{ color: "#8A8F9C", fontSize: 12 }}>% → 税金合計 {yen(ninkuTaxYen + overtimeTaxYen + expensesTaxYen)}</span>
            </div>
          )}
        </Section>

        <Section label="会社">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <EditToggleButton editing={editingCompanies} onClick={() => setEditingCompanies((v) => !v)} />
          </div>
          <ChipRow>
            {visibleCompanies.map((c) => (
              <ChipWithDelete key={c} editing={editingCompanies} onDelete={() => requestDelete("company", c, c)}>
                <Chip active={company === c} onClick={() => (editingCompanies ? null : setCompany(c))}>{c}</Chip>
              </ChipWithDelete>
            ))}
            {!editingCompanies && <Chip onClick={() => setShowAddCompany(true)} isAdd><Plus size={14} /></Chip>}
          </ChipRow>
          {!showAllCompanies && monthCompanies.length > 0 && monthCompanies.length < companies.length && (
            <button onClick={() => setShowAllCompanies(true)} style={moreToggleBtnStyle}>
              <ChevronDown size={13} /> 他の月の会社も見る（あと{companies.length - monthCompanies.length}件）
            </button>
          )}
          {showAllCompanies && monthCompanies.length > 0 && (
            <button onClick={() => setShowAllCompanies(false)} style={moreToggleBtnStyle}>
              今月の会社だけ表示する
            </button>
          )}
          {company && !companies.includes(company) && <PresetPrompt label={`「${company}」をプリセットに追加する？`} onYes={registerCompanyPreset} />}
          <ManualInput placeholder="会社名を直接入力" value={company} onChange={setCompany} />
        </Section>

        <Section label="現場名（任意）">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            {sitePresets.length > 0 && <EditToggleButton editing={editingSites} onClick={() => setEditingSites((v) => !v)} />}
          </div>
          <ChipRow>
            {visibleSites.map((s) => (
              <ChipWithDelete key={s} editing={editingSites} onDelete={() => requestDelete("site", s, s)}>
                <Chip active={site === s} onClick={() => (editingSites ? null : setSite(s))}>{s}</Chip>
              </ChipWithDelete>
            ))}
            {!editingSites && <Chip onClick={() => setShowAddSite(true)} isAdd><Plus size={14} /></Chip>}
          </ChipRow>
          {!showAllSites && monthSites.length > 0 && monthSites.length < sitePresets.length && (
            <button onClick={() => setShowAllSites(true)} style={moreToggleBtnStyle}>
              <ChevronDown size={13} /> 他の月の現場も見る（あと{sitePresets.length - monthSites.length}件）
            </button>
          )}
          {showAllSites && monthSites.length > 0 && (
            <button onClick={() => setShowAllSites(false)} style={moreToggleBtnStyle}>
              今月の現場だけ表示する
            </button>
          )}
          {site && !sitePresets.includes(site) && <PresetPrompt label={`「${site}」をプリセットに追加する？`} onYes={registerSitePreset} />}
          <ManualInput placeholder="例: 〇〇マンション新築工事" value={site} onChange={setSite} />
          <div style={{ marginTop: 8 }}>
            <ManualInput placeholder="現場の住所（任意）" value={siteAddress} onChange={setSiteAddress} />
          </div>
        </Section>


        <Section label="人工（1日あたり）">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <EditToggleButton editing={editingNinku} onClick={() => setEditingNinku((v) => !v)} />
          </div>
          <ChipRow>
            {ninkuPresets.map((v) => (
              <ChipWithDelete key={v} editing={editingNinku} onDelete={() => requestDelete("ninku", v, yen(v))}>
                <Chip active={Number(ninku) === v} onClick={() => (editingNinku ? null : setNinku(v))}>{yen(v)}</Chip>
              </ChipWithDelete>
            ))}
            {!editingNinku && <Chip onClick={() => setShowAddNinku(true)} isAdd><Plus size={14} /></Chip>}
          </ChipRow>
          {ninku && !ninkuPresets.includes(Number(ninku)) && <PresetPrompt label={`「${yen(ninku)}」をプリセットに追加する？`} onYes={registerNinkuPreset} />}
          <ManualInput placeholder="金額を直接入力" value={ninku === 0 ? "" : String(ninku)} onChange={(v) => setNinku(v.replace(/[^0-9]/g, ""))} numeric />
          {taxEnabled && <div style={{ color: "#8A8F9C", fontSize: 12, marginTop: 8 }}>→ 税金 {yen(ninkuTaxYen)}</div>}
        </Section>

        <Section label="残業代">
          <ChipRow>
            <Chip active={overtimeMode === "time"} onClick={() => setOvertimeMode("time")}>時間で計算</Chip>
            <Chip active={overtimeMode === "manual"} onClick={() => setOvertimeMode("manual")}>金額を直接入力</Chip>
          </ChipRow>
          {overtimeMode === "time" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "#8A8F9C", fontSize: 11 }}>時給プリセット</span>
                {overtimeRatePresets.length > 0 && <EditToggleButton editing={editingOvertimeRate} onClick={() => setEditingOvertimeRate((v) => !v)} />}
              </div>
              <ChipRow>
                {overtimeRatePresets.map((v) => (
                  <ChipWithDelete key={v} editing={editingOvertimeRate} onDelete={() => requestDelete("overtimeRate", v, `${v}円`)}>
                    <Chip active={Number(overtimeRateStr) === v} onClick={() => (editingOvertimeRate ? null : setOvertimeRateStr(String(v)))}>{v}円</Chip>
                  </ChipWithDelete>
                ))}
                {!editingOvertimeRate && <Chip onClick={() => setShowAddOvertimeRate(true)} isAdd><Plus size={14} /></Chip>}
              </ChipRow>
            </div>
          )}
          {overtimeMode === "time" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <LabeledField label="時間(分)">
                <input type="text" inputMode="numeric" value={overtimeMinStr} placeholder="0" onChange={(e) => setOvertimeMinStr(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </LabeledField>
              <LabeledField label="時給換算(円/時)">
                <input type="text" inputMode="numeric" value={overtimeRateStr} placeholder="0" onChange={(e) => setOvertimeRateStr(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </LabeledField>
            </div>
          ) : (
            <ManualInput placeholder="残業代の金額" value={overtimeManual === 0 ? "" : String(overtimeManual)} onChange={(v) => setOvertimeManual(v.replace(/[^0-9]/g, ""))} numeric />
          )}
          <div style={{ color: "#8A8F9C", fontSize: 12, marginTop: 6 }}>→ 残業代 {yen(overtimeAmount)}</div>
          {taxEnabled && <div style={{ color: "#8A8F9C", fontSize: 12, marginTop: 4 }}>→ 税金 {yen(overtimeTaxYen)}</div>}
        </Section>

        <Section label="燃料費">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ color: "#8A8F9C", fontSize: 11 }}>ルートを選ぶ（距離も一緒に入ります）</div>
            {routes.length > 0 && <EditToggleButton editing={editingRoutes} onClick={() => setEditingRoutes((v) => !v)} />}
          </div>
          <ChipRow>
            {routes.filter((r) => r.label).map((r) => (
              <ChipWithDelete key={r.id} editing={editingRoutes} onDelete={() => requestDelete("route", r.id, r.label)}>
                <Chip onClick={() => (editingRoutes ? null : addTransport(r.label, r.km))}>
                  {r.label}{r.km ? `（${r.km}km）` : ""}
                </Chip>
              </ChipWithDelete>
            ))}
            {!editingRoutes && <Chip onClick={() => setShowAddRoute(true)} isAdd><Plus size={14} /> ルートを登録</Chip>}
          </ChipRow>

          {transports.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {transports.map((t) => (
                <div key={t.id} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <input
                      value={t.memo}
                      onChange={(e) => updateTransport(t.id, { memo: e.target.value })}
                      placeholder="行き先メモ（例: 自宅→A社）"
                      style={{ ...inputStyle, flex: 1, boxSizing: "border-box" }}
                    />
                    <button onClick={() => requestItemDelete(`燃料費「${t.memo || "移動"}」`, () => removeTransport(t.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                      <Trash2 size={15} color="#5A5F6B" />
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <LabeledField label="距離(km)">
                      <input type="text" inputMode="numeric" value={t.km} placeholder="0" onChange={(e) => updateTransport(t.id, { km: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                    </LabeledField>
                    <LabeledField label="1kmあたり(円)">
                      <input type="text" inputMode="numeric" value={t.ratePerKm} placeholder="20" onChange={(e) => updateTransport(t.id, { ratePerKm: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                    </LabeledField>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Chip active={t.roundTripKm} onClick={() => updateTransport(t.id, { roundTripKm: !t.roundTripKm })}>往復{t.roundTripKm ? "（×2）✓" : ""}</Chip>
                  </div>
                  <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 6 }}>
                    → {t.km || 0}km × {t.ratePerKm || 0}円{t.roundTripKm ? " × 往復" : ""} = {yen(Number(t.km || 0) * Number(t.ratePerKm || 0) * (t.roundTripKm ? 2 : 1))}
                  </div>

                  <div style={{ color: "#F5A623", fontSize: 13, fontWeight: 800, textAlign: "right", marginTop: 10 }}>
                    小計 {yen(transportItemTotal(t))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => addTransport("")}
            style={{ marginTop: 12, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 10, padding: "10px", color: "#F5A623", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Plus size={14} /> 燃料費を追加する
          </button>
        </Section>

        <Section label="高速代">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ color: "#8A8F9C", fontSize: 11 }}>プリセットを選ぶ（金額も一緒に入ります）</div>
            {highwayPresets.length > 0 && <EditToggleButton editing={editingHighwayPresets} onClick={() => setEditingHighwayPresets((v) => !v)} />}
          </div>
          <ChipRow>
            {highwayPresets.map((h) => (
              <ChipWithDelete key={h.id} editing={editingHighwayPresets} onDelete={() => requestDelete("highwayPreset", h.id, `${h.fromIC}IC〜${h.toIC}IC`)}>
                <Chip onClick={() => (editingHighwayPresets ? null : addHighway(h.fromIC, h.toIC, h.amount))}>
                  {h.fromIC}IC〜{h.toIC}IC{h.amount ? `（${yen(h.amount)}）` : ""}
                </Chip>
              </ChipWithDelete>
            ))}
            {!editingHighwayPresets && <Chip onClick={() => setShowAddHighwayPreset(true)} isAdd><Plus size={14} /> プリセットを登録</Chip>}
          </ChipRow>

          {highways.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {highways.map((h) => (
                <div key={h.id} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                    <input
                      value={h.fromIC || ""}
                      onChange={(e) => updateHighway(h.id, { fromIC: e.target.value })}
                      placeholder="〇〇"
                      style={{ ...inputStyle, width: 80, boxSizing: "border-box" }}
                    />
                    <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC〜</span>
                    <input
                      value={h.toIC || ""}
                      onChange={(e) => updateHighway(h.id, { toIC: e.target.value })}
                      placeholder="〇〇"
                      style={{ ...inputStyle, width: 80, boxSizing: "border-box" }}
                    />
                    <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC</span>
                    <button onClick={() => requestItemDelete(`高速代「${h.fromIC || ""}IC〜${h.toIC || ""}IC」`, () => removeHighway(h.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, marginLeft: "auto" }}>
                      <Trash2 size={15} color="#5A5F6B" />
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <LabeledField label="片道の金額">
                      <input type="text" inputMode="numeric" value={h.amount} placeholder="0" onChange={(e) => updateHighway(h.id, { amount: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                    </LabeledField>
                    <Chip active={h.roundTrip} onClick={() => updateHighway(h.id, { roundTrip: !h.roundTrip })}>往復{h.roundTrip ? "（×2）✓" : ""}</Chip>
                  </div>
                  <div style={{ color: "#F5A623", fontSize: 13, fontWeight: 800, textAlign: "right", marginTop: 10 }}>
                    小計 {yen(highwayItemTotal(h))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => addHighway("")}
            style={{ marginTop: 12, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 10, padding: "10px", color: "#F5A623", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Plus size={14} /> 高速代を追加する
          </button>
        </Section>

        <Section label="諸経費">
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 8 }}>タップですぐ追加（人工・残業代を含め、下のリストで自由に編集できます）</div>
          <ChipRow>
            {EXPENSE_LABEL_PRESETS.map((label) => (
              <Chip key={label} onClick={() => addExpenseQuick(label)}>{label}</Chip>
            ))}
            <Chip onClick={() => setShowAddExpense(true)} isAdd><Plus size={14} /> その他</Chip>
          </ChipRow>

          {expenses.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {expenses.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "8px 10px", flexWrap: "wrap" }}>
                  <input
                    value={e.label}
                    onChange={(ev) => updateExpenseLabel(e.id, ev.target.value)}
                    style={{ ...inputStyle, flex: "1 1 80px", minWidth: 0, background: "transparent", border: "none", padding: "2px 0" }}
                  />
                  <input
                    type="text" inputMode="numeric" placeholder="0"
                    value={e.amount === 0 ? "" : String(e.amount)}
                    onChange={(ev) => updateExpenseAmount(e.id, ev.target.value)}
                    style={{ ...inputStyle, width: 80, flexShrink: 0, boxSizing: "border-box", textAlign: "right" }}
                  />
                  <span style={{ color: "#8A8F9C", fontSize: 11 }}>円</span>
                  <button onClick={() => requestItemDelete(`諸経費「${e.label || "項目"}」`, () => removeExpense(e.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <Trash2 size={14} color="#8A8F9C" />
                  </button>
                </div>
              ))}
              <div style={{ color: "#8FD19E", fontSize: 12, fontWeight: 700, textAlign: "right" }}>小計 {yen(expensesSum)}</div>
            </div>
          )}
          {taxEnabled && <div style={{ color: "#8A8F9C", fontSize: 12, marginTop: 8 }}>→ 税金 {yen(expensesTaxYen)}</div>}
        </Section>

        {extraPeople.map((p, idx) => (
          <div key={p.id} style={{ marginTop: 18, background: "#20242E", border: "1px solid #F5A623", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ color: "#F5A623", fontSize: 13, fontWeight: 800 }}>追加の人（{idx + 2}人目）・会社/現場は共通</div>
              <button onClick={() => requestItemDelete(`追加の人「${p.name || "名前未設定"}」`, () => removePerson(p.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <Trash2 size={15} color="#8A8F9C" />
              </button>
            </div>

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>名前（任意）</div>
            {namePresets.length > 0 && (
              <ChipRow>
                {namePresets.map((n) => (
                  <Chip key={n} active={p.name === n} onClick={() => updatePerson(p.id, { name: n })}>{n}</Chip>
                ))}
              </ChipRow>
            )}
            <ManualInput placeholder="例: 佐藤" value={p.name} onChange={(v) => updatePerson(p.id, { name: v })} />
            {p.name && !namePresets.includes(p.name) && (
              <PresetPrompt label={`「${p.name}」をプリセットに追加する？`} onYes={() => setNamePresets((prev) => [...prev, p.name])} />
            )}

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "12px 0 6px" }}>税金</div>
            <Chip active={p.taxEnabled} onClick={() => updatePerson(p.id, { taxEnabled: !p.taxEnabled })}>税金を適用する{p.taxEnabled ? "✓" : ""}</Chip>
            {p.taxEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <input type="text" inputMode="numeric" value={p.taxRateStr} onChange={(e) => updatePerson(p.id, { taxRateStr: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: 70, boxSizing: "border-box" }} />
                <span style={{ color: "#8A8F9C", fontSize: 12 }}>% → 税金合計 {yen(personTaxAmount(p))}</span>
              </div>
            )}

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "12px 0 6px" }}>人工</div>
            <ChipRow>
              {ninkuPresets.map((v) => (
                <Chip key={v} active={Number(p.ninku) === v} onClick={() => updatePerson(p.id, { ninku: v })}>{yen(v)}</Chip>
              ))}
            </ChipRow>
            <ManualInput placeholder="金額を直接入力" value={p.ninku === 0 ? "" : String(p.ninku)} onChange={(v) => updatePerson(p.id, { ninku: v.replace(/[^0-9]/g, "") })} numeric />

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "12px 0 6px" }}>残業代</div>
            <ChipRow>
              <Chip active={p.overtimeMode === "time"} onClick={() => updatePerson(p.id, { overtimeMode: "time" })}>時間で計算</Chip>
              <Chip active={p.overtimeMode === "manual"} onClick={() => updatePerson(p.id, { overtimeMode: "manual" })}>金額を直接入力</Chip>
            </ChipRow>
            {p.overtimeMode === "time" && overtimeRatePresets.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <ChipRow>
                  {overtimeRatePresets.map((v) => (
                    <Chip key={v} active={Number(p.overtimeRateStr) === v} onClick={() => updatePerson(p.id, { overtimeRateStr: String(v) })}>{v}円</Chip>
                  ))}
                </ChipRow>
              </div>
            )}
            {p.overtimeMode === "time" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <LabeledField label="時間(分)">
                  <input type="text" inputMode="numeric" value={p.overtimeMinStr} placeholder="0" onChange={(e) => updatePerson(p.id, { overtimeMinStr: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </LabeledField>
                <LabeledField label="時給換算(円/時)">
                  <input type="text" inputMode="numeric" value={p.overtimeRateStr} placeholder="0" onChange={(e) => updatePerson(p.id, { overtimeRateStr: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </LabeledField>
              </div>
            ) : (
              <ManualInput placeholder="残業代の金額" value={p.overtimeManual === 0 ? "" : String(p.overtimeManual)} onChange={(v) => updatePerson(p.id, { overtimeManual: Number(v.replace(/[^0-9]/g, "") || 0) })} numeric />
            )}
            <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 6 }}>→ 残業代 {yen(personOvertimeAmount(p))}</div>

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "14px 0 6px" }}>燃料費</div>
            <ChipRow>
              {routes.filter((r) => r.label).map((r) => (
                <Chip key={r.id} onClick={() => addPersonTransport(p.id, r.label, r.km)}>{r.label}{r.km ? `（${r.km}km）` : ""}</Chip>
              ))}
            </ChipRow>
            {p.transports.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {p.transports.map((t) => (
                  <div key={t.id} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input value={t.memo} onChange={(e) => updatePersonTransport(p.id, t.id, { memo: e.target.value })} placeholder="行き先メモ" style={{ ...inputStyle, flex: 1, boxSizing: "border-box" }} />
                      <button onClick={() => requestItemDelete(`燃料費「${t.memo || "移動"}」`, () => removePersonTransport(p.id, t.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                        <Trash2 size={14} color="#5A5F6B" />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <LabeledField label="距離(km)">
                        <input type="text" inputMode="numeric" value={t.km} placeholder="0" onChange={(e) => updatePersonTransport(p.id, t.id, { km: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                      </LabeledField>
                      <LabeledField label="1kmあたり(円)">
                        <input type="text" inputMode="numeric" value={t.ratePerKm} placeholder="20" onChange={(e) => updatePersonTransport(p.id, t.id, { ratePerKm: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                      </LabeledField>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Chip active={t.roundTripKm} onClick={() => updatePersonTransport(p.id, t.id, { roundTripKm: !t.roundTripKm })}>往復{t.roundTripKm ? "（×2）✓" : ""}</Chip>
                    </div>
                    <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 6 }}>
                      → {t.km || 0}km × {t.ratePerKm || 0}円{t.roundTripKm ? " × 往復" : ""} = {yen(Number(t.km || 0) * Number(t.ratePerKm || 0) * (t.roundTripKm ? 2 : 1))}
                    </div>
                    <div style={{ color: "#F5A623", fontSize: 12, fontWeight: 800, textAlign: "right", marginTop: 8 }}>小計 {yen(transportItemTotal(t))}</div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => addPersonTransport(p.id, "")}
              style={{ marginTop: 8, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 10, padding: "9px", color: "#F5A623", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Plus size={13} /> 燃料費を追加する
            </button>

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "14px 0 6px" }}>高速代</div>
            <ChipRow>
              {highwayPresets.map((h) => (
                <Chip key={h.id} onClick={() => addPersonHighway(p.id, h.fromIC, h.toIC, h.amount)}>{h.fromIC}IC〜{h.toIC}IC{h.amount ? `（${yen(h.amount)}）` : ""}</Chip>
              ))}
            </ChipRow>
            {p.highways.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {p.highways.map((h) => (
                  <div key={h.id} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      <input value={h.fromIC || ""} onChange={(e) => updatePersonHighway(p.id, h.id, { fromIC: e.target.value })} placeholder="〇〇" style={{ ...inputStyle, width: 80, boxSizing: "border-box" }} />
                      <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC〜</span>
                      <input value={h.toIC || ""} onChange={(e) => updatePersonHighway(p.id, h.id, { toIC: e.target.value })} placeholder="〇〇" style={{ ...inputStyle, width: 80, boxSizing: "border-box" }} />
                      <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC</span>
                      <button onClick={() => requestItemDelete(`高速代「${h.fromIC || ""}IC〜${h.toIC || ""}IC」`, () => removePersonHighway(p.id, h.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, marginLeft: "auto" }}>
                        <Trash2 size={14} color="#5A5F6B" />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <LabeledField label="片道の金額">
                        <input type="text" inputMode="numeric" value={h.amount} placeholder="0" onChange={(e) => updatePersonHighway(p.id, h.id, { amount: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                      </LabeledField>
                      <Chip active={h.roundTrip} onClick={() => updatePersonHighway(p.id, h.id, { roundTrip: !h.roundTrip })}>往復{h.roundTrip ? "（×2）✓" : ""}</Chip>
                    </div>
                    <div style={{ color: "#F5A623", fontSize: 12, fontWeight: 800, textAlign: "right", marginTop: 8 }}>小計 {yen(highwayItemTotal(h))}</div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => addPersonHighway(p.id, "")}
              style={{ marginTop: 8, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 10, padding: "9px", color: "#F5A623", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Plus size={13} /> 高速代を追加する
            </button>

            <div style={{ color: "#C7CBD4", fontSize: 12, fontWeight: 700, margin: "14px 0 6px" }}>諸経費</div>
            <ChipRow>
              {EXPENSE_LABEL_PRESETS.map((label) => (
                <Chip key={label} onClick={() => addPersonExpense(p.id, label)}>{label}</Chip>
              ))}
              <Chip onClick={() => setShowAddExpenseForPerson(p.id)} isAdd><Plus size={14} /> その他</Chip>
            </ChipRow>
            {p.expenses.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {p.expenses.map((e) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "8px 10px", flexWrap: "wrap" }}>
                    <input value={e.label} onChange={(ev) => updatePersonExpense(p.id, e.id, { label: ev.target.value })} style={{ ...inputStyle, flex: "1 1 70px", minWidth: 0, background: "transparent", border: "none", padding: "2px 0" }} />
                    <input type="text" inputMode="numeric" placeholder="0" value={e.amount === 0 ? "" : String(e.amount)} onChange={(ev) => updatePersonExpense(p.id, e.id, { amount: Number(ev.target.value.replace(/[^0-9]/g, "") || 0) })} style={{ ...inputStyle, width: 80, flexShrink: 0, boxSizing: "border-box", textAlign: "right" }} />
                    <span style={{ color: "#8A8F9C", fontSize: 11 }}>円</span>
                    <button onClick={() => requestItemDelete(`諸経費「${e.label || "項目"}」`, () => removePersonExpense(p.id, e.id))} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                      <Trash2 size={13} color="#8A8F9C" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: "#F5A623", fontSize: 13, fontWeight: 800, textAlign: "right", marginTop: 10 }}>
              小計 {yen(personTotal(p))}
            </div>
          </div>
        ))}

        <button
          onClick={addPerson}
          style={{ marginTop: 14, width: "100%", background: "#242832", border: "1px dashed #F5A623", borderRadius: 12, padding: "12px", color: "#F5A623", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}
        >
          <Plus size={15} />同じ現場でもう1人分を追加する
        </button>

        <Section label="メモ（任意）">
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="現場の内容など" style={{ ...inputStyle, width: "100%", minHeight: 60, resize: "vertical", boxSizing: "border-box" }} />
        </Section>

        {company && ninku > 0 && !isDuplicateCombo && !comboSaved && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#2A2E38", border: "1px dashed #F5A623", borderRadius: 10, padding: "10px 12px" }}>
            <span style={{ color: "#F5A623", fontSize: 12, fontWeight: 600 }}>この組み合わせをワンタップ用に登録する？</span>
            <button
              onClick={() => { onSaveCombo(buildJob()); setComboSaved(true); }}
              style={{ background: "#F5A623", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: "#1C1F26", cursor: "pointer" }}
            >
              登録
            </button>
          </div>
        )}
        {comboSaved && <div style={{ marginTop: 10, color: "#8FD19E", fontSize: 11 }}>✓ ワンタップ用に登録しました</div>}

        <div style={{ marginTop: 18, background: "linear-gradient(135deg,#F5A623,#E8871E)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>
            {extraPeople.length > 0 ? `この件の合計（${extraPeople.length + 1}人分）` : "この件の合計"}
          </div>
          <div style={{ color: "#1C1F26", fontSize: 24, fontWeight: 800 }}>
            {yen(total + extraPeople.reduce((s, p) => s + personTotal(p), 0))}
          </div>
          {(ninkuTaxYen + overtimeTaxYen + expensesTaxYen + extraPeople.reduce((s, p) => s + personTaxAmount(p), 0)) > 0 && (
            <div style={{ color: "#3A2A08", fontSize: 11, marginTop: 4 }}>うち税金 {yen(ninkuTaxYen + overtimeTaxYen + expensesTaxYen + extraPeople.reduce((s, p) => s + personTaxAmount(p), 0))}</div>
          )}
        </div>

        <button onClick={save} style={{ marginTop: 16, width: "100%", background: "#F5A623", border: "none", borderRadius: 12, padding: "14px", color: "#1C1F26", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
          <Check size={18} />保存する
        </button>
      </div>

      {showAddCompany && (
        <Modal onClose={() => setShowAddCompany(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>会社を追加</div>
          <input autoFocus value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="会社名" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addCompany} style={modalBtnStyle}>決定</button>
        </Modal>
      )}
      {showAddSite && (
        <Modal onClose={() => setShowAddSite(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>現場名を追加</div>
          <input autoFocus value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="例: 〇〇マンション新築工事" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addSite} style={modalBtnStyle}>決定</button>
        </Modal>
      )}
      {showAddName && (
        <Modal onClose={() => setShowAddName(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>名前を追加</div>
          <input autoFocus value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="例: 山田" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addNamePresetDirect} style={modalBtnStyle}>決定</button>
        </Modal>
      )}
      {showAddNinku && (
        <Modal onClose={() => setShowAddNinku(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>人工の金額を追加</div>
          <input autoFocus type="number" value={newNinkuValue} onChange={(e) => setNewNinkuValue(e.target.value)} placeholder="例: 22000" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addNinku} style={modalBtnStyle}>決定</button>
        </Modal>
      )}
      {showAddOvertimeRate && (
        <Modal onClose={() => setShowAddOvertimeRate(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>時給換算を追加</div>
          <input autoFocus type="number" value={newOvertimeRateValue} onChange={(e) => setNewOvertimeRateValue(e.target.value)} placeholder="例: 3000" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addOvertimeRatePreset} style={modalBtnStyle}>決定</button>
        </Modal>
      )}
      {showAddExpense && (
        <Modal onClose={() => setShowAddExpense(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>諸経費を追加</div>
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 6 }}>項目名</div>
          <input autoFocus value={newExpenseLabel} onChange={(e) => setNewExpenseLabel(e.target.value)} placeholder="例: 駐車場代" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>金額</div>
          <input type="text" inputMode="numeric" value={newExpenseAmount} onChange={(e) => setNewExpenseAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="例: 500" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addCustomExpense} style={modalBtnStyle}>追加する</button>
        </Modal>
      )}
      {showAddExpenseForPerson !== null && (
        <Modal onClose={() => setShowAddExpenseForPerson(null)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>諸経費を追加</div>
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 6 }}>項目名</div>
          <input autoFocus value={newPersonExpenseLabel} onChange={(e) => setNewPersonExpenseLabel(e.target.value)} placeholder="例: 駐車場代" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>金額</div>
          <input type="text" inputMode="numeric" value={newPersonExpenseAmount} onChange={(e) => setNewPersonExpenseAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="例: 500" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addCustomPersonExpense} style={modalBtnStyle}>追加する</button>
        </Modal>
      )}
      {showAddRoute && (
        <Modal onClose={() => setShowAddRoute(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>ルートを登録</div>
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 6 }}>呼び名（例: 自宅→A社）</div>
          <input autoFocus value={newRouteMemo} onChange={(e) => setNewRouteMemo(e.target.value)} placeholder="例: 自宅→A社" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>距離(km)</div>
          <input type="text" inputMode="numeric" value={newRouteKm} onChange={(e) => setNewRouteKm(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="例: 18" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={registerRoute} style={modalBtnStyle}>登録する</button>
        </Modal>
      )}
      {showAddHighwayPreset && (
        <Modal onClose={() => setShowAddHighwayPreset(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>高速代プリセットを登録</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input autoFocus value={newHighwayFromIC} onChange={(e) => setNewHighwayFromIC(e.target.value)} placeholder="〇〇" style={{ ...inputStyle, width: 90, boxSizing: "border-box" }} />
            <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC〜</span>
            <input value={newHighwayToIC} onChange={(e) => setNewHighwayToIC(e.target.value)} placeholder="〇〇" style={{ ...inputStyle, width: 90, boxSizing: "border-box" }} />
            <span style={{ color: "#8A8F9C", fontSize: 12 }}>IC</span>
          </div>
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>金額（片道）</div>
          <input type="text" inputMode="numeric" value={newHighwayAmount} onChange={(e) => setNewHighwayAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="例: 1500" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={registerHighwayPreset} style={modalBtnStyle}>登録する</button>
        </Modal>
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>削除しますか？</div>
          <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 16 }}>「{confirmDelete.label}」をプリセットから削除します</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button onClick={confirmDeleteNow} style={{ flex: 1, background: "#E85D5D", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>削除する</button>
          </div>
        </Modal>
      )}
      {confirmItemDelete && (
        <Modal onClose={() => setConfirmItemDelete(null)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>削除しますか？</div>
          <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 16 }}>{confirmItemDelete.label}を削除します</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmItemDelete(null)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => { confirmItemDelete.onConfirm(); setConfirmItemDelete(null); }}
              style={{ flex: 1, background: "#E85D5D", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- プリセット編集用の小さい部品 ----
function EditToggleButton({ editing, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: editing ? "#F5A623" : "#242832",
        border: "1px solid #F5A623",
        borderRadius: 8,
        color: editing ? "#1C1F26" : "#F5A623",
        fontSize: 11, fontWeight: 800, cursor: "pointer", padding: "5px 10px",
        display: "flex", alignItems: "center", gap: 4,
      }}
    >
      <Pencil size={11} />
      {editing ? "完了" : "編集"}
    </button>
  );
}
function ChipWithDelete({ editing, onDelete, children }) {
  return (
    <div style={{ position: "relative" }}>
      {children}
      {editing && (
        <button
          onClick={onDelete}
          style={{
            position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: 11,
            background: "#E85D5D", border: "2px solid #1C1F26", color: "#fff", fontSize: 13, fontWeight: 800,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ------------------- まとめて予定追加画面 -------------------
function BulkAddView({ initialYear, initialMonth, entries, comboPresets, sitePresets, onBack, onApply, onBulkDelete, onBulkTax }) {
  const [mode, setMode] = useState("add"); // "add" | "delete" | "tax"
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [selectedPreset, setSelectedPreset] = useState(comboPresets[0] || null);
  const [overrideSite, setOverrideSite] = useState(""); // 空なら現場名はプリセットのまま
  const [selectedDates, setSelectedDates] = useState([]); // ["2026-08-07", ...]
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkTaxEnabled, setBulkTaxEnabled] = useState(true);
  const [bulkTaxRateStr, setBulkTaxRateStr] = useState("10");
  const [confirmBulkTax, setConfirmBulkTax] = useState(false);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y);
  };

  const toggleDate = (k) => {
    setSelectedDates((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const apply = () => {
    if (!selectedPreset || selectedDates.length === 0) return;
    const { id, ...job } = selectedPreset;
    const finalJob = overrideSite ? { ...job, site: overrideSite } : job;
    onApply(selectedDates, { ...finalJob });
  };

  const selectedDatesWithData = selectedDates.filter((k) => (entries[k] || []).length > 0);

  const modeTitle = mode === "add" ? "まとめて予定を追加" : mode === "delete" ? "まとめて予定を削除" : "まとめて税金を設定";

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>{modeTitle}</div>
        </div>

        <ChipRow>
          <Chip active={mode === "add"} onClick={() => { setMode("add"); setSelectedDates([]); }}>まとめて追加</Chip>
          <Chip active={mode === "delete"} onClick={() => { setMode("delete"); setSelectedDates([]); }}>まとめて削除</Chip>
          <Chip active={mode === "tax"} onClick={() => { setMode("tax"); setSelectedDates([]); }}>まとめて税金</Chip>
        </ChipRow>
        <div style={{ marginBottom: 18 }} />

        {mode === "add" && comboPresets.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#8A8F9C", fontSize: 13, lineHeight: 1.7 }}>
            まだワンタップ用のプリセットがありません。<br />
            先に通常の入力画面で会社・人工などを入力し、<br />
            「ワンタップ用に登録する」から作成してください。
          </div>
        )}

        {mode === "add" && comboPresets.length > 0 && (
          <>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>① 追加する内容を選ぶ</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
              {comboPresets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPreset(p)}
                  style={{
                    padding: "10px 14px", borderRadius: 12,
                    border: selectedPreset?.id === p.id ? "1.5px solid #F5A623" : "1px solid #333846",
                    background: selectedPreset?.id === p.id ? "rgba(245,166,35,0.15)" : "#242832",
                    color: selectedPreset?.id === p.id ? "#F5A623" : "#C7CBD4",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  <span>{p.company || "会社未設定"}{p.site ? `　${p.site}` : ""}</span>
                  <span style={{ fontWeight: 500, fontSize: 11, opacity: 0.8 }}>{yen(jobTotal(p))}</span>
                </button>
              ))}
            </div>

            {sitePresets.length > 0 && (
              <>
                <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                  ② 現場名を変更する（任意）
                </div>
                <div style={{ color: "#5A5F6B", fontSize: 11, marginBottom: 8 }}>
                  選ぶと、選択した内容の現場名をまとめて上書きします。選ばなければプリセットの現場名のままです。
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
                  <Chip active={overrideSite === ""} onClick={() => setOverrideSite("")}>変更しない</Chip>
                  {sitePresets.map((s) => (
                    <Chip key={s} active={overrideSite === s} onClick={() => setOverrideSite(s)}>{s}</Chip>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {mode === "tax" && (
          <>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>① 税金の設定を選ぶ</div>
            <ChipRow>
              <Chip active={bulkTaxEnabled} onClick={() => setBulkTaxEnabled(true)}>税金を適用する</Chip>
              <Chip active={!bulkTaxEnabled} onClick={() => setBulkTaxEnabled(false)}>税金を適用しない（解除）</Chip>
            </ChipRow>
            {bulkTaxEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 22 }}>
                <input type="text" inputMode="numeric" value={bulkTaxRateStr} onChange={(e) => setBulkTaxRateStr(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...inputStyle, width: 70, boxSizing: "border-box" }} />
                <span style={{ color: "#8A8F9C", fontSize: 12 }}>%</span>
              </div>
            )}
            <p style={{ color: "#5A5F6B", fontSize: 11, marginBottom: 8 }}>
              選んだ日付のすべての仕事（追加の人も含む）に、この設定を一括で反映します。
            </p>
          </>
        )}

        {(mode === "delete" || mode === "tax" || comboPresets.length > 0) && (
          <>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              {mode === "delete" ? "削除したい日付を選ぶ" : mode === "tax" ? "② 設定したい日付を選ぶ" : `${sitePresets.length > 0 ? "③" : "②"} 日付を選ぶ`}（{selectedDates.length}件選択中）
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#242832", borderRadius: 14, padding: "10px 14px", marginBottom: 12, border: "1px solid #333846" }}>
              <button onClick={() => changeMonth(-1)} style={iconBtnStyle}><ChevronLeft size={20} color="#F5A623" /></button>
              <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{year}年 {month}月</div>
              <button onClick={() => changeMonth(1)} style={iconBtnStyle}><ChevronRight size={20} color="#F5A623" /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 6 }}>
              {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
                <div key={d} style={{ textAlign: "center", fontSize: 11, color: i === 0 ? "#E85D5D" : i === 6 ? "#5D9CE8" : "#8A8F9C", fontWeight: 700 }}>{d}</div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={"empty" + i} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const k = keyOf(year, month, day);
                const isSelected = selectedDates.includes(k);
                const hasExisting = (entries[k] || []).length > 0;
                return (
                  <button
                    key={day}
                    onClick={() => toggleDate(k)}
                    style={{
                      aspectRatio: "1", borderRadius: 10,
                      border: isSelected ? "1.5px solid #F5A623" : "1px solid #2E323C",
                      background: isSelected ? "#F5A623" : hasExisting ? "#2E3A2E" : "#242832",
                      color: isSelected ? "#1C1F26" : "#C7CBD4",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: 13, fontWeight: isSelected ? 800 : 600,
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            {mode === "add" ? (
              <p style={{ color: "#5A5F6B", fontSize: 11, marginTop: 10 }}>
                緑っぽい日はすでに入力がある日です。選択すると追加で登録されます（上書きではありません）。
              </p>
            ) : mode === "delete" ? (
              <p style={{ color: "#5A5F6B", fontSize: 11, marginTop: 10 }}>
                緑っぽい日は入力がある日です。選んだ日付の予定はすべて削除されます（一部だけ消すことはできません）。
              </p>
            ) : (
              <p style={{ color: "#5A5F6B", fontSize: 11, marginTop: 10 }}>
                緑っぽい日は入力がある日です。選んだ日付のすべての仕事に、上で選んだ税金設定が一括で反映されます。
              </p>
            )}
          </>
        )}
      </div>

      {mode === "add" && comboPresets.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1C1F26", borderTop: "1px solid #333846", padding: "12px 16px" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <button
              onClick={apply}
              disabled={!selectedPreset || selectedDates.length === 0}
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "14px",
                background: selectedPreset && selectedDates.length > 0 ? "#F5A623" : "#3A3F4A",
                color: selectedPreset && selectedDates.length > 0 ? "#1C1F26" : "#6B7280",
                fontSize: 15, fontWeight: 800, cursor: selectedPreset && selectedDates.length > 0 ? "pointer" : "not-allowed",
              }}
            >
              {selectedDates.length > 0 ? `${selectedDates.length}件の日付に追加する` : "日付を選んでください"}
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1C1F26", borderTop: "1px solid #333846", padding: "12px 16px" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={selectedDatesWithData.length === 0}
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "14px",
                background: selectedDatesWithData.length > 0 ? "#E85D5D" : "#3A3F4A",
                color: selectedDatesWithData.length > 0 ? "#fff" : "#6B7280",
                fontSize: 15, fontWeight: 800, cursor: selectedDatesWithData.length > 0 ? "pointer" : "not-allowed",
              }}
            >
              {selectedDatesWithData.length > 0 ? `${selectedDatesWithData.length}件の日付の予定を削除する` : "予定のある日付を選んでください"}
            </button>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <Modal onClose={() => setConfirmBulkDelete(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>削除しますか？</div>
          <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 16 }}>
            選んだ{selectedDatesWithData.length}件の日付の予定を、すべて削除します。この操作は元に戻せません。
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmBulkDelete(false)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => { onBulkDelete(selectedDatesWithData); setConfirmBulkDelete(false); }}
              style={{ flex: 1, background: "#E85D5D", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}

      {mode === "tax" && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1C1F26", borderTop: "1px solid #333846", padding: "12px 16px" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <button
              onClick={() => setConfirmBulkTax(true)}
              disabled={selectedDatesWithData.length === 0}
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "14px",
                background: selectedDatesWithData.length > 0 ? "#F5A623" : "#3A3F4A",
                color: selectedDatesWithData.length > 0 ? "#1C1F26" : "#6B7280",
                fontSize: 15, fontWeight: 800, cursor: selectedDatesWithData.length > 0 ? "pointer" : "not-allowed",
              }}
            >
              {selectedDatesWithData.length > 0 ? `${selectedDatesWithData.length}件の日付に反映する` : "予定のある日付を選んでください"}
            </button>
          </div>
        </div>
      )}

      {confirmBulkTax && (
        <Modal onClose={() => setConfirmBulkTax(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>反映しますか？</div>
          <div style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 16 }}>
            選んだ{selectedDatesWithData.length}件の日付のすべての仕事に、
            {bulkTaxEnabled ? `税率${bulkTaxRateStr || 0}%の税金を適用します。` : "税金の適用を解除します。"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmBulkTax(false)} style={{ flex: 1, background: "#242832", border: "1px solid #444A58", borderRadius: 10, padding: "11px", color: "#C7CBD4", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => { onBulkTax(selectedDatesWithData, bulkTaxEnabled, Number(bulkTaxRateStr || 0)); setConfirmBulkTax(false); }}
              style={{ flex: 1, background: "#F5A623", border: "none", borderRadius: 10, padding: "11px", color: "#1C1F26", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              反映する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------- 会社ごとの履歴画面 -------------------
function HistoryView({ entries, companies, sitePresets, onBack, onOpenDate }) {
  const [groupBy, setGroupBy] = useState("company"); // "company" | "site"

  // entries全体から、会社ごと・現場ごとに「日付・相手先・金額」のリストを作る
  const byCompany = useMemo(() => {
    const map = {};
    Object.entries(entries).forEach(([k, jobs]) => {
      (jobs || []).forEach((j) => {
        const c = j.company || "未設定";
        if (!map[c]) map[c] = [];
        map[c].push({ date: k, sub: j.site || "", total: jobTotal(j) });
      });
    });
    Object.keys(map).forEach((c) => map[c].sort((a, b) => b.date.localeCompare(a.date)));
    return map;
  }, [entries]);

  const bySite = useMemo(() => {
    const map = {};
    Object.entries(entries).forEach(([k, jobs]) => {
      (jobs || []).forEach((j) => {
        if (!j.site) return; // 現場名が無い記録は現場別履歴には出さない
        if (!map[j.site]) map[j.site] = [];
        map[j.site].push({ date: k, sub: j.company || "", total: jobTotal(j) });
      });
    });
    Object.keys(map).forEach((s) => map[s].sort((a, b) => b.date.localeCompare(a.date)));
    return map;
  }, [entries]);

  const groupMap = groupBy === "company" ? byCompany : bySite;
  const nameSource = groupBy === "company" ? companies : sitePresets;

  const allNames = useMemo(() => {
    const set = new Set([...nameSource, ...Object.keys(groupMap)]);
    return Array.from(set).filter((n) => (groupMap[n] || []).length > 0);
  }, [nameSource, groupMap]);

  const [selected, setSelected] = useState(allNames[0] || null);

  // グループ切り替え時に、選択中の項目がリストに無ければ先頭を選び直す
  if (selected && !allNames.includes(selected) && allNames.length > 0) {
    setSelected(allNames[0]);
  }

  const formatDate = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return `${y}年${m}月${d}日`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>履歴</div>
        </div>

        <ChipRow>
          <Chip active={groupBy === "company"} onClick={() => { setGroupBy("company"); setSelected(null); }}>会社ごと</Chip>
          <Chip active={groupBy === "site"} onClick={() => { setGroupBy("site"); setSelected(null); }}>現場ごと</Chip>
        </ChipRow>

        {allNames.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#8A8F9C", fontSize: 13 }}>
            {groupBy === "company" ? "まだ入力がありません" : "現場名が入力された記録がまだありません"}
          </div>
        ) : (
          <>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, margin: "18px 0 8px" }}>
              {groupBy === "company" ? "会社を選ぶ" : "現場を選ぶ"}
            </div>
            <ChipRow>
              {allNames.map((n) => (
                <Chip key={n} active={selected === n} onClick={() => setSelected(n)}>
                  {n}（{(groupMap[n] || []).length}件）
                </Chip>
              ))}
            </ChipRow>

            {selected && (
              <div style={{ marginTop: 20 }}>
                <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                  {selected} の記録（{(groupMap[selected] || []).length}件）
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(groupMap[selected] || []).map((r, i) => (
                    <button
                      key={i}
                      onClick={() => onOpenDate(r.date)}
                      style={{ width: "100%", textAlign: "left", background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                    >
                      <div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{formatDate(r.date)}</div>
                        {r.sub && <div style={{ color: "#6B7280", fontSize: 11, marginTop: 2 }}>{r.sub}</div>}
                      </div>
                      <div style={{ color: "#F5A623", fontSize: 14, fontWeight: 800 }}>{yen(r.total)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------- 請求内容確認画面 -------------------
function InvoiceView({ year, month, entries, onBack, profile, setProfile, paymentStatus, setPaymentStatus, pdfLayout, onOpenDate }) {
  const rows = useMemo(() => {
    const out = [];
    Object.entries(entries)
      .filter(([k]) => k.startsWith(monthKey(year, month)))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, jobs]) => {
        (jobs || []).forEach((j) => {
          const extra = j.extraPeople || [];
          const combinedNinku = (j.ninku || 0) + extra.reduce((s, p) => s + (p.ninku || 0), 0);
          const combinedOvertime = (j.overtimeAmount || 0) + extra.reduce((s, p) => s + (p.overtimeAmount || 0), 0);
          const mainSplit = splitLegacyTransportExpenses(j.expenses);
          const combinedTransports = [...(j.transports || []), ...mainSplit.transportLike, ...extra.flatMap((p) => {
            const s = splitLegacyTransportExpenses(p.expenses);
            return [...(p.transports || []), ...s.transportLike];
          })];
          const combinedHighways = [...(j.highways || []), ...extra.flatMap((p) => p.highways || [])];
          const combinedExpenses = [
            ...mainSplit.other.map((e) => ({ ...e, label: j.personName ? `${j.personName}：${e.label}` : e.label })),
            ...extra.flatMap((p) => splitLegacyTransportExpenses(p.expenses).other.map((e) => ({ ...e, label: p.name ? `${p.name}：${e.label}` : e.label }))),
          ];
          const combinedTax = totalTax(j) + extra.reduce((s, p) => s + totalTax(p), 0);
          out.push({
            date: k, day: Number(k.split("-")[2]), company: j.company || "-", site: j.site || "",
            people: [j.personName, ...extra.map((p) => p.name)].filter(Boolean),
            ninku: combinedNinku, overtime: combinedOvertime,
            transport: transportsTotal(combinedTransports), transports: combinedTransports,
            highway: highwaysTotal(combinedHighways), highways: combinedHighways,
            miscExpense: expensesTotal(combinedExpenses), expenses: combinedExpenses,
            tax: combinedTax,
            total: jobTotal(j),
          });
        });
      });
    return out;
  }, [entries, year, month]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const grandTaxTotal = rows.reduce((s, r) => s + (r.tax || 0), 0);
  const byCompany = useMemo(() => {
    const map = {};
    rows.forEach((r) => { map[r.company] = (map[r.company] || 0) + r.total; });
    return Object.entries(map);
  }, [rows]);
  const companyList = byCompany.map(([c]) => c);

  // 入金済みかどうかの管理(月+会社ごと。会社を分けていない月は「全体」で1つ)
  const paymentKey = (companyName) => `${year}-${month}-${companyName || "全体"}`;
  const isPaid = (companyName) => !!paymentStatus[paymentKey(companyName)];
  const togglePaid = (companyName) => {
    const key = paymentKey(companyName);
    setPaymentStatus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // PDF用: 1行=1人分のデータ(名前・現場名・現場住所を列で分けるため)
  const personRows = useMemo(() => {
    const out = [];
    Object.entries(entries)
      .filter(([k]) => k.startsWith(monthKey(year, month)))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, jobs]) => {
        (jobs || []).forEach((j) => {
          const day = Number(k.split("-")[2]);
          const base = { date: k, day, company: j.company || "-", site: j.site || "", siteAddress: j.siteAddress || "" };
          const mainSplit = splitLegacyTransportExpenses(j.expenses);
          out.push({
            ...base, name: j.personName || "",
            ninku: j.ninku || 0, overtime: j.overtimeAmount || 0,
            transport: transportsTotal(j.transports) + expensesTotal(mainSplit.transportLike),
            transports: [...(j.transports || []), ...mainSplit.transportLike.map((e) => ({ id: e.id, memo: e.label, km: "", ratePerKm: "", __legacyAmount: e.amount }))],
            highway: highwaysTotal(j.highways), highways: j.highways || [],
            miscExpense: expensesTotal(mainSplit.other), expenses: mainSplit.other,
            tax: totalTax(j),
            total: personAmount(j),
          });
          (j.extraPeople || []).forEach((p) => {
            const pSplit = splitLegacyTransportExpenses(p.expenses);
            out.push({
              ...base, name: p.name || "",
              ninku: p.ninku || 0, overtime: p.overtimeAmount || 0,
              transport: transportsTotal(p.transports) + expensesTotal(pSplit.transportLike),
              transports: [...(p.transports || []), ...pSplit.transportLike.map((e) => ({ id: e.id, memo: e.label, km: "", ratePerKm: "", __legacyAmount: e.amount }))],
              highway: highwaysTotal(p.highways), highways: p.highways || [],
              miscExpense: expensesTotal(pSplit.other), expenses: pSplit.other,
              tax: totalTax(p),
              total: personAmount(p),
            });
          });
        });
      });
    return out;
  }, [entries, year, month]);

  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [pdfCompanyFilter, setPdfCompanyFilter] = useState("__all__");

  if (showPdfPreview) {
    const filteredPersonRows = pdfCompanyFilter === "__all__" ? personRows : personRows.filter((r) => r.company === pdfCompanyFilter);
    const filteredTotal = filteredPersonRows.reduce((s, r) => s + r.total, 0);
    return (
      <PdfPreview
        year={year} month={month} rows={filteredPersonRows} grandTotal={filteredTotal}
        companyLabel={pdfCompanyFilter !== "__all__" ? pdfCompanyFilter : (companyList.length === 1 ? companyList[0] : "")}
        profile={profile}
        pdfLayout={pdfLayout}
        onBack={() => setShowPdfPreview(false)}
      />
    );
  }

  if (showProfileEdit) {
    return <ProfileEditView profile={profile} setProfile={setProfile} onBack={() => setShowProfileEdit(false)} />;
  }


  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FileText size={18} color="#F5A623" />
            <div style={{ color: "#fff", fontSize: 17, fontWeight: 800 }}>{year}年{month}月 請求内容の確認</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#5A5F6B" }}>この月の入力はまだありません</div>
        ) : (
          <>
            <div style={{ background: "linear-gradient(135deg,#F5A623,#E8871E)", borderRadius: 14, padding: "16px 18px", marginBottom: byCompany.length > 1 ? 10 : 16 }}>
              <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>請求合計</div>
              <div style={{ color: "#1C1F26", fontSize: 28, fontWeight: 800 }}>{yen(grandTotal)}</div>
              {grandTaxTotal > 0 && <div style={{ color: "#3A2A08", fontSize: 12, marginTop: 4 }}>うち税金合計 {yen(grandTaxTotal)}</div>}
            </div>
            {byCompany.length === 1 && (
              <button
                onClick={() => togglePaid(byCompany[0][0])}
                style={{
                  width: "100%", marginBottom: 16, borderRadius: 10, padding: "10px",
                  background: isPaid(byCompany[0][0]) ? "rgba(143,209,158,0.15)" : "#242832",
                  border: isPaid(byCompany[0][0]) ? "1px solid #8FD19E" : "1px solid #333846",
                  color: isPaid(byCompany[0][0]) ? "#8FD19E" : "#8A8F9C",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                {isPaid(byCompany[0][0]) ? "✓ 入金済み" : "入金済みにする"}
              </button>
            )}
            {byCompany.length > 1 && (
              <div style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ color: "#8A8F9C", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>会社別 小計・入金状況</div>
                {byCompany.map(([c, t]) => (
                  <div key={c} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#C7CBD4", fontSize: 13 }}>{c}</span>
                      {isPaid(c) && <span style={{ color: "#8FD19E", fontSize: 10, fontWeight: 800, border: "1px solid #8FD19E", borderRadius: 5, padding: "1px 5px" }}>入金済</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{yen(t)}</span>
                      <button
                        onClick={() => togglePaid(c)}
                        style={{
                          background: isPaid(c) ? "#8FD19E" : "#333846", border: "none", borderRadius: 6,
                          color: isPaid(c) ? "#1C1F26" : "#C7CBD4", fontSize: 10, fontWeight: 700, padding: "4px 8px", cursor: "pointer",
                        }}
                      >
                        {isPaid(c) ? "取消" : "入金済にする"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ color: "#8A8F9C", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>明細（{rows.length}件）</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r, i) => (
                <button
                  key={i}
                  onClick={() => onOpenDate(r.date)}
                  style={{ width: "100%", textAlign: "left", background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                >
                  <div>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>
                      {month}月{r.day}日　{r.company}{r.site ? `　${r.site}` : ""}
                    </div>
                    {r.people && r.people.length > 0 && (
                      <div style={{ color: "#8A8F9C", fontSize: 11 }}>{r.people.join("・")}</div>
                    )}
                    <div style={{ color: "#6B7280", fontSize: 11 }}>人工{yen(r.ninku)} ／ 残業{yen(r.overtime)}{r.tax > 0 ? ` ／ 税金${yen(r.tax)}` : ""}</div>
                    {r.transports && r.transports.length > 0 && (
                      <div style={{ color: "#6B7280", fontSize: 11 }}>
                        燃料費：{r.transports.map((t) => `${t.memo || "移動"}${yen(transportItemTotal(t))}`).join(" ／ ")}
                      </div>
                    )}
                    {r.highways && r.highways.length > 0 && (
                      <div style={{ color: "#6B7280", fontSize: 11 }}>
                        高速代：{r.highways.map((h) => `${h.fromIC ? `${h.fromIC}IC〜${h.toIC}IC` : "高速代"}${yen(highwayItemTotal(h))}`).join(" ／ ")}
                      </div>
                    )}
                    {r.expenses && r.expenses.length > 0 && (
                      <div style={{ color: "#6B7280", fontSize: 11 }}>
                        諸経費：{r.expenses.map((e) => `${e.label}${yen(e.amount)}`).join(" ／ ")}
                      </div>
                    )}
                  </div>
                  <div style={{ color: "#F5A623", fontSize: 14, fontWeight: 800 }}>{yen(r.total)}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {companyList.length > 1 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>請求書を作る会社を選ぶ</div>
            <ChipRow>
              <Chip active={pdfCompanyFilter === "__all__"} onClick={() => setPdfCompanyFilter("__all__")}>全部まとめて</Chip>
              {companyList.map((c) => (
                <Chip key={c} active={pdfCompanyFilter === c} onClick={() => setPdfCompanyFilter(c)}>{c}のみ</Chip>
              ))}
            </ChipRow>
          </div>
        )}

        <button
          onClick={() => setShowPdfPreview(true)}
          style={{ marginTop: 20, width: "100%", background: "#242832", border: "1px solid #F5A623", borderRadius: 12, padding: "13px", color: "#F5A623", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
        >
          <FileText size={16} />請求書のプレビューを見る
        </button>
        <button
          onClick={() => setShowProfileEdit(true)}
          style={{ marginTop: 10, width: "100%", background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: "12px", color: "#C7CBD4", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
        >
          <Pencil size={14} />発行者名・振込先を設定する
        </button>
      </div>
    </div>
  );
}

// ------------------- PDFプレビュー画面(白い紙面イメージ・手入力で編集可) -------------------
// ------------------- 発行者名・振込先の設定画面 -------------------
// ------------------- 設定画面 -------------------
function SettingsView({ pdfLayout, setPdfLayout, onBack }) {
  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>設定</div>
        </div>

        <Section label="請求書（PDF）の向き">
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 10 }}>
            縦表示は今まで通り、日付が縦に並ぶ形です。横表示にすると、日付が横に並び、人工・残業代・諸経費などが縦に並ぶ形になります。1度選んだ後、自動で元に戻ることはありません。
          </div>
          <ChipRow>
            <Chip active={pdfLayout === "portrait"} onClick={() => setPdfLayout("portrait")}>縦表示（今まで通り）</Chip>
            <Chip active={pdfLayout === "landscape"} onClick={() => setPdfLayout("landscape")}>横表示</Chip>
          </ChipRow>
        </Section>
      </div>
    </div>
  );
}

function ProfileEditView({ profile, setProfile, onBack }) {
  const [issuerName, setIssuerName] = useState(profile?.issuerName || "");
  const [bankInfo, setBankInfo] = useState(profile?.bankInfo || "");
  const [closingDay, setClosingDay] = useState(profile?.closingDay || "末日");
  const [invoiceNumber, setInvoiceNumber] = useState(profile?.invoiceNumber || "");
  const [saved, setSaved] = useState(false);

  const closingPresets = ["10日", "15日", "20日", "25日", "末日"];
  const isCustom = closingDay && !closingPresets.includes(closingDay);

  const save = () => {
    setProfile({ issuerName, bankInfo, closingDay, invoiceNumber });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1C1F26", fontFamily: "'Zen Kaku Gothic New','Hiragino Sans',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtnStyle}><ChevronLeft size={22} color="#F5A623" /></button>
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 800 }}>発行者名・振込先の設定</div>
        </div>
        <p style={{ color: "#8A8F9C", fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
          ここで登録しておくと、請求書のプレビューを開いた時に自動で入力された状態になります。プレビュー画面でも個別に修正できます。
        </p>

        <Section label="発行者名（自分の名前・屋号など）">
          <ManualInput placeholder="例: 山田太郎" value={issuerName} onChange={setIssuerName} />
        </Section>

        <Section label="登録番号（Tから始まる番号・任意）">
          <ManualInput placeholder="例: T1234567890123" value={invoiceNumber} onChange={setInvoiceNumber} />
        </Section>

        <Section label="締め日">
          <ChipRow>
            {closingPresets.map((d) => (
              <Chip key={d} active={closingDay === d} onClick={() => setClosingDay(d)}>{d}</Chip>
            ))}
          </ChipRow>
          <ManualInput
            placeholder="その他（例: 5日）"
            value={isCustom ? closingDay : ""}
            onChange={setClosingDay}
          />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 6 }}>
            発行日プレビューの日付が、選んだ締め日で自動的に入るようになります
          </div>
        </Section>

        <Section label="振込先">
          <textarea
            value={bankInfo}
            onChange={(e) => setBankInfo(e.target.value)}
            placeholder={"例:\n〇〇銀行 〇〇支店\n普通 1234567\n山田太郎"}
            style={{ ...inputStyle, width: "100%", minHeight: 100, resize: "vertical", boxSizing: "border-box" }}
          />
        </Section>

        <button
          onClick={save}
          style={{ marginTop: 20, width: "100%", background: "#F5A623", border: "none", borderRadius: 12, padding: "14px", color: "#1C1F26", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
        >
          <Check size={18} />保存する
        </button>
        {saved && <div style={{ marginTop: 10, color: "#8FD19E", fontSize: 12, textAlign: "center" }}>✓ 保存しました</div>}
      </div>
    </div>
  );
}

// ------------------- PDF横表示テーブル(日付が横、項目が縦) -------------------
function PdfTableLandscape({ editableRows, updateRow, printFieldStyle, displayTotal }) {
  const labelStyle = { border: "1px solid #ccc", padding: "5px 7px", background: "#EDEDED", fontWeight: 700, fontSize: 10, whiteSpace: "nowrap", verticalAlign: "top" };
  const cellStyle = { border: "1px solid #ccc", padding: 2, verticalAlign: "top" };

  const CHUNK_SIZE = 5; // 1ページに収める日付の件数(入りきらない分は次のページへ)。列を広めに取って改行を減らす
  const chunks = [];
  for (let i = 0; i < editableRows.length; i += CHUNK_SIZE) {
    chunks.push(editableRows.map((r, idx) => ({ r, idx })).slice(i, i + CHUNK_SIZE));
  }
  const labelColWidth = 11;
  const colWidth = (100 - labelColWidth) / CHUNK_SIZE;

  return (
    <div>
      {chunks.map((chunk, chunkIdx) => (
        <table
          key={chunkIdx}
          className={`pdf-chunk${chunkIdx > 0 ? " pdf-page-break" : ""}`}
          style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 9, marginBottom: 16, breakInside: "avoid", pageBreakInside: "avoid" }}
        >
          <colgroup>
            <col style={{ width: `${labelColWidth}%` }} />
            {chunk.map((_, i) => <col key={i} style={{ width: `${colWidth}%` }} />)}
          </colgroup>
          <tbody>
            <tr>
              <td style={labelStyle}>日にち</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={cellStyle}><AutoGrowInput value={r.dateLabel} onChange={(v) => updateRow(idx, "dateLabel", v)} style={printFieldStyle} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>名前</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={cellStyle}><AutoGrowInput value={r.nameLabel} onChange={(v) => updateRow(idx, "nameLabel", v)} style={printFieldStyle} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>現場名</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={cellStyle}><AutoGrowInput value={r.siteLabel} onChange={(v) => updateRow(idx, "siteLabel", v)} style={printFieldStyle} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>現場の住所</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={cellStyle}><AutoGrowInput value={r.addressLabel} onChange={(v) => updateRow(idx, "addressLabel", v)} style={{ ...printFieldStyle, fontSize: 8.5 }} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>人工</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}><AutoGrowInput value={String(r.ninku)} onChange={(v) => updateRow(idx, "ninku", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>残業代</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}><AutoGrowInput value={String(r.overtime)} onChange={(v) => updateRow(idx, "overtime", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>燃料費</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}>
                  <AutoGrowInput value={String(r.transport)} onChange={(v) => updateRow(idx, "transport", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.transports && r.transports.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.transports.map((t, ti) => (<div key={ti}>{t.memo || "移動"}：{yen(transportItemTotal(t))}</div>))}
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>高速代</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}>
                  <AutoGrowInput value={String(r.highway)} onChange={(v) => updateRow(idx, "highway", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.highways && r.highways.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.highways.map((h, hi) => (<div key={hi}>{h.fromIC ? `${h.fromIC}IC〜${h.toIC}IC` : "高速代"}：{yen(highwayItemTotal(h))}</div>))}
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>諸経費</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}>
                  <AutoGrowInput value={String(r.miscExpense)} onChange={(v) => updateRow(idx, "miscExpense", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.expenses && r.expenses.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.expenses.map((e, ei) => (<div key={ei}>{e.label}：{yen(e.amount)}</div>))}
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelStyle}>税金</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}><AutoGrowInput value={String(r.tax)} onChange={(v) => updateRow(idx, "tax", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
              ))}
            </tr>
            <tr>
              <td style={{ ...labelStyle, background: "#F5F5F5" }}>金額</td>
              {chunk.map(({ r, idx }) => (
                <td key={idx} style={{ ...cellStyle, textAlign: "right" }}><AutoGrowInput value={String(r.total)} onChange={(v) => updateRow(idx, "total", v)} style={{ ...printFieldStyle, textAlign: "right", fontWeight: 700 }} /></td>
              ))}
            </tr>
            {chunkIdx === chunks.length - 1 && (
              <tr>
                <td colSpan={chunk.length + 1} style={{ ...labelStyle, textAlign: "right", background: "#F5F5F5" }}>合計 {yen(displayTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function PdfPreview({ year, month, rows, grandTotal, companyLabel, profile, pdfLayout, onBack }) {
  const lastDay = new Date(year, month, 0).getDate(); // その月の最終日
  const closingDay = profile?.closingDay || "末日";
  const resolvedDay = closingDay === "末日" ? lastDay : Math.min(Number(String(closingDay).replace(/[^0-9]/g, "")) || lastDay, lastDay);
  const [issuer, setIssuer] = useState(profile?.issuerName || "");
  const [invoiceNumber, setInvoiceNumber] = useState(profile?.invoiceNumber || "");
  const [clientName, setClientName] = useState(companyLabel || "");
  const [issueDate, setIssueDate] = useState(`${year}年${month}月${resolvedDay}日`);
  const [bankInfo, setBankInfo] = useState(profile?.bankInfo || "");
  const [note, setNote] = useState("");
  // 明細は表示用にコピーして手入力で修正できるようにする(保存データ自体は変更しない、印刷確認用の一時編集)
  const [editableRows, setEditableRows] = useState(
    rows.map((r) => ({
      ...r,
      dateLabel: `${month}月${r.day}日`,
      nameLabel: r.name || "",
      siteLabel: r.site || "",
      addressLabel: r.siteAddress || "",
    }))
  );

  const updateRow = (idx, field, value) => {
    setEditableRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: ["total", "ninku", "overtime", "transport", "highway", "tax"].includes(field) ? Number(value.replace(/[^0-9]/g, "") || 0) : value };
      return next;
    });
  };

  const displayTotal = editableRows.reduce((s, r) => s + Number(r.total || 0), 0);

  const printFieldStyle = { border: "none", borderBottom: "1px dashed #ccc", background: "transparent", fontSize: 11, padding: "2px 3px", width: "100%", boxSizing: "border-box", color: "#000", minWidth: 0 };

  return (
    <div style={{ minHeight: "100vh", background: "#3A3D45", overflowX: "auto" }}>
      {/* 操作バー(印刷時は隠す) */}
      <div className="no-print" style={{ position: "sticky", top: 0, background: "#1C1F26", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#F5A623", fontSize: 13, fontWeight: 700 }}>
          <ChevronLeft size={20} /> 戻って修正する
        </button>
        <button
          onClick={() => window.print()}
          style={{ background: "#F5A623", border: "none", borderRadius: 10, padding: "9px 16px", color: "#1C1F26", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
        >
          印刷・PDF保存する
        </button>
      </div>
      <p className="no-print" style={{ color: "#C7CBD4", fontSize: 11, textAlign: "center", padding: "8px 16px 0" }}>
        下の白い紙面が実際の印刷イメージです。文字はタップして直接修正できます。
      </p>

      {/* 印刷イメージ(紙面) */}
      <div className="pdf-paper" style={{ background: "#fff", color: "#000", maxWidth: 780, margin: "16px auto", padding: "28px 32px", fontFamily: "'Hiragino Sans','Zen Kaku Gothic New',sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", fontSize: 20, fontWeight: 800, letterSpacing: 6, marginBottom: 20 }}>請求書</div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, fontSize: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 4 }}>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="請求先（会社名）" style={{ ...printFieldStyle, fontSize: 14, fontWeight: 700 }} />
            </div>
            <div style={{ color: "#555" }}>御中</div>
          </div>
          <div style={{ width: 150, textAlign: "right" }}>
            <input value={issueDate} onChange={(e) => setIssueDate(e.target.value)} style={{ ...printFieldStyle, textAlign: "right" }} />
            <div style={{ marginTop: 10 }}>
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="発行者名（自分の名前）" style={{ ...printFieldStyle, textAlign: "right" }} />
            </div>
            <div style={{ marginTop: 6 }}>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="登録番号（任意）" style={{ ...printFieldStyle, textAlign: "right", fontSize: 10, color: "#555" }} />
            </div>
          </div>
        </div>

        <div style={{ background: "#F5F5F5", border: "1px solid #ddd", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{year}年{month}月分 ご請求額</span>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{yen(displayTotal)}</span>
        </div>

        {pdfLayout === "landscape" ? (
          <PdfTableLandscape editableRows={editableRows} updateRow={updateRow} printFieldStyle={printFieldStyle} displayTotal={displayTotal} />
        ) : (
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 9, marginBottom: 16 }}>
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "#EDEDED" }}>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "left" }}>日にち</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "left" }}>名前</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "left" }}>現場名</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "left" }}>現場の住所</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>人工</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>残業代</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>燃料費</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>高速代</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>諸経費</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>税金</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 3px", textAlign: "right" }}>金額</th>
            </tr>
          </thead>
          <tbody>
            {editableRows.map((r, i) => (
              <tr key={i}>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", verticalAlign: "top" }}><AutoGrowInput value={r.dateLabel} onChange={(v) => updateRow(i, "dateLabel", v)} style={printFieldStyle} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", verticalAlign: "top" }}><AutoGrowInput value={r.nameLabel} onChange={(v) => updateRow(i, "nameLabel", v)} style={printFieldStyle} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", verticalAlign: "top" }}><AutoGrowInput value={r.siteLabel} onChange={(v) => updateRow(i, "siteLabel", v)} style={printFieldStyle} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", verticalAlign: "top" }}><AutoGrowInput value={r.addressLabel} onChange={(v) => updateRow(i, "addressLabel", v)} style={{ ...printFieldStyle, fontSize: 8.5 }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word" }}><AutoGrowInput value={String(r.ninku)} onChange={(v) => updateRow(i, "ninku", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word" }}><AutoGrowInput value={String(r.overtime)} onChange={(v) => updateRow(i, "overtime", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", overflowWrap: "break-word" }}>
                  <AutoGrowInput value={String(r.transport)} onChange={(v) => updateRow(i, "transport", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.transports && r.transports.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.transports.map((t, ti) => (
                        <div key={ti}>{t.memo || "移動"}：{yen(transportItemTotal(t))}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", overflowWrap: "break-word" }}>
                  <AutoGrowInput value={String(r.highway)} onChange={(v) => updateRow(i, "highway", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.highways && r.highways.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.highways.map((h, hi) => (
                        <div key={hi}>{h.fromIC ? `${h.fromIC}IC〜${h.toIC}IC` : "高速代"}：{yen(highwayItemTotal(h))}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word", overflowWrap: "break-word" }}>
                  <AutoGrowInput value={String(r.miscExpense)} onChange={(v) => updateRow(i, "miscExpense", v)} style={{ ...printFieldStyle, textAlign: "right" }} />
                  {r.expenses && r.expenses.length > 0 && (
                    <div style={{ fontSize: 7, color: "#666", textAlign: "right", padding: "0 3px", lineHeight: 1.3, wordBreak: "break-word" }}>
                      {r.expenses.map((e, ei) => (
                        <div key={ei}>{e.label}：{yen(e.amount)}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word" }}><AutoGrowInput value={String(r.tax)} onChange={(v) => updateRow(i, "tax", v)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2, wordBreak: "break-word" }}><AutoGrowInput value={String(r.total)} onChange={(v) => updateRow(i, "total", v)} style={{ ...printFieldStyle, textAlign: "right", fontWeight: 700 }} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10} style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 800, background: "#F5F5F5" }}>合計</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 800, background: "#F5F5F5" }}>{yen(displayTotal)}</td>
            </tr>
          </tfoot>
        </table>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>振込先</div>
          <textarea value={bankInfo} onChange={(e) => setBankInfo(e.target.value)} placeholder="銀行名・支店名・口座番号など" style={{ ...printFieldStyle, minHeight: 40, resize: "vertical", borderBottom: "1px solid #ccc" }} />
        </div>

        <div>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>備考</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="振込先など" style={{ ...printFieldStyle, minHeight: 50, resize: "vertical", borderBottom: "1px solid #ccc" }} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          body * { visibility: hidden; }
          .pdf-paper, .pdf-paper * { visibility: visible; }
          .pdf-paper { position: absolute; top: 0; left: 0; width: 100% !important; max-width: none !important; box-shadow: none !important; margin: 0 !important; box-sizing: border-box; }
          .pdf-paper * { box-sizing: border-box; }
          table { table-layout: fixed !important; width: 100% !important; }
          .pdf-page-break { page-break-before: always; break-before: page; }
          .pdf-chunk { page-break-inside: avoid; break-inside: avoid; }
          .pdf-chunk td { vertical-align: top !important; }
          .no-print { display: none !important; }
          input, textarea { border-bottom: none !important; }
        }
      `}</style>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 14, background: "#20242E", border: "1px solid #333846", borderRadius: 14, padding: 14 }}>
      <div style={{ color: "#C7CBD4", fontSize: 13, fontWeight: 800, marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}
function ChipRow({ children }) { return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>; }
function Chip({ children, active, onClick, isAdd }) {
  return (
    <button onClick={onClick} style={{
      padding: isAdd ? "8px 10px" : "8px 14px", borderRadius: 20,
      border: active ? "1.5px solid #F5A623" : "1px solid #333846",
      background: active ? "rgba(245,166,35,0.15)" : "#242832",
      color: active ? "#F5A623" : "#C7CBD4", fontSize: 13, fontWeight: active ? 700 : 500,
      cursor: "pointer", display: "flex", alignItems: "center",
    }}>{children}</button>
  );
}
function ManualInput({ placeholder, value, onChange, numeric }) {
  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
      <Pencil size={13} color="#8A8F9C" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={numeric ? "numeric" : "text"} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
    </div>
  );
}
function LabeledField({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: "#A9AFBC", fontSize: 11, fontWeight: 700, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
function PresetPrompt({ label, onYes }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#2A2E38", border: "1px dashed #444A58", borderRadius: 10, padding: "8px 10px" }}>
      <span style={{ color: "#C7CBD4", fontSize: 12 }}>{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => { onYes(); setDismissed(true); }} style={{ background: "#F5A623", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#1C1F26", cursor: "pointer" }}>追加</button>
        <button onClick={() => setDismissed(true)} style={{ background: "transparent", border: "1px solid #444A58", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#8A8F9C", cursor: "pointer" }}>いいえ</button>
      </div>
    </div>
  );
}
function AutoGrowInput({ value, onChange, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...style, resize: "none", overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word", display: "block", fontFamily: "inherit" }}
    />
  );
}

function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#242832", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "20px 18px 28px", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", cursor: "pointer" }}><X size={18} color="#8A8F9C" /></button>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { background: "#1C1F26", border: "1px solid #333846", borderRadius: 8, padding: "9px 10px", color: "#fff", fontSize: 16, outline: "none" };
const moreToggleBtnStyle = { marginTop: 8, background: "none", border: "none", color: "#8A8F9C", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "4px 0", display: "flex", alignItems: "center", gap: 4 };
const modalBtnStyle = { marginTop: 12, width: "100%", background: "#F5A623", border: "none", borderRadius: 10, padding: "11px", color: "#1C1F26", fontWeight: 800, fontSize: 14, cursor: "pointer" };
