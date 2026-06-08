"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPlayerId, getSocket, recallName, rememberName } from "@/lib/socket";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(recallName());
    const socket = getSocket();
    const onJoined = ({ code }: { code: string }) => router.push(`/room/${code}`);
    const onError = (msg: string) => {
      setError(msg);
      setBusy(false);
    };
    socket.on("joined", onJoined);
    socket.on("error", onError);
    return () => {
      socket.off("joined", onJoined);
      socket.off("error", onError);
    };
  }, [router]);

  const create = () => {
    setError("");
    if (!name.trim()) return setError("Enter your name first.");
    rememberName(name.trim());
    setBusy(true);
    getSocket().emit("create", { name: name.trim(), playerId: getPlayerId() });
  };

  const join = () => {
    setError("");
    if (!name.trim()) return setError("Enter your name first.");
    if (!code.trim()) return setError("Enter a room code.");
    rememberName(name.trim());
    setBusy(true);
    getSocket().emit("join", {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      playerId: getPlayerId(),
    });
  };

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-3xl shadow-lg shadow-violet-900/40">
          🎭
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">Mafia</h1>
        <p className="mt-2 text-sm text-white/60">
          A real-time party game. One host narrates; everyone else plays.
        </p>
      </header>

      <div className="rounded-3xl bg-[#181820]/80 p-5 ring-1 ring-white/10 backdrop-blur">
        <label className="block text-xs font-semibold uppercase tracking-wide text-white/50">
          Your name
        </label>
        <input
          className="mt-2 w-full rounded-2xl bg-white/5 px-4 py-3 text-lg font-medium outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-violet-400"
          placeholder="e.g. Alex"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />

        <button
          onClick={create}
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3.5 font-bold text-white shadow-lg shadow-violet-900/40 transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
        >
          Host a new game
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-white/40">
          <div className="h-px flex-1 bg-white/10" />
          or join one
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-2xl bg-white/5 px-4 py-3 text-center text-xl font-bold uppercase tracking-[0.3em] outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-cyan-400"
            placeholder="CODE"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            onClick={join}
            disabled={busy}
            className="shrink-0 rounded-2xl bg-cyan-400 px-6 font-bold text-[#10222a] transition hover:bg-cyan-300 active:scale-[0.99] disabled:opacity-50"
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
