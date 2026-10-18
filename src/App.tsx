import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  Circle,
  Flame,
  LogOut,
  Play,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { configured, supabase } from "./supabase";
import type { DailyStat, Occurrence, Status, Task } from "./types";

const today = () => new Date().toLocaleDateString("en-CA");
const dateOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};
const weekday = () => new Date().getDay();
const emptyForm = {
  title: "",
  notes: "",
  weight: 1,
  kind: "one_time" as const,
  recurring: false,
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Occurrence[]>([]);
  const [history, setHistory] = useState<DailyStat[]>([]);
  const [showBacklog, setShowBacklog] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (user) void load();
  }, [user]);

  async function load() {
    if (!supabase || !user) return;
    const date = today();
    const { data: templates } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_archived", false);
    const due = (templates ?? []).filter(
      (task: Task) =>
        task.scheduled_date === date ||
        (task.kind === "recurring" && task.recurrence_days.includes(weekday()))
    );
    if (due.length)
      await supabase.from("task_occurrences").upsert(
        due.map((task: Task) => ({
          user_id: user.id,
          task_id: task.id,
          occurrence_date: date,
          title: task.title,
          notes: task.notes,
          weight: task.weight,
        })),
        { onConflict: "task_id,occurrence_date", ignoreDuplicates: true }
      );
    const [{ data: occurrences }, { data: stats }] = await Promise.all([
      supabase
        .from("task_occurrences")
        .select("*")
        .eq("occurrence_date", date)
        .order("focus_rank", { ascending: true, nullsFirst: false }),
      supabase
        .from("daily_stats")
        .select("*")
        .gte("stat_date", dateOffset(-6))
        .order("stat_date"),
    ]);
    setItems((occurrences ?? []) as Occurrence[]);
    setHistory((stats ?? []) as DailyStat[]);
    await syncStats((occurrences ?? []) as Occurrence[]);
  }
  async function syncStats(next: Occurrence[]) {
    if (!supabase || !user) return;
    const total = next.reduce((sum, x) => sum + x.weight, 0);
    const completed = next
      .filter((x) => x.status === "done")
      .reduce((sum, x) => sum + x.weight, 0);
    await supabase.from("daily_stats").upsert({
      user_id: user.id,
      stat_date: today(),
      total_points: total,
      completed_points: completed,
      xp_earned: completed * 10,
      goal_reached: total > 0 && completed / total >= 0.6,
    });
  }
  async function changeStatus(item: Occurrence, status: Status) {
    if (!supabase) return;
    if (status === "in_progress")
      await supabase
        .from("task_occurrences")
        .update({ status: "todo" })
        .eq("occurrence_date", today())
        .eq("status", "in_progress");
    const { error } = await supabase
      .from("task_occurrences")
      .update({
        status,
        completed_at: status === "done" ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
    if (!error) await load();
  }
  async function setFocus(item: Occurrence) {
    if (!supabase) return;
    const focused = items
      .filter((x) => x.focus_rank)
      .sort((a, b) => a.focus_rank! - b.focus_rank!);
    if (item.focus_rank) {
      await supabase
        .from("task_occurrences")
        .update({ focus_rank: null })
        .eq("id", item.id);
    } else {
      if (focused.length >= 3)
        await supabase
          .from("task_occurrences")
          .update({ focus_rank: null })
          .eq("id", focused[2].id);
      await supabase
        .from("task_occurrences")
        .update({ focus_rank: Math.min(focused.length + 1, 3) })
        .eq("id", item.id);
    }
    await load();
  }
  async function createTask(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !user || !form.title.trim()) return;
    await supabase.from("tasks").insert({
      user_id: user.id,
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      weight: form.weight,
      kind: form.recurring ? "recurring" : "one_time",
      scheduled_date: form.recurring ? null : today(),
      recurrence_days: form.recurring ? [weekday()] : [],
    });
    setForm(emptyForm);
    setShowForm(false);
    await load();
  }
  async function remove(item: Occurrence) {
    if (!supabase || !confirm(`Hapus “${item.title}”?`)) return;
    await supabase
      .from("tasks")
      .update({ is_archived: true })
      .eq("id", item.task_id);
    await load();
  }

  if (!configured) return <SetupScreen />;
  if (loading) return <div className="loading">Menyiapkan Fokus Hari…</div>;
  if (!user) return <Auth />;
  const total = items.reduce((s, i) => s + i.weight, 0),
    done = items
      .filter((i) => i.status === "done")
      .reduce((s, i) => s + i.weight, 0);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const focused = items
      .filter((i) => i.focus_rank)
      .sort((a, b) => a.focus_rank! - b.focus_rank!),
    backlog = items.filter((i) => !i.focus_rank);
  const active = items.find((i) => i.status === "in_progress");
  let streak = 0;
  for (let i = 0; i < 7; i++) {
    const stat = history.find((h) => h.stat_date === dateOffset(-i));
    if (stat?.goal_reached) streak++;
    else break;
  }
  return (
    <main className="app-shell">
      <header>
        <div className="brand">
          <Sparkles size={21} /> Fokus Hari
        </div>
        <div className="header-actions">
          <span className="streak">
            <Flame size={18} /> {streak} hari
          </span>
          <button
            className="icon-btn"
            aria-label="Keluar"
            onClick={() => supabase?.auth.signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date())}
          </p>
          <h1>Hari yang cukup, bukan sempurna.</h1>
          <p className="sub">Pilih yang penting, kerjakan satu per satu.</p>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>
          <Plus size={19} /> Tambah task
        </button>
      </section>
      <section className="overview">
        <Progress percent={percent} done={done} total={total} />
        <div className="active-card">
          <div>
            <span className="eyebrow">SEDANG DIKERJAKAN</span>
            <h2>{active?.title ?? "Belum ada task aktif"}</h2>
            <p>
              {active
                ? "Fokus pada satu langkah kecil ini."
                : "Mulai satu task untuk memberi arah."}
            </p>
          </div>
          {active && (
            <button
              className="finish"
              onClick={() => changeStatus(active, "done")}
            >
              <Check size={19} /> Selesai
            </button>
          )}
        </div>
        <div className="xp-card">
          <span>
            <Target size={18} /> XP HARI INI
          </span>
          <strong>{done * 10}</strong>
          <small>Target harian: 60%</small>
        </div>
      </section>
      <section className="section-title">
        <div>
          <p className="eyebrow">TIGA FOKUS</p>
          <h2>Yang paling berarti sekarang</h2>
        </div>
        <span>{focused.length}/3 dipilih</span>
      </section>
      <section className="focus-grid">
        {focused.map((item, index) => (
          <TaskCard
            key={item.id}
            item={item}
            index={index}
            onStatus={changeStatus}
            onFocus={setFocus}
            onDelete={remove}
          />
        ))}
        {Array.from({ length: Math.max(0, 3 - focused.length) }, (_, i) => (
          <button
            key={i}
            className="focus-empty"
            onClick={() => setShowBacklog(true)}
          >
            <Plus size={19} />
            <span>Pilih fokus #{focused.length + i + 1}</span>
          </button>
        ))}
      </section>
      <section className="backlog">
        <button
          className="backlog-toggle"
          onClick={() => setShowBacklog(!showBacklog)}
        >
          <span>
            <ChevronDown className={showBacklog ? "" : "rotate"} size={18} />{" "}
            Task lain hari ini <b>{backlog.length}</b>
          </span>
          <small>{showBacklog ? "Sembunyikan" : "Tampilkan"}</small>
        </button>
        {showBacklog && (
          <div className="backlog-list">
            {backlog.length ? (
              backlog.map((item) => (
                <TaskRow
                  key={item.id}
                  item={item}
                  onStatus={changeStatus}
                  onFocus={setFocus}
                  onDelete={remove}
                />
              ))
            ) : (
              <div className="empty">
                <Circle size={20} />
                <span>Belum ada task lain. Hari ini terasa lapang.</span>
              </div>
            )}
          </div>
        )}
      </section>
      <Weekly stats={history} />
      {showForm && (
        <TaskForm
          form={form}
          setForm={setForm}
          onClose={() => setShowForm(false)}
          onSubmit={createTask}
        />
      )}
    </main>
  );
}

function Progress({
  percent,
  done,
  total,
}: {
  percent: number;
  done: number;
  total: number;
}) {
  return (
    <div className="progress-card">
      <div
        className="ring"
        style={{ "--p": `${percent * 3.6}deg` } as React.CSSProperties}
      >
        <div>
          <strong>{percent}%</strong>
          <span>selesai</span>
        </div>
      </div>
      <div>
        <span className="eyebrow">PROGRES HARI INI</span>
        <h2>
          {done} dari {total} poin
        </h2>
        <p>
          {percent >= 60
            ? "Target hari ini tercapai. Mantap!"
            : "Target tenangmu: 60% dari poin hari ini."}
        </p>
      </div>
    </div>
  );
}
function TaskCard({
  item,
  index,
  ...actions
}: {
  item: Occurrence;
  index: number;
  onStatus: (i: Occurrence, s: Status) => void;
  onFocus: (i: Occurrence) => void;
  onDelete: (i: Occurrence) => void;
}) {
  return (
    <article className={`task-card ${item.status}`}>
      <div className="task-top">
        <span className="focus-number">0{index + 1}</span>
        <button
          className="remove"
          aria-label="Keluarkan dari fokus"
          onClick={() => actions.onFocus(item)}
        >
          <X size={16} />
        </button>
      </div>
      <h3>{item.title}</h3>
      {item.notes && <p>{item.notes}</p>}
      <div className="task-meta">
        <span>
          {"●".repeat(item.weight)}
          {"○".repeat(3 - item.weight)} fokus
        </span>
        <StatusTag status={item.status} />
      </div>
      <div className="task-actions">
        {item.status === "done" ? (
          <button
            className="done-btn"
            onClick={() => actions.onStatus(item, "todo")}
          >
            <Check size={16} /> Selesai
          </button>
        ) : item.status === "in_progress" ? (
          <button
            className="done-btn"
            onClick={() => actions.onStatus(item, "done")}
          >
            <Check size={16} /> Tandai selesai
          </button>
        ) : (
          <button
            className="start-btn"
            onClick={() => actions.onStatus(item, "in_progress")}
          >
            <Play size={15} /> Mulai
          </button>
        )}
      </div>
    </article>
  );
}
function TaskRow({
  item,
  onStatus,
  onFocus,
  onDelete,
}: {
  item: Occurrence;
  onStatus: (i: Occurrence, s: Status) => void;
  onFocus: (i: Occurrence) => void;
  onDelete: (i: Occurrence) => void;
}) {
  return (
    <div className="task-row">
      <button
        aria-label="Selesaikan task"
        className={`check ${item.status === "done" ? "checked" : ""}`}
        onClick={() => onStatus(item, item.status === "done" ? "todo" : "done")}
      >
        {item.status === "done" && <Check size={15} />}
      </button>
      <div className="row-text">
        <strong className={item.status === "done" ? "struck" : ""}>
          {item.title}
        </strong>
        <span>
          {"●".repeat(item.weight)}
          {"○".repeat(3 - item.weight)} poin fokus
        </span>
      </div>
      <StatusTag status={item.status} />
      <button className="focus-add" onClick={() => onFocus(item)}>
        <Target size={16} /> Fokus
      </button>
      <button
        className="delete"
        aria-label="Hapus task"
        onClick={() => onDelete(item)}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
function StatusTag({ status }: { status: Status }) {
  const labels = {
    todo: "Belum mulai",
    in_progress: "Sedang dikerjakan",
    done: "Selesai",
  };
  return <span className={`status ${status}`}>{labels[status]}</span>;
}
function Weekly({ stats }: { stats: DailyStat[] }) {
  const dates = Array.from({ length: 7 }, (_, i) => dateOffset(i - 6));
  return (
    <section className="weekly">
      <div>
        <p className="eyebrow">RITME 7 HARI</p>
        <h2>Langkah kecil juga dihitung.</h2>
      </div>
      <div className="bars">
        {dates.map((d) => {
          const s = stats.find((x) => x.stat_date === d),
            p = s?.total_points
              ? Math.round((s.completed_points / s.total_points) * 100)
              : 0;
          return (
            <div className="day" key={d}>
              <div className="bar-bg">
                <i style={{ height: `${p}%` }} />
              </div>
              <span>
                {new Intl.DateTimeFormat("id-ID", { weekday: "narrow" }).format(
                  new Date(`${d}T12:00:00`)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function TaskForm({
  form,
  setForm,
  onClose,
  onSubmit,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Tambah task"
    >
      <form className="task-form" onSubmit={onSubmit}>
        <button type="button" className="close" onClick={onClose}>
          <X />
        </button>
        <p className="eyebrow">TASK BARU</p>
        <h2>Apa satu langkah berikutnya?</h2>
        <label>
          Judul task
          <input
            autoFocus
            required
            maxLength={180}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Contoh: balas tiga email"
          />
        </label>
        <label>
          Catatan <small>(opsional)</small>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Agar lebih mudah memulai…"
          />
        </label>
        <fieldset>
          <legend>Bobot fokus</legend>
          <div className="weight-picker">
            {[1, 2, 3].map((weight) => (
              <button
                type="button"
                className={form.weight === weight ? "selected" : ""}
                key={weight}
                onClick={() => setForm({ ...form, weight })}
              >
                {"●".repeat(weight)}
                {"○".repeat(3 - weight)}{" "}
                <small>
                  {weight === 1 ? "Ringan" : weight === 2 ? "Sedang" : "Besar"}
                </small>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="switch">
          <input
            type="checkbox"
            checked={form.recurring}
            onChange={(e) => setForm({ ...form, recurring: e.target.checked })}
          />
          <span>
            Ulangi setiap hari{" "}
            {new Intl.DateTimeFormat("id-ID", { weekday: "long" }).format(
              new Date()
            )}
          </span>
        </label>
        <button className="primary wide" type="submit">
          <Plus size={19} /> Tambahkan ke hari ini
        </button>
      </form>
    </div>
  );
}
function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
            },
          });
    setBusy(false);
    setMessage(
      result.error?.message ??
        (mode === "signup"
          ? "Periksa email untuk mengonfirmasi akunmu."
          : "Berhasil masuk.")
    );
  }
  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="brand">
          <Sparkles /> Fokus Hari
        </div>
        <p className="eyebrow">RUANG TENANG UNTUK HARI INI</p>
        <h1>
          Kurangi ramai.
          <br />
          Mulai yang penting.
        </h1>
        <p>
          Task pribadi yang cukup jelas untuk dimulai, cukup lembut untuk
          diulang.
        </p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <p className="eyebrow">
          {mode === "login" ? "SELAMAT DATANG" : "BUAT AKUN"}
        </p>
        <h2>{mode === "login" ? "Masuk ke harimu" : "Mulai langkah kecil"}</h2>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <p className="notice">{message}</p>}
        <button className="primary wide" disabled={busy}>
          {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Buat akun"}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "Belum punya akun? Daftar"
            : "Sudah punya akun? Masuk"}
        </button>
      </form>
    </main>
  );
}
function SetupScreen() {
  return (
    <main className="setup">
      <Sparkles size={32} />
      <h1>Fokus Hari siap disambungkan.</h1>
      <p>
        Tambahkan <code>VITE_SUPABASE_URL</code> dan{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> pada <code>.env.local</code> atau
        environment variables Netlify.
      </p>
    </main>
  );
}
