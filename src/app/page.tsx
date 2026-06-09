"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createGame, joinGame, recallName, rememberName } from "@/lib/game";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(recallName());
    // Pre-fill the code from a shared join link (?room=ABCD).
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) setCode(room.toUpperCase().slice(0, 4));
  }, []);

  const create = async () => {
    setError("");
    if (!name.trim()) return setError("Enter your name first.");
    rememberName(name.trim());
    setBusy(true);
    try {
      const { code } = await createGame(name.trim());
      router.push(`/room/${code}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const join = async () => {
    setError("");
    if (!name.trim()) return setError("Enter your name first.");
    if (!code.trim()) return setError("Enter a room code.");
    rememberName(name.trim());
    setBusy(true);
    try {
      const res = await joinGame(code.trim().toUpperCase(), name.trim());
      router.push(`/room/${res.code}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-gold to-gold-deep text-3xl text-ink-900 shadow-lg shadow-black/60 ring-1 ring-gold/40 animate-flicker">
          🎭
        </div>
        <h1 className="font-display text-5xl font-black uppercase tracking-[0.15em] text-bone">
          Mafia
        </h1>
        <p className="mt-3 text-sm italic text-gold/60">
          Trust no one after dark.
        </p>
        <p className="mt-1 text-sm text-white/55">
          A real-time party game. One host narrates; everyone else plays.
        </p>
      </header>

      <div className="rounded-3xl bg-ink-700/80 p-5 ring-1 ring-gold/15 backdrop-blur">
        <label className="block text-xs font-semibold uppercase tracking-wide text-white/50">
          Your name
        </label>
        <input
          className="mt-2 w-full rounded-2xl bg-white/5 px-4 py-3 text-lg font-medium outline-none ring-1 ring-gold/15 transition focus:ring-2 focus:ring-gold"
          placeholder="e.g. Alex"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />

        <button
          onClick={create}
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-blood to-blood-deep py-3.5 font-bold text-white shadow-lg shadow-black/60 transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Please wait…" : "Host a new game"}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-white/40">
          <div className="h-px flex-1 bg-white/10" />
          or join one
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-2xl bg-white/5 px-4 py-3 text-center text-xl font-bold uppercase tracking-[0.3em] outline-none ring-1 ring-gold/15 transition focus:ring-2 focus:ring-steel"
            placeholder="CODE"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            onClick={join}
            disabled={busy}
            className="shrink-0 rounded-2xl bg-steel px-6 font-bold text-ink-900 transition hover:bg-steel-soft active:scale-[0.99] disabled:opacity-50"
          >
            Join
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-2xl bg-rose-500/15 px-4 py-2.5 text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>

      <p className="text-center text-xs text-white/40">
        The host is the narrator and doesn’t get a role. You need at least 3 other
        players to start.
      </p>
    </div>
  );
}
