"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { joinGame, recallName, sendAction, subscribeToView } from "@/lib/game";
import { ASSIGNABLE_ROLES, getRole, teamLabel } from "@/game/roles";
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
    // Make sure we have a seat (handles direct loads / refreshes), then
    // live-subscribe to our personal view of the room.
    let unsub = () => {};
    joinGame(code, name)
      .then(() => {
        unsub = subscribeToView(code, setView, setError);
      })
      .catch((e: any) => {
        setError(e.message);
        if (/not found/i.test(e.message)) setTimeout(() => router.replace("/"), 1800);
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
    <div className="space-y-5">
      <Header view={view} />

      <div className="lg:flex lg:items-start lg:gap-5">
        {/* PC: left-hand menu */}
        <SideNav
          tabs={tabs}
          active={activeTab}
          onChange={setTab}
          unread={unread}
        />
        {/* Active section (mobile + desktop). Bottom padding clears the mobile bar. */}
        <div className="min-w-0 flex-1 space-y-5 pb-28 lg:pb-0">{section}</div>
      </div>

      {/* Mobile: bottom tab bar */}
      <BottomNav tabs={tabs} active={activeTab} onChange={setTab} unread={unread} />
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
          <span
            className={`flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold ${
              view.you.alive ? teamAccentText(role.team) : "text-white/40 line-through"
            }`}
          >
            {role.emoji} {role.name}
          </span>
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
    return (
      <Card>
        <PhaseHeading emoji="🌙" title={`Night ${view.day}`} />
        <p className="mt-2 text-white/60">
          Players with night powers are acting in secret. Wait for them, or advance below.
        </p>
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
            You have no action tonight. Sit tight until morning…
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
  if (view.you.isHost) {
    return (
      <Card>
        <PhaseHeading emoji="☀️" title={`Day ${view.day}`} />
        <p className="mt-2 text-white/60">
          Let players debate in the town chat, then everyone votes. Advance when the
          votes are in.
        </p>
      </Card>
    );
  }
  if (!view.you.alive) return <DeadNotice text="The dead can't vote. Enjoy the show." />;
  if (!view.prompt) return null;
  return (
    <Card>
      {/* Night results (e.g. the Police squad's finding) surface in the morning. */}
      <PrivateMessage view={view} />
      <PhaseHeading emoji="🗳️" title={view.prompt.text} />
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
  const label =
    view.phase === "night"
      ? "Resolve night →"
      : view.phase === "witch"
        ? "Reveal morning →"
        : "Resolve vote →";

  return (
    <Card className="!bg-amber-400/10 ring-amber-400/30">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-amber-200">🎙️ God controls</h2>
        {status && (
          <span className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold text-amber-100">
            {view.phase === "day" ? "Votes" : view.phase === "witch" ? "Witch" : "Actions"}{" "}
            {status.acted}/{status.pending}
          </span>
        )}
      </div>

      {view.phase === "day" && status && (
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
                    <Avatar name={all.find((p) => p.id === id)?.name ?? "?"} size={24} />
                    {all.find((p) => p.id === id)?.name ?? id}
                  </span>
                  <span className="font-bold text-amber-200">{n}</span>
                </div>
              ))
          )}
        </div>
      )}

      <button
        onClick={() => sendAction(view.code, "advance")}
        className="mt-4 w-full rounded-2xl bg-amber-400 py-3 font-bold text-[#2a1e00] transition hover:bg-amber-300 active:scale-[0.99]"
      >
        {label}
      </button>
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

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Players</SectionTitle>
        <span className="text-xs font-semibold text-white/45">{aliveCount} alive</span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {all.map((p) => {
          const role = getRole(p.roleId);
          const reveal = p.id === view.you.id || view.you.isHost || view.phase === "ended";
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
