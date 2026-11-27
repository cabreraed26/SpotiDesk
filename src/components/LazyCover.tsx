import { useEffect, useState } from "react";
import { Music } from "lucide-react";

const MAX_TRACKED_URLS = 512;
const loadedImageUrls = new Set<string>();

function rememberLoadedUrl(url: string) {
  if (loadedImageUrls.has(url)) return;
  if (loadedImageUrls.size >= MAX_TRACKED_URLS) {
    const first = loadedImageUrls.values().next().value;
    if (first) loadedImageUrls.delete(first);
  }
  loadedImageUrls.add(url);
}

interface LazyCoverProps {
  src?: string;
  /** Optional lower-res URL already decoded elsewhere so hero morph transitions never flash blank on frame 0 */
  placeholderSrc?: string;
  alt: string;
  className?: string;
  iconSize?: number;
  roundedClass?: string;
  /** Set true on editorial hero covers participating in View Transitions */
  eager?: boolean;
}

export function LazyCover({
  src,
  placeholderSrc,
  alt,
  className = "w-10 h-10",
  iconSize = 16,
  roundedClass = "rounded-md",
  eager = false,
}: LazyCoverProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    src && loadedImageUrls.has(src) ? src : null
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (src && loadedImageUrls.has(src)) {
      setLoadedSrc(src);
    }
  }, [src]);

  const isLoaded = Boolean(src && (loadedSrc === src || loadedImageUrls.has(src)));
  const isFailed = Boolean(src && failedSrc === src);
  const showImage = Boolean(src) && !isFailed;
  const showPlaceholder = Boolean(
    placeholderSrc &&
      placeholderSrc !== src &&
      !isLoaded &&
      loadedImageUrls.has(placeholderSrc)
  );

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center ${roundedClass} ${className}`}
    >
      {showPlaceholder && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          decoding="sync"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding={eager ? "sync" : "async"}
          onLoad={() => {
            if (src) {
              rememberLoadedUrl(src);
              setLoadedSrc(src);
            }
          }}
          onError={() => {
            if (src) setFailedSrc(src);
          }}
          className={`relative z-10 w-full h-full object-cover ${
            isLoaded
              ? "opacity-100"
              : showPlaceholder
                ? "opacity-0 transition-opacity duration-200 ease-apple"
                : eager
                  ? "opacity-100"
                  : "opacity-0 transition-opacity duration-300 ease-apple"
          }`}
        />
      ) : (
        <Music
          size={iconSize}
          strokeWidth={1.5}
          className="text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
