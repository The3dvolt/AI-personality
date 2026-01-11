import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a proactive spatial assistant. You can see through the camera. Always reference what you see in conversation.`;

export async function POST(req: Request) {
  const form = await req.formData();
  const transcript = form.get("transcript") as string | null;
  const audio = form.get("audio") as unknown as Blob | null;
  const promptOverride = form.get("prompt") as string | null;
  const observations = form.get("observations") as string | null;
  const expectingNameFor = form.get("expectingNameFor") as string | null;

  const key = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";

  // If we have a transcript, prefer that. If not, we can at least acknowledge audio received.
  const userText = promptOverride ?? transcript ?? (audio ? "[audio received]" : null);
  if (!userText) return NextResponse.json({ error: "no input" }, { status: 400 });

  const prompt = `${SYSTEM_PROMPT}\n\nVision: ${observations ?? "none"}\n\nUser: ${userText}\n\nAssistant:`;

  if (!key) {
    // Mocked reply
    const reply = `I heard you. Based on what I see: ${observations ? observations : 'I don\'t have observations yet.'}`;
    return NextResponse.json({ reply });
  }

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta2/models/gemini-3-pro:predict`;

    // If expecting a name, ask the model to extract a name from the user's reply and return JSON
    if (expectingNameFor && transcript) {
      const extractPrompt = `${SYSTEM_PROMPT}\n\nYou have been asked to extract a person's name from the user's reply.\nUser reply: ${transcript}\n\nRespond ONLY with a JSON object with a single key \"name\" whose value is the detected full name (or empty string if none).`;
      const body = { prompt: { text: extractPrompt } };
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json({ error: txt }, { status: 502 });
      }
      const json = await res.json();
      const replyText = json?.candidates?.[0]?.content || json;
      let extractedName = "";
      try {
        const text = typeof replyText === "string" ? replyText : JSON.stringify(replyText);
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          extractedName = parsed.name || "";
        }
      } catch (e) {
        // fallback: try to use raw text as name
        extractedName = String(replyText).trim();
      }
      return NextResponse.json({ extractedName });
    }

    const body = {
      prompt: { text: prompt },
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: txt }, { status: 502 });
    }

    const json = await res.json();
    const replyText = json?.candidates?.[0]?.content || json?.output?.[0]?.content || JSON.stringify(json);
    // try to extract a plain text
    const text = typeof replyText === "string" ? replyText : JSON.stringify(replyText);
    return NextResponse.json({ reply: text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
