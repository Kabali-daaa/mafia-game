"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  joinGame,
  recallName,
  sendAction,
  subscribeToView,
} from "@/lib/game";
import { ASSIGNABLE_ROLES, getRole, type RoleDef, teamLabel } from "@/game/roles";
import type { ChatLine, PublicPlayer, RoomView } from "@/lib/types";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code || "").toUpperCase();
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const name = recallName();
    if (!name) {
      router.replace("/");
      return;
    }
    let unsub = () => {};
    const gotView = { current: false };
    const onView = (v: RoomView) => {
      gotView.current = true;
      setError("");
      setView(v);
    };
    // Subscribe right away so a refresh/returning player sees the room instantly
    // if they already have a seat (no false "room not found").
    unsub = subscribeToView(code, onView, () => {});
    // In parallel, (re)claim the seat — reconnect by id, or resume by name.
    joinGame(code, name)
      .then(() => {
        // Re-subscribe in case we adopted a resumed id (rejoin-by-name).
        unsub();
        unsub = subscribeToView(code, onView, () => {});
      })
      .catch((e: any) => {
        if (gotView.current) return; // already showing the room — ignore hiccups
        setError(e.message);
        if (/not found/i.test(e.message))
          setTimeout(() => {
            if (!gotView.current) router.replace("/");
          }, 2000);
      });
    return () => unsub();
  }, [code, router]);

  if (error && !view) {
    return (
      <div className="rounded-3xl bg-rose-500/15 p-6 text-center text-rose-200">
        {error}
      </div>
    );
  }
  if (!view) {
    return <div className="py-24 text-center text-white/50">Connecting…</div>;
  }
  return <Room view={view} />;
}

/* ----------------------------- shared UI bits ---------------------------- */

// Whether the player's own role is currently shown on screen (hide for privacy).
const RoleViz = createContext<{ visible: boolean; toggle: () => void }>({
  visible: true,
  toggle: () => {},
});

const AVATAR_GRADIENTS = [
  "from-amber-400 to-orange-500",
  "from-violet-400 to-fuchsia-500",
  "from-cyan-400 to-sky-500",
  "from-emerald-400 to-teal-500",
  "from-rose-400 to-pink-500",
  "from-indigo-400 to-violet-500",
  "from-lime-400 to-emerald-500",
  "from-fuchsia-400 to-purple-500",
];
function gradientFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
function Avatar({
  name,
  size = 40,
  dimmed = false,
}: {
  name: string;
  size?: number;
  dimmed?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(
        name
      )} font-bold text-black/80 ${dimmed ? "opacity-40 grayscale" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function teamAccentText(team: string) {
  return team === "mafia"
    ? "text-rose-300"
    : team === "neutral"
      ? "text-amber-300"
      : "text-cyan-300";
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl bg-[#181820] p-5 ring-1 ring-white/10 ${className}`}>
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-white/45">
      {children}
    </h2>
  );
}

/* -------------------------------- layout --------------------------------- */

type Tab = "game" | "chat" | "players" | "log";

// The phase action + host controls (the "Game" section).
function MainColumn({ view }: { view: RoomView }) {
  const isHost = view.you.isHost;
  const inRound =
    view.phase === "night" || view.phase === "witch" || view.phase === "day";
  return (
    <div className="space-y-5">
      {view.phase === "lobby" && <Lobby view={view} />}
      {view.phase === "night" && <NightPhase view={view} />}
      {view.phase === "witch" && <WitchPhase view={view} />}
      {view.phase === "day" && <DayPhase view={view} />}
      {view.phase === "ended" && <Ended view={view} />}
      {inRound && isHost && <HostControls view={view} />}
    </div>
  );
}

function Room({ view }: { view: RoomView }) {
  const hasChat = view.phase !== "lobby";
  const tabs: Tab[] = hasChat
    ? ["game", "chat", "players", "log"]
    : ["game", "players"];
  const [tab, setTab] = useState<Tab>("game");
  const activeTab = tabs.includes(tab) ? tab : "game";
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("game");
  }, [tabs, tab]);

  // New-message notification for the Chat tab (cleared when you open chat).
  const chatCount = view.chat.town.length + (view.chat.killers?.length ?? 0);
  const [seen, setSeen] = useState(chatCount);
  useEffect(() => {
    if (activeTab === "chat") setSeen(chatCount);
  }, [activeTab, chatCount]);
  const unread = activeTab === "chat" ? 0 : Math.max(0, chatCount - seen);

  // --- Role privacy + dramatic reveal ---
  const [roleVisible, setRoleVisible] = useState(false);
  const [revealRoleId, setRevealRoleId] = useState<string | null>(null);
  const roleId = view.you.roleId;
  useEffect(() => {
    if (view.you.isHost || !roleId) return;
    // Show the dramatic reveal once per assigned role (survives refresh; fires
    // again if the role changes, e.g. Psycho → Vigilante).
    const key = `mafia:seenRole:${view.code}`;
    if (localStorage.getItem(key) !== roleId) setRevealRoleId(roleId);
  }, [roleId, view.you.isHost, view.code]);

  const dismissReveal = () => {
    localStorage.setItem(`mafia:seenRole:${view.code}`, roleId || "");
    setRevealRoleId(null);
    setRoleVisible(false); // re-hide for privacy after they've seen it
  };

  const section =
    activeTab === "chat" && hasChat ? (
      <Chat view={view} />
    ) : activeTab === "players" ? (
      <Roster view={view} />
    ) : activeTab === "log" ? (
      <LogFeed view={view} />
    ) : (
      <MainColumn view={view} />
    );

  return (
    <RoleViz.Provider value={{ visible: roleVisible, toggle: () => setRoleVisible((v) => !v) }}>
      <div className="space-y-5">
        <Header view={view} />

        <div className="lg:flex lg:items-start lg:gap-5">
          <SideNav tabs={tabs} active={activeTab} onChange={setTab} unread={unread} />
          <div className="min-w-0 flex-1 space-y-5 pb-28 lg:pb-0">{section}</div>
        </div>

        <BottomNav tabs={tabs} active={activeTab} onChange={setTab} unread={unread} />
      </div>

      {revealRoleId && (
        <RoleReveal role={getRole(revealRoleId)} onDone={dismissReveal} />
      )}
    </RoleViz.Provider>
  );
}

// Full-screen, suspenseful role reveal shown when a player's role is assigned.
function RoleReveal({ role, onDone }: { role: RoleDef | null; onDone: () => void }) {
  const [stage, setStage] = useState(0); // 0 = build-up, 1 = revealed
  useEffect(() => {
    const t = setTimeout(() => setStage(1), 1400);
    return () => clearTimeout(t);
  }, []);
  if (!role) return null;

  const glow =
    role.team === "mafia"
      ? "shadow-rose-500/50"
      : role.team === "neutral"
        ? "shadow-amber-400/50"
        : "shadow-cyan-400/50";
  const ring =
    role.team === "mafia"
      ? "ring-rose-400/60"
      : role.team === "neutral"
        ? "ring-amber-300/60"
        : "ring-cyan-300/60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm">
      {stage === 0 ? (
        <div className="text-center">
          <div className="text-2xl font-semibold text-white/70 animate-pulse">
            Dealing your role…
          </div>
          <div className="mt-6 text-6xl animate-spin-slow">🎭</div>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-white/50 reveal-fade">
            You are the
          </div>
          <div
            className={`reveal-pop flex flex-col items-center rounded-[2rem] bg-[#15151d] px-10 py-10 shadow-2xl ${glow} ring-2 ${ring}`}
          >
            <div className="text-7xl drop-shadow-lg">{role.emoji}</div>
            <div className="mt-3 text-4xl font-black">{role.name}</div>
            <div className={`mt-1 text-sm font-bold uppercase tracking-widest ${teamAccentText(role.team)}`}>
              {teamLabel(role.team)}
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/65">{role.description}</p>
          </div>
          <button
            onClick={onDone}
            className="reveal-fade mt-8 rounded-2xl bg-white/15 px-8 py-3 font-bold ring-1 ring-white/20 transition hover:bg-white/25"
          >
            🙈 Got it — hide my role
          </button>
        </div>
      )}
    </div>
  );
}

const TAB_META: Record<Tab, { icon: string; label: string }> = {
  game: { icon: "🎭", label: "Game" },
  chat: { icon: "💬", label: "Chat" },
  players: { icon: "👥", label: "Players" },
  log: { icon: "📜", label: "Story" },
};

function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white ${className}`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function SideNav({
  tabs,
  active,
  onChange,
  unread,
}: {
  tabs: Tab[];
  active: Tab;
  onChange: (t: Tab) => void;
  unread: number;
}) {
  return (
    <nav className="hidden w-52 shrink-0 lg:block">
      <div className="sticky top-6 space-y-1 rounded-3xl bg-[#181820] p-3 ring-1 ring-white/10">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              onClick={() => onChange(t)}
              className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left font-semibold transition ${
                on
                  ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30"
                  : "text-white/55 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              <span className="text-lg">{TAB_META[t].icon}</span>
              <span>{TAB_META[t].label}</span>
              {t === "chat" && <UnreadBadge count={unread} className="ml-auto" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function BottomNav({
  tabs,
  active,
  onChange,
  unread,
}: {
  tabs: Tab[];
  active: Tab;
  onChange: (t: Tab) => void;
  unread: number;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 lg:hidden">
      <div className="mx-auto max-w-md px-4 pb-4">
        <div className="flex items-stretch justify-around gap-1 rounded-3xl bg-[#1c1c26]/95 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur">
          {tabs.map((t) => {
            const on = t === active;
            return (
              <button
                key={t}
                onClick={() => onChange(t)}
                className="relative flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5"
              >
                <span
                  className={`flex h-9 w-14 items-center justify-center rounded-2xl text-lg transition ${
                    on ? "bg-violet-500 shadow-lg shadow-violet-900/40" : "opacity-50"
                  }`}
                >
                  {TAB_META[t].icon}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    on ? "text-violet-300" : "text-white/45"
                  }`}
                >
                  {TAB_META[t].label}
                </span>
                {t === "chat" && (
                  <UnreadBadge count={unread} className="absolute right-2 top-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function Header({ view }: { view: RoomView }) {
  const role = getRole(view.you.roleId);
  const { visible, toggle } = useContext(RoleViz);
  const phase: Record<string, { label: string; cls: string }> = {
    lobby: { label: "Lobby", cls: "bg-white/10 text-white/80" },
    night: { label: `🌙 Night ${view.day}`, cls: "bg-indigo-500/25 text-indigo-200" },
    witch: { label: "🧙 The Witch stirs", cls: "bg-purple-500/25 text-purple-200" },
    day: { label: `☀️ Day ${view.day}`, cls: "bg-amber-500/25 text-amber-200" },
    ended: { label: "Game over", cls: "bg-emerald-500/25 text-emerald-200" },
  };
  const p = phase[view.phase];

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#181820] p-4 ring-1 ring-white/10 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xl">
          🎭
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Room code
          </div>
          <div className="text-2xl font-extrabold tracking-[0.25em]">{view.code}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${p.cls}`}>
          {p.label}
        </span>
        {view.you.isHost ? (
          <span className="flex items-center gap-2 rounded-full bg-amber-400/20 px-3 py-1.5 text-sm font-semibold text-amber-200">
            🎙️ God
          </span>
        ) : role ? (
          <button
            onClick={toggle}
            title={visible ? "Tap to hide your role" : "Tap to reveal your role"}
            className={`flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold transition hover:bg-white/15 ${
              visible
                ? view.you.alive
                  ? teamAccentText(role.team)
                  : "text-white/40 line-through"
                : "text-white/55"
            }`}
          >
            {visible ? (
              <>
                {role.emoji} {role.name} <span className="opacity-60">🙈</span>
              </>
            ) : (
              <>🎭 Tap to reveal</>
            )}
          </button>
        ) : null}
      </div>
    </header>
  );
}

/* -------------------------------- lobby ---------------------------------- */

function Lobby({ view }: { view: RoomView }) {
  const isHost = view.you.isHost;
  const playerCount = [view.you, ...view.players].filter((p) => !p.isHost).length;
  const total = Object.values(view.config).reduce((a, b) => a + b, 0);
  const [copied, setCopied] = useState(false);

  const setCount = (roleId: string, n: number) =>
    sendAction(view.code, "setConfig", {
      config: { ...view.config, [roleId]: Math.max(0, n) },
    });

  const copy = () => {
    navigator.clipboard?.writeText(view.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold">Lobby</h2>
          <p className="mt-0.5 text-sm text-white/55">
            {playerCount} player{playerCount === 1 ? "" : "s"} joined (excluding the host).
          </p>
        </div>
        <button
          onClick={copy}
          className="rounded-2xl bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-200 ring-1 ring-cyan-400/30 transition hover:bg-cyan-400/25"
        >
          {copied ? "Copied!" : `Share ${view.code}`}
        </button>
      </div>

      {isHost ? (
        <div className="mt-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <SectionTitle>Roles</SectionTitle>
            <span
              className={`text-sm font-bold ${
                total === playerCount ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              {total} / {playerCount}
            </span>
          </div>
          {ASSIGNABLE_ROLES.map((r) => {
            const count = view.config[r.id] ?? 0;
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 transition ${
                  count > 0 ? "bg-white/[0.06] ring-white/15" : "bg-white/[0.02] ring-white/5"
                }`}
              >
                <span className="text-xl">{r.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.name}{" "}
                    <span className={`text-xs ${teamAccentText(r.team)}`}>
                      {teamLabel(r.team)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-white/45">{r.description}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCount(r.id, count - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-lg leading-none transition hover:bg-white/20"
                  >
                    –
                  </button>
                  <span className="w-5 text-center font-bold">{count}</span>
                  <button
                    onClick={() => setCount(r.id, count + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-lg leading-none transition hover:bg-white/20"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => sendAction(view.code, "start")}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3.5 font-bold shadow-lg shadow-violet-900/40 transition hover:opacity-90 active:scale-[0.99]"
          >
            Start game
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-white/5 px-4 py-6 text-center text-white/70">
          <div className="mb-2 text-2xl">⏳</div>
          Waiting for the host to start the game…
        </div>
      )}
    </Card>
  );
}

/* ------------------------------ action panel ----------------------------- */

function ActionPanel({ view }: { view: RoomView }) {
  const prompt = view.prompt!;
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  const phaseKey = `${view.phase}:${view.day}`;
  useEffect(() => {
    setPicked([]);
    setSent(false);
  }, [phaseKey]);

  const all = [view.you, ...view.players];
  const targets = prompt.targets
    .map((id) => all.find((p) => p.id === id))
    .filter(Boolean) as (PublicPlayer | typeof view.you)[];

  const need = prompt.selectCount;
  const toggle = (id: string) =>
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (need === 1) return [id];
      if (cur.length >= need) return [...cur.slice(1), id];
      return [...cur, id];
    });

  const submit = (ids: string[]) => {
    if (prompt.kind === "vote")
      sendAction(view.code, "vote", { targetId: ids[0] ?? null });
    else sendAction(view.code, "nightAction", { targetIds: ids });
    setSent(true);
  };

  if (prompt.submitted || sent) {
    return (
      <div className="mt-4 rounded-2xl bg-emerald-500/15 px-4 py-3.5 text-center font-medium text-emerald-200">
        ✔ Locked in — waiting for the others…
      </div>
    );
  }

  // Skip / Revote choice on a tied vote.
  if (prompt.kind === "choice") {
    return (
      <div className="mt-4 grid gap-2.5">
        {(prompt.choices ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => {
              sendAction(view.code, "choice", { choice: c.id });
              setSent(true);
            }}
            className="rounded-2xl bg-white/5 px-4 py-4 font-bold ring-1 ring-white/10 transition hover:bg-white/10 active:scale-[0.98]"
          >
            {c.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {targets.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className={`flex flex-col items-center gap-2 rounded-2xl px-2 py-3 ring-1 transition active:scale-[0.97] ${
                on
                  ? "bg-violet-500/30 ring-violet-400"
                  : "bg-white/5 ring-white/10 hover:bg-white/10"
              }`}
            >
              <Avatar name={p.name} size={40} />
              <span className="max-w-full truncate text-sm font-semibold">
                {p.name}
                {p.id === view.you.id ? " (you)" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {need > 1 && (
        <p className="mt-2 text-xs text-white/50">
          Pick {need} — selected {picked.length}/{need}.
        </p>
      )}
      <div className="mt-4 flex gap-2.5">
        <button
          disabled={picked.length !== need}
          onClick={() => submit(picked)}
          className="flex-1 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3.5 font-bold transition hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
        >
          Confirm
        </button>
        {prompt.canSkip && (
          <button
            onClick={() => submit([])}
            className="rounded-2xl bg-white/10 px-6 py-3.5 font-bold transition hover:bg-white/20"
          >
            Skip
          </button>
        )}
      </div>
    </>
  );
}

/* ------------------------------- phases ---------------------------------- */

function PrivateMessage({ view }: { view: RoomView }) {
  if (!view.privateMessage) return null;
  return (
    <div className="mb-3 rounded-2xl bg-amber-400/15 px-4 py-3 text-sm font-medium text-amber-100 ring-1 ring-amber-400/25">
      {view.privateMessage}
    </div>
  );
}

function PhaseHeading({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-3xl">{emoji}</span>
      <h2 className="text-xl font-extrabold">{title}</h2>
    </div>
  );
}

function NightPhase({ view }: { view: RoomView }) {
  if (view.you.isHost) {
    const board = view.nightControl?.board ?? [];
    return (
      <Card>
        <PhaseHeading emoji="🌙" title={`Night ${view.day}`} />
        <p className="mt-1 text-sm text-white/55">
          Now calling: <span className="font-bold text-white/85">{view.nightStepLabel ?? "…"}</span>.
          Tap the button below to move on.
        </p>
        <ul className="mt-3 space-y-1.5">
          {board.map((e, i) => (
            <li
              key={i}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1 ${
                e.current ? "bg-indigo-500/15 ring-indigo-400/40" : "bg-white/[0.04] ring-white/10"
              }`}
            >
              <span className="min-w-0">
                <span className="text-white/45">{e.step}</span>{" "}
                <span className="font-semibold">{e.name}</span>
              </span>
              <span className={`shrink-0 ${e.done ? "text-emerald-300" : "text-amber-300"}`}>
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  if (!view.you.alive) return <DeadNotice text="You're out of the game, but watch it unfold." />;
  return (
    <Card>
      <PrivateMessage view={view} />
      {view.prompt ? (
        <>
          <PhaseHeading emoji="🌙" title={view.prompt.text} />
          <ActionPanel view={view} />
        </>
      ) : (
        <>
          <PhaseHeading emoji="🌙" title={`Night ${view.day}`} />
          <p className="mt-2 text-white/60">
            {view.nightStepLabel
              ? `The God is waking the ${view.nightStepLabel}… wait for your turn.`
              : "Sit tight…"}
          </p>
        </>
      )}
    </Card>
  );
}

function WitchPhase({ view }: { view: RoomView }) {
  if (view.prompt && view.prompt.kind === "witch") {
    return (
      <Card className="!bg-purple-500/10 ring-purple-400/30">
        <PrivateMessage view={view} />
        <PhaseHeading emoji="🧙" title={view.prompt.text} />
        <ActionPanel view={view} />
      </Card>
    );
  }
  return (
    <Card>
      <PhaseHeading emoji="🧙" title="The Witch stirs" />
      <p className="mt-2 text-white/60">
        Something is happening in the dark before dawn… wait for morning.
      </p>
    </Card>
  );
}

function DayPhase({ view }: { view: RoomView }) {
  const stage = view.voteStage;
  if (view.you.isHost) {
    const hostNote =
      stage === "discussion"
        ? "Discussion time — let the town argue in chat, then open the vote below."
        : stage === "done"
          ? "The day is settled. Begin the night when everyone's ready."
          : stage === "godchoice"
            ? "The vote is deadlocked — break the tie below: Skip or Revote."
            : stage === "choice"
              ? "It's a tie — the town is voting Skip vs Revote."
              : stage === "revote"
                ? "Revote in progress between the tied players."
                : "Voting is open — players are casting their votes.";
    return (
      <Card>
        <PhaseHeading emoji="☀️" title={`Day ${view.day}`} />
        <p className="mt-2 text-white/60">{hostNote}</p>
      </Card>
    );
  }
  if (!view.you.alive) return <DeadNotice text="The dead can't vote. Enjoy the show." />;

  // Player view with no active vote prompt → discussion / settled / God-deciding.
  if (!view.prompt) {
    const msg =
      stage === "discussion"
        ? "Discuss in the town chat 💬 — the God will open the vote soon."
        : stage === "done"
          ? "The day's vote is settled. Waiting for the God to begin the night…"
          : "The vote tied — waiting for the God to decide Skip or Revote…";
    return (
      <Card>
        <PrivateMessage view={view} />
        <PhaseHeading emoji="☀️" title={`Day ${view.day}`} />
        <p className="mt-2 text-white/60">{msg}</p>
      </Card>
    );
  }
  const isChoice = view.prompt.kind === "choice";
  return (
    <Card>
      {/* Night results (e.g. the Police squad's finding) surface in the morning. */}
      <PrivateMessage view={view} />
      <PhaseHeading emoji={isChoice ? "🤝" : "🗳️"} title={view.prompt.text} />
      <ActionPanel view={view} />
    </Card>
  );
}

function DeadNotice({ text }: { text: string }) {
  return (
    <Card className="text-center">
      <div className="text-4xl">⚰️</div>
      <p className="mt-2 text-white/60">{text}</p>
    </Card>
  );
}

function HostControls({ view }: { view: RoomView }) {
  const status = view.hostStatus;
  const all = [view.you, ...view.players];
  const stage = view.voteStage;
  const isGodChoice = view.phase === "day" && stage === "godchoice";

  const label =
    view.phase === "night"
      ? view.nightControl?.nextLabel
        ? `Next: ${view.nightControl.nextLabel} →`
        : "Resolve night 🌅"
      : view.phase === "witch"
        ? "Reveal morning →"
        : stage === "discussion"
          ? "Open the vote 🗳️"
          : stage === "done"
            ? `Begin Night ${view.day + 1} 🌙`
            : stage === "choice"
              ? "Resolve choice →"
              : stage === "revote"
                ? "Resolve revote →"
                : "Resolve vote →";

  // Map a vote-count key to a readable label (player name, or Skip/Revote).
  const labelFor = (id: string) =>
    id === "skip" ? "⏭️ Skip" : id === "revote" ? "🔁 Revote" : all.find((p) => p.id === id)?.name ?? id;

  const dayVoting =
    view.phase === "day" && (stage === "vote" || stage === "revote" || stage === "choice");
  return (
    <Card className="!bg-amber-400/10 ring-amber-400/30">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-amber-200">🎙️ God controls</h2>
        {status && (dayVoting || view.phase === "witch") && (
          <span className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold text-amber-100">
            {view.phase === "day" ? (stage === "choice" ? "Choice" : "Votes") : "Witch"}{" "}
            {status.acted}/{status.pending}
          </span>
        )}
      </div>

      {dayVoting && status && (
        <div className="mt-3 space-y-1.5">
          {Object.entries(status.voteCounts).length === 0 ? (
            <div className="text-sm text-amber-100/60">No votes yet.</div>
          ) : (
            Object.entries(status.voteCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {id !== "skip" && id !== "revote" && (
                      <Avatar name={all.find((p) => p.id === id)?.name ?? "?"} size={24} />
                    )}
                    {labelFor(id)}
                  </span>
                  <span className="font-bold text-amber-200">{n}</span>
                </div>
              ))
          )}
        </div>
      )}

      {isGodChoice ? (
        <div className="mt-3">
          <p className="text-sm text-amber-100/80">
            The vote is deadlocked. Your call:
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => sendAction(view.code, "godDecide", { decision: "skip" })}
              className="flex-1 rounded-2xl bg-white/15 py-3 font-bold ring-1 ring-white/20 transition hover:bg-white/25"
            >
              ⏭️ Skip
            </button>
            <button
              onClick={() => sendAction(view.code, "godDecide", { decision: "revote" })}
              className="flex-1 rounded-2xl bg-amber-400 py-3 font-bold text-[#2a1e00] transition hover:bg-amber-300"
            >
              🔁 Revote
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => sendAction(view.code, "advance")}
          className="mt-4 w-full rounded-2xl bg-amber-400 py-3 font-bold text-[#2a1e00] transition hover:bg-amber-300 active:scale-[0.99]"
        >
          {label}
        </button>
      )}
    </Card>
  );
}

function Ended({ view }: { view: RoomView }) {
  const won = view.winner;
  const conf =
    won === "town"
      ? { emoji: "🎉", title: "Town wins!", cls: "from-cyan-500/30 to-emerald-500/20" }
      : won === "mafia"
        ? { emoji: "💀", title: "Killers win!", cls: "from-rose-500/30 to-red-500/20" }
        : { emoji: "🤡", title: "Neutral wins!", cls: "from-amber-500/30 to-orange-500/20" };
  return (
    <Card className={`bg-gradient-to-br ${conf.cls} text-center`}>
      <div className="text-5xl">{conf.emoji}</div>
      <h2 className="mt-2 text-2xl font-extrabold">{conf.title}</h2>
      <p className="mt-1 text-white/65">Final roles are revealed in the roster.</p>
      {view.you.isHost && (
        <button
          onClick={() => sendAction(view.code, "reset")}
          className="mt-4 rounded-2xl bg-white/15 px-6 py-3 font-bold ring-1 ring-white/20 transition hover:bg-white/25"
        >
          Play again
        </button>
      )}
    </Card>
  );
}

/* --------------------------------- chat ---------------------------------- */

function Chat({ view }: { view: RoomView }) {
  const { chat } = view;
  const isHost = view.you.isHost;
  return (
    <div className="space-y-5">
      {chat.killers !== null && (
        <ChatBox
          title="🔪 Killers' room"
          subtitle={
            isHost
              ? "Private to the Killers — you can whisper anonymously."
              : "Private to you and your fellow Killers."
          }
          accent="killers"
          code={view.code}
          lines={chat.killers}
          channel="killers"
          canPost={chat.canPostKillers}
          placeholder={
            !chat.canPostKillers
              ? "Killers' room is quiet now."
              : isHost
                ? "Whisper to the Killers (anonymously)…"
                : "Plan with your team…"
          }
        />
      )}
      <ChatBox
        title="🏙️ Town chat"
        subtitle={
          isHost
            ? "Anonymous to players — you see senders and can post anonymously."
            : "Anonymous. No one can tell who said what."
        }
        accent="town"
        code={view.code}
        lines={chat.town}
        channel="town"
        canPost={chat.canPostTown}
        placeholder={
          chat.canPostTown
            ? isHost
              ? "Drop an anonymous message…"
              : "Say something (anonymously)…"
            : view.you.alive
              ? "Town chat opens during the day."
              : "The dead can't speak."
        }
      />
    </div>
  );
}

function ChatBox({
  title,
  subtitle,
  accent,
  code,
  lines,
  channel,
  canPost,
  placeholder,
}: {
  title: string;
  subtitle: string;
  accent: "town" | "killers";
  code: string;
  lines: ChatLine[];
  channel: "town" | "killers";
  canPost: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  const send = () => {
    const t = text.trim();
    if (!t || !canPost) return;
    sendAction(code, "chat", { channel, text: t });
    setText("");
  };

  const isKillers = accent === "killers";
  return (
    <Card className={isKillers ? "!bg-rose-500/10 ring-rose-400/25" : ""}>
      <h2 className="text-sm font-extrabold">{title}</h2>
      <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/35">No messages yet.</p>
        ) : (
          lines.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%]">
                <div
                  className={`mb-0.5 text-[11px] font-semibold ${
                    m.sender === null ? "italic text-white/35" : "text-white/55"
                  } ${m.mine ? "text-right" : ""}`}
                >
                  {m.sender ?? "Anonymous"}
                </div>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    m.mine
                      ? "bg-violet-500/35 text-white"
                      : isKillers
                        ? "bg-black/25 text-white/90"
                        : "bg-white/8 text-white/90"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={text}
          disabled={!canPost}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={placeholder}
          maxLength={500}
          className="min-w-0 flex-1 rounded-2xl bg-white/5 px-3.5 py-2.5 text-sm outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-violet-400 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!canPost || !text.trim()}
          className="shrink-0 rounded-2xl bg-violet-500 px-4 py-2.5 text-sm font-bold transition hover:bg-violet-400 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </Card>
  );
}

/* -------------------------------- roster --------------------------------- */

function Roster({ view }: { view: RoomView }) {
  const all = useMemo(() => [view.you, ...view.players], [view]);
  const aliveCount = all.filter((p) => !p.isHost && p.alive).length;
  const { visible: ownRoleVisible } = useContext(RoleViz);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Players</SectionTitle>
        <span className="text-xs font-semibold text-white/45">{aliveCount} alive</span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {all.map((p) => {
          const role = getRole(p.roleId);
          const isYou = p.id === view.you.id;
          // Your own role respects the hide toggle; others only at game end.
          const reveal =
            view.you.isHost || view.phase === "ended" || (isYou && ownRoleVisible);
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 ring-1 ring-white/10 ${
                p.alive ? "bg-white/[0.05]" : "bg-white/[0.02]"
              }`}
            >
              <Avatar name={p.name} size={34} dimmed={!p.alive && !p.isHost} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`truncate text-sm font-semibold ${
                      !p.alive && !p.isHost ? "text-white/40 line-through" : ""
                    }`}
                  >
                    {p.name}
                    {p.id === view.you.id && " (you)"}
                  </span>
                  {!p.connected && <span className="text-[10px] text-white/30">offline</span>}
                </div>
                <div className="truncate text-[11px] text-white/45">
                  {p.isHost ? "🎙️ God" : !p.alive ? "⚰️ Out" : "Alive"}
                  {role && reveal && (
                    <>
                      {" · "}
                      {role.emoji} {role.name}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* --------------------------------- log ----------------------------------- */

function LogFeed({ view }: { view: RoomView }) {
  if (view.log.length === 0) return null;
  return (
    <Card>
      <SectionTitle>Story so far</SectionTitle>
      <ul className="mt-3 space-y-2 text-sm">
        {view.log
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={i} className="rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-white/80">
              {e.text}
            </li>
          ))}
      </ul>
    </Card>
  );
}
