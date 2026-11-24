// Menu art: the black puzzle cube (the three.js scene is in cubeScene.js). Layout.jsx loads this chunk
// only for screens at least 1024 px wide, together with three.js. Without WebGL it renders nothing and
// the menu is just the list of pages. Under reduced motion the cube is drawn once, solved, and stays still.
import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { caseById } from "./data/content.js";
import { getCube } from "./cubeScene.js";

// The cube's front face shows the first nine characters of the night case's fused plate (CG04MX48?1).
const PLATE = caseById("night_partial_white")?.fused || "CG04MX48?1";

export default function CubeArt() {
  const reduce = useReducedMotion();
  const stage = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed || !stage.current) return undefined;
    let cube;
    try {
      cube = getCube(PLATE);
    } catch {
      setFailed(true); // no WebGL
      return undefined;
    }
    return cube.mount(stage.current, { still: Boolean(reduce), onLost: () => setFailed(true) });
  }, [reduce, failed]);

  if (failed) return null;
  return (
    <div className="cube" aria-hidden>
      <div className="cube__glow" />
      <div ref={stage} className="cube__stage" />
    </div>
  );
}
