import { useEffect, useRef, useState } from "react";

export function PaperThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(() => !src || typeof window.IntersectionObserver === "undefined");

  useEffect(() => {
    if (!src || visible) return;
    const node = frameRef.current;
    if (!node) return;
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [src, visible]);

  return (
    <div ref={frameRef} className="paper-thumbnail-frame">
      {src && visible ? (
        <img className="paper-thumbnail" src={src} alt={alt} loading="lazy" />
      ) : (
        <div className="paper-thumbnail paper-thumbnail--placeholder" aria-label="Paper thumbnail">
          {src ? "Scan" : "PDF"}
        </div>
      )}
    </div>
  );
}
