"use client";
import React, { useEffect, useState } from "react";
import { listMemories, listFaces } from "./useFaceStore";

export default function MemorySidebar() {
  const [memories, setMemories] = useState<any[]>([]);
  const [faces, setFaces] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setMemories(await listMemories());
      setFaces(await listFaces());
    })();
  }, []);

  return (
    <aside className="w-72 bg-white/80 dark:bg-black/60 rounded-md p-3 shadow-md">
      <h3 className="font-semibold mb-2">Memory</h3>
      <div className="mb-3">
        <div className="text-sm font-medium">People</div>
        <ul className="text-sm mt-1">
          {faces.length === 0 && <li className="text-xs text-gray-500">None yet</li>}
          {faces.map((f) => (
            <li key={f.hash} className="truncate">{f.name ?? f.hash.slice(0,8)} · {new Date(f.lastSeen).toLocaleString()}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-sm font-medium">Interactions</div>
        <ul className="text-sm mt-1 max-h-64 overflow-auto">
          {memories.length === 0 && <li className="text-xs text-gray-500">No memories</li>}
          {memories.map((m: any, i: number) => (
            <li key={i} className="mb-2">
              <div className="text-xs text-gray-600">{new Date(m.ts).toLocaleString()}</div>
              <div className="font-medium">{m.title}</div>
              <div className="text-xs text-gray-700">{m.detail}</div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
