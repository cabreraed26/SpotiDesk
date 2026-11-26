import { useCallback, useEffect, useRef, useState } from "react";
import { Disc3, Loader2, Play, User } from "lucide-react";
import { SpotifyApiError, type SpotifyApiClient } from "../lib/spotifyApi";
import type { SpotifyAlbumSimple, SpotifyArtist } from "../types/spotify";
import { getBestImage } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface LibraryViewProps {
  mode: "albums" | "artists";
  api: SpotifyApiClient;
  onSelectAlbum: (albumId: string) => void;
  onPlayContext: (options: { contextUri: string; offsetPosition?: number }) => Promise<void>;
}

export function LibraryView({
  mode,
  api,
  onSelectAlbum,
  onPlayContext,
}: LibraryViewProps) {
  const [albums, setAlbums] = useState<SpotifyAlbumSimple[]>([]);
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const cursorAfterRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    offsetRef.current = 0;
    cursorAfterRef.current = undefined;
    setIsLoading(true);
    setError(null);
    setAlbums([]);
    setArtists([]);
    setTotal(0);
    setHasMore(false);

    (async () => {
      try {
        if (mode === "albums") {
          const page = await api.getSavedAlbums(50, 0);
          if (cancelled) return;
          const items = (page.items ?? [])
            .map((entry) => entry?.album)
            .filter((a): a is SpotifyAlbumSimple => Boolean(a && a.id));
          setAlbums(items);
          setTotal(page.total ?? items.length);
          offsetRef.current = (page.items ?? []).length;
          setHasMore(Boolean(page.next));
        } else {
          const page = await api.getFollowedArtists(50);
          if (cancelled) return;
          const items = (page.items ?? []).filter(Boolean);
          setArtists(items);
          setTotal(page.total ?? items.length);
          cursorAfterRef.current = page.cursors?.after ?? undefined;
          setHasMore(Boolean(page.next && page.cursors?.after));
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SpotifyApiError && err.status === 403 && mode === "artists") {
          setError(
            "Cierra sesión y vuelve a conectar con Spotify desde Ajustes para conceder permiso de ver tus artistas seguidos."
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : mode === "albums"
                ? "No se pudieron cargar tus álbumes guardados."
                : "No se pudieron cargar tus artistas seguidos."
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, mode]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      if (mode === "albums") {
        const page = await api.getSavedAlbums(50, offsetRef.current);
        const items = (page.items ?? [])
          .map((entry) => entry?.album)
          .filter((a): a is SpotifyAlbumSimple => Boolean(a && a.id));
        setAlbums((prev) => [...prev, ...items]);
        offsetRef.current += (page.items ?? []).length;
        setHasMore(Boolean(page.next));
      } else {
        const page = await api.getFollowedArtists(50, cursorAfterRef.current);
        const items = (page.items ?? []).filter(Boolean);
        setArtists((prev) => [...prev, ...items]);
        cursorAfterRef.current = page.cursors?.after ?? undefined;
        setHasMore(Boolean(page.next && page.cursors?.after));
      }
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [api, hasMore, isLoadingMore, mode]);

  return (
    <div key={mode} className="anim-view-enter flex-1 overflow-y-auto px-8 pt-8 pb-32 space-y-8">
      <section className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Tu Biblioteca
          </p>
          <h1 className="mt-1.5 text-[32px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            {mode === "albums" ? "Tus Álbumes" : "Artistas Seguidos"}
          </h1>
        </div>
        {total > 0 && (
          <span className="text-[12.5px] tabular-nums text-[var(--text-tertiary)]">
            {total} {mode === "albums" ? "álbumes" : "artistas"}
          </span>
        )}
      </section>

      {isLoading ? (
        <div className="py-20 flex items-center justify-center">
          <Loader2 size={22} strokeWidth={1.5} className="animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : error ? (
        <div className="max-w-[520px] p-5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {error}
        </div>
      ) : mode === "albums" ? (
        albums.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-center gap-3 text-[var(--text-secondary)]">
            <Disc3 size={28} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
            <p className="text-[13.5px]">Todavía no tienes álbumes guardados en tu biblioteca.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {albums.map((album) => {
                const year = album.release_date?.slice(0, 4);
                return (
                  <div
                    key={album.id}
                    onClick={() => onSelectAlbum(album.id)}
                    className="group playlist-card-zoom p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
                  >
                    <div className="playlist-cover-zoom relative aspect-square mb-3.5">
                      <LazyCover
                        src={getBestImage(album.images, "medium")}
                        alt={album.name}
                        className="w-full h-full"
                        iconSize={28}
                        roundedClass="rounded-xl"
                      />
                      <button
                        type="button"
                        aria-label={`Reproducir ${album.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onPlayContext({ contextUri: album.uri, offsetPosition: 0 });
                        }}
                        className="chrome-no-select absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                      >
                        <Play size={14} strokeWidth={1.8} fill="currentColor" />
                      </button>
                    </div>
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em]">
                      {album.name}
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                      {(album.artists ?? []).map((a) => a.name).join(", ")}
                      {year ? ` · ${year}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void handleLoadMore()}
                  className="h-9 px-5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isLoadingMore ? "Cargando..." : "Cargar más álbumes"}
                </button>
              </div>
            )}
          </>
        )
      ) : artists.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center gap-3 text-[var(--text-secondary)]">
          <User size={28} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
          <p className="text-[13.5px]">Todavía no sigues artistas en Spotify.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
            {artists.map((artist) => {
              const avatar = getBestImage(artist.images, "medium");
              return (
                <button
                  key={artist.id}
                  type="button"
                  onClick={() => void onPlayContext({ contextUri: artist.uri })}
                  className="group playlist-card-zoom p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex flex-col items-center text-center cursor-pointer"
                >
                  <div className="playlist-cover-zoom relative w-28 h-28 rounded-full overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center mb-3.5">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={artist.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={30} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />
                    )}
                    <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity duration-200">
                      <Play size={18} strokeWidth={1.8} fill="currentColor" />
                    </span>
                  </div>
                  <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate w-full tracking-[-0.01em]">
                    {artist.name}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">
                    Artista
                  </div>
                </button>
              );
            })}
          </div>

          {hasMore && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                disabled={isLoadingMore}
                onClick={() => void handleLoadMore()}
                className="h-9 px-5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {isLoadingMore ? "Cargando..." : "Cargar más artistas"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
