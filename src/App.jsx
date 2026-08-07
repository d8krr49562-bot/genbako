import React, { useState, useEffect, useMemo } from "react";
import { Plus, ChevronLeft, ChevronRight, X, Check, FileText, Pencil, Loader2, Trash2, Zap } from "lucide-react";

const yen = (n) => `¥${Number(n || 0).toLocaleString()}`;
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthKey = (y, m) => `${y}-${pad(m)}`;
const todayObj = new Date();

const STORAGE_KEY = "invoice-app-data-v2";

// 諸経費リストの合計金額
const expensesTotal = (expenses) => (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
// 1件分の仕事の合計金額
const jobTotal = (j) => (j.ninku || 0) + (j.overtimeAmount || 0) + expensesTotal(j.expenses);
// その日全体(複数件)の合計金額
const dayTotal = (jobs) => (jobs || []).reduce((s, j) => s + jobTotal(j), 0);

// 諸経費のよく使う項目名プリセット
const EXPENSE_LABEL_PRESETS = ["宿泊費"];

const emptyJob = () => ({
  company: "", ninku: 0, overtimeMode: "time", overtimeMin: 0,
  overtimeRatePerHour: 2500, overtimeAmount: 0, expenses: [], memo: "",
});

export default function InvoiceApp() {
  const [year, setYear] = useState(todayObj.getFullYear());
  const [month, setMonth] = useState(todayObj.getMonth() + 1);
  const [view, setView] = useState("calendar"); // calendar | dayJobs | jobEdit | invoice
  const [selectedDate, setSelectedDate] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null); // どの仕事を編集中か(nullなら新規追加)
  const [peekDate, setPeekDate] = useState(null);

  const [entries, setEntries] = useState({}); // { "2026-08-07": [job, job, ...] }
  const [companies, setCompanies] = useState(["A社", "B社"]);
  const [ninkuPresets, setNinkuPresets] = useState([25000, 20000, 18000]);
  const [comboPresets, setComboPresets] = useState([]); // セットプリセット
  const [routes, setRoutes] = useState([]); // 地点間の距離プリセット { id, from, to, km }

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
        setNinkuPresets(data.ninkuPresets || [25000, 20000, 18000]);
        setComboPresets(data.comboPresets || []);
        setRoutes(data.routes || []);
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
      const payload = JSON.stringify({ entries, companies, ninkuPresets, comboPresets, routes });
      localStorage.setItem(STORAGE_KEY, payload);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e && e.message ? e.message : String(e));
    }
  }, [entries, companies, ninkuPresets, comboPresets, routes, loading]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  const monthTotal = useMemo(() => {
    let t = 0;
    Object.entries(entries).forEach(([k, jobs]) => {
      if (k.startsWith(monthKey(year, month))) t += dayTotal(jobs);
    });
    return t;
  }, [entries, year, month]);

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
        onBack={() => { setView("calendar"); setPeekDate(selectedDate); }}
        onAddQuick={(preset) => {
          const { id, ...job } = preset;
          addJobToDay(selectedDate, { ...job });
        }}
        onOpenNew={() => { setEditingIndex(null); setView("jobEdit"); }}
        onOpenEdit={(idx) => { setEditingIndex(idx); setView("jobEdit"); }}
        onRemove={(idx) => removeJobFromDay(selectedDate, idx)}
        onRemoveCombo={removeComboPreset}
      />
    );
  }

  if (view === "jobEdit" && selectedDate) {
    const jobs = entries[selectedDate] || [];
    const initial = editingIndex !== null ? jobs[editingIndex] : emptyJob();
    return (
      <JobDetail
        dateKey={selectedDate}
        job={initial}
        onSave={(job) => {
          if (editingIndex !== null) updateJobInDay(selectedDate, editingIndex, job);
          else addJobToDay(selectedDate, job);
          setView("dayJobs");
        }}
        onBack={() => setView("dayJobs")}
        companies={companies}
        setCompanies={setCompanies}
        ninkuPresets={ninkuPresets}
        setNinkuPresets={setNinkuPresets}
        onSaveCombo={addComboPreset}
        comboPresets={comboPresets}
        routes={routes}
        setRoutes={setRoutes}
      />
    );
  }

  if (view === "invoice") {
    return <InvoiceView year={year} month={month} entries={entries} onBack={() => setView("calendar")} />;
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
          style={{ marginTop: 12, width: "100%", textAlign: "left", cursor: "pointer", background: "linear-gradient(135deg,#F5A623,#E8871E)", border: "none", borderRadius: 14, padding: "14px 18px" }}
        >
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
                    <span style={{ color: "#C7CBD4", fontSize: 12 }}>{j.company || "未設定"}</span>
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

        <p style={{ color: "#5A5F6B", fontSize: 11, textAlign: "center", marginTop: 20 }}>
          日付をタップするとその場で金額を確認できます。1日に複数件の仕事も追加できます。
        </p>
      </div>
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
function DayJobsView({ dateKey, jobs, comboPresets, onBack, onAddQuick, onOpenNew, onOpenEdit, onRemove, onRemoveCombo }) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const total = dayTotal(jobs);
  const [editingCombos, setEditingCombos] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const [confirmRemoveCombo, setConfirmRemoveCombo] = useState(null);

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

        {comboPresets.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                <Zap size={13} color="#F5A623" /> ワンタップで追加
              </div>
              <button
                onClick={() => setEditingCombos((v) => !v)}
                style={{ background: "none", border: "none", color: editingCombos ? "#F5A623" : "#5A5F6B", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "4px 6px" }}
              >
                {editingCombos ? "完了" : "編集"}
              </button>
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
                    <span>{p.company || "会社未設定"}</span>
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
            </div>
          </div>
        )}

        <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>この日の仕事（{jobs.length}件）</div>

        {jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#5A5F6B", fontSize: 13 }}>まだ入力がありません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {jobs.map((j, idx) => (
              <div key={idx} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button onClick={() => onOpenEdit(idx)} style={{ background: "none", border: "none", textAlign: "left", flex: 1, cursor: "pointer", padding: 0 }}>
                  <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{j.company || "未設定"}</div>
                  <div style={{ color: "#6B7280", fontSize: 11, marginTop: 2 }}>人工{yen(j.ninku)} ／ 残業{yen(j.overtimeAmount)} ／ 諸経費{yen(expensesTotal(j.expenses))}</div>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#F5A623", fontSize: 14, fontWeight: 800 }}>{yen(jobTotal(j))}</span>
                  <button onClick={() => setConfirmRemoveIdx(idx)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={15} color="#5A5F6B" />
                  </button>
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
    </div>
  );
}

// ------------------- 1件分の入力/編集画面 -------------------
function JobDetail({ dateKey, job, onSave, onBack, companies, setCompanies, ninkuPresets, setNinkuPresets, onSaveCombo, comboPresets, routes, setRoutes }) {
  const [company, setCompany] = useState(job.company || "");
  const [ninku, setNinku] = useState(job.ninku || 0);
  const [overtimeMode, setOvertimeMode] = useState(job.overtimeMode || "time");
  const [overtimeMinStr, setOvertimeMinStr] = useState(job.overtimeMin ? String(job.overtimeMin) : "");
  const [overtimeRateStr, setOvertimeRateStr] = useState(job.overtimeRatePerHour ? String(job.overtimeRatePerHour) : "2500");
  const [overtimeManual, setOvertimeManual] = useState(job.overtimeAmount || 0);
  const [expenses, setExpenses] = useState(job.expenses && job.expenses.length ? job.expenses : []);
  const [memo, setMemo] = useState(job.memo || "");

  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [showAddNinku, setShowAddNinku] = useState(false);
  const [newNinkuValue, setNewNinkuValue] = useState("");
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpenseLabel, setNewExpenseLabel] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState("");
  const [comboSaved, setComboSaved] = useState(false);

  const overtimeMin = Number(overtimeMinStr || 0);
  const overtimeRatePerHour = Number(overtimeRateStr || 0);
  const overtimeAmount = overtimeMode === "time" ? Math.round((overtimeMin / 60) * overtimeRatePerHour) : Number(overtimeManual || 0);
  const expensesSum = expensesTotal(expenses);
  const total = Number(ninku || 0) + overtimeAmount + expensesSum;
  const [y, m, d] = dateKey.split("-").map(Number);

  const currentJob = () => ({ company, ninku: Number(ninku), overtimeMode, overtimeMin, overtimeRatePerHour, overtimeAmount, expenses, memo: "" });

  const isDuplicateCombo = comboPresets.some((p) =>
    p.company === company && Number(p.ninku) === Number(ninku) && p.overtimeMode === overtimeMode &&
    Number(p.overtimeMin) === overtimeMin && Number(p.overtimeRatePerHour) === overtimeRatePerHour &&
    expensesTotal(p.expenses) === expensesSum
  );

  const save = () => onSave({ company, ninku: Number(ninku), overtimeMode, overtimeMin, overtimeRatePerHour, overtimeAmount, expenses, memo });

  const addExpenseQuick = (label) => {
    setExpenses((prev) => [...prev, { id: Date.now(), label, amount: 0 }]);
  };
  const updateExpenseAmount = (id, amountStr) => {
    const amount = Number(amountStr.replace(/[^0-9]/g, "") || 0);
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, amount } : e)));
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

  // ---- ルート計算(距離×単価で燃料費、高速代を合算して追加) ----
  const [showRouteCalc, setShowRouteCalc] = useState(false);
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [routeKmStr, setRouteKmStr] = useState("");
  const [useHighway, setUseHighway] = useState(false);
  const [highwayFeeStr, setHighwayFeeStr] = useState("");
  const [ratePerKmStr, setRatePerKmStr] = useState("20");
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [newRouteFrom, setNewRouteFrom] = useState("");
  const [newRouteTo, setNewRouteTo] = useState("");
  const [newRouteKm, setNewRouteKm] = useState("");

  const selectRoute = (r) => {
    setRouteFrom(r.from);
    setRouteTo(r.to);
    setRouteKmStr(String(r.km));
  };

  const registerRoute = () => {
    if (!newRouteFrom.trim() || !newRouteTo.trim() || !newRouteKm) return;
    const r = { id: Date.now(), from: newRouteFrom.trim(), to: newRouteTo.trim(), km: Number(newRouteKm) };
    setRoutes((prev) => [...prev, r]);
    selectRoute(r);
    setShowAddRoute(false);
    setNewRouteFrom(""); setNewRouteTo(""); setNewRouteKm("");
  };

  const routeKm = Number(routeKmStr || 0);
  const ratePerKm = Number(ratePerKmStr || 0);
  const fuelCost = Math.round(routeKm * ratePerKm);
  const highwayFee = Number(highwayFeeStr || 0);

  const addRouteExpense = () => {
    const routeLabel = routeFrom && routeTo ? `${routeFrom}→${routeTo}` : "移動";
    const newItems = [];
    if (fuelCost > 0) {
      newItems.push({ id: Date.now(), label: `燃料費（${routeLabel}・${routeKm}km）`, amount: fuelCost });
    }
    if (useHighway && highwayFee > 0) {
      newItems.push({ id: Date.now() + 1, label: `高速代（${routeLabel}）`, amount: highwayFee });
    }
    if (newItems.length === 0) return;
    setExpenses((prev) => [...prev, ...newItems]);
    // 入力欄はリセット(ルート自体はプリセットに残る)
    setShowRouteCalc(false);
    setUseHighway(false);
    setHighwayFeeStr("");
  };

  const addCompany = () => { if (!newCompanyName.trim()) return; setCompany(newCompanyName.trim()); setShowAddCompany(false); setNewCompanyName(""); };
  const registerCompanyPreset = () => { if (company && !companies.includes(company)) setCompanies([...companies, company]); };
  const addNinku = () => { const v = Number(newNinkuValue); if (!v) return; setNinku(v); setShowAddNinku(false); setNewNinkuValue(""); };
  const registerNinkuPreset = () => { if (ninku && !ninkuPresets.includes(Number(ninku))) setNinkuPresets([...ninkuPresets, Number(ninku)]); };

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

        <Section label="会社">
          <ChipRow>
            {companies.map((c) => <Chip key={c} active={company === c} onClick={() => setCompany(c)}>{c}</Chip>)}
            <Chip onClick={() => setShowAddCompany(true)} isAdd><Plus size={14} /></Chip>
          </ChipRow>
          {company && !companies.includes(company) && <PresetPrompt label={`「${company}」をプリセットに追加する？`} onYes={registerCompanyPreset} />}
          <ManualInput placeholder="会社名を直接入力" value={company} onChange={setCompany} />
        </Section>

        <Section label="人工（1日あたり）">
          <ChipRow>
            {ninkuPresets.map((v) => <Chip key={v} active={Number(ninku) === v} onClick={() => setNinku(v)}>{yen(v)}</Chip>)}
            <Chip onClick={() => setShowAddNinku(true)} isAdd><Plus size={14} /></Chip>
          </ChipRow>
          {ninku && !ninkuPresets.includes(Number(ninku)) && <PresetPrompt label={`「${yen(ninku)}」をプリセットに追加する？`} onYes={registerNinkuPreset} />}
          <ManualInput placeholder="金額を直接入力" value={ninku === 0 ? "" : String(ninku)} onChange={(v) => setNinku(v.replace(/[^0-9]/g, ""))} numeric />
        </Section>

        <Section label="残業代">
          <ChipRow>
            <Chip active={overtimeMode === "time"} onClick={() => setOvertimeMode("time")}>時間で計算</Chip>
            <Chip active={overtimeMode === "manual"} onClick={() => setOvertimeMode("manual")}>金額を直接入力</Chip>
          </ChipRow>
          {overtimeMode === "time" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
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
        </Section>

        <Section label="交通費・諸経費">
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 8 }}>ルートを選んで燃料費・高速代を自動計算</div>
          <ChipRow>
            {routes.map((r) => (
              <Chip key={r.id} onClick={() => { selectRoute(r); setShowRouteCalc(true); }}>
                {r.from}→{r.to}（{r.km}km）
              </Chip>
            ))}
            <Chip onClick={() => setShowAddRoute(true)} isAdd><Plus size={14} /> ルート登録</Chip>
          </ChipRow>

          {showRouteCalc && (
            <div style={{ marginTop: 10, background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 12 }}>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {routeFrom || "出発地"} → {routeTo || "到着地"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <LabeledField label="距離(km)">
                  <input type="text" inputMode="numeric" value={routeKmStr} placeholder="0" onChange={(e) => setRouteKmStr(e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </LabeledField>
                <LabeledField label="1kmあたり(円)">
                  <input type="text" inputMode="numeric" value={ratePerKmStr} placeholder="20" onChange={(e) => setRatePerKmStr(e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </LabeledField>
              </div>
              <div style={{ color: "#8A8F9C", fontSize: 12, marginTop: 6 }}>→ 燃料費 {yen(fuelCost)}</div>

              <div style={{ marginTop: 10 }}>
                <ChipRow>
                  <Chip active={!useHighway} onClick={() => setUseHighway(false)}>高速道路を使わない</Chip>
                  <Chip active={useHighway} onClick={() => setUseHighway(true)}>高速道路を使う</Chip>
                </ChipRow>
                {useHighway && (
                  <div style={{ marginTop: 8 }}>
                    <ManualInput placeholder="高速代の金額" value={highwayFeeStr} onChange={(v) => setHighwayFeeStr(v.replace(/[^0-9]/g, ""))} numeric />
                  </div>
                )}
              </div>

              <button
                onClick={addRouteExpense}
                style={{ marginTop: 12, width: "100%", background: "#F5A623", border: "none", borderRadius: 10, padding: "10px", color: "#1C1F26", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
              >
                この内容で諸経費に追加する
              </button>
            </div>
          )}

          <div style={{ color: "#8A8F9C", fontSize: 11, margin: "14px 0 8px" }}>その他の項目</div>
          <ChipRow>
            {EXPENSE_LABEL_PRESETS.map((label) => (
              <Chip key={label} onClick={() => addExpenseQuick(label)}>{label}</Chip>
            ))}
            <Chip onClick={() => setShowAddExpense(true)} isAdd><Plus size={14} /> その他</Chip>
          </ChipRow>

          {expenses.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {expenses.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "8px 10px" }}>
                  <span style={{ color: "#C7CBD4", fontSize: 12, flex: 1 }}>{e.label}</span>
                  <input
                    type="text" inputMode="numeric" placeholder="0"
                    value={e.amount === 0 ? "" : String(e.amount)}
                    onChange={(ev) => updateExpenseAmount(e.id, ev.target.value)}
                    style={{ ...inputStyle, width: 90, textAlign: "right" }}
                  />
                  <span style={{ color: "#5A5F6B", fontSize: 11 }}>円</span>
                  <button onClick={() => removeExpense(e.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <Trash2 size={14} color="#5A5F6B" />
                  </button>
                </div>
              ))}
              <div style={{ color: "#8FD19E", fontSize: 12, fontWeight: 700, textAlign: "right" }}>小計 {yen(expensesSum)}</div>
            </div>
          )}
        </Section>

        <Section label="メモ（任意）">
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="現場の内容など" style={{ ...inputStyle, width: "100%", minHeight: 60, resize: "vertical", boxSizing: "border-box" }} />
        </Section>

        {company && ninku > 0 && !isDuplicateCombo && !comboSaved && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#2A2E38", border: "1px dashed #F5A623", borderRadius: 10, padding: "10px 12px" }}>
            <span style={{ color: "#F5A623", fontSize: 12, fontWeight: 600 }}>この組み合わせをワンタップ用に登録する？</span>
            <button
              onClick={() => { onSaveCombo(currentJob()); setComboSaved(true); }}
              style={{ background: "#F5A623", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: "#1C1F26", cursor: "pointer" }}
            >
              登録
            </button>
          </div>
        )}
        {comboSaved && <div style={{ marginTop: 10, color: "#8FD19E", fontSize: 11 }}>✓ ワンタップ用に登録しました</div>}

        <div style={{ marginTop: 18, background: "linear-gradient(135deg,#F5A623,#E8871E)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>この件の合計</div>
          <div style={{ color: "#1C1F26", fontSize: 24, fontWeight: 800 }}>{yen(total)}</div>
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
      {showAddNinku && (
        <Modal onClose={() => setShowAddNinku(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>人工の金額を追加</div>
          <input autoFocus type="number" value={newNinkuValue} onChange={(e) => setNewNinkuValue(e.target.value)} placeholder="例: 22000" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={addNinku} style={modalBtnStyle}>決定</button>
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
      {showAddRoute && (
        <Modal onClose={() => setShowAddRoute(false)}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>ルートを登録</div>
          <div style={{ color: "#8A8F9C", fontSize: 11, marginBottom: 6 }}>出発地</div>
          <input autoFocus value={newRouteFrom} onChange={(e) => setNewRouteFrom(e.target.value)} placeholder="例: 自宅" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>到着地</div>
          <input value={newRouteTo} onChange={(e) => setNewRouteTo(e.target.value)} placeholder="例: A社" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <div style={{ color: "#8A8F9C", fontSize: 11, marginTop: 12, marginBottom: 6 }}>距離(km) ※Googleマップ等で調べて入力</div>
          <input type="text" inputMode="numeric" value={newRouteKm} onChange={(e) => setNewRouteKm(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="例: 18" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
          <button onClick={registerRoute} style={modalBtnStyle}>登録する</button>
        </Modal>
      )}
    </div>
  );
}

// ------------------- 請求内容確認画面 -------------------
function InvoiceView({ year, month, entries, onBack }) {
  const rows = useMemo(() => {
    const out = [];
    Object.entries(entries)
      .filter(([k]) => k.startsWith(monthKey(year, month)))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, jobs]) => {
        (jobs || []).forEach((j) => {
          out.push({ date: k, day: Number(k.split("-")[2]), company: j.company || "-", ninku: j.ninku || 0, overtime: j.overtimeAmount || 0, transport: expensesTotal(j.expenses), expenses: j.expenses || [], total: jobTotal(j) });
        });
      });
    return out;
  }, [entries, year, month]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const byCompany = useMemo(() => {
    const map = {};
    rows.forEach((r) => { map[r.company] = (map[r.company] || 0) + r.total; });
    return Object.entries(map);
  }, [rows]);

  const [showPdfPreview, setShowPdfPreview] = useState(false);

  if (showPdfPreview) {
    return <PdfPreview year={year} month={month} rows={rows} grandTotal={grandTotal} onBack={() => setShowPdfPreview(false)} />;
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
            <div style={{ background: "linear-gradient(135deg,#F5A623,#E8871E)", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
              <div style={{ color: "#3A2A08", fontSize: 12, fontWeight: 700 }}>請求合計</div>
              <div style={{ color: "#1C1F26", fontSize: 28, fontWeight: 800 }}>{yen(grandTotal)}</div>
            </div>
            {byCompany.length > 1 && (
              <div style={{ background: "#242832", border: "1px solid #333846", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ color: "#8A8F9C", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>会社別 小計</div>
                {byCompany.map(([c, t]) => (
                  <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ color: "#C7CBD4", fontSize: 13 }}>{c}</span>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{yen(t)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ color: "#8A8F9C", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>明細（{rows.length}件）</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ background: "#242832", border: "1px solid #333846", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{month}月{r.day}日　{r.company}</div>
                    <div style={{ color: "#6B7280", fontSize: 11 }}>人工{yen(r.ninku)} ／ 残業{yen(r.overtime)} ／ 諸経費{yen(r.transport)}</div>
                  </div>
                  <div style={{ color: "#F5A623", fontSize: 14, fontWeight: 800 }}>{yen(r.total)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => setShowPdfPreview(true)}
          style={{ marginTop: 24, width: "100%", background: "#242832", border: "1px solid #F5A623", borderRadius: 12, padding: "13px", color: "#F5A623", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
        >
          <FileText size={16} />請求書のプレビューを見る
        </button>
      </div>
    </div>
  );
}

// ------------------- PDFプレビュー画面(白い紙面イメージ・手入力で編集可) -------------------
function PdfPreview({ year, month, rows, grandTotal, onBack }) {
  const [issuer, setIssuer] = useState("");
  const [clientName, setClientName] = useState("");
  const [issueDate, setIssueDate] = useState(`${year}年${month}月　　日`);
  const [note, setNote] = useState("");
  // 明細は表示用にコピーして手入力で修正できるようにする(保存データ自体は変更しない、印刷確認用の一時編集)
  const [editableRows, setEditableRows] = useState(
    rows.map((r) => ({ ...r, dateLabel: `${month}月${r.day}日` }))
  );

  const updateRow = (idx, field, value) => {
    setEditableRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: field === "total" || field === "ninku" || field === "overtime" || field === "transport" ? Number(value.replace(/[^0-9]/g, "") || 0) : value };
      return next;
    });
  };

  const displayTotal = editableRows.reduce((s, r) => s + Number(r.total || 0), 0);

  const printFieldStyle = { border: "none", borderBottom: "1px dashed #ccc", background: "transparent", fontSize: 12, padding: "2px 4px", width: "100%", boxSizing: "border-box", color: "#000" };

  return (
    <div style={{ minHeight: "100vh", background: "#3A3D45" }}>
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
      <div className="pdf-paper" style={{ background: "#fff", color: "#000", maxWidth: 480, margin: "16px auto", padding: "24px 18px", fontFamily: "'Hiragino Sans','Zen Kaku Gothic New',sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", fontSize: 20, fontWeight: 800, letterSpacing: 6, marginBottom: 20 }}>請求書</div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, fontSize: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 4 }}>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="請求先（会社名）" style={{ ...printFieldStyle, fontSize: 14, fontWeight: 700 }} />
            </div>
            <div style={{ color: "#555" }}>御中</div>
          </div>
          <div style={{ width: 140, textAlign: "right" }}>
            <input value={issueDate} onChange={(e) => setIssueDate(e.target.value)} style={{ ...printFieldStyle, textAlign: "right" }} />
            <div style={{ marginTop: 10 }}>
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="発行者名（自分の名前）" style={{ ...printFieldStyle, textAlign: "right" }} />
            </div>
          </div>
        </div>

        <div style={{ background: "#F5F5F5", border: "1px solid #ddd", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{year}年{month}月分 ご請求額</span>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{yen(displayTotal)}</span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginBottom: 16 }}>
          <thead>
            <tr style={{ background: "#EDEDED" }}>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "left" }}>日付</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "left" }}>内容</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "right" }}>人工</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "right" }}>残業代</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "right" }}>諸経費</th>
              <th style={{ border: "1px solid #ccc", padding: "5px 4px", textAlign: "right" }}>金額</th>
            </tr>
          </thead>
          <tbody>
            {editableRows.map((r, i) => (
              <tr key={i}>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.dateLabel} onChange={(e) => updateRow(i, "dateLabel", e.target.value)} style={printFieldStyle} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.company} onChange={(e) => updateRow(i, "company", e.target.value)} style={printFieldStyle} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.ninku} onChange={(e) => updateRow(i, "ninku", e.target.value)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.overtime} onChange={(e) => updateRow(i, "overtime", e.target.value)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.transport} onChange={(e) => updateRow(i, "transport", e.target.value)} style={{ ...printFieldStyle, textAlign: "right" }} /></td>
                <td style={{ border: "1px solid #ccc", padding: 2 }}><input value={r.total} onChange={(e) => updateRow(i, "total", e.target.value)} style={{ ...printFieldStyle, textAlign: "right", fontWeight: 700 }} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 800, background: "#F5F5F5" }}>合計</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 800, background: "#F5F5F5" }}>{yen(displayTotal)}</td>
            </tr>
          </tfoot>
        </table>

        <div>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>備考</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="振込先など" style={{ ...printFieldStyle, minHeight: 50, resize: "vertical", borderBottom: "1px solid #ccc" }} />
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .pdf-paper, .pdf-paper * { visibility: visible; }
          .pdf-paper { position: absolute; top: 0; left: 0; width: 100%; box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
          input, textarea { border-bottom: none !important; }
        }
      `}</style>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ color: "#8A8F9C", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{label}</div>
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
      <Pencil size={13} color="#5A5F6B" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={numeric ? "numeric" : "text"} style={{ ...inputStyle, flex: 1 }} />
    </div>
  );
}
function LabeledField({ label, children }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ color: "#5A5F6B", fontSize: 10, marginBottom: 4 }}>{label}</div>
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
const modalBtnStyle = { marginTop: 12, width: "100%", background: "#F5A623", border: "none", borderRadius: 10, padding: "11px", color: "#1C1F26", fontWeight: 800, fontSize: 14, cursor: "pointer" };
