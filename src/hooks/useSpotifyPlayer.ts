import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type {
  SpotifyDevice,
  UnifiedTrack,
  WebPlaybackState,
  SpotifyWebPlayer,
} from "../types/spotify";

const SDK_SCRIPT_URL = "https://sdk.scdn.co/spotify-player.js";
const PLAYER_NAME = "SpotiDesk";

export type RepeatMode = "off" | "context" | "track";

function mapSdkRepeat(mode: 0 | 1 | 2): RepeatMode {
  if (mode === 1) return "context";
  if (mode === 2) return "track";
  return "off";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

let sdkLoadPromise: Promise<void> | null = null;

function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SCRIPT_URL}"]`
    );

    const prevReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prevReady?.();
      resolve();
    };

    if (!existing) {
      const script = document.createElement("script");
      script.src = SDK_SCRIPT_URL;
      script.async = true;
      script.onerror = () => {
        sdkLoadPromise = null;
        reject(
          new Error(
            "No se pudo cargar Spotify Web Playback SDK (revisa tu conexión o CSP)."
          )
        );
      };
      document.body.appendChild(script);
    }
  });

  return sdkLoadPromise;
}

export interface UseSpotifyPlayerOptions {
  isAuthenticated: boolean;
  getFreshToken: () => Promise<string | null>;
  api: SpotifyApiClient;
  autoplayEnabled?: boolean;
  onAutoplayTriggered?: (seedTrack: UnifiedTrack) => void;
}

export function useSpotifyPlayer({
  isAuthenticated,
  getFreshToken,
  api,
  autoplayEnabled = true,
  onAutoplayTriggered,
}: UseSpotifyPlayerOptions) {
  const playerRef = useRef<SpotifyWebPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const activeDeviceIdRef = useRef<string | null>(null);
  const readyWaitersRef = useRef<Array<(id: string | null) => void>>([]);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);

  const [currentTrack, setCurrentTrack] = useState<UnifiedTrack | null>(null);
  const [contextUri, setContextUri] = useState<string | null>(null);
  const [sdkWindowTracks, setSdkWindowTracks] = useState<UnifiedTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const previousVolumeRef = useRef(0.75);
  const isLocalActiveRef = useRef(false);
  const [isLocalActive, setIsLocalActive] = useState(false);
  const hydrateSeqRef = useRef(0);
  const lastSdkEventAtRef = useRef(0);
  const remoteHydrateTimersRef = useRef<number[]>([]);
  const endTrackSyncUriRef = useRef<string | null>(null);

  // Autoplay state tracking refs
  const autoplayEnabledRef = useRef(autoplayEnabled);
  autoplayEnabledRef.current = autoplayEnabled;
  const onAutoplayTriggeredRef = useRef(onAutoplayTriggered);
  onAutoplayTriggeredRef.current = onAutoplayTriggered;
  const wasPlayingRef = useRef(false);
  const lastTrackRef = useRef<UnifiedTrack | null>(null);
  const lastPositionRef = useRef(0);
  const lastDurationRef = useRef(0);
  const playingAnchorRef = useRef<{ wallMs: number; posMs: number } | null>(null);
  const hasNextSdkTracksRef = useRef(false);
  const manualPauseAtRef = useRef(0);
  const autoplayInFlightRef = useRef(false);
  const lastAutoplayAtRef = useRef(0);
  const recentTrackUrisRef = useRef<string[]>([]);
  const triggerAutoplayRef = useRef<(seed: UnifiedTrack) => Promise<void>>(async () => {});

  const recordRecentTrack = useCallback((uri: string) => {
    const list = recentTrackUrisRef.current;
    if (list[list.length - 1] === uri) return;
    list.push(uri);
    if (list.length > 40) {
      list.splice(0, list.length - 40);
    }
  }, []);

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [activeDeviceName, setActiveDeviceName] = useState<string>(PLAYER_NAME);

  const getFreshTokenRef = useRef(getFreshToken);
  getFreshTokenRef.current = getFreshToken;

  const setLocalActive = useCallback((active: boolean) => {
    isLocalActiveRef.current = active;
    setIsLocalActive(active);
  }, []);

  const clearRemoteHydrateTimers = useCallback(() => {
    remoteHydrateTimersRef.current.forEach((id) => window.clearTimeout(id));
    remoteHydrateTimersRef.current = [];
  }, []);

  const refreshDevices = useCallback(async (): Promise<SpotifyDevice[]> => {
    if (!isAuthenticated) return [];
    try {
      const list = await api.getDevices();
      setDevices(list);
      const active = list.find((d) => d.is_active);
      if (active) {
        activeDeviceIdRef.current = active.id;
        setActiveDeviceName(active.name);
        setLocalActive(Boolean(deviceIdRef.current && active.id === deviceIdRef.current));
      } else {
        setLocalActive(false);
      }
      return list;
    } catch {
      return [];
    }
  }, [api, isAuthenticated, setLocalActive]);

  const hydrateFromRemoteState = useCallback(async () => {
    const seq = ++hydrateSeqRef.current;
    try {
      const state = await api.getPlaybackState();
      if (seq !== hydrateSeqRef.current) return;
      if (!state) return;

      const remoteIsLocal = Boolean(
        deviceIdRef.current && state.device?.id === deviceIdRef.current
      );
      // Avoid overwriting fresh local Web Playback SDK events with a slightly stale REST snapshot
      if (remoteIsLocal && performance.now() - lastSdkEventAtRef.current < 1500) {
        return;
      }

      const prevWasPlaying = wasPlayingRef.current;
      const prevTrack = lastTrackRef.current;
      const prevPosition = lastPositionRef.current;
      const prevDuration = lastDurationRef.current;
      const anchor = playingAnchorRef.current;
      const estimatedPrevPos =
        prevWasPlaying && anchor
          ? Math.max(prevPosition, anchor.posMs + (performance.now() - anchor.wallMs))
          : prevPosition;

      activeDeviceIdRef.current = state.device?.id ?? null;
      if (state.device?.name) setActiveDeviceName(state.device.name);
      setLocalActive(remoteIsLocal);
      setIsPlaying(state.is_playing);
      wasPlayingRef.current = state.is_playing;
      if (state.is_playing && typeof state.progress_ms === "number") {
        playingAnchorRef.current = { wallMs: performance.now(), posMs: state.progress_ms };
      } else if (!state.is_playing) {
        playingAnchorRef.current = null;
      }
      setShuffle(state.shuffle_state);
      setRepeatMode(state.repeat_state);
      if (state.context !== undefined) {
        setContextUri(state.context?.uri ?? null);
      }
      if (typeof state.progress_ms === "number") {
        setPositionMs(state.progress_ms);
        lastPositionRef.current = state.progress_ms;
      }
      if (typeof state.device?.volume_percent === "number") {
        const nextVol = state.device.volume_percent / 100;
        setVolumeState(nextVol);
        setMuted(nextVol === 0);
      }
      if (state.item) {
        const nextDuration = state.item.duration_ms ?? 0;
        setDurationMs(nextDuration);
        lastDurationRef.current = nextDuration;
        const imgs = state.item.album?.images ?? [];
        const sorted = [...imgs].sort((a, b) => (a.width ?? 640) - (b.width ?? 640));
        const small = sorted[0]?.url;
        const large = sorted[sorted.length - 1]?.url;
        const artistItems = (state.item.artists ?? [])
          .filter((a) => Boolean(a && a.id && a.name))
          .map((a) => ({ id: a.id, name: a.name }));
        const nextTrack: UnifiedTrack = {
          id: state.item.id || state.item.uri,
          uri: state.item.uri,
          name: state.item.name,
          artists: (state.item.artists ?? []).map((a) => a.name).join(", "),
          artistId: artistItems[0]?.id,
          artistItems,
          albumName: state.item.album?.name ?? "",
          albumId: state.item.album?.id,
          albumImage: small,
          albumImageLarge: large,
          durationMs: nextDuration,
        };
        lastTrackRef.current = nextTrack;
        recordRecentTrack(nextTrack.uri);
        // Preserve object identity when track hasn't changed so effects (likes, Discord RPC) don't re-fire
        setCurrentTrack((prev) =>
          prev &&
          prev.uri === nextTrack.uri &&
          prev.name === nextTrack.name &&
          prev.albumImage === nextTrack.albumImage &&
          Boolean(prev.artistItems?.length) === Boolean(nextTrack.artistItems?.length)
            ? prev
            : nextTrack
        );

        // Remote Spotify Connect end-of-playback Autoplay detection
        const endedRemotely =
          !remoteIsLocal &&
          autoplayEnabledRef.current &&
          state.repeat_state === "off" &&
          prevWasPlaying &&
          !state.is_playing &&
          prevTrack?.uri === nextTrack.uri &&
          prevDuration > 5000 &&
          estimatedPrevPos >= prevDuration - 5000 &&
          (state.progress_ms ?? 0) <= 1500 &&
          performance.now() - manualPauseAtRef.current > 2000;

        if (endedRemotely) {
          void triggerAutoplayRef.current(nextTrack);
        }
      }
    } catch {
      // Ignore when no playback is active
    }
  }, [api, recordRecentTrack, setLocalActive]);

  const scheduleRemoteHydrate = useCallback(
    (delays: number[] = [350, 1100]) => {
      clearRemoteHydrateTimers();
      remoteHydrateTimersRef.current = delays.map((delay) =>
        window.setTimeout(() => {
          void hydrateFromRemoteState();
        }, delay)
      );
    },
    [clearRemoteHydrateTimers, hydrateFromRemoteState]
  );

  useEffect(() => {
    return () => clearRemoteHydrateTimers();
  }, [clearRemoteHydrateTimers]);

  const notifyReadyWaiters = useCallback((id: string | null) => {
    const waiters = readyWaitersRef.current.splice(0);
    waiters.forEach((resolve) => resolve(id));
  }, []);

  const waitForReadyDevice = useCallback((timeoutMs = 3500): Promise<string | null> => {
    if (deviceIdRef.current) return Promise.resolve(deviceIdRef.current);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        readyWaitersRef.current = readyWaitersRef.current.filter((w) => w !== onReady);
        resolve(deviceIdRef.current);
      }, timeoutMs);

      const onReady = (id: string | null) => {
        window.clearTimeout(timer);
        resolve(id);
      };
      readyWaitersRef.current.push(onReady);
    });
  }, []);

  // Initialize Spotify Web Playback SDK once authenticated (StrictMode-safe)
  useEffect(() => {
    if (!isAuthenticated) {
      clearRemoteHydrateTimers();
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      activeDeviceIdRef.current = null;
      setLocalActive(false);
      setDeviceId(null);
      setIsSdkReady(false);
      setCurrentTrack(null);
      setContextUri(null);
      setSdkWindowTracks([]);
      setIsPlaying(false);
      setPositionMs(0);
      setDurationMs(0);
      return;
    }

    let cancelled = false;
    let localPlayer: SpotifyWebPlayer | null = null;

    (async () => {
      try {
        await loadSpotifySdk();
        if (cancelled || !window.Spotify) return;

        const player = new window.Spotify.Player({
          name: PLAYER_NAME,
          volume: 0.75,
          getOAuthToken: (cb) => {
            void getFreshTokenRef.current().then((t) => {
              if (t) cb(t);
            });
          },
        });
        localPlayer = player;

        player.addListener("ready", ({ device_id }) => {
          if (cancelled) return;
          deviceIdRef.current = device_id;
          setDeviceId(device_id);
          setIsSdkReady(true);
          setSdkError(null);
          notifyReadyWaiters(device_id);
          void refreshDevices();
          void hydrateFromRemoteState();
        });

        player.addListener("not_ready", () => {
          if (cancelled) return;
          deviceIdRef.current = null;
          setLocalActive(false);
          setDeviceId(null);
          setIsSdkReady(false);
        });

        player.addListener("player_state_changed", (state: WebPlaybackState | null) => {
          if (cancelled) return;
          if (!state) {
            setLocalActive(false);
            // Playback transferred away from this local SDK device — sync remote Spotify Connect state
            void refreshDevices();
            scheduleRemoteHydrate([300, 1200]);
            return;
          }

          const prevWasPlaying = wasPlayingRef.current;
          const prevTrack = lastTrackRef.current;
          const prevPosition = lastPositionRef.current;
          const prevDuration = lastDurationRef.current;
          const anchor = playingAnchorRef.current;
          const estimatedPrevPos =
            prevWasPlaying && anchor
              ? Math.max(prevPosition, anchor.posMs + (performance.now() - anchor.wallMs))
              : prevPosition;

          lastSdkEventAtRef.current = performance.now();
          setLocalActive(true);
          activeDeviceIdRef.current = deviceIdRef.current;
          setActiveDeviceName(PLAYER_NAME);
          setContextUri(state.context?.uri ?? null);
          setIsPlaying(!state.paused);
          wasPlayingRef.current = !state.paused;
          if (!state.paused) {
            playingAnchorRef.current = { wallMs: performance.now(), posMs: state.position };
          } else {
            playingAnchorRef.current = null;
          }
          setPositionMs(state.position);
          lastPositionRef.current = state.position;
          setDurationMs(state.duration);
          lastDurationRef.current = state.duration;
          setShuffle(state.shuffle);
          setRepeatMode(mapSdkRepeat(state.repeat_mode));

          const mapSdkTrack = (
            t: WebPlaybackState["track_window"]["current_track"]
          ): UnifiedTrack => {
            const imgs = t.album?.images ?? [];
            const sorted = [...imgs].sort((a, b) => (a.width ?? 640) - (b.width ?? 640));
            const artistItems = (t.artists ?? [])
              .map((a) => {
                const raw = a as { id?: string; uri?: string; url?: string; name: string };
                const match = (raw.uri || raw.url || "").match(/artist[:/]([A-Za-z0-9]+)/);
                const id = raw.id || match?.[1] || "";
                return id ? { id, name: raw.name } : null;
              })
              .filter((x): x is { id: string; name: string } => Boolean(x));
            const albumId = t.album?.uri?.startsWith("spotify:album:")
              ? t.album.uri.split(":")[2]
              : undefined;
            return {
              id: t.id ?? t.uri,
              uri: t.uri,
              name: t.name,
              artists: (t.artists ?? []).map((a) => a.name).join(", "),
              artistId: artistItems[0]?.id,
              artistItems,
              albumName: t.album?.name ?? "",
              albumId,
              albumImage: sorted[0]?.url,
              albumImageLarge: sorted[sorted.length - 1]?.url,
              durationMs: t.duration_ms || 0,
            };
          };

          const track = state.track_window?.current_track;
          const nextTracksRaw = state.track_window?.next_tracks ?? [];
          hasNextSdkTracksRef.current = nextTracksRaw.length > 0;

          if (track) {
            const mappedCurrent = {
              ...mapSdkTrack(track),
              durationMs: state.duration || track.duration_ms || 0,
            };
            lastTrackRef.current = mappedCurrent;
            recordRecentTrack(mappedCurrent.uri);
            setCurrentTrack((prev) =>
              prev &&
              prev.uri === mappedCurrent.uri &&
              prev.name === mappedCurrent.name &&
              prev.albumImage === mappedCurrent.albumImage &&
              Boolean(prev.artistItems?.length) === Boolean(mappedCurrent.artistItems?.length)
                ? prev
                : mappedCurrent
            );

            const prevList = (state.track_window.previous_tracks ?? []).map(mapSdkTrack);
            const nextList = nextTracksRaw.map(mapSdkTrack);
            setSdkWindowTracks([...prevList, mappedCurrent, ...nextList]);

            // Detect natural end of the last track when queue is empty and Repeat is off
            const resetToStart =
              state.position === 0 ||
              (state.duration > 0 && state.position >= state.duration - 1200);
            const wasNearEnd = prevDuration > 5000 && estimatedPrevPos >= prevDuration - 5000;
            const notManualPause = performance.now() - manualPauseAtRef.current > 2000;

            if (
              autoplayEnabledRef.current &&
              state.repeat_mode === 0 &&
              nextTracksRaw.length === 0 &&
              prevWasPlaying &&
              state.paused &&
              resetToStart &&
              wasNearEnd &&
              notManualPause &&
              prevTrack?.uri === mappedCurrent.uri
            ) {
              void triggerAutoplayRef.current(mappedCurrent);
            }
          }
        });

        player.addListener("initialization_error", ({ message }) => {
          if (!cancelled) setSdkError(`Error inicializando reproductor: ${message}`);
        });

        player.addListener("authentication_error", ({ message }) => {
          if (!cancelled) setSdkError(`Error de autenticación del SDK: ${message}`);
        });

        player.addListener("account_error", () => {
          if (!cancelled) {
            setSdkError(
              "El reproductor integrado requiere una cuenta Spotify Premium. Puedes controlar otros dispositivos con Spotify Connect."
            );
          }
        });

        player.addListener("playback_error", ({ message }) => {
          if (!cancelled) setSdkError(`Error de reproducción: ${message}`);
        });

        const connected = await player.connect();
        if (cancelled) {
          player.disconnect();
          return;
        }
        if (connected) {
          playerRef.current = player;
        }
      } catch (err) {
        if (!cancelled) {
          setSdkError(err instanceof Error ? err.message : "Error cargando el SDK de Spotify.");
        }
      }
    })();

    return () => {
      cancelled = true;
      localPlayer?.disconnect();
      if (playerRef.current === localPlayer) {
        playerRef.current = null;
      }
      deviceIdRef.current = null;
      notifyReadyWaiters(null);
    };
  }, [
    isAuthenticated,
    refreshDevices,
    hydrateFromRemoteState,
    notifyReadyWaiters,
    clearRemoteHydrateTimers,
    scheduleRemoteHydrate,
    setLocalActive,
    recordRecentTrack,
  ]);

  // Keep UI & Notch synced when playback is controlled remotely via Spotify Connect
  // (Local Web Playback SDK already pushes live events, so this stays completely idle when local)
  useEffect(() => {
    if (!isAuthenticated || isLocalActive) return;

    let cancelled = false;
    let timerId: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = document.hidden ? 10_000 : 4_000;
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        if (!document.hidden || isPlaying) {
          await hydrateFromRemoteState();
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    const handleVisibilityOrFocus = () => {
      if (!document.hidden && !isLocalActiveRef.current) {
        if (timerId !== null) window.clearTimeout(timerId);
        void hydrateFromRemoteState().finally(scheduleNext);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [isAuthenticated, isLocalActive, isPlaying, hydrateFromRemoteState]);

  // Trigger an immediate remote refresh when a remote track reaches its natural end
  useEffect(() => {
    if (!isAuthenticated || isLocalActive || !isPlaying || !currentTrack || durationMs <= 0) {
      return;
    }
    if (positionMs >= durationMs - 400 && endTrackSyncUriRef.current !== currentTrack.uri) {
      endTrackSyncUriRef.current = currentTrack.uri;
      scheduleRemoteHydrate([500, 1500]);
    }
  }, [
    isAuthenticated,
    isLocalActive,
    isPlaying,
    currentTrack,
    positionMs,
    durationMs,
    scheduleRemoteHydrate,
  ]);

  useEffect(() => {
    endTrackSyncUriRef.current = null;
  }, [currentTrack?.uri]);

  // Lightweight local progress ticker: pauses completely when paused or window is hidden
  useEffect(() => {
    if (!isPlaying) return;

    let lastTick = performance.now();
    const interval = window.setInterval(() => {
      if (document.hidden) {
        lastTick = performance.now();
        return;
      }
      const now = performance.now();
      const delta = now - lastTick;
      lastTick = now;
      setPositionMs((prev) => {
        const next = prev + delta;
        const clamped = durationMs > 0 ? Math.min(next, durationMs) : next;
        lastPositionRef.current = clamped;
        return clamped;
      });
    }, 250);

    const handleVisibility = () => {
      if (!document.hidden && playerRef.current && isLocalActiveRef.current) {
        void playerRef.current.getCurrentState().then((st) => {
          if (st) {
            setPositionMs(st.position);
            setIsPlaying(!st.paused);
          }
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isPlaying, durationMs]);

  const targetDeviceId = useCallback(() => {
    if (isLocalActiveRef.current && deviceIdRef.current) {
      return deviceIdRef.current;
    }
    return activeDeviceIdRef.current ?? deviceIdRef.current ?? undefined;
  }, []);

  const ensureLocalElementActivated = useCallback(async () => {
    try {
      await playerRef.current?.activateElement?.();
    } catch {
      // Optional SDK method
    }
  }, []);

  /**
   * Resolves a verified, currently-registered Spotify Connect device ID,
   * reconnecting the local Web Playback SDK if needed.
   */
  const resolveVerifiedDeviceId = useCallback(async (): Promise<string | null> => {
    let liveDevices = await refreshDevices();

    // 1. Check if our current local SDK device is already registered on Spotify Connect
    if (deviceIdRef.current && liveDevices.some((d) => d.id === deviceIdRef.current)) {
      return deviceIdRef.current;
    }

    // 2. Check if another live instance named SpotyFast is registered
    const namedSpotyFast = liveDevices.find((d) => d.name === PLAYER_NAME && d.id);
    if (namedSpotyFast?.id) {
      deviceIdRef.current = namedSpotyFast.id;
      setDeviceId(namedSpotyFast.id);
      return namedSpotyFast.id;
    }

    // 3. Wait briefly / reconnect local Web Playback SDK if not ready yet
    if (!deviceIdRef.current && playerRef.current) {
      try {
        await playerRef.current.connect();
      } catch {
        // Ignore reconnect error
      }
      const readyId = await waitForReadyDevice(3000);
      if (readyId) {
        await sleep(300);
        liveDevices = await refreshDevices();
        if (liveDevices.some((d) => d.id === readyId)) {
          return readyId;
        }
        return readyId;
      }
    }

    // 4. Fallback to any active or available Spotify Connect device
    const active = liveDevices.find((d) => d.is_active && d.id);
    if (active?.id) return active.id;

    const firstAvailable = liveDevices.find((d) => !d.is_restricted && d.id);
    return firstAvailable?.id ?? deviceIdRef.current ?? null;
  }, [refreshDevices, waitForReadyDevice]);

  const playContext = useCallback(
    async (options: {
      contextUri?: string;
      uris?: string[];
      offsetPosition?: number;
      offsetUri?: string;
    }) => {
      await ensureLocalElementActivated();

      const buildPayload = (devId?: string | null) => ({
        deviceId: devId,
        contextUri: options.contextUri,
        uris: options.uris,
        offset:
          options.offsetUri !== undefined
            ? { uri: options.offsetUri }
            : options.offsetPosition !== undefined
              ? { position: options.offsetPosition }
              : undefined,
      });

      let target = targetDeviceId();
      if (!target) {
        target = (await resolveVerifiedDeviceId()) ?? undefined;
      }

      try {
        await api.play(buildPayload(target));
        setSdkError(null);
        // When targeting a remote Spotify Connect device (e.g. another PC), the local SDK
        // does not fire player_state_changed, so hydrate remote state immediately.
        if (!target || target !== deviceIdRef.current || !isLocalActiveRef.current) {
          scheduleRemoteHydrate([350, 1100]);
        }
        return;
      } catch {
        // Recovery path: verify live device, transfer playback, wait for Connect routing, and retry
        const verifiedId = await resolveVerifiedDeviceId();
        if (!verifiedId) {
          setSdkError(
            "No se encontró un dispositivo de reproducción activo. Espera un segundo a que SpotiDesk se conecte o elige un dispositivo en Spotify Connect."
          );
          return;
        }

        try {
          await api.transferPlayback(verifiedId, false);
          // Give Spotify Connect backend time to activate the newly transferred device
          await sleep(450);
          await api.play(buildPayload(verifiedId));
          activeDeviceIdRef.current = verifiedId;
          const isLocal = Boolean(deviceIdRef.current && verifiedId === deviceIdRef.current);
          setLocalActive(isLocal);
          setSdkError(null);
          if (!isLocal) {
            scheduleRemoteHydrate([350, 1100]);
          }
        } catch (retryErr) {
          // One final retry after another brief settle delay for cold SDK wakeups
          try {
            await sleep(550);
            await api.play(buildPayload(verifiedId));
            activeDeviceIdRef.current = verifiedId;
            const isLocal = Boolean(deviceIdRef.current && verifiedId === deviceIdRef.current);
            setLocalActive(isLocal);
            setSdkError(null);
            if (!isLocal) {
              scheduleRemoteHydrate([350, 1100]);
            }
          } catch {
            setSdkError(
              retryErr instanceof Error
                ? `No se pudo reproducir (${retryErr.message}). Selecciona "SpotiDesk" en el selector de dispositivos abajo a la derecha.`
                : "No se pudo iniciar la reproducción."
            );
          }
        }
      }
    },
    [
      api,
      ensureLocalElementActivated,
      resolveVerifiedDeviceId,
      scheduleRemoteHydrate,
      setLocalActive,
      targetDeviceId,
    ]
  );

  // Wire endless Autoplay handler using playContext
  useEffect(() => {
    triggerAutoplayRef.current = async (seed: UnifiedTrack) => {
      if (!autoplayEnabledRef.current) return;
      const now = performance.now();
      if (autoplayInFlightRef.current || now - lastAutoplayAtRef.current < 4000) {
        return;
      }
      autoplayInFlightRef.current = true;
      lastAutoplayAtRef.current = now;
      try {
        const exclude = new Set<string>(recentTrackUrisRef.current);
        exclude.add(seed.uri);
        const tracks = await api.getAutoplayTracks(seed, exclude, 12);
        if (tracks.length === 0) return;
        await playContext({
          uris: tracks.map((t) => t.uri),
          offsetPosition: 0,
        });
        onAutoplayTriggeredRef.current?.(seed);
      } catch {
        // Silent fail so we never disrupt UX
      } finally {
        autoplayInFlightRef.current = false;
      }
    };
  }, [api, playContext]);

  const togglePlay = useCallback(async () => {
    await ensureLocalElementActivated();
    if (isPlaying) {
      manualPauseAtRef.current = performance.now();
    }
    if (playerRef.current && isLocalActiveRef.current) {
      await playerRef.current.togglePlay();
      return;
    }

    try {
      if (isPlaying) {
        await api.pause(activeDeviceIdRef.current);
        setIsPlaying(false);
        wasPlayingRef.current = false;
        scheduleRemoteHydrate([450]);
      } else {
        const target = targetDeviceId() ?? (await resolveVerifiedDeviceId());
        if (!target) {
          setSdkError("No hay ningún dispositivo activo para reanudar.");
          return;
        }
        await api.play({ deviceId: target });
        setIsPlaying(true);
        wasPlayingRef.current = true;
        if (!deviceIdRef.current || target !== deviceIdRef.current) {
          scheduleRemoteHydrate([350, 1100]);
        }
      }
    } catch (err) {
      setSdkError(err instanceof Error ? err.message : "Error alternando reproducción.");
    }
  }, [
    api,
    ensureLocalElementActivated,
    isPlaying,
    resolveVerifiedDeviceId,
    scheduleRemoteHydrate,
    targetDeviceId,
  ]);

  const nextTrack = useCallback(async () => {
    if (playerRef.current && isLocalActiveRef.current) {
      if (
        autoplayEnabledRef.current &&
        repeatMode === "off" &&
        !hasNextSdkTracksRef.current &&
        lastTrackRef.current
      ) {
        await triggerAutoplayRef.current(lastTrackRef.current);
        return;
      }
      await playerRef.current.nextTrack();
      return;
    }
    try {
      await api.nextTrack(activeDeviceIdRef.current);
      scheduleRemoteHydrate([350, 1100]);
    } catch {
      // Ignore
    }
  }, [api, repeatMode, scheduleRemoteHydrate]);

  const previousTrack = useCallback(async () => {
    if (playerRef.current && isLocalActiveRef.current) {
      await playerRef.current.previousTrack();
      return;
    }
    try {
      await api.previousTrack(activeDeviceIdRef.current);
      scheduleRemoteHydrate([350, 1100]);
    } catch {
      // Ignore
    }
  }, [api, scheduleRemoteHydrate]);

  const seek = useCallback(
    async (ms: number) => {
      const clamped = Math.max(0, Math.min(durationMs || ms, Math.round(ms)));
      setPositionMs(clamped);
      if (playerRef.current && isLocalActiveRef.current) {
        await playerRef.current.seek(clamped);
        return;
      }
      try {
        await api.seek(clamped, activeDeviceIdRef.current);
      } catch {
        // Ignore
      }
    },
    [api, durationMs]
  );

  const setVolume = useCallback(
    async (nextVol: number) => {
      const clamped = Math.max(0, Math.min(1, nextVol));
      setVolumeState(clamped);
      setMuted(clamped === 0);
      if (clamped > 0) previousVolumeRef.current = clamped;

      if (playerRef.current && isLocalActiveRef.current) {
        await playerRef.current.setVolume(clamped);
        return;
      }
      try {
        await api.setVolume(clamped * 100, activeDeviceIdRef.current);
      } catch {
        // Ignore
      }
    },
    [api]
  );

  const toggleMute = useCallback(async () => {
    if (muted || volume === 0) {
      await setVolume(previousVolumeRef.current || 0.7);
    } else {
      previousVolumeRef.current = volume;
      await setVolume(0);
    }
  }, [muted, volume, setVolume]);

  const toggleShuffle = useCallback(async () => {
    const next = !shuffle;
    setShuffle(next);
    try {
      await api.setShuffle(next, targetDeviceId());
    } catch {
      setShuffle(!next);
    }
  }, [api, shuffle, targetDeviceId]);

  const cycleRepeat = useCallback(async () => {
    const next: RepeatMode =
      repeatMode === "off" ? "context" : repeatMode === "context" ? "track" : "off";
    setRepeatMode(next);
    try {
      await api.setRepeat(next, targetDeviceId());
    } catch {
      setRepeatMode(repeatMode);
    }
  }, [api, repeatMode, targetDeviceId]);

  const transferToDevice = useCallback(
    async (targetId: string) => {
      try {
        await api.transferPlayback(targetId, isPlaying);
        activeDeviceIdRef.current = targetId;
        const isLocal = Boolean(deviceIdRef.current && targetId === deviceIdRef.current);
        setLocalActive(isLocal);
        const found = devices.find((d) => d.id === targetId);
        if (found) setActiveDeviceName(found.name);
        setTimeout(() => void refreshDevices(), 450);
        if (!isLocal) {
          scheduleRemoteHydrate([450, 1200]);
        }
      } catch (err) {
        setSdkError(err instanceof Error ? err.message : "No se pudo cambiar de dispositivo.");
      }
    },
    [api, devices, isPlaying, refreshDevices, scheduleRemoteHydrate, setLocalActive]
  );

  // Sync native Windows 11 SMTC (Media Session API: volume overlay + lock screen)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;

    if (!currentTrack) {
      ms.metadata = null;
      ms.playbackState = "none";
      return;
    }

    const artwork: MediaImage[] = [];
    if (currentTrack.albumImage) {
      artwork.push({ src: currentTrack.albumImage, sizes: "128x128", type: "image/jpeg" });
    }
    if (currentTrack.albumImageLarge) {
      artwork.push({ src: currentTrack.albumImageLarge, sizes: "512x512", type: "image/jpeg" });
    }

    try {
      ms.metadata = new MediaMetadata({
        title: currentTrack.name,
        artist: currentTrack.artists,
        album: currentTrack.albumName || "SpotiDesk",
        artwork,
      });
      ms.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // Ignore MediaMetadata errors on unsupported runtimes
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!currentTrack || durationMs <= 0 || typeof ms.setPositionState !== "function") return;

    try {
      const durationSec = durationMs / 1000;
      const posSec = Math.min(durationSec, Math.max(0, positionMs / 1000));
      ms.setPositionState({
        duration: durationSec,
        playbackRate: isPlaying ? 1 : 0,
        position: posSec,
      });
    } catch {
      // Ignore position range mismatch
    }
  }, [currentTrack, durationMs, positionMs, isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !isAuthenticated) {
      return;
    }
    const ms = navigator.mediaSession;
    const safeHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this runtime
      }
    };

    safeHandler("play", () => void togglePlay());
    safeHandler("pause", () => void togglePlay());
    safeHandler("previoustrack", () => void previousTrack());
    safeHandler("nexttrack", () => void nextTrack());
    safeHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        void seek(details.seekTime * 1000);
      }
    });

    return () => {
      safeHandler("play", null);
      safeHandler("pause", null);
      safeHandler("previoustrack", null);
      safeHandler("nexttrack", null);
      safeHandler("seekto", null);
    };
  }, [isAuthenticated, togglePlay, previousTrack, nextTrack, seek]);

  // Listen for native Rust media-control events (Global Media Keys + System Tray menu)
  useEffect(() => {
    if (!isAuthenticated) return;

    let unlisten: (() => void) | undefined;
    void listen<string>("media-control", (event) => {
      switch (event.payload) {
        case "play-pause":
          void togglePlay();
          break;
        case "play":
          if (!isPlaying) void togglePlay();
          break;
        case "pause":
          if (isPlaying) void togglePlay();
          break;
        case "next":
          void nextTrack();
          break;
        case "previous":
          void previousTrack();
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [isAuthenticated, isPlaying, togglePlay, nextTrack, previousTrack]);

  return {
    deviceId,
    isSdkReady,
    sdkError,
    clearSdkError: () => setSdkError(null),
    currentTrack,
    contextUri,
    sdkWindowTracks,
    isPlaying,
    positionMs,
    durationMs,
    shuffle,
    repeatMode,
    volume,
    muted,
    devices,
    activeDeviceName,
    playContext,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    refreshDevices,
    transferToDevice,
  };
}
