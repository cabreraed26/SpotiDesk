import type { TrackArtistRef } from "../types/spotify";

interface ArtistLinksProps {
  artistsText: string;
  artistItems?: TrackArtistRef[];
  fallbackArtistId?: string;
  onSelectArtist?: (artistId: string, artistName?: string) => void;
  linkClassName?: string;
}

export function ArtistLinks({
  artistsText,
  artistItems,
  fallbackArtistId,
  onSelectArtist,
  linkClassName = "hover:text-[var(--text-primary)] hover:underline underline-offset-2 transition-colors cursor-pointer",
}: ArtistLinksProps) {
  if (!onSelectArtist || !artistsText) {
    return <>{artistsText}</>;
  }

  if (artistItems && artistItems.length > 0) {
    return (
      <>
        {artistItems.map((artist, idx) => (
          <span key={`${artist.id}-${idx}`}>
            {idx > 0 && ", "}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectArtist(artist.id, artist.name);
              }}
              className={linkClassName}
            >
              {artist.name}
            </button>
          </span>
        ))}
      </>
    );
  }

  // Fallback when track metadata only carries comma-separated artist names (e.g. live SDK / pre-HMR state)
  const names = artistsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (names.length === 0) {
    return <>{artistsText}</>;
  }

  return (
    <>
      {names.map((name, idx) => (
        <span key={`${name}-${idx}`}>
          {idx > 0 && ", "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectArtist(idx === 0 && fallbackArtistId ? fallbackArtistId : "", name);
            }}
            className={linkClassName}
          >
            {name}
          </button>
        </span>
      ))}
    </>
  );
}
