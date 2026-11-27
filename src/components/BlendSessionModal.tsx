import { useEffect, useMemo, useState } from "react";
import { Check, Heart, Loader2, Play, Plus, Shuffle, Sparkles, X } from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type { SpotifyPlaylist, UnifiedTrack } from "../types/spotify";
import { viewCache } from "../lib/viewCache";
import { getBestImage, getPlaylistTrackCount } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface BlendSessionModalProps {
  api: SpotifyApiClient;
  playlists: SpotifyPlaylist[];
  currentUserId?: string;
  onPlayTracks: (uris: string[], label: string) => Promise<void>;
  onSaveAsPlaylist: (name: string, uris: string[]) => Promise<void>;
  onClose: () => void;
}

const LIKED_SOURCE_ID = "__liked__";

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function interleaveUnique(lists: UnifiedTrack[][], maxTracks = 80): string[] {
  const shuffled = lists.map((l) => shuffleArray(l));
  const seen = new Set<string>();
  const result: string[] = [];
  let round = 0;

  while (result.length < maxTracks) {
    let addedInRound = false;
    for (const bucket of shuffled) {
      while (round < bucket.length) {
        const candidate = bucket[round];
        if (candidate?.uri && !seen.has(candidate.uri)) {
          seen.add(candidate.uri);
          result.push(candidate.uri);
          addedInRound = true;
          break;
        }
        // Try pulling another non-duplicate from this bucket if current collided
        bucket.splice(round, 1);
      }
      if (result.length >= maxTracks) break;
    }
    if (!addedInRound) break;
    round += 1;
  }
  return result;
}

export function BlendSessionModal({
  api,
  playlists,
  currentUserId,
  onPlayTracks,
  onSaveAsPlaylist,
  onClose,
}: BlendSessionModalProps) {
  const availablePlaylists = useMemo(() => {
    return playlists.filter(
      (p) => !currentUserId || !p.owner?.id || p.owner.id === currentUserId || p.collaborative
    );
  }, [playlists, currentUserId]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const defaults: string[] = [];
    if (availablePlaylists[0]) defaults.push(availablePlaylists[0].id);
    if (availablePlaylists[1]) defaults.push(availablePlaylists[1].id);
    else if (availablePlaylists[0]) defaults.push(LIKED_SOURCE_ID);
    return defaults;
  });
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isWorking) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isWorking, onClose]);

  const toggleSource = (id: string) => {
    setError(null);
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const selectedNames = useMemo(() => {
    return selectedIds
      .map((id) =>
        id === LIKED_SOURCE_ID
          ? "Tus Me Gusta"
          : availablePlaylists.find((p) => p.id === id)?.name || ""
      )
      .filter(Boolean);
  }, [availablePlaylists, selectedIds]);

  const collectBlendedUris = async (): Promise<string[]> => {
    const buckets: UnifiedTrack[][] = [];
    // Fetch sequentially reusing SWR viewCache so we never trigger Spotify 429 bursts
    for (const id of selectedIds) {
      if (id === LIKED_SOURCE_ID) {
        const cached = viewCache.likedTracks;
        if (cached && cached.tracks.length > 0) {
          buckets.push(cached.tracks);
        } else {
          const page = await api.getSavedTracks(50, 0);
          const tracks = (page.items ?? [])
            .map((entry) => entry?.item ?? entry?.track)
            .filter((t): t is NonNullable<typeof t> => Boolean(t?.uri))
            .map((t) => ({
              id: t.id || t.uri,
              uri: t.uri,
              name: t.name,
              artists: (t.artists ?? []).map((a) => a.name).join(", "),
              albumName: t.album?.name ?? "",
              durationMs: t.duration_ms ?? 0,
            }));
          if (tracks.length > 0) buckets.push(tracks);
        }
      } else {
        const cached = viewCache.getPlaylist(id);
        if (cached && cached.tracks.length > 0) {
          buckets.push(cached.tracks);
        } else {
          const page = await api.getPlaylistTracks(id, 80, 0);
          const tracks = (page.items ?? [])
            .map((i) => i.track ?? i.item)
            .filter((t): t is NonNullable<typeof t> => Boolean(t?.uri))
            .map((t) => ({
              id: t.id || t.uri,
              uri: t.uri,
              name: t.name,
              artists: (t.artists ?? []).map((a) => a.name).join(", "),
              albumName: t.album?.name ?? "",
              durationMs: t.duration_ms ?? 0,
            }));
          if (tracks.length > 0) buckets.push(tracks);
        }
      }
    }
    return interleaveUnique(buckets, 80);
  };

  const handlePlayBlend = async () => {
    if (selectedIds.length < 2 || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const uris = await collectBlendedUris();
      if (uris.length === 0) {
        setError("Las playlists seleccionadas no tienen canciones reproducibles.");
        return;
      }
      const label = selectedNames.slice(0, 2).join(" + ") + (selectedNames.length > 2 ? ` +${selectedNames.length - 2}` : "");
      await onPlayTracks(uris, label);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo mezclar las playlists ahora mismo."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleSaveBlend = async () => {
    if (selectedIds.length < 2 || isWorking) return;
    setIsWorking(true);
    setError(null);
    try {
      const uris = await collectBlendedUris();
      if (uris.length === 0) {
        setError("No se encontraron canciones para guardar.");
        return;
      }
      const defaultTitle = `Blend · ${selectedNames.slice(0, 2).join(" + ")}`;
      await onSaveAsPlaylist(saveName.trim() || defaultTitle, uris);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo crear la playlist mezclada."
      );
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mezclador instantáneo de playlists"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isWorking) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
    >
      <div className="anim-context-menu popover-glass w-full max-w-[520px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Shuffle size={17} strokeWidth={1.6} className="text-[var(--text-primary)]" />
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                Blend Session
              </h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Elige entre 2 y 4 listas para intercalarlas al vuelo sin duplicados
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isWorking}
            onClick={onClose}
            aria-label="Cerrar mezclador"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer disabled:opacity-40"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        {/* Playlist picker */}
        <div className="p-5 space-y-4">
          <div className="max-h-[300px] overflow-y-auto space-y-1 pr-1">
            {/* Tus Me Gusta as a blendable source */}
            {(() => {
              const checked = selectedIds.includes(LIKED_SOURCE_ID);
              return (
                <button
                  type="button"
                  onClick={() => toggleSource(LIKED_SOURCE_ID)}
                  className={`w-full px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-all cursor-pointer border ${
                    checked
                      ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                      : "bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center shrink-0">
                    <Heart size={15} strokeWidth={1.6} fill={checked ? "currentColor" : "none"} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">Tus Me Gusta</div>
                    <div className="text-[11px] text-[var(--text-tertiary)]">
                      Biblioteca guardada
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                      checked
                        ? "bg-[var(--solid-bg)] text-[var(--solid-fg)] border-transparent"
                        : "border-[var(--border-subtle)]"
                    }`}
                  >
                    {checked && <Check size={11} strokeWidth={2.2} />}
                  </span>
                </button>
              );
            })()}

            {availablePlaylists.map((playlist) => {
              const checked = selectedIds.includes(playlist.id);
              const thumb = getBestImage(playlist.images, "small");
              return (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => toggleSource(playlist.id)}
                  className={`w-full px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-all cursor-pointer border ${
                    checked
                      ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                      : "bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <LazyCover
                    src={thumb}
                    alt={playlist.name}
                    className="w-9 h-9 shrink-0"
                    iconSize={14}
                    roundedClass="rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{playlist.name}</div>
                    <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                      {getPlaylistTrackCount(playlist)} canciones
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                      checked
                        ? "bg-[var(--solid-bg)] text-[var(--solid-fg)] border-transparent"
                        : "border-[var(--border-subtle)]"
                    }`}
                  >
                    {checked && <Check size={11} strokeWidth={2.2} />}
                  </span>
                </button>
              );
            })}
          </div>

          {showSaveInput && (
            <div className="anim-stagger-1 flex items-center gap-2 pt-1">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={`Blend · ${selectedNames.slice(0, 2).join(" + ")}`}
                className="flex-1 h-9 px-3 rounded-xl text-[12.5px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
              />
              <button
                type="button"
                disabled={selectedIds.length < 2 || isWorking}
                onClick={() => void handleSaveBlend()}
                className="h-9 px-3.5 rounded-xl bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shrink-0"
              >
                {isWorking ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Plus size={13} strokeWidth={1.9} />
                )}
                Crear
              </button>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[var(--text-secondary)] px-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={selectedIds.length < 2 || isWorking}
            onClick={() => setShowSaveInput((v) => !v)}
            className="h-9 px-3 rounded-xl border border-[var(--border-hairline)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Sparkles size={13} strokeWidth={1.6} />
            {showSaveInput ? "Ocultar guardado" : "Guardar playlist"}
          </button>

          <button
            type="button"
            disabled={selectedIds.length < 2 || isWorking}
            onClick={() => void handlePlayBlend()}
            className="h-9 px-4 rounded-xl bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[12.5px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
          >
            {isWorking ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Mezclando...
              </>
            ) : (
              <>
                <Play size={13} strokeWidth={2} fill="currentColor" />
                Mezclar y reproducir ({selectedIds.length})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
