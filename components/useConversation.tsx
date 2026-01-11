"use client";
import { useEffect, useRef, useState } from "react";
import { Observation } from "./useVision";
import { saveFaceWithName, saveMemory } from "./useFaceStore";

type Opts = {
  expectingNameFor?: string | null;
  onClearedExpecting?: () => void;
};

export default function useConversation(stream: MediaStream | null, observations: Observation | null, vadSpeaking: boolean, opts?: Opts, getLastFrame?: () => Blob | null) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);

  useEffect(() => {
    // Setup SpeechRecognition if available
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition || null;
    if (SpeechRecognition) {
      const r = new SpeechRecognition();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (ev: any) => {
        const last = ev.results[ev.results.length - 1];
        if (last && last[0]) {
          setLastTranscript(last[0].transcript);
        }
      };
      recognitionRef.current = r;
    }
  }, []);

  useEffect(() => {
    if (!stream) return;

    if (vadSpeaking) {
      // start recording + recognition
      if (!mediaRecorderRef.current) {
        try {
          const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
          mr.ondataavailable = (e) => {
            if (e.data && e.data.size) chunksRef.current.push(e.data);
          };
          mr.start();
          mediaRecorderRef.current = mr;
        } catch (e) {
          console.warn("MediaRecorder start failed", e);
        }
      }
      if (recognitionRef.current && !listening) {
        try {
          recognitionRef.current.start();
          setListening(true);
        } catch (e) {}
      }
    } else {
      // stop recording/recognition and send audio/transcript
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recognitionRef.current && listening) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
        setListening(false);
      }

      (async () => {
        // package and send
        const chunks = chunksRef.current.splice(0);
        let transcript = lastTranscript;
        if (chunks.length === 0 && !transcript) return;

        const form = new FormData();
        if (transcript) form.append("transcript", transcript);
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
          form.append("audio", blob, "utterance.webm");
        }
        if (observations) form.append("observations", JSON.stringify(observations));
        if (opts?.expectingNameFor) form.append("expectingNameFor", opts.expectingNameFor);
        try {
          const lastFrame = getLastFrame?.();
          if (lastFrame) form.append("frame", lastFrame, "last-frame.jpg");
        } catch {}

        try {
          // Mute outgoing audio tracks to avoid feedback while waiting/playing
          const audioTracks = stream.getAudioTracks();
          audioTracks.forEach((t) => (t.enabled = false));

          try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { thinking: true } })); } catch {}
          const res = await fetch("/api/converse", { method: "POST", body: form });
          let data: any = {};
          try {
            data = await res.json();
          } catch (e) {
            // network/json error
            try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { offline: true } })); } catch {}
          }
          const reply = data?.reply || data?.text || "(no response)";

          // If server extracted a name, save it
          if (opts?.expectingNameFor && data?.extractedName) {
            try {
              await saveFaceWithName(opts.expectingNameFor, data.extractedName.trim());
              await saveMemory({ title: `Learned person: ${data.extractedName.trim()}`, detail: opts.expectingNameFor });
              if (opts.onClearedExpecting) opts.onClearedExpecting();
            } catch (e) {}
          }

          // Speak the reply using speechSynthesis
          if (reply) {
            await speakText(reply);
          }

          try { window.dispatchEvent(new CustomEvent("ai-status", { detail: { thinking: false } })); } catch {}
        } catch (e) {
          console.error(e);
        } finally {
          // restore mic track
          const audioTracks = stream.getAudioTracks();
          audioTracks.forEach((t) => (t.enabled = true));
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vadSpeaking, stream]);

  async function speakText(text: string) {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    });
  }

  return { listening, lastTranscript };
}
