"use client";
import React from "react";
import { motion } from "framer-motion";

export default function VisionOverlay({ observations }: { observations: any | null }) {
  if (!observations) return null;

  return (
    <>
      {/* Bounding boxes */}
      <div className="pointer-events-none absolute inset-0">
        {(observations.objects || []).map((obj: any, i: number) => {
          const [ymin, xmin, ymax, xmax] = obj.bbox || [0,0,0,0];
          const top = `${(ymin * 100).toFixed(2)}%`;
          const left = `${(xmin * 100).toFixed(2)}%`;
          const width = `${((xmax - xmin) * 100).toFixed(2)}%`;
          const height = `${((ymax - ymin) * 100).toFixed(2)}%`;
          const label = obj.model || obj.name;

          return (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ position: 'absolute', top, left, width, height }} className="transform-gpu will-change-transform">
              <div className="absolute inset-0 border-2 border-indigo-400/80 rounded-md transform-gpu" />
              <div className="absolute -top-5 left-0 bg-indigo-700/90 text-white text-xs px-2 py-0.5 rounded-sm">{label}</div>
            </motion.div>
          );
        })}
      </div>

      {/* Summary box */}
      <div className="pointer-events-none absolute right-4 top-4 w-72 bg-black/50 text-white rounded-md p-3 backdrop-blur-sm">
        <h4 className="font-semibold mb-1">Current Observations</h4>
        {!observations && <div className="text-sm">No observations yet</div>}
        {observations && (
          <div className="text-sm">
            <div>Face: {observations.facePresent ? (observations.faceStatus || "present") : "none"}</div>
            <div>Environment: {observations.environment || "unknown"}</div>
            <div>Objects: {(observations.objects || []).map((o: any) => o.name + (o.model ? ` (${o.model})` : '')).slice(0,5).join(", ") || "none"}</div>
          </div>
        )}
      </div>
    </>
  );
}
