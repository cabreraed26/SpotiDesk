import { useCallback, useEffect, useRef, useState } from "react";
import { Disc3, Play, User } from "lucide-react";
import { SpotifyApiError, type SpotifyApiClient } from "../lib/spotifyApi";
import type { SpotifyAlbumSimple, SpotifyArtist } from "../types/spotify";
import { getBestImage } from "../lib/format";
import { viewCache } from "../lib/viewCache";
import { LazyCover } from "./LazyCover";

interface LibraryViewProps {
  mode: "albums" | "artists";
  api: SpotifyApiClient;
  onSelectAlbum: (album: SpotifyAlbumSimple, morphSourceEl?: HTMLElement | null) => void;
  onSelectArtist: (artist: SpotifyArtist, morphSourceEl?: HTMLElement | null) => void;
  onPlayContext: (options: { contextUri: string; offsetPosition?: number }) => Promise<void>;
}

export function LibraryView({
  mode,
  api,
  onSelectAlbum,
  onSelectArtist,
  onPlayContext,
}: LibraryViewProps) {
  const cachedAlbums = mode === "albums" ? viewCache.savedAlbums : null;
  const cachedArtists = mode === "artists" ? viewCache.followedArtists : null;

  const [albums, setAlbums] = useState<SpotifyAlbumSimple[]>(
    () => cachedAlbums?.items ?? []
  );
  const [artists, setArtists] = useState<SpotifyArtist[]>(
    () => cachedArtists?.items ?? []
  );
  const [total, setTotal] = useState<number>(
    () => (mode === "albums" ? cachedAlbums?.total : cachedArtists?.total) ?? 0
  );
  const [hasMore, setHasMore] = useState<boolean>(
    () => (mode === "albums" ? cachedAlbums?.hasMore : cachedArtists?.hasMore) ?? false
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    () => (mode === "albums" ? !cachedAlbums : !cachedArtists)
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(cachedAlbums?.offset ?? 0);
  const cursorAfterRef = useRef<string | undefined>(cachedArtists?.after);

  useEffect(() => {
    let cancelled = false;
    const snapAlbums = mode === "albums" ? viewCache.savedAlbums : null;
    const snapArtists = mode === "artists" ? viewCache.followedArtists : null;

    setError(null);
    if (mode === "albums") {
      setAlbums(snapAlbums?.items ?? []);
      setTotal(snapAlbums?.total ?? 0);
      setHasMore(snapAlbums?.hasMore ?? false);
      offsetRef.current = snapAlbums?.offset ?? 0;
      setIsLoading(!snapAlbums);
    } else {
      setArtists(snapArtists?.items ?? []);
      setTotal(snapArtists?.total ?? 0);
      setHasMore(snapArtists?.hasMore ?? false);
      cursorAfterRef.current = snapArtists?.after;
      setIsLoading(!snapArtists);
    }

    // Revalidate cleanly in the background (0ms render when cached!)
    (async () => {
      try {
        if (mode === "albums") {
          const page = await api.getSavedAlbums(50, 0);
          if (cancelled) return;
          const items = (page.items ?? [])
            .map((entry) => entry?.album)
            .filter((a): a is SpotifyAlbumSimple => Boolean(a && a.id));
          const nextTotal = page.total ?? items.length;
          const nextOffset = (page.items ?? []).length;
          const nextMore = Boolean(page.next);

          setAlbums(items);
          setTotal(nextTotal);
          offsetRef.current = nextOffset;
          setHasMore(nextMore);
          viewCache.savedAlbums = {
            items,
            total: nextTotal,
            offset: nextOffset,
            hasMore: nextMore,
          };
        } else {
          const page = await api.getFollowedArtists(50);
          if (cancelled) return;
          const items = (page.items ?? []).filter(Boolean);
          const nextTotal = page.total ?? items.length;
          const nextAfter = page.cursors?.after ?? undefined;
          const nextMore = Boolean(page.next && nextAfter);

          setArtists(items);
          setTotal(nextTotal);
          cursorAfterRef.current = nextAfter;
          setHasMore(nextMore);
          viewCache.followedArtists = {
            items,
            total: nextTotal,
            after: nextAfter,
            hasMore: nextMore,
          };
        }
      } catch (err) {
        if (cancelled) return;
        const hasCache = mode === "albums" ? Boolean(snapAlbums) : Boolean(snapArtists);
        if (!hasCache) {
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
        const nextOffset = offsetRef.current + (page.items ?? []).length;
        const nextMore = Boolean(page.next);

        setAlbums((prev) => {
          const merged = [...prev, ...items];
          viewCache.savedAlbums = {
            items: merged,
            total: page.total ?? merged.length,
            offset: nextOffset,
            hasMore: nextMore,
          };
          return merged;
        });
        offsetRef.current = nextOffset;
        setHasMore(nextMore);
      } else {
        const page = await api.getFollowedArtists(50, cursorAfterRef.current);
        const items = (page.items ?? []).filter(Boolean);
        const nextAfter = page.cursors?.after ?? undefined;
        const nextMore = Boolean(page.next && nextAfter);

        setArtists((prev) => {
          const merged = [...prev, ...items];
          viewCache.followedArtists = {
            items: merged,
            total: page.total ?? merged.length,
            after: nextAfter,
            hasMore: nextMore,
          };
          return merged;
        });
        cursorAfterRef.current = nextAfter;
        setHasMore(nextMore);
      }
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [api, hasMore, isLoadingMore, mode]);

  return (
    <div className="flex-1 overflow-y-auto px-8 pt-8 pb-32 space-y-8">
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
        <div
          className={
            mode === "albums"
              ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5"
              : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5"
          }
        >
          {Array.from({ length: mode === "albums" ? 10 : 12 }).map((_, i) => (
            <div
              key={i}
              className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] animate-pulse"
            >
              <div
                className={
                  mode === "albums"
                    ? "aspect-square rounded-xl bg-[var(--bg-card)] mb-3.5"
                    : "w-28 h-28 mx-auto rounded-full bg-[var(--bg-card)] mb-3.5"
                }
              />
              <div className="h-3.5 w-3/4 mx-auto rounded bg-[var(--bg-card)] mb-2" />
              <div className="h-3 w-1/2 mx-auto rounded bg-[var(--bg-card)]" />
            </div>
          ))}
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
                    onMouseEnter={() => void viewCache.prefetchAlbum(api, album.id)}
                    onClick={(e) => {
                      const coverEl = e.currentTarget.querySelector<HTMLElement>(
                        "[data-morph-cover]"
                      );
                      onSelectAlbum(album, coverEl);
                    }}
                    className="group playlist-card-zoom p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
                  >
                    <div
                      data-morph-cover
                      data-album-cover={album.id}
                      className="playlist-cover-zoom relative aspect-square mb-3.5 rounded-xl overflow-hidden"
                    >
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
                <div
                  key={artist.id}
                  role="button"
                  tabIndex={0}
                  onMouseEnter={() => void viewCache.prefetchArtist(api, artist.id, artist)}
                  onClick={(e) => {
                    const avatarEl = e.currentTarget.querySelector<HTMLElement>(
                      "[data-morph-avatar]"
                    );
                    onSelectArtist(artist, avatarEl);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectArtist(artist);
                    }
                  }}
                  className="group playlist-card-zoom p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex flex-col items-center text-center cursor-pointer"
                >
                  <div className="relative mb-3.5">
                    <div
                      data-morph-avatar
                      data-artist-cover={artist.id}
                      className="playlist-cover-zoom w-28 h-28 rounded-full overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center"
                    >
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={artist.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User
                          size={30}
                          strokeWidth={1.5}
                          className="text-[var(--text-tertiary)]"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Reproducir ${artist.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onPlayContext({ contextUri: artist.uri });
                      }}
                      className="chrome-no-select absolute right-0 bottom-0 w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                    >
                      <Play size={14} strokeWidth={1.8} fill="currentColor" />
                    </button>
                  </div>
                  <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate w-full tracking-[-0.01em]">
                    {artist.name}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">
                    Artista · Ver álbumes
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
                {isLoadingMore ? "Cargando..." : "Cargar más artistas"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
