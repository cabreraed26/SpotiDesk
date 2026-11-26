import { useState } from "react";
import { Music } from "lucide-react";

interface LazyCoverProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
  roundedClass?: string;
}

export function LazyCover({
  src,
  alt,
  className = "w-10 h-10",
  iconSize = 16,
  roundedClass = "rounded-md",
}: LazyCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center ${roundedClass} ${className}`}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ease-apple ${
            loaded ? "opacity-100" : "opacity-0"
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
