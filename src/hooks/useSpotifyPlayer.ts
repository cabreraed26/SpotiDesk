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
}

export function useSpotifyPlayer({
  isAuthenticated,
  getFreshToken,
  api,
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

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [activeDeviceName, setActiveDeviceName] = useState<string>(PLAYER_NAME);

  const getFreshTokenRef = useRef(getFreshToken);
  getFreshTokenRef.current = getFreshToken;

  const refreshDevices = useCallback(async (): Promise<SpotifyDevice[]> => {
    if (!isAuthenticated) return [];
    try {
      const list = await api.getDevices();
      setDevices(list);
      const active = list.find((d) => d.is_active);
      if (active) {
        activeDeviceIdRef.current = active.id;
        setActiveDeviceName(active.name);
        isLocalActiveRef.current = active.id === deviceIdRef.current;
      }
      return list;
    } catch {
      return [];
    }
  }, [api, isAuthenticated]);

  const hydrateFromRemoteState = useCallback(async () => {
    try {
      const state = await api.getPlaybackState();
      if (!state) return;
      activeDeviceIdRef.current = state.device?.id ?? null;
      if (state.device?.name) setActiveDeviceName(state.device.name);
      isLocalActiveRef.current = state.device?.id === deviceIdRef.current;
      setIsPlaying(state.is_playing);
      setShuffle(state.shuffle_state);
      setRepeatMode(state.repeat_state);
      if (typeof state.progress_ms === "number") setPositionMs(state.progress_ms);
      if (typeof state.device?.volume_percent === "number") {
        setVolumeState(state.device.volume_percent / 100);
      }
      if (state.item) {
        setDurationMs(state.item.duration_ms ?? 0);
        const imgs = state.item.album?.images ?? [];
        const small = imgs[imgs.length - 1]?.url;
        const large = imgs[0]?.url;
        setCurrentTrack({
          id: state.item.id || state.item.uri,
          uri: state.item.uri,
          name: state.item.name,
          artists: (state.item.artists ?? []).map((a) => a.name).join(", "),
          albumName: state.item.album?.name ?? "",
          albumId: state.item.album?.id,
          albumImage: small,
          albumImageLarge: large,
          durationMs: state.item.duration_ms ?? 0,
        });
      }
    } catch {
      // Ignore when no playback is active
    }
  }, [api]);

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
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      activeDeviceIdRef.current = null;
      isLocalActiveRef.current = false;
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
          isLocalActiveRef.current = false;
          setDeviceId(null);
          setIsSdkReady(false);
        });

        player.addListener("player_state_changed", (state: WebPlaybackState | null) => {
          if (cancelled) return;
          if (!state) {
            isLocalActiveRef.current = false;
            return;
          }

          isLocalActiveRef.current = true;
          activeDeviceIdRef.current = deviceIdRef.current;
          setActiveDeviceName(PLAYER_NAME);
          setContextUri(state.context?.uri ?? null);
          setIsPlaying(!state.paused);
          setPositionMs(state.position);
          setDurationMs(state.duration);
          setShuffle(state.shuffle);
          setRepeatMode(mapSdkRepeat(state.repeat_mode));

          const mapSdkTrack = (
            t: WebPlaybackState["track_window"]["current_track"]
          ): UnifiedTrack => {
            const imgs = t.album?.images ?? [];
            const sorted = [...imgs].sort((a, b) => (a.width ?? 640) - (b.width ?? 640));
            return {
              id: t.id ?? t.uri,
              uri: t.uri,
              name: t.name,
              artists: (t.artists ?? []).map((a) => a.name).join(", "),
              albumName: t.album?.name ?? "",
              albumImage: sorted[0]?.url,
              albumImageLarge: sorted[sorted.length - 1]?.url,
              durationMs: t.duration_ms || 0,
            };
          };

          const track = state.track_window?.current_track;
          if (track) {
            const mappedCurrent = {
              ...mapSdkTrack(track),
              durationMs: state.duration || track.duration_ms || 0,
            };
            setCurrentTrack(mappedCurrent);

            const prevList = (state.track_window.previous_tracks ?? []).map(mapSdkTrack);
            const nextList = (state.track_window.next_tracks ?? []).map(mapSdkTrack);
            setSdkWindowTracks([...prevList, mappedCurrent, ...nextList]);
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
  }, [isAuthenticated, refreshDevices, hydrateFromRemoteState, notifyReadyWaiters]);

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
        return durationMs > 0 ? Math.min(next, durationMs) : next;
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
          isLocalActiveRef.current = verifiedId === deviceIdRef.current;
          setSdkError(null);
        } catch (retryErr) {
          // One final retry after another brief settle delay for cold SDK wakeups
          try {
            await sleep(550);
            await api.play(buildPayload(verifiedId));
            activeDeviceIdRef.current = verifiedId;
            isLocalActiveRef.current = verifiedId === deviceIdRef.current;
            setSdkError(null);
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
    [api, ensureLocalElementActivated, resolveVerifiedDeviceId, targetDeviceId]
  );

  const togglePlay = useCallback(async () => {
    await ensureLocalElementActivated();
    if (playerRef.current && isLocalActiveRef.current) {
      await playerRef.current.togglePlay();
      return;
    }

    try {
      if (isPlaying) {
        await api.pause(activeDeviceIdRef.current);
        setIsPlaying(false);
      } else {
        const target = targetDeviceId() ?? (await resolveVerifiedDeviceId());
        if (!target) {
          setSdkError("No hay ningún dispositivo activo para reanudar.");
          return;
        }
        await api.play({ deviceId: target });
        setIsPlaying(true);
      }
    } catch (err) {
      setSdkError(err instanceof Error ? err.message : "Error alternando reproducción.");
    }
  }, [api, ensureLocalElementActivated, isPlaying, resolveVerifiedDeviceId, targetDeviceId]);

  const nextTrack = useCallback(async () => {
    if (playerRef.current && isLocalActiveRef.current) {
      await playerRef.current.nextTrack();
      return;
    }
    try {
      await api.nextTrack(activeDeviceIdRef.current);
      setTimeout(() => void hydrateFromRemoteState(), 350);
    } catch {
      // Ignore
    }
  }, [api, hydrateFromRemoteState]);

  const previousTrack = useCallback(async () => {
    if (playerRef.current && isLocalActiveRef.current) {
      await playerRef.current.previousTrack();
      return;
    }
    try {
      await api.previousTrack(activeDeviceIdRef.current);
      setTimeout(() => void hydrateFromRemoteState(), 350);
    } catch {
      // Ignore
    }
  }, [api, hydrateFromRemoteState]);

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
        isLocalActiveRef.current = targetId === deviceIdRef.current;
        const found = devices.find((d) => d.id === targetId);
        if (found) setActiveDeviceName(found.name);
        setTimeout(() => void refreshDevices(), 450);
      } catch (err) {
        setSdkError(err instanceof Error ? err.message : "No se pudo cambiar de dispositivo.");
      }
    },
    [api, devices, isPlaying, refreshDevices]
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
  }, [isAuthenticated, togglePlay, nextTrack, previousTrack]);

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
