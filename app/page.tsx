"use client";
import VideoPreview from "../components/VideoPreview";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-gray-900">
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-semibold mb-6">Dashboard</h1>
        <VideoPreview />
      </main>
    </div>
  );
}
