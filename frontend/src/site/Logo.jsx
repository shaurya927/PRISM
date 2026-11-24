import React from "react";

// PRISM mark: a folded "P" of seven grey facets (same drawing as public/logo.svg and the report watermark).
const FACETS = [
  ["436,65 250,290 436,420", "#e9e9e5"],
  ["447,75 700,180 447,255", "#c7c7c7"],
  ["512,245 705,190 705,365", "#868686"],
  ["715,200 828,345 715,420", "#ffffff"],
  ["838,350 705,588 440,585", "#bdbec2"],
  ["248,300 436,432 436,585 248,805", "#e8e8e8"],
  ["436,600 436,755 248,875 248,820", "#888888"],
];

/** The mark at `size` px tall (it is about 0.74 as wide as it is tall). */
export default function Logo({ size = 22, className = "", title }) {
  return (
    <svg
      className={className}
      width={Math.round(size * 0.737)}
      height={size}
      viewBox="236 52 616 836"
      fill="none"
      stroke="#2a2a2a"
      strokeWidth={size < 40 ? 6 : 3}
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {FACETS.map(([points, fill]) => <polygon key={points} points={points} fill={fill} />)}
    </svg>
  );
}
