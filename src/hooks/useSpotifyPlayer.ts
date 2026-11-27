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
export type SoftGlideMode = "off" | "subtle" | "cinematic";

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
  softGlideMode?: SoftGlideMode;
  onAutoplayTriggered?: (seedTrack: UnifiedTrack) => void;
}

export function useSpotifyPlayer({
  isAuthenticated,
  getFreshToken,
  api,
  autoplayEnabled = true,
  softGlideMode = "subtle",
  onAutoplayTriggered,
}: UseSpotifyPlayerOptions) {
  const playerRef = useRef<SpotifyWebPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const activeDeviceIdRef = useRef<string | null>(null);
  const readyWaitersRef = useRef<Array<(id: string | null) => void>>([]);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [sdkEpoch, setSdkEpoch] = useState(0);
  const playSeqRef = useRef(0);
  const lastSdkReconnectAtRef = useRef(0);

  const [currentTrack, setCurrentTrack] = useState<UnifiedTrack | null>(null);
  const [contextUri, setContextUri] = useState<string | null>(null);
  const [sdkWindowTracks, setSdkWindowTracks] = useState<UnifiedTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(0.75);
  const volumeRef = useRef(0.75);
  volumeRef.current = volume;
  const [muted, setMuted] = useState(false);
  const previousVolumeRef = useRef(0.75);
  const isLocalActiveRef = useRef(false);
  const [isLocalActive, setIsLocalActive] = useState(false);
  const userSelectedRemoteIdRef = useRef<string | null>(null);
  const claimedOnReadyRef = useRef(false);
  const hydrateSeqRef = useRef(0);
  const lastSdkEventAtRef = useRef(0);
  const remoteHydrateTimersRef = useRef<number[]>([]);
  const endTrackSyncUriRef = useRef<string | null>(null);

  // Autoplay & Soft Glide state tracking refs
  const autoplayEnabledRef = useRef(autoplayEnabled);
  autoplayEnabledRef.current = autoplayEnabled;
  const softGlideModeRef = useRef<SoftGlideMode>(softGlideMode);
  softGlideModeRef.current = softGlideMode;
  const glideSeqRef = useRef(0);
  const fadeInPendingRef = useRef(false);
  const endFadeUriRef = useRef<string | null>(null);
  const lastSdkTrackUriRef = useRef<string | null>(null);
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

  const cancelSoftGlide = useCallback((restoreVolume = false) => {
    glideSeqRef.current += 1;
    fadeInPendingRef.current = false;
    if (restoreVolume && playerRef.current && isLocalActiveRef.current) {
      void playerRef.current.setVolume(volumeRef.current).catch(() => {});
    }
  }, []);

  const rampLocalVolume = useCallback(
    async (fromVol: number, toVol: number, durationMs: number): Promise<boolean> => {
      const player = playerRef.current;
      if (!player || !isLocalActiveRef.current || durationMs <= 0) return false;
      const mySeq = ++glideSeqRef.current;
      const steps = Math.max(4, Math.round(durationMs / 35));
      const stepDelay = durationMs / steps;
      for (let i = 1; i <= steps; i++) {
        if (glideSeqRef.current !== mySeq || !playerRef.current || !isLocalActiveRef.current) {
          return false;
        }
        const t = i / steps;
        // Smooth ease-in-out curve for perceptual audio transition
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const nextV = Math.max(0, Math.min(1, fromVol + (toVol - fromVol) * eased));
        try {
          await playerRef.current.setVolume(nextV);
        } catch {
          return false;
        }
        if (i < steps) {
          await sleep(stepDelay);
        }
      }
      return glideSeqRef.current === mySeq;
    },
    []
  );

  const runSoftGlideOut = useCallback(async () => {
    const mode = softGlideModeRef.current;
    if (
      mode === "off" ||
      !playerRef.current ||
      !isLocalActiveRef.current ||
      !wasPlayingRef.current ||
      volumeRef.current <= 0.02
    ) {
      return;
    }
    const baseVol = volumeRef.current;
    const outMs = mode === "cinematic" ? 480 : 220;
    fadeInPendingRef.current = true;
    await rampLocalVolume(baseVol, Math.max(0.02, baseVol * 0.04), outMs);
  }, [rampLocalVolume]);

  const runSoftGlideIn = useCallback(() => {
    if (!fadeInPendingRef.current) return;
    fadeInPendingRef.current = false;
    const mode = softGlideModeRef.current;
    const targetVol = volumeRef.current;
    if (mode === "off" || !playerRef.current || !isLocalActiveRef.current) {
      if (playerRef.current && isLocalActiveRef.current) {
        void playerRef.current.setVolume(targetVol).catch(() => {});
      }
      return;
    }
    const inMs = mode === "cinematic" ? 720 : 320;
    void rampLocalVolume(Math.max(0.02, targetVol * 0.05), targetVol, inMs);
  }, [rampLocalVolume]);

  const refreshDevices = useCallback(async (): Promise<SpotifyDevice[]> => {
    if (!isAuthenticated || api.isRateLimited()) return [];
    try {
      const remoteList = await api.getDevices();
      const localId = deviceIdRef.current;

      // Filter out stale/zombie "SpotiDesk" entries left behind by a previous reload that aren't
      // this live SDK instance and aren't actively playing, so the user never sees duplicate SpotiDesk rows.
      const cleanedList = remoteList.filter((d) => {
        if (d.name === PLAYER_NAME && localId && d.id && d.id !== localId && !d.is_active) {
          return false;
        }
        return true;
      });

      setDevices(cleanedList);
      const active = cleanedList.find((d) => d.is_active);
      if (active) {
        const activeIsLocal = Boolean(localId && active.id === localId);
        if (activeIsLocal) {
          userSelectedRemoteIdRef.current = null;
          activeDeviceIdRef.current = active.id;
          setActiveDeviceName(active.name);
          setLocalActive(true);
        } else if (
          wasPlayingRef.current ||
          userSelectedRemoteIdRef.current === active.id ||
          !localId
        ) {
          activeDeviceIdRef.current = active.id;
          setActiveDeviceName(active.name);
          setLocalActive(false);
        } else {
          // Another device (e.g. an idle TV) is marked active while paused and wasn't explicitly selected:
          // keep SpotiDesk ready as the preferred local target.
          activeDeviceIdRef.current = localId;
          setActiveDeviceName(PLAYER_NAME);
          setLocalActive(false);
        }
      } else {
        setLocalActive(false);
        if (localId && !userSelectedRemoteIdRef.current) {
          activeDeviceIdRef.current = localId;
          setActiveDeviceName(PLAYER_NAME);
        }
      }
      // Return the REAL Spotify Connect device list (never synthetic entries) so verification is 100% accurate
      return remoteList;
    } catch {
      return [];
    }
  }, [api, isAuthenticated, setLocalActive]);

  const hydrateFromRemoteState = useCallback(async () => {
    if (api.isRateLimited()) return null;
    const seq = ++hydrateSeqRef.current;
    try {
      const state = await api.getPlaybackState();
      if (seq !== hydrateSeqRef.current) return null;
      if (!state) return null;

      const remoteIsLocal = Boolean(
        deviceIdRef.current && state.device?.id === deviceIdRef.current
      );
      // Avoid overwriting fresh local Web Playback SDK events with a slightly stale REST snapshot
      if (remoteIsLocal && performance.now() - lastSdkEventAtRef.current < 1500) {
        return state;
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

      const shouldFollowRemoteDevice =
        remoteIsLocal ||
        state.is_playing ||
        !deviceIdRef.current ||
        (Boolean(state.device?.id) && userSelectedRemoteIdRef.current === state.device?.id);

      if (shouldFollowRemoteDevice) {
        activeDeviceIdRef.current = state.device?.id ?? null;
        if (state.device?.name) setActiveDeviceName(state.device.name);
        if (remoteIsLocal) userSelectedRemoteIdRef.current = null;
      } else {
        // Remote device (e.g. a TV in standby) is paused and wasn't chosen by the user:
        // hydrate the track metadata for continuity, but keep SpotiDesk as the local target.
        activeDeviceIdRef.current = deviceIdRef.current;
        setActiveDeviceName(PLAYER_NAME);
      }
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
        // Preserve object identity when track hasn't changed so effects (e.g. likes) don't re-fire
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
      return state;
    } catch {
      // Ignore when no playback is active
      return null;
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

          // Spotify Connect REST servers can take 0.5–2.5s to propagate a newly connected Web Playback SDK
          // device_id. Wait gently until it appears in /me/player/devices, then quietly reclaim any
          // paused/idle remote session (like a standby TV) onto this Mac without starting audio.
          void (async () => {
            const remoteState = await hydrateFromRemoteState();
            if (cancelled) return;

            // Poll gently for propagation so SpotiDesk appears promptly in the Connect menu
            const delays = [400, 900, 1600];
            let propagated = false;
            for (const delay of delays) {
              await sleep(delay);
              if (cancelled || deviceIdRef.current !== device_id) return;
              const live = await refreshDevices();
              if (live.some((d) => d.id === device_id)) {
                propagated = true;
                break;
              }
            }
            if (cancelled || deviceIdRef.current !== device_id) return;

            const remoteIsPlayingElsewhere = Boolean(
              remoteState?.is_playing &&
                remoteState.device?.id &&
                remoteState.device.id !== device_id
            );

            if (
              propagated &&
              !remoteIsPlayingElsewhere &&
              !userSelectedRemoteIdRef.current &&
              !claimedOnReadyRef.current
            ) {
              claimedOnReadyRef.current = true;
              activeDeviceIdRef.current = device_id;
              setActiveDeviceName(PLAYER_NAME);
              try {
                await api.transferPlayback(device_id, false);
                if (!cancelled) {
                  setLocalActive(true);
                  void refreshDevices();
                }
              } catch {
                // Silent: Spotify returns 404/204 if no prior playback session exists yet
              }
            }
          })();
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
          setSdkError(null);
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
            const trackChanged = lastSdkTrackUriRef.current !== track.uri;
            lastSdkTrackUriRef.current = track.uri;
            if (trackChanged && fadeInPendingRef.current && !state.paused) {
              runSoftGlideIn();
            } else if (state.paused && fadeInPendingRef.current) {
              cancelSoftGlide(true);
            }
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

    const handleBeforeUnload = () => {
      localPlayer?.disconnect();
    };
    // macOS WKWebView requires an interactive user gesture to unlock the SDK's <audio> element;
    // unlocking on the user's very first pointer/key interaction makes the first Play click instant.
    let audioUnlocked = false;
    const handleFirstGesture = () => {
      if (audioUnlocked || !playerRef.current) return;
      audioUnlocked = true;
      try {
        void playerRef.current.activateElement?.();
      } catch {
        // Ignore
      }
      window.removeEventListener("pointerdown", handleFirstGesture, true);
      window.removeEventListener("keydown", handleFirstGesture, true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pointerdown", handleFirstGesture, { capture: true, passive: true });
    window.addEventListener("keydown", handleFirstGesture, { capture: true, passive: true });

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pointerdown", handleFirstGesture, true);
      window.removeEventListener("keydown", handleFirstGesture, true);
      claimedOnReadyRef.current = false;
      userSelectedRemoteIdRef.current = null;
      localPlayer?.disconnect();
      if (playerRef.current === localPlayer) {
        playerRef.current = null;
      }
      deviceIdRef.current = null;
      notifyReadyWaiters(null);
    };
  }, [
    api,
    isAuthenticated,
    sdkEpoch,
    refreshDevices,
    hydrateFromRemoteState,
    notifyReadyWaiters,
    clearRemoteHydrateTimers,
    scheduleRemoteHydrate,
    setLocalActive,
    recordRecentTrack,
    cancelSoftGlide,
    runSoftGlideIn,
  ]);

  // Keep UI & Notch synced when playback is controlled remotely via Spotify Connect
  // (Local Web Playback SDK already pushes live events, so this stays completely idle when local)
  useEffect(() => {
    if (!isAuthenticated || isLocalActive) return;

    let cancelled = false;
    let timerId: number | null = null;
    let lastFocusHydrateAt = 0;

    const scheduleNext = () => {
      if (cancelled) return;
      // Be very polite with Spotify Dev Mode rate limits:
      // 5.5s only while actively playing remotely, 18s while paused, 25s while hidden.
      const delay = document.hidden ? 25_000 : isPlaying ? 5_500 : 18_000;
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        if ((!document.hidden || isPlaying) && !api.isRateLimited()) {
          await hydrateFromRemoteState();
        }
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    const handleVisibilityOrFocus = () => {
      const now = performance.now();
      if (
        !document.hidden &&
        !isLocalActiveRef.current &&
        !api.isRateLimited() &&
        now - lastFocusHydrateAt > 5_000
      ) {
        lastFocusHydrateAt = now;
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
  }, [api, isAuthenticated, isLocalActive, isPlaying, hydrateFromRemoteState]);

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
    endFadeUriRef.current = null;
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

        // Automatic end-of-track Soft Glide ramp on local SDK playback
        const mode = softGlideModeRef.current;
        const leadMs = mode === "cinematic" ? 2200 : mode === "subtle" ? 1100 : 0;
        const curUri = lastTrackRef.current?.uri;
        if (
          leadMs > 0 &&
          isLocalActiveRef.current &&
          durationMs > 15_000 &&
          curUri &&
          endFadeUriRef.current !== curUri &&
          clamped >= durationMs - leadMs &&
          clamped < durationMs - 150 &&
          volumeRef.current > 0.03
        ) {
          endFadeUriRef.current = curUri;
          fadeInPendingRef.current = true;
          const baseVol = volumeRef.current;
          void rampLocalVolume(baseVol, Math.max(0.02, baseVol * 0.06), Math.max(250, durationMs - clamped - 100));
        }

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
    // Only route commands to a remote Spotify Connect device if it is actively playing right now
    // or the user explicitly chose it in the device switcher.
    if (
      !isLocalActiveRef.current &&
      activeDeviceIdRef.current &&
      activeDeviceIdRef.current !== deviceIdRef.current &&
      (userSelectedRemoteIdRef.current === activeDeviceIdRef.current || wasPlayingRef.current)
    ) {
      return activeDeviceIdRef.current;
    }
    return deviceIdRef.current ?? activeDeviceIdRef.current ?? undefined;
  }, []);

  const ensureLocalElementActivated = useCallback(async () => {
    try {
      await playerRef.current?.activateElement?.();
    } catch {
      // Optional SDK method
    }
  }, []);

  /**
   * Resolves a verified, currently-registered Spotify Connect device ID.
   * Crucially, waits patiently for Spotify Connect propagation BEFORE ever tearing down
   * a healthy SDK connection (tearing down early resets the propagation clock and causes 404 loops).
   */
  const resolveVerifiedDeviceId = useCallback(async (): Promise<string | null> => {
    // 1. If the SDK hasn't finished initial handshake yet, wait for `ready` first
    let localId = deviceIdRef.current ?? (await waitForReadyDevice(3500));

    // 2. Check if our live local SDK device is registered on Spotify Connect (with polite propagation backoff)
    if (localId) {
      const pollDelays = [0, 550, 950, 1400];
      for (const delay of pollDelays) {
        if (delay > 0) await sleep(delay);
        const liveDevices = await refreshDevices();
        const curLocal = deviceIdRef.current;
        if (curLocal && liveDevices.some((d) => d.id === curLocal)) {
          return curLocal;
        }
        // If `not_ready` cleared deviceIdRef mid-wait, break out to recreate SDK cleanly
        if (!curLocal) break;
      }
    }

    // 3. Only if the SDK truly dropped or failed to propagate after ~3s, spin up a brand-new
    // Spotify.Player instance (reusing a disconnected instance is unreliable on WKWebView).
    if (performance.now() - lastSdkReconnectAtRef.current > 8000) {
      lastSdkReconnectAtRef.current = performance.now();
      deviceIdRef.current = null;
      setDeviceId(null);
      setIsSdkReady(false);
      setSdkEpoch((e) => e + 1);

      const freshId = await waitForReadyDevice(4500);
      if (freshId) {
        for (const delay of [500, 1000, 1500]) {
          await sleep(delay);
          const live = await refreshDevices();
          if (live.some((d) => d.id === freshId)) {
            return freshId;
          }
        }
        return freshId;
      }
    }

    // 4. Fallback to any active or available Spotify Connect device
    const finalDevices = await refreshDevices();
    const active = finalDevices.find((d) => d.is_active && d.id);
    if (active?.id) return active.id;

    const firstAvailable = finalDevices.find((d) => !d.is_restricted && d.id);
    return firstAvailable?.id ?? deviceIdRef.current ?? null;
  }, [refreshDevices, waitForReadyDevice]);

  const playContext = useCallback(
    async (options: {
      contextUri?: string;
      uris?: string[];
      offsetPosition?: number;
      offsetUri?: string;
    }) => {
      const myPlaySeq = ++playSeqRef.current;
      // Trigger WKWebView audio unlock synchronously inside the user's click turn
      try {
        void playerRef.current?.activateElement?.();
      } catch {
        // Ignore
      }
      await runSoftGlideOut();
      if (playSeqRef.current !== myPlaySeq) return;

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
        if (playSeqRef.current !== myPlaySeq) return;
      }

      try {
        await api.play(buildPayload(target));
        if (playSeqRef.current !== myPlaySeq) return;
        setSdkError(null);
        window.setTimeout(() => runSoftGlideIn(), 700);
        // When targeting a remote Spotify Connect device (e.g. another PC), the local SDK
        // does not fire player_state_changed, so hydrate remote state immediately.
        if (!target || target !== deviceIdRef.current || !isLocalActiveRef.current) {
          scheduleRemoteHydrate([350, 1100]);
        }
        return;
      } catch {
        if (playSeqRef.current !== myPlaySeq) return;
        cancelSoftGlide(true);
        // Recovery path: wait for Spotify Connect registration, transfer playback, and retry cleanly
        const verifiedId = await resolveVerifiedDeviceId();
        if (playSeqRef.current !== myPlaySeq) return;
        if (!verifiedId) {
          setSdkError(
            "SpotiDesk aún se está conectando con Spotify. Intenta reproducir de nuevo en un segundo."
          );
          return;
        }

        try {
          await api.transferPlayback(verifiedId, false);
          if (playSeqRef.current !== myPlaySeq) return;
          // Give Spotify Connect backend time to activate the newly transferred device
          await sleep(420);
          if (playSeqRef.current !== myPlaySeq) return;
          await api.play(buildPayload(verifiedId));
          activeDeviceIdRef.current = verifiedId;
          const isLocal = Boolean(deviceIdRef.current && verifiedId === deviceIdRef.current);
          setLocalActive(isLocal);
          setSdkError(null);
          if (!isLocal) {
            scheduleRemoteHydrate([350, 1100]);
          }
        } catch (retryErr) {
          if (playSeqRef.current !== myPlaySeq) return;
          // One final retry after another brief settle delay for cold SDK wakeups
          try {
            await sleep(650);
            if (playSeqRef.current !== myPlaySeq) return;
            await api.play(buildPayload(verifiedId));
            activeDeviceIdRef.current = verifiedId;
            const isLocal = Boolean(deviceIdRef.current && verifiedId === deviceIdRef.current);
            setLocalActive(isLocal);
            setSdkError(null);
            if (!isLocal) {
              scheduleRemoteHydrate([350, 1100]);
            }
          } catch {
            if (playSeqRef.current !== myPlaySeq) return;
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
      cancelSoftGlide,
      resolveVerifiedDeviceId,
      runSoftGlideIn,
      runSoftGlideOut,
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
        const resumingOnLocalFromIdleRemote = Boolean(
          deviceIdRef.current && target === deviceIdRef.current && !isLocalActiveRef.current
        );
        if (resumingOnLocalFromIdleRemote && lastTrackRef.current) {
          // Cleanly transfer the paused queue onto this Mac and start playing here
          // instead of waking up an idle TV/speaker.
          try {
            await api.transferPlayback(target, true);
            activeDeviceIdRef.current = target;
            setActiveDeviceName(PLAYER_NAME);
            setLocalActive(true);
            setIsPlaying(true);
            wasPlayingRef.current = true;
            return;
          } catch {
            // Fall through to standard play if transfer wasn't needed
          }
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
    setLocalActive,
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
      await runSoftGlideOut();
      await playerRef.current.nextTrack();
      window.setTimeout(() => runSoftGlideIn(), 650);
      return;
    }
    try {
      await api.nextTrack(activeDeviceIdRef.current);
      scheduleRemoteHydrate([350, 1100]);
    } catch {
      // Ignore
    }
  }, [api, repeatMode, runSoftGlideIn, runSoftGlideOut, scheduleRemoteHydrate]);

  const previousTrack = useCallback(async () => {
    if (playerRef.current && isLocalActiveRef.current) {
      await runSoftGlideOut();
      await playerRef.current.previousTrack();
      window.setTimeout(() => runSoftGlideIn(), 650);
      return;
    }
    try {
      await api.previousTrack(activeDeviceIdRef.current);
      scheduleRemoteHydrate([350, 1100]);
    } catch {
      // Ignore
    }
  }, [api, runSoftGlideIn, runSoftGlideOut, scheduleRemoteHydrate]);

  const seek = useCallback(
    async (ms: number) => {
      const clamped = Math.max(0, Math.min(durationMs || ms, Math.round(ms)));
      cancelSoftGlide(true);
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
    [api, cancelSoftGlide, durationMs]
  );

  const setVolume = useCallback(
    async (nextVol: number) => {
      const clamped = Math.max(0, Math.min(1, nextVol));
      cancelSoftGlide(false);
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
    [api, cancelSoftGlide]
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
        const isLocal = Boolean(deviceIdRef.current && targetId === deviceIdRef.current);
        userSelectedRemoteIdRef.current = isLocal ? null : targetId;
        await api.transferPlayback(targetId, isPlaying);
        activeDeviceIdRef.current = targetId;
        setLocalActive(isLocal);
        const found = devices.find((d) => d.id === targetId);
        if (found) setActiveDeviceName(found.name);
        else if (isLocal) setActiveDeviceName(PLAYER_NAME);
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
