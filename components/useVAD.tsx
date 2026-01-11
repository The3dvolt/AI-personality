"use client";
import { useEffect, useRef, useState } from "react";

export default function useVAD(stream: MediaStream | null, opts?: { threshold?: number; smoothing?: number }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;

    const threshold = opts?.threshold ?? 0.02;
    const smoothing = opts?.smoothing ?? 0.8;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    let speaking = false;

    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
      }
      const rms = Math.sqrt(sum / data.length);
      const smoothed = smoothing * volume + (1 - smoothing) * rms;
      setVolume(smoothed);
      if (!speaking && smoothed > threshold) {
        speaking = true;
        setIsSpeaking(true);
      } else if (speaking && smoothed <= threshold * 0.8) {
        speaking = false;
        setIsSpeaking(false);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      analyser.disconnect();
      try {
        source.disconnect();
      } catch {}
      audioCtx.close();
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  return { isSpeaking, volume };
}
