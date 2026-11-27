export interface PlaylistFolder {
  id: string;
  name: string;
  playlistIds: string[];
  collapsed?: boolean;
}

export interface SidebarOrganization {
  pinnedIds: string[];
  folders: PlaylistFolder[];
}

const STORAGE_KEY = "spotidesk.sidebar_org_v1";
const MAX_PINNED = 5;

export function loadSidebarOrg(): SidebarOrganization {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pinnedIds: [], folders: [] };
    const parsed = JSON.parse(raw) as Partial<SidebarOrganization>;
    return {
      pinnedIds: Array.isArray(parsed.pinnedIds)
        ? parsed.pinnedIds.filter((x): x is string => typeof x === "string").slice(0, MAX_PINNED)
        : [],
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter(
            (f): f is PlaylistFolder =>
              Boolean(f && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.playlistIds))
          )
        : [],
    };
  } catch {
    return { pinnedIds: [], folders: [] };
  }
}

export function saveSidebarOrg(org: SidebarOrganization): SidebarOrganization {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(org));
  } catch {
    // Ignore storage quota errors
  }
  return org;
}

export function togglePinInOrg(org: SidebarOrganization, playlistId: string): SidebarOrganization {
  const exists = org.pinnedIds.includes(playlistId);
  const pinnedIds = exists
    ? org.pinnedIds.filter((id) => id !== playlistId)
    : [...org.pinnedIds, playlistId].slice(0, MAX_PINNED);
  return saveSidebarOrg({ ...org, pinnedIds });
}

export function createFolderInOrg(org: SidebarOrganization, name: string): SidebarOrganization {
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed) return org;
  const folder: PlaylistFolder = {
    id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    playlistIds: [],
    collapsed: false,
  };
  return saveSidebarOrg({ ...org, folders: [...org.folders, folder] });
}

export function deleteFolderInOrg(org: SidebarOrganization, folderId: string): SidebarOrganization {
  return saveSidebarOrg({
    ...org,
    folders: org.folders.filter((f) => f.id !== folderId),
  });
}

export function toggleFolderCollapsedInOrg(
  org: SidebarOrganization,
  folderId: string
): SidebarOrganization {
  return saveSidebarOrg({
    ...org,
    folders: org.folders.map((f) =>
      f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
    ),
  });
}

export function assignPlaylistToFolderInOrg(
  org: SidebarOrganization,
  playlistId: string,
  targetFolderId: string | null
): SidebarOrganization {
  const folders = org.folders.map((f) => {
    const cleaned = f.playlistIds.filter((id) => id !== playlistId);
    if (targetFolderId && f.id === targetFolderId) {
      return { ...f, playlistIds: [...cleaned, playlistId], collapsed: false };
    }
    return { ...f, playlistIds: cleaned };
  });
  return saveSidebarOrg({ ...org, folders });
}
