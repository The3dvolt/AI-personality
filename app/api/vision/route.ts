import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("frame") as unknown as Blob | null;
  if (!file) return NextResponse.json({ error: "no frame" }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const key = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  // If no key, return a mocked analysis
  if (!key) {
    const faceDetected = Math.random() > 0.4;
    const environment = faceDetected ? "office" : "living room";
    const objects = faceDetected ? ["laptop", "chair", "monitor"] : ["sofa", "coffee table", "lamp"];
    const faceHash = faceDetected ? `mockhash-${Math.floor(Math.random() * 10000)}` : undefined;
    return NextResponse.json({ faceDetected, environment, objects, faceHash });
  }

  try {
    // Call Google Cloud Vision API (REST) for face, label, and object detection
    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;
    const body = {
      requests: [
        {
          image: { content: buffer.toString("base64") },
          features: [
            { type: "FACE_DETECTION", maxResults: 5 },
            { type: "LABEL_DETECTION", maxResults: 10 },
            { type: "OBJECT_LOCALIZATION", maxResults: 10 },
          ],
        },
      ],
    };

    const res = await fetch(visionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: txt }, { status: 502 });
    }

    const json = await res.json();
    const resp = json.responses?.[0] || {};

    const faceAnnotations = resp.faceAnnotations || [];
    const labelAnnotations = resp.labelAnnotations || [];
    const localizedObjects = resp.localizedObjectAnnotations || [];

    const faceDetected = faceAnnotations.length > 0;
    let faceHash: string | undefined = undefined;
    if (faceDetected) {
      const first = faceAnnotations[0];
      const bbox = first.boundingPoly || first.fdBoundingPoly || {};
      const hash = crypto.createHash("sha256");
      hash.update(JSON.stringify(bbox));
      hash.update(buffer.slice(0, Math.min(buffer.length, 10240)));
      faceHash = hash.digest("hex");
    }

    const environment = labelAnnotations.slice(0, 5).map((l: any) => l.description).join(", ") || undefined;

    // Normalize localized objects and compute percentage bbox [ymin,xmin,ymax,xmax]
    const objects = (localizedObjects || []).map((o: any) => {
      // boundingPoly.normalizedVertices is an array of {x,y}
      const verts = o.boundingPoly?.normalizedVertices || o.boundingPoly?.vertices || [];
      const xs = verts.map((v: any) => v.x ?? 0);
      const ys = verts.map((v: any) => v.y ?? 0);
      const xmin = Math.min(...xs);
      const xmax = Math.max(...xs);
      const ymin = Math.min(...ys);
      const ymax = Math.max(...ys);
      return {
        name: o.name,
        score: o.score ?? o.confidence ?? 0,
        bbox: [ymin, xmin, ymax, xmax],
      };
    });

    // Ask Gemini for model details and a curious question for high-confidence objects
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    let curiousQuestion = undefined;
    let modelDetails: Record<string,string> = {};
    if (apiKey && objects.length > 0) {
      try {
        const summary = objects.map((o: any) => `${o.name} (score:${o.score}) bbox:${o.bbox.join(',')}`).join('\n');
        const prompt = `You are a Proactive Spatial Companion. I detected these objects:\n${summary}\n\nFor each object return a possible specific model/brand if you can (short), and propose a single friendly curious question to ask the user about the most interesting object. Respond in JSON: { objects: [{name,model}], curiousQuestion: string }`;
        const gUrl = `https://generativelanguage.googleapis.com/v1beta2/models/gemini-3-pro:predict`;
        const body2 = { prompt: { text: prompt } };
        const gres = await fetch(gUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type':'application/json' }, body: JSON.stringify(body2) });
        if (gres.ok) {
          const gj = await gres.json();
          const reply = gj?.candidates?.[0]?.content || gj;
          try {
            const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
            const m = text.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              curiousQuestion = parsed.curiousQuestion;
              if (parsed.objects) {
                for (const p of parsed.objects) modelDetails[p.name] = p.model;
              }
            }
          } catch(e) {}
        }
      } catch(e) {}
    }

    // attach model details into returned objects
    const objectsWithDetails = objects.map((o: any) => ({ ...o, model: modelDetails[o.name] || null }));

    // persist sightings briefly
      try {
        const db = await import('../../../lib/db');
        for (const o of objectsWithDetails) {
          try { db.saveObjectMemory(o.name, o.model || ''); } catch(e) {}
        }
      } catch(e) {}

    return NextResponse.json({ faceDetected, faceHash, environment, objects: objectsWithDetails, curiousQuestion, raw: resp });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

