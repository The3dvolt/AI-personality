"use client";
import { useEffect, useRef, useState } from "react";
import { saveFace, hasSeen } from "./useFaceStore";
import { saveMemory } from "./useFaceStore";

export type Observation = {
  facePresent: boolean;
  faceStatus?: string; // 'new' | 'seen'
  faceHash?: string;
  environment?: string;
  objects?: string[];
  raw?: any;
};

function computeAHash(canvas: HTMLCanvasElement) {
  // average hash (8x8)
  const size = 8;
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let sum = 0;
  const vals: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    vals.push(v);
    sum += v;
  }
  const avg = sum / vals.length;
  let hash = "";
  for (let i = 0; i < vals.length; i++) hash += vals[i] > avg ? "1" : "0";
  return hash;
}

export default function useVision(videoRef: HTMLVideoElement | null) {
  const [observations, setObservations] = useState<Observation | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastFrameRef = useRef<Blob | null>(null);
  const batteryRef = useRef<any>(null);
  const captureIntervalRef = useRef<number>(4000);
  const lastObjectsRef = useRef<string[]>([]);
  const proactiveRef = useRef<number | null>(null);

  useEffect(() => {
    if (!videoRef) return;

    async function captureAndSend() {
      if (!videoRef || !videoRef.srcObject) return;
      const video = videoRef;
      const canvas = document.createElement("canvas");
      // capture a high-res frame but keep canvas off-DOM to avoid layout impact
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // draw into canvas; schedule heavy toBlob work to idle time to reduce jank
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((res) => {
        const doBlob = () => canvas.toBlob((b) => res(b), "image/jpeg", 0.9);
        if ((window as any).requestIdleCallback) {
          (window as any).requestIdleCallback(doBlob, { timeout: 1000 });
        } else {
          setTimeout(doBlob, 0);
        }
      });
      if (!blob) return;
      // store last captured frame for voice-first uploads
      try { lastFrameRef.current = blob; } catch {}

      // compute a hash for face persistence using whole frame (fallback)
      const hash = computeAHash(canvas);
      const seen = await hasSeen(hash).catch(()=>false);
      if (seen) await saveFace(hash);

      const form = new FormData();
      form.append("frame", blob, "frame.jpg");

      // notify app that AI is thinking
      try {
        window.dispatchEvent(new CustomEvent("ai-status", { detail: { thinking: true } }));
      } catch {}

      let res: Response;
      try {
        res = await fetch("/api/vision", { method: "POST", body: form });
      } catch (err) {
        try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { offline: true } })); } catch {}
        return setObservations({ facePresent: false, environment: "offline", objects: [], raw: { error: String(err) } });
      }

      if (!res.ok) {
        const txt = await res.text();
        try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { thinking: false } })); } catch {}
        setObservations({ facePresent: false, environment: "unknown", objects: [], raw: { error: txt } });
        return;
      }
      const data = await res.json();
      try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { thinking: false } })); } catch {}

      // interpret server response
      const facePresent = !!data.faceDetected;
      const faceStatus = facePresent ? (data.faceHash && (await hasSeen(data.faceHash).catch(()=>false)) ? "seen" : "new") : undefined;
      if (facePresent && data.faceHash) await saveFace(data.faceHash);

      setObservations({
        facePresent,
        faceStatus,
        faceHash: data.faceHash,
        environment: data.environment || data.description,
        objects: data.objects || [],
        raw: data,
      });

      // Proactive behavior: if new objects or new face appears, log and leave it to UI to ask
      try {
        const prev = lastObjectsRef.current || [];
        const cur = data.objects || [];
        const added = cur.filter((o: string) => !prev.includes(o));
        if (added.length > 0) {
          await saveMemory({ title: `New objects: ${added.join(", ")}`, detail: JSON.stringify(added) });
        }
        lastObjectsRef.current = cur;

        if (facePresent && faceStatus === "new") {
          await saveMemory({ title: `Saw new person`, detail: data.faceHash || "unknown" });
        }
      } catch (e) {}
    }

    // start immediately
    captureAndSend();

    // get battery status if available to throttle captures on low battery
    if ((navigator as any).getBattery) {
      try {
        (navigator as any).getBattery().then((bat: any) => {
          batteryRef.current = bat;
          const updateInterval = () => {
            const level = bat.level ?? 1;
            const low = level < 0.2 || bat.charging === false && level < 0.35;
            captureIntervalRef.current = low ? 5000 : 4000;
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            intervalRef.current = window.setInterval(captureAndSend, captureIntervalRef.current);
          };
          bat.addEventListener('levelchange', updateInterval);
          bat.addEventListener('chargingchange', updateInterval);
          updateInterval();
        }).catch(()=>{
          intervalRef.current = window.setInterval(captureAndSend, captureIntervalRef.current);
        });
      } catch {
        intervalRef.current = window.setInterval(captureAndSend, captureIntervalRef.current);
      }
    } else {
      intervalRef.current = window.setInterval(captureAndSend, captureIntervalRef.current);
    }

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  return { observations };
  function getLastFrame() { return lastFrameRef.current; }
  return { observations, getLastFrame };
}
