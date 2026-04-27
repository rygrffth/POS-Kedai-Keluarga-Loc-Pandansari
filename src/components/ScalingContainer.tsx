"use client";

import React, { useEffect, useState, useRef, ReactNode } from "react";

interface ScalingContainerProps {
  children: ReactNode;
  /** Target width for the design. Default: 1080 (Portrait) or 1920 (Landscape) */
  baseWidth?: number;
  /** Target height for the design. Default: 1920 (Portrait) or 1080 (Landscape) */
  baseHeight?: number;
  /** Mode: 'fit' (scale to fit), 'width' (scale to width), 'height' (scale to height) */
  mode?: "fit" | "width" | "height";
  /** Background color for the outer container */
  bg?: string;
}

export default function ScalingContainer({
  children,
  baseWidth = 430, // Default iPhone width for portrait POS
  baseHeight = 932, // Default iPhone height
  mode = "fit",
  bg = "bg-slate-50",
}: ScalingContainerProps) {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      let newScale = 1;

      const scaleX = windowWidth / baseWidth;
      const scaleY = windowHeight / baseHeight;

      if (mode === "fit") {
        newScale = Math.min(scaleX, scaleY);
      } else if (mode === "width") {
        newScale = scaleX;
      } else if (mode === "height") {
        newScale = scaleY;
      }

      // Avoid extreme scaling
      setScale(newScale);
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Initial call

    return () => window.removeEventListener("resize", handleResize);
  }, [baseWidth, baseHeight, mode]);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 overflow-y-auto flex flex-col items-center py-4 ${bg}`}
    >
      <div
        ref={contentRef}
        style={{
          width: `${baseWidth}px`,
          height: `${baseHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top center",
          transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          flexShrink: 0,
        }}
        className="relative shadow-2xl bg-white grain-texture"
      >
        {children}
      </div>
    </div>
  );
}
