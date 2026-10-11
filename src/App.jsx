import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

/* ------------------------------------------------------------------ */
/*  Constants & date helpers                                           */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "weekly-planner:v1";
const FLIP_MS = 750;

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

// Monday-based week start, at local midnight
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
  d.setDate(d.getDate() - offset);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Local "YYYY-MM-DD" (avoids UTC shifting from toISOString)
function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function formatRange(start) {
  const end = addDays(start, 6);
  const sm = MONTHS_SHORT[start.getMonth()];
  const em = MONTHS_SHORT[end.getMonth()];
  if (start.getFullYear() !== end.getFullYear()) {
    return `${sm} ${start.getDate()}, ${start.getFullYear()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${sm} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Untimed notes first, then by time, then by creation order
function sortNotes(list = []) {
  return [...list].sort((a, b) => {
    if (!a.time && !b.time) return a.createdAt - b.createdAt;
    if (!a.time) return -1;
    if (!b.time) return 1;
    return a.time.localeCompare(b.time) || a.createdAt - b.createdAt;
  });
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Day cell (one box on a page)                                       */
/* ------------------------------------------------------------------ */

function DayCell({ date, index, notes, isToday, onOpen }) {
  const key = toKey(date);
  const list = sortNotes(notes);
  const weekend = index >= 5;
  const interactive = Boolean(onOpen);

  const open = () => interactive && onOpen(key);

  return (
    <div
      className={[
        "day",
        weekend && "day--weekend",
        isToday && "day--today",
      ]
        .filter(Boolean)
        .join(" ")}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={`${DAY_NAMES[index]} ${date.getDate()}, ${list.length} notes`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="day__head">
        <span className="day__num">{date.getDate()}</span>
        <span className="day__name">{DAY_NAMES[index]}</span>
        {list.length > 0 && <span className="day__count">{list.length}</span>}
      </div>

      <ul className="day__notes">
        {list.map((n) => (
          <li key={n.id} className={`note${n.done ? " note--done" : ""}`}>
            {n.time && <span className="note__time">{n.time}</span>}
            <span className="note__text">{n.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One page of the book (left = Mon–Wed, right = Thu–Sun)             */
/* ------------------------------------------------------------------ */

function Page({ side, weekStart, notes, todayKey, onOpenDay }) {
  const indices = side === "left" ? [0, 1, 2] : [3, 4, 5, 6];
  const week = isoWeek(weekStart);
  const sunday = addDays(weekStart, 6);

  return (
    <div className={`page-inner page-inner--${side}`}>
      <header className="page__header">
        {side === "left" ? (
          <>
            <span className="page__title">{MONTHS[weekStart.getMonth()]}</span>
            <span className="page__meta">{weekStart.getFullYear()}</span>
          </>
        ) : (
          <>
            <span className="page__title">Week {week}</span>
            <span className="page__meta">{MONTHS[sunday.getMonth()]}</span>
          </>
        )}
      </header>

      <div className="page__days">
        {indices.map((i) => {
          const date = addDays(weekStart, i);
          const key = toKey(date);
          return (
            <DayCell
              key={key}
              date={date}
              index={i}
              notes={notes[key]}
              isToday={key === todayKey}
              onOpen={onOpenDay}
            />
          );
        })}
      </div>

      <footer className={`page__folio page__folio--${side}`}>
        {side === "left" ? week * 2 - 1 : week * 2}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom sheet: CRUD for a single day                                */
/* ------------------------------------------------------------------ */

function DaySheet({ dayKey, notes, onClose, onAdd, onUpdate, onDelete }) {
  const date = fromKey(dayKey);
  const dayIndex = (date.getDay() + 6) % 7;
  const list = sortNotes(notes);

  const [editingId, setEditingId] = useState(null);
  const [time, setTime] = useState("");
  const [text, setText] = useState("");
  const textRef = useRef(null);

  const reset = () => {
    setEditingId(null);
    setTime("");
    setText("");
  };

  const startEdit = (note) => {
    setEditingId(note.id);
    setTime(note.time || "");
    setText(note.text);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const save = () => {
    const clean = text.trim();
    if (!clean) return;
    if (editingId) onUpdate(dayKey, editingId, { time, text: clean });
    else onAdd(dayKey, { time, text: clean });
    reset();
  };

  const remove = (id) => {
    onDelete(dayKey, id);
    if (id === editingId) reset();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Notes for ${DAY_NAMES[dayIndex]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grabber" />

        <div className="sheet__header">
          <div>
            <div className="sheet__weekday">{DAY_NAMES[dayIndex]}</div>
            <div className="sheet__title">
              {MONTHS[date.getMonth()]} {date.getDate()}
            </div>
          </div>
          <button type="button" className="sheet__done" onClick={onClose}>
            Done
          </button>
        </div>

        {list.length === 0 ? (
          <p className="sheet__empty">Nothing planned yet. Write your first note below.</p>
        ) : (
          <ul className="sheet__list">
            {list.map((n) => (
              <li
                key={n.id}
                className={[
                  "entry",
                  n.done && "entry--done",
                  n.id === editingId && "entry--editing",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  type="button"
                  className={`entry__check${n.done ? " entry__check--on" : ""}`}
                  aria-label={n.done ? "Mark as not done" : "Mark as done"}
                  onClick={() => onUpdate(dayKey, n.id, { done: !n.done })}
                >
                  {n.done && (
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                <button type="button" className="entry__body" onClick={() => startEdit(n)}>
                  <span className="entry__time">{n.time || "Any time"}</span>
                  <span className="entry__text">{n.text}</span>
                </button>

                <button
                  type="button"
                  className="entry__delete"
                  aria-label="Delete note"
                  onClick={() => remove(n.id)}
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 10h5.6l.7-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="composer">
          <div className="composer__row">
            <label className="composer__label" htmlFor="note-time">Time</label>
            <input
              id="note-time"
              type="time"
              className="composer__time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            {time && (
              <button type="button" className="composer__clear" onClick={() => setTime("")}>
                Clear time
              </button>
            )}
          </div>

          <textarea
            ref={textRef}
            className="composer__text"
            placeholder="What's the plan?"
            value={text}
            rows={3}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="composer__actions">
            {editingId && (
              <button type="button" className="btn btn--ghost" onClick={reset}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={!text.trim()}
              onClick={save}
            >
              {editingId ? "Save note" : "Add note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [notes, setNotes] = useState(loadNotes);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [flip, setFlip] = useState(null); // { dir: "next" | "prev", target: Date }
  const [openDay, setOpenDay] = useState(null);
  const touchStart = useRef(null);

  const todayKey = toKey(new Date());
  const currentWeek = startOfWeek(new Date());

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
      /* storage full or unavailable */
    }
  }, [notes]);

  /* ---------- CRUD ---------- */
  const addNote = useCallback((key, { time, text }) => {
    setNotes((prev) => ({
      ...prev,
      [key]: [
        ...(prev[key] || []),
        { id: uid(), time, text, done: false, createdAt: Date.now() },
      ],
    }));
  }, []);

  const updateNote = useCallback((key, id, patch) => {
    setNotes((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  }, []);

  const deleteNote = useCallback((key, id) => {
    setNotes((prev) => {
      const list = (prev[key] || []).filter((n) => n.id !== id);
      const next = { ...prev };
      if (list.length) next[key] = list;
      else delete next[key];
      return next;
    });
  }, []);

  /* ---------- navigation / flipping ---------- */
  const goTo = useCallback(
    (date) => {
      if (flip) return;
      const target = startOfWeek(date);
      if (target.getTime() === weekStart.getTime()) return;
      setFlip({ dir: target > weekStart ? "next" : "prev", target });
    },
    [flip, weekStart]
  );

  const next = () => goTo(addDays(weekStart, 7));
  const prev = () => goTo(addDays(weekStart, -7));

  const finishFlip = useCallback(() => {
    setFlip((f) => {
      if (f) setWeekStart(f.target);
      return null;
    });
  }, []);

  // Safety net in case animationend doesn't fire (backgrounded app etc.)
  useEffect(() => {
    if (!flip) return;
    const t = setTimeout(finishFlip, FLIP_MS + 400);
    return () => clearTimeout(t);
  }, [flip, finishFlip]);

  const onLeafAnimationEnd = (e) => {
    if (e.animationName === "flip-next" || e.animationName === "flip-prev") {
      finishFlip();
    }
  };

  /* ---------- swipe gestures ---------- */
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e) => {
    if (!touchStart.current || openDay) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      dx < 0 ? next() : prev();
    }
  };

  /* ---------- page composition ---------- */
  const renderPage = (ws, side, interactive) => (
    <Page
      side={side}
      weekStart={ws}
      notes={notes}
      todayKey={todayKey}
      onOpenDay={interactive ? setOpenDay : undefined}
    />
  );

  let leftPage, rightPage, leafFront, leafBack;

  if (!flip) {
    leftPage = renderPage(weekStart, "left", true);
    rightPage = renderPage(weekStart, "right", true);
  } else if (flip.dir === "next") {
    // Right page lifts and turns over to the left, revealing next week
    leftPage = renderPage(weekStart, "left", false);
    rightPage = renderPage(flip.target, "right", false);
    leafFront = renderPage(weekStart, "right", false);
    leafBack = renderPage(flip.target, "left", false);
  } else {
    // Left page lifts and turns back to the right, revealing previous week
    leftPage = renderPage(flip.target, "left", false);
    rightPage = renderPage(weekStart, "right", false);
    leafFront = renderPage(weekStart, "left", false);
    leafBack = renderPage(flip.target, "right", false);
  }

  const displayWeek = flip ? flip.target : weekStart;
  const isCurrent = displayWeek.getTime() === currentWeek.getTime();

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="nav-btn" onClick={prev} aria-label="Previous week">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="week-label">
          <span className="week-label__range">{formatRange(displayWeek)}</span>
          <span className="week-label__sub">
            {isCurrent ? "This week" : `Week ${isoWeek(displayWeek)}`}
          </span>
          {/* Invisible native date picker over the label: tap to jump */}
          <input
            type="date"
            className="week-label__picker"
            aria-label="Jump to a date"
            value={toKey(displayWeek)}
            onChange={(e) => e.target.value && goTo(fromKey(e.target.value))}
          />
        </div>

        <button type="button" className="nav-btn" onClick={next} aria-label="Next week">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="subbar">
        <button
          type="button"
          className={`today-btn${isCurrent ? " today-btn--hidden" : ""}`}
          onClick={() => goTo(new Date())}
          tabIndex={isCurrent ? -1 : 0}
        >
          Back to this week
        </button>
      </div>

      <main className="desk" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="book">
          <div className="spread">
            <section className="page page--left">{leftPage}</section>
            <section className="page page--right">{rightPage}</section>
            <div className="spine" aria-hidden="true" />
            <div className="ribbon" aria-hidden="true" />

            {flip && (
              <div className={`leaf leaf--${flip.dir}`} onAnimationEnd={onLeafAnimationEnd}>
                <div className={`leaf__face leaf__front page page--${flip.dir === "next" ? "right" : "left"}`}>
                  {leafFront}
                </div>
                <div className={`leaf__face leaf__back page page--${flip.dir === "next" ? "left" : "right"}`}>
                  {leafBack}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {openDay && (
        <DaySheet
          key={openDay}
          dayKey={openDay}
          notes={notes[openDay]}
          onClose={() => setOpenDay(null)}
          onAdd={addNote}
          onUpdate={updateNote}
          onDelete={deleteNote}
        />
      )}
    </div>
  );
}
