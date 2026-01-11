"use client";
import React, { useEffect, useRef, useState } from "react";
import useVAD from "./useVAD";
import useVision from "./useVision";
import VisionOverlay from "./VisionOverlay";
import useConversation from "./useConversation";
import MemorySidebar from "./MemorySidebar";
import { saveMemory } from "./useFaceStore";

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<{ camera?: string; microphone?: string }>({});

  const [facingMode, setFacingMode] = useState<'user'|'environment'>('user');
  const [aiThinking, setAiThinking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [selectedDeviceIdx, setSelectedDeviceIdx] = useState<number>(0);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  useEffect(() => {
    navigator.permissions?.query?.({ name: "camera" as PermissionName }).then((p) => setPermission((s) => ({ ...s, camera: p.state }))).catch(()=>{});
    navigator.permissions?.query?.({ name: "microphone" as PermissionName }).then((p) => setPermission((s) => ({ ...s, microphone: p.state }))).catch(()=>{});
  }, []);

  useEffect(() => {
    // enumerate devices
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const vids = devices.filter((d) => d.kind === 'videoinput');
      setDeviceIds(vids.map(v=>v.deviceId));
    }).catch(()=>{});
  }, []);

  useEffect(() => {
    async function start() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode }, audio: true });
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
        localStorage.setItem("has_media_permission", "1");
      } catch (e: any) {
        setError(e?.message ?? "Could not access camera/microphone");
      }
    }

    const saved = localStorage.getItem("has_media_permission");
    if (saved) start();

    return () => {};
  }, [facingMode]);

  // restart stream when facingMode changes at runtime (mobile toggle)
  useEffect(() => {
    if (!localStorage.getItem("has_media_permission")) return;
    (async () => {
      try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode }, audio: true });
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const { isSpeaking, volume } = useVAD(stream);
  const { observations, getLastFrame } = useVision(videoRef.current);
  const [expectingNameFor, setExpectingNameFor] = useState<string | null>(null);
  const { listening, lastTranscript } = useConversation(stream, observations, isSpeaking, {
    expectingNameFor,
    onClearedExpecting: () => setExpectingNameFor(null),
  }, getLastFrame);

  const [lastUserSpeakAt, setLastUserSpeakAt] = useState<number>(Date.now());

  useEffect(() => {
    if (lastTranscript) setLastUserSpeakAt(Date.now());
  }, [lastTranscript]);

  // If silence for 20s and a significant change occurred, proactively ask a question
  useEffect(() => {
    if (!observations) return;
    const now = Date.now();
    const silent = now - lastUserSpeakAt > 20000;
    const significant = (observations.facePresent && observations.faceStatus === 'new') || (observations.objects && observations.objects.length > 0);
    if (silent && significant) {
      (async () => {
        try {
          // generate a proactive question
          const form = new FormData();
          form.append('prompt', `Proactively ask a friendly question about the scene: ${observations.environment || ''}. Mention one object or person I see.`);
          form.append('observations', JSON.stringify(observations));
          try { window.dispatchEvent(new CustomEvent('ai-status', { detail: { thinking: true } })); } catch {}
          const res = await fetch('/api/converse', { method: 'POST', body: form });
          const data = await res.json();
          const reply = data?.reply || data?.text || '';
          // mute mic while speaking
          const audioTracks = stream?.getAudioTracks() || [];
          audioTracks.forEach((t) => (t.enabled = false));
          if (reply) await speak(reply);
          audioTracks.forEach((t) => (t.enabled = true));
          try { window.dispatchEvent(new CustomEvent('ai-status', { detail: { thinking: false } })); } catch {}
          setLastUserSpeakAt(Date.now());
        } catch (e) { console.error(e); }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations, lastUserSpeakAt]);

  useEffect(() => {
    // Proactive timer: if a new person or new object appears, initiate a proactive question
    if (!observations) return;
    (async () => {
      try {
        if (observations.facePresent && observations.faceStatus === "new" && observations.faceHash && !expectingNameFor) {
          setExpectingNameFor(observations.faceHash);
          await saveMemory({ title: "Asked for name", detail: observations.faceHash });
          // ask for name via converse API
          const form = new FormData();
          form.append("prompt", "I don't think we've met, what's your name?");
          form.append("observations", JSON.stringify(observations));

          // mute mic while speaking
          const audioTracks = stream?.getAudioTracks() || [];
          audioTracks.forEach((t) => (t.enabled = false));

          const res = await fetch("/api/converse", { method: "POST", body: form });
          const data = await res.json();
          const reply = data?.reply || data?.text || "Hi";
          await speak(reply);

          audioTracks.forEach((t) => (t.enabled = true));
        }

        if (observations.objects && observations.objects.length > 0) {
          // if an object appears that we haven't seen before, ask about it
          const key = `seen_objects_v1`;
          const seen = JSON.parse(localStorage.getItem(key) || "[]");
          const added = observations.objects.filter((o) => !seen.includes(o));
          if (added.length > 0) {
            localStorage.setItem(key, JSON.stringify(Array.from(new Set([...seen, ...observations.objects]))));
            await saveMemory({ title: `Asked about new objects`, detail: added.join(", ") });
            const form = new FormData();
            form.append("prompt", `I see ${added.slice(0,1)[0]}. Can you tell me what that is?`);
            form.append("observations", JSON.stringify(observations));

            const audioTracks = stream?.getAudioTracks() || [];
            audioTracks.forEach((t) => (t.enabled = false));
            const res = await fetch("/api/converse", { method: "POST", body: form });
            const data = await res.json();
            const reply = data?.reply || data?.text || "";
            if (reply) await speak(reply);
            audioTracks.forEach((t) => (t.enabled = true));
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations]);

  async function speak(text: string) {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }

  const requestPermissions = async () => {
    try {
      const constraints: any = { audio: true };
      if (isIOS) constraints.video = { facingMode };
      else if (deviceIds.length > 0) constraints.video = { deviceId: { exact: deviceIds[selectedDeviceIdx] } };
      else constraints.video = true;
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      localStorage.setItem("has_media_permission", "1");
    } catch (e: any) {
      setError(e?.message ?? "Permission denied");
    }
  };

  const startAura = async () => {
    // iOS requires a user gesture to unlock audio
      try {
      if (!audioCtxRef.current) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        if ((ctx as any).resume) await (ctx as any).resume();
      }
    } catch (e) { console.warn(e); }
  };

  const toggleCamera = async () => {
    if (isIOS) {
      setFacingMode((f) => f === 'user' ? 'environment' : 'user');
      return;
    }
    if (deviceIds.length <= 1) return;
    const next = (selectedDeviceIdx + 1) % deviceIds.length;
    setSelectedDeviceIdx(next);
    // restart stream with new device
    try {
      if (stream) stream.getTracks().forEach(t=>t.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceIds[next] } }, audio: true });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch (e) { console.error(e); }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:h-auto h-[100dvh]">
      <div className="relative">
        <div className={`rounded-lg overflow-hidden bg-black/80 aspect-video relative ${aiThinking || isSpeaking ? 'ring-4 ring-indigo-400/60 animate-[pulse_1.8s_infinite]' : ''}`}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <VisionOverlay observations={observations} />
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isSpeaking ? "bg-emerald-400" : "bg-gray-400"} shadow-md`} />
            <div className="text-white text-sm">{isSpeaking ? "Speaking" : "Silent"}</div>
          </div>
          <div className="absolute right-4 bottom-4 bg-black/50 text-white rounded-md px-3 py-1 text-sm">Vol: {Math.round(volume * 100)}</div>
        </div>

        {offline && (
          <div className="absolute inset-0 flex items-start justify-center pointer-events-none">
            <div className="mt-4 bg-red-600/90 text-white px-3 py-1 rounded shadow">Offline — AI unavailable</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-4 items-center">
        <div className="flex-1" />
        <div className="flex gap-2">
          <button onClick={startAura} className="rounded-lg bg-green-600 text-white px-4 py-2">Start Aura</button>
          <button onClick={toggleCamera} className="rounded-lg bg-blue-600 text-white px-4 py-2">Toggle Camera</button>
        </div>
        <div className="w-72">
          <div className="sticky top-6">
            <MemorySidebar />
          </div>
        </div>
      </div>

      {!stream && (
        <div className="mt-4 flex items-center justify-center">
          <button onClick={requestPermissions} className="rounded-lg bg-blue-600 text-white px-4 py-2">Enable Camera/Mic</button>
        </div>
      )}

      {error && <div className="mt-4 text-red-600">{error}</div>}
    </div>
  );
}
