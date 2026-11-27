import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEV_MODE_USER_NOT_ALLOWED_MSG,
  SpotifyApiClient,
  SpotifyApiError,
} from "../lib/spotifyApi";
import type { AuthTokenPayload, SpotifyUser } from "../types/spotify";

const CLIENT_ID_STORAGE_KEY = "spotyfast.spotify_client_id";

function readInitialClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
    if (saved) return saved;
  } catch {
    // Ignore storage errors
  }
  const fromEnv = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
  if (fromEnv && fromEnv !== "your_spotify_client_id_here") {
    return fromEnv;
  }
  return "";
}

export function useSpotifyAuth() {
  const [tokenPayload, setTokenPayload] = useState<AuthTokenPayload | null>(null);
  const [user, setUser] = useState<SpotifyUser | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientIdState] = useState<string>(readInitialClientId);

  const tokenRef = useRef<AuthTokenPayload | null>(null);
  tokenRef.current = tokenPayload;

  const setClientId = useCallback((value: string) => {
    const trimmed = value.trim();
    setClientIdState(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem(CLIENT_ID_STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const getFreshToken = useCallback(async (): Promise<string | null> => {
    const current = tokenRef.current;
    const nowSec = Math.floor(Date.now() / 1000);
    if (current && nowSec + 90 < current.expiresAt) {
      return current.accessToken;
    }

    try {
      const valid = await invoke<AuthTokenPayload | null>("get_valid_token");
      setTokenPayload(valid);
      return valid?.accessToken ?? null;
    } catch {
      return null;
    }
  }, []);

  const forceRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const refreshed = await invoke<AuthTokenPayload>("refresh_spotify_token");
      setTokenPayload(refreshed);
      return refreshed.accessToken;
    } catch {
      setTokenPayload(null);
      setUser(null);
      return null;
    }
  }, []);

  const api = useMemo(
    () =>
      new SpotifyApiClient({
        getToken: getFreshToken,
        forceRefresh,
      }),
    [getFreshToken, forceRefresh]
  );

  // Restore saved session on boot
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const valid = await invoke<AuthTokenPayload | null>("get_valid_token");
        if (!active) return;
        if (valid) {
          tokenRef.current = valid;
          const profile = await api.getMe();
          if (!active) return;
          setTokenPayload(valid);
          setUser(profile);
        }
      } catch (err) {
        if (active) {
          console.warn("[SpotyFast] No se pudo restaurar la sesión:", err);
          tokenRef.current = null;
          setTokenPayload(null);
          setUser(null);
          if (err instanceof SpotifyApiError && (err.isUserNotRegistered || err.status === 403)) {
            await invoke("logout_spotify").catch(() => {});
            setError(err.isUserNotRegistered ? err.message : DEV_MODE_USER_NOT_ALLOWED_MSG);
          }
        }
      } finally {
        if (active) setIsInitializing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [api]);

  // Schedule proactive auto-refresh 2 minutes before expiry (zero polling)
  useEffect(() => {
    if (!tokenPayload) return;
    const nowMs = Date.now();
    const refreshAtMs = (tokenPayload.expiresAt - 120) * 1000;
    const delayMs = Math.max(5_000, refreshAtMs - nowMs);

    const timer = window.setTimeout(() => {
      void forceRefresh();
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [tokenPayload, forceRefresh]);

  const login = useCallback(
    async (overrideClientId?: string) => {
      const effectiveId = (overrideClientId ?? clientId).trim();
      if (!effectiveId) {
        setError(
          "Primero pega tu Client ID de Spotify arriba. Si no tienes uno, despliega la guía de 1 minuto para crearlo gratis."
        );
        return;
      }
      if (overrideClientId !== undefined) {
        setClientId(effectiveId);
      }

      setError(null);
      setIsAuthenticating(true);
      try {
        const payload = await invoke<AuthTokenPayload>("start_spotify_auth", {
          clientId: effectiveId,
        });
        tokenRef.current = payload;
        const profile = await api.getMe();
        setTokenPayload(payload);
        setUser(profile);
      } catch (err) {
        tokenRef.current = null;
        setTokenPayload(null);
        setUser(null);
        if (err instanceof SpotifyApiError) {
          await invoke("logout_spotify").catch(() => {});
        }
        const message =
          err instanceof SpotifyApiError && (err.isUserNotRegistered || err.status === 403)
            ? DEV_MODE_USER_NOT_ALLOWED_MSG
            : typeof err === "string"
              ? err
              : err instanceof Error
                ? err.message
                : "Error de autenticación.";
        setError(message);
      } finally {
        setIsAuthenticating(false);
      }
    },
    [api, clientId, setClientId]
  );

  const logout = useCallback(async () => {
    try {
      await invoke("logout_spotify");
    } finally {
      setTokenPayload(null);
      setUser(null);
      setError(null);
    }
  }, []);

  return {
    token: tokenPayload?.accessToken ?? null,
    isAuthenticated: Boolean(tokenPayload),
    isInitializing,
    isAuthenticating,
    error,
    user,
    clientId,
    setClientId,
    login,
    logout,
    getFreshToken,
    forceRefresh,
    api,
  };
}
