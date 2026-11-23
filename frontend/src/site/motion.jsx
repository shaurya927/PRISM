import React from "react";

// One ease-out curve for every transition on the site. Motion only answers interaction
// (hover, press, sliders, tabs, menus, page changes); nothing animates on its own.
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_REVEAL = EASE;
export const EASE_APPEAR = EASE;

/** Headline split into lines. Each line keeps its own block so wraps stay where they were written. */
export function SplitLines({ lines, as: Tag = "h1", className = "" }) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i} className="mask-line"><span className="mask-line__in">{line}</span></span>
      ))}
    </Tag>
  );
}

/** Plain block. Kept as a component so existing call sites do not change; it no longer animates in. */
export function Reveal({ children, className = "", as: Tag = "div" }) {
  return <Tag className={className}>{children}</Tag>;
}

/** Paragraph with the unknown `?` in the accent colour. */
export function ScrubText({ text, className = "" }) {
  return (
    <p className={`scrub ${className}`}>
      {text.split(" ").map((w, i) => (
        <span key={i} className={w.includes("?") ? "text-accent" : ""}>{w}{" "}</span>
      ))}
    </p>
  );
}

/** A measured figure in one format. */
export function Counter({ value, decimals = 0, suffix = "", prefix = "", className = "" }) {
  return <span className={className}>{prefix}{Number(value).toFixed(decimals)}{suffix}</span>;
}

/** Row of capability names, wrapped instead of scrolling on its own. */
export function Marquee({ items, className = "" }) {
  return (
    <div className={`marquee ${className}`}>
      <ul className="marquee__track">
        {items.map((it) => (
          <li key={it} className="marquee__item">{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** Image in a clipped frame. */
export function ImageReveal({ src, alt = "", className = "", imgClassName = "", pixel = false }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <img src={src} alt={alt} loading="lazy" className={`w-full h-full object-cover ${pixel ? "pixel" : ""} ${imgClassName}`} />
    </div>
  );
}

/** Mono micro-label with an index, e.g. "(02) Pipeline". */
export function Label({ index, children, className = "" }) {
  return (
    <div className={`label-mono ${className}`}>
      {index != null && <span className="opacity-50 mr-2">({String(index).padStart(2, "0")})</span>}
      {children}
    </div>
  );
}

/** Text with every `?` in the accent colour. */
export function ScrambleText({ text, className = "" }) {
  return (
    <span className={className} aria-label={text}>
      {text.split("").map((c, i) => (
        <span key={i} className={c === "?" ? "text-accent" : ""}>{c}</span>
      ))}
    </span>
  );
}
