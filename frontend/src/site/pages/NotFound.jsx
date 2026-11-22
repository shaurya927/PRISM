import React from "react";
import { Reveal, ScrambleText } from "../motion.jsx";
import { Pill } from "../components.jsx";

export default function NotFound() {
  return (
    <section className="gutter min-h-screen flex flex-col justify-center">
      <div className="display plate-type"><ScrambleText text="4?4" duration={1} /></div>
      <Reveal delay={0.3}><p className="lead mt-8 max-w-md">This page could not be read with confidence, so PRISM won't guess what it was.</p></Reveal>
      <Reveal delay={0.45} className="mt-8"><Pill to="/">Back to the start</Pill></Reveal>
    </section>
  );
}
