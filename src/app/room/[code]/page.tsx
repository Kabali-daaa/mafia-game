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
import { QRCodeSVG } from "qrcode.react";
import {
  ASSIGNABLE_ROLES,
  ROLE_LIST,
  getRole,
  type RoleDef,
  teamLabel,
} from "@/game/roles";
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

// Muted, metallic noir avatar tones — candlelight gold, pewter, blood, moonlight.
const AVATAR_GRADIENTS = [
  "from-amber-300 to-amber-600",
  "from-stone-300 to-stone-500",
  "from-steel-soft to-steel",
  "from-rose-300 to-rose-700",
  "from-yellow-600 to-amber-800",
  "from-zinc-400 to-zinc-600",
  "from-orange-300 to-rose-600",
  "from-slate-400 to-slate-700",
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
    ? "text-blood-soft"
    : team === "neutral"
      ? "text-gold-soft"
      : "text-steel-soft";
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl bg-ink-700 p-5 ring-1 ring-gold/15 ${className}`}>
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-gold/70">
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
  const [revealed, setRevealed] = useState(false); // tap-gated so a glance can't expose your role
  if (!role) return null;

  const glow =
    role.team === "mafia"
      ? "shadow-rose-500/50"
      : role.team === "neutral"
        ? "shadow-amber-400/50"
        : "shadow-steel/40";
  const ring =
    role.team === "mafia"
      ? "ring-rose-400/60"
      : role.team === "neutral"
        ? "ring-amber-300/60"
        : "ring-steel/60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm">
      {!revealed ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setRevealed(true)}
          className="flex cursor-pointer flex-col items-center text-center"
        >
          <div className="mb-5 font-display text-sm font-semibold uppercase tracking-[0.4em] text-gold-soft">
            Your fate is dealt
          </div>
          {/* Face-down card — nothing is shown until the player chooses to flip it. */}
          <div className="relative flex h-96 w-72 flex-col items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-br from-ink-600 to-ink-900 shadow-2xl ring-1 ring-gold/30">
            <span className="absolute left-3 top-2 text-lg text-gold/50">♠</span>
            <span className="absolute bottom-2 right-3 rotate-180 text-lg text-gold/50">♠</span>
            <div className="pointer-events-none absolute inset-2 rounded-xl border border-gold/15" />
            <div className="text-6xl text-gold/70 animate-flicker">🎭</div>
            <div className="mt-4 font-display text-lg uppercase tracking-[0.35em] text-gold/60">
              Mafia
            </div>
          </div>
          <span className="mt-8 rounded-2xl bg-blood px-8 py-3 font-bold text-bone shadow-lg shadow-black/60 ring-1 ring-gold/30">
            👆 Tap to see your role
          </span>
          <span className="mt-3 text-xs text-white/40">Make sure no one's looking.</span>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 font-display text-sm font-semibold uppercase tracking-[0.4em] text-gold-soft reveal-fade">
            You are the
          </div>
          <div
            className={`reveal-pop relative flex w-72 flex-col items-center rounded-2xl border border-gold/40 bg-ink-900 px-8 py-10 shadow-2xl ${glow} ring-1 ${ring}`}
          >
            {/* corner pips for the playing-card feel */}
            <span className="absolute left-3 top-2 text-lg text-gold/60">♠</span>
            <span className="absolute bottom-2 right-3 rotate-180 text-lg text-gold/60">♠</span>
            <div className="pointer-events-none absolute inset-2 rounded-xl border border-gold/15" />
            <div className="text-7xl drop-shadow-lg">{role.emoji}</div>
            <div className="mt-4 font-display text-3xl font-black tracking-wide">{role.name}</div>
            <div className={`mt-2 text-xs font-bold uppercase tracking-[0.3em] ${teamAccentText(role.team)}`}>
              {teamLabel(role.team)}
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/65">{role.description}</p>
          </div>
          <button
            onClick={onDone}
            className="reveal-fade mt-8 rounded-2xl bg-white/10 px-8 py-3 font-bold text-bone ring-1 ring-gold/25 transition hover:bg-white/20"
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
      <div className="sticky top-6 space-y-1 rounded-3xl bg-ink-700 p-3 ring-1 ring-gold/15">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              onClick={() => onChange(t)}
              className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left font-semibold transition ${
                on
                  ? "bg-gold/15 text-gold-soft ring-1 ring-gold/40"
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
        <div className="flex items-stretch justify-around gap-1 rounded-3xl bg-ink-800/95 p-2 shadow-2xl shadow-black/40 ring-1 ring-gold/15 backdrop-blur">
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
                    on ? "bg-gold shadow-lg shadow-black/60" : "opacity-50"
                  }`}
                >
                  {TAB_META[t].icon}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    on ? "text-gold-soft" : "text-white/45"
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
  const [showHelp, setShowHelp] = useState(false);
  const phase: Record<string, { label: string; cls: string }> = {
    lobby: { label: "Lobby", cls: "bg-white/10 text-bone/80" },
    night: { label: `🌙 Night ${view.day}`, cls: "bg-steel-deep/40 text-steel-soft ring-1 ring-steel/30" },
    witch: { label: "🧙 The Witch stirs", cls: "bg-steel-deep/40 text-steel-soft ring-1 ring-steel/30" },
    day: { label: `☀️ Day ${view.day}`, cls: "bg-gold/15 text-gold-soft ring-1 ring-gold/30" },
    ended: { label: "Game over", cls: "bg-blood/20 text-blood-soft ring-1 ring-blood/40" },
  };
  const p = phase[view.phase];

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-ink-700 p-4 ring-1 ring-gold/15 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-deep text-xl text-ink-900 shadow-lg shadow-black/50 ring-1 ring-gold/40 animate-flicker">
          🎭
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold/60">
            Room code
          </div>
          <div className="font-display text-2xl font-extrabold tracking-[0.3em] text-bone">{view.code}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowHelp(true)}
          title="Roles & rules"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/70 transition hover:bg-white/20"
        >
          ?
        </button>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
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

// In-app roles & rules reference, openable any time from the header.
function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"how" | "roles">("how");
  const byTeam = (team: string) =>
    ROLE_LIST.filter((r) => r.team === team).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl bg-ink-900 ring-1 ring-gold/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <h2 className="font-display text-lg font-extrabold text-bone">📖 How to play</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 p-3">
          {(["how", "roles"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-2xl px-4 py-2 text-sm font-bold transition ${
                tab === t
                  ? "bg-gold/20 text-gold-soft ring-1 ring-gold/40"
                  : "text-white/55 hover:bg-white/5"
              }`}
            >
              {t === "how" ? "Rules" : "Roles"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pt-1 text-sm text-white/75">
          {tab === "how" ? (
            <>
              <div>
                <h3 className="font-bold text-white">🏆 How to win</h3>
                <ul className="mt-1 space-y-1.5">
                  <li>🔵 <b>Town</b> — win when <b>every Killer is eliminated</b>.</li>
                  <li>🔴 <b>Killers</b> — win when they <b>equal or outnumber</b> everyone else still alive.</li>
                  <li>🤡 <b>Jester</b> — wins <b>alone &amp; instantly</b> if the town <b>votes them out</b> (banished to the forest). Being murdered at <i>night</i> does <b>not</b> count.</li>
                  <li>💞 <b>Lovers</b> — a Cupid couple from <b>opposite sides</b> (e.g. a Cop + a Killer) win <b>together</b> if they're the <b>last two players alive</b>.</li>
                </ul>
                <p className="mt-2 text-xs text-white/45">
                  The winner is checked after every night and every day vote — the first
                  side to meet its condition wins. A living Jester counts toward
                  &ldquo;everyone else,&rdquo; delaying a Killer win.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-white">🌙 Night</h3>
                <p className="mt-1">
                  The God calls each role-group in turn — Cupid, Killers, Psycho,
                  Police, Doctor, Item, then the Witch. Only the called role acts;
                  everyone else waits. The Killers make just <b>one kill</b> per night
                  no matter how many there are.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-white">☀️ Day</h3>
                <p className="mt-1">
                  Morning reveals who died — gruesomely, but <b>never</b> their role.
                  The town discusses in chat, then votes to <b>banish</b> one suspect
                  from the village. <b>No role is ever revealed</b> — not from a death,
                  not from a banishment (only on the end-game screen). Ties go to a
                  Skip-or-Revote choice; a deadlock is broken by the God.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-white">💬 Chat & privacy</h3>
                <p className="mt-1">
                  Town chat is anonymous. The Killers have a private room. Your role is
                  hidden by default — tap the chip in the header to peek.
                </p>
              </div>
            </>
          ) : (
            <>
              {([
                ["mafia", "🔴 Killers' side"],
                ["town", "🔵 Town"],
                ["neutral", "🟡 Neutral"],
              ] as const).map(([team, label]) => (
                <div key={team}>
                  <h3 className="mb-1.5 font-bold text-white">{label}</h3>
                  <ul className="space-y-2">
                    {byTeam(team).map((r) => (
                      <li key={r.id} className="flex gap-2.5 rounded-2xl bg-white/[0.04] p-2.5">
                        <span className="text-xl">{r.emoji}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-white/90">{r.name}</div>
                          <div className="text-xs text-white/55">{r.description}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- lobby ---------------------------------- */

// Share the room: a scannable QR + a copyable join link + the bare code.
function SharePanel({ code }: { code: string }) {
  const [joinUrl, setJoinUrl] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/?room=${code}`);
  }, [code]);

  const copy = (what: "link" | "code", value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const share = () => {
    if (navigator.share && joinUrl) {
      navigator
        .share({ title: "Join my Mafia game", text: `Room code: ${code}`, url: joinUrl })
        .catch(() => {});
    } else {
      copy("link", joinUrl);
    }
  };

  return (
    <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-gold/15 sm:flex-row sm:items-center">
      {joinUrl && (
        <div className="shrink-0 rounded-2xl bg-white p-2.5">
          <QRCodeSVG value={joinUrl} size={104} level="M" />
        </div>
      )}
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          Scan to join — or share the link
        </div>
        <div className="mt-1 font-display text-2xl font-extrabold tracking-[0.3em] text-bone">{code}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button
            onClick={share}
            className="rounded-2xl bg-steel/15 px-4 py-2 text-sm font-bold text-steel-soft ring-1 ring-steel/40 transition hover:bg-steel/25"
          >
            {copied === "link" ? "Link copied!" : "🔗 Share link"}
          </button>
          <button
            onClick={() => copy("code", code)}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white/80 ring-1 ring-white/15 transition hover:bg-white/20"
          >
            {copied === "code" ? "Copied!" : "Copy code"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Lobby({ view }: { view: RoomView }) {
  const isHost = view.you.isHost;
  const playerCount = [view.you, ...view.players].filter((p) => !p.isHost).length;
  const total = Object.values(view.config).reduce((a, b) => a + b, 0);

  const setCount = (roleId: string, n: number) =>
    sendAction(view.code, "setConfig", {
      config: { ...view.config, [roleId]: Math.max(0, n) },
    });

  return (
    <Card>
      <div>
        <h2 className="font-display text-xl font-extrabold text-bone">Lobby</h2>
        <p className="mt-0.5 text-sm text-white/55">
          {playerCount} player{playerCount === 1 ? "" : "s"} joined (excluding the host).
        </p>
      </div>

      <SharePanel code={view.code} />

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
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-blood to-blood-deep py-3.5 font-bold shadow-lg shadow-black/60 transition hover:opacity-90 active:scale-[0.99]"
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
            className="rounded-2xl bg-white/5 px-4 py-4 font-bold ring-1 ring-gold/15 transition hover:bg-white/10 active:scale-[0.98]"
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
                  ? "bg-gold/25 ring-gold"
                  : "bg-white/5 ring-gold/15 hover:bg-white/10"
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
          className="flex-1 rounded-2xl bg-gradient-to-r from-blood to-blood-deep py-3.5 font-bold transition hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
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
  // Tap-gated: the content (which can reveal your role) stays hidden until you choose
  // to read it, so it never sits exposed on screen for a passer-by to see.
  const [open, setOpen] = useState(false);
  // Reset to hidden whenever the message itself changes (new night result).
  const msg = view.privateMessage;
  useEffect(() => setOpen(false), [msg]);
  if (!msg) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-gold/10 px-4 py-3 text-left text-sm font-semibold text-gold-soft ring-1 ring-gold/25 transition hover:bg-gold/15"
      >
        <span>🔒 You have a private message</span>
        <span className="text-xs font-normal text-white/45">Tap to read</span>
      </button>
    );
  }
  return (
    <button
      onClick={() => setOpen(false)}
      className="mb-3 flex w-full items-start justify-between gap-3 rounded-2xl bg-gold/15 px-4 py-3 text-left text-sm font-medium text-bone ring-1 ring-gold/30"
    >
      <span>{msg}</span>
      <span className="shrink-0 text-xs text-white/40">🙈 hide</span>
    </button>
  );
}

function PhaseHeading({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-3xl">{emoji}</span>
      <h2 className="font-display text-xl font-extrabold text-bone">{title}</h2>
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
          Tap the button below to move on — or skip anyone who's stalling.
        </p>
        <ul className="mt-3 space-y-1.5">
          {board.map((e, i) => (
            <li
              key={i}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ring-1 ${
                e.current ? "bg-steel-deep/25 ring-steel/40" : "bg-white/[0.04] ring-gold/15"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-white/45">{e.step}</span>
                <span className="font-semibold">{e.name}</span>
                {!e.connected && <span className="text-[10px] font-semibold text-blood-soft">offline</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={e.done ? "text-emerald-300" : "text-amber-300"}>{e.text}</span>
                {!e.done && (
                  <button
                    onClick={() => sendAction(view.code, "hostSkip", { targetId: e.id })}
                    className="rounded-lg bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70 transition hover:bg-white/20"
                  >
                    skip
                  </button>
                )}
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
          <PhaseHeading emoji="🌙" title="Your move tonight" />
          <p className="mt-2 text-sm text-white/50">{view.prompt.text}</p>
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
      <Card className="!bg-ink-600 ring-gold/20">
        <PrivateMessage view={view} />
        <PhaseHeading emoji="🌙" title="Your move tonight" />
        <p className="mt-2 text-sm text-white/50">{view.prompt.text}</p>
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
        <h2 className="font-display text-lg font-extrabold text-gold-soft">🎙️ God controls</h2>
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

      {dayVoting && status && status.pendingPlayers.length > 0 && (
        <div className="mt-3 rounded-2xl bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-amber-100/70">
              Waiting on {status.pendingPlayers.length}
            </span>
            <button
              onClick={() => sendAction(view.code, "hostSkip", { targetId: "__all__" })}
              className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/75 transition hover:bg-white/20"
            >
              Skip all
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {status.pendingPlayers.map((p) => (
              <button
                key={p.id}
                onClick={() => sendAction(view.code, "hostSkip", { targetId: p.id })}
                title="Skip this player's vote"
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/75 transition hover:bg-white/20"
              >
                {p.name}
                {!p.connected && <span className="text-[10px] text-blood-soft">offline</span>}
                <span className="text-white/40">✕</span>
              </button>
            ))}
          </div>
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
      ? { emoji: "🎉", title: "Town wins!", cls: "from-steel/25 to-steel-deep/30" }
      : won === "mafia"
        ? { emoji: "💀", title: "Killers win!", cls: "from-blood/30 to-blood-deep/30" }
        : won === "lovers"
          ? { emoji: "💞", title: "Lovers win!", cls: "from-blood/25 to-gold/20" }
          : { emoji: "🤡", title: "Neutral wins!", cls: "from-gold/25 to-gold-deep/25" };
  // The whole game told back as a story, in order.
  const story = view.log.filter((e) => e.text.trim().length > 0);

  return (
    <div className="space-y-5">
      <Card className={`bg-gradient-to-br ${conf.cls} text-center ring-gold/25`}>
        <div className="text-5xl">{conf.emoji}</div>
        <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-wide text-bone">{conf.title}</h2>
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

      <Card>
        <SectionTitle>📖 How it all unfolded</SectionTitle>
        <ol className="mt-3 space-y-2.5">
          {story.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/50">
                {i + 1}
              </span>
              <p className="text-sm leading-relaxed text-white/80">{e.text}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
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
          title="🔒 Private room"
          subtitle={
            isHost
              ? "A private channel — you can whisper anonymously."
              : "Private to you and your circle."
          }
          accent="killers"
          code={view.code}
          lines={chat.killers}
          channel="killers"
          canPost={chat.canPostKillers}
          placeholder={
            !chat.canPostKillers
              ? "This room is quiet now."
              : isHost
                ? "Whisper here (anonymously)…"
                : "Plan with your circle…"
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
    <Card className={isKillers ? "!bg-ink-600 ring-gold/20" : ""}>
      <h2 className="font-display text-sm font-extrabold text-bone">{title}</h2>
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
                      ? "bg-gold/30 text-white"
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
          className="min-w-0 flex-1 rounded-2xl bg-white/5 px-3.5 py-2.5 text-sm outline-none ring-1 ring-gold/15 transition focus:ring-2 focus:ring-gold disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!canPost || !text.trim()}
          className="shrink-0 rounded-2xl bg-gold px-4 py-2.5 text-sm font-bold transition hover:bg-gold disabled:opacity-40"
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
              className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 ring-1 ring-gold/15 ${
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
      {/* Chronological — oldest at the top — so it reads as a story, newest last. */}
      <ul className="mt-3 space-y-2 text-sm">
        {view.log.map((e, i) => (
          <li key={i} className="rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-white/80">
            {e.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
