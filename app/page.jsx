'use client';

import { useState } from 'react';
import Image from 'next/image';

// ─── Style badge colors ───────────────────────────────────────────────────────
const STYLE_COLORS = {
  Coastal:        'bg-sky-100 text-sky-800',
  Glam:           'bg-purple-100 text-purple-800',
  'Organic Modern': 'bg-amber-100 text-amber-800',
  'Art Deco':     'bg-yellow-100 text-yellow-800',
  Farmhouse:      'bg-green-100 text-green-800',
  'French Country': 'bg-pink-100 text-pink-800',
  Industrial:     'bg-zinc-200 text-zinc-800',
  Modern:         'bg-blue-100 text-blue-800',
  Rustic:         'bg-orange-100 text-orange-800',
  Traditional:    'bg-red-100 text-red-800',
  Transitional:   'bg-teal-100 text-teal-800',
};

function badgeClass(style) {
  return STYLE_COLORS[style] ?? 'bg-stone-200 text-stone-700';
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────
function RoomCard({ room }) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [genError, setGenError] = useState(null);

  async function copyPrompt() {
    await navigator.clipboard.writeText(room.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function generateImage() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: room.prompt,
          products: room.products.map((p) => ({
            title: p.title,
            images: p.images,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      setGeneratedImage(data.imageUrl);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function downloadZip() {
    setDownloading(true);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          styleName: room.style,
          prompt: room.prompt,
          products: room.products.map((p) => ({
            title: p.title,
            images: p.images,
          })),
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${room.style.toLowerCase().replace(/\s+/g, '-')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden flex flex-col">
      {/* Generated image */}
      {generatedImage && (
        <div className="relative">
          <img
            src={generatedImage}
            alt={`Generated ${room.style} room scene`}
            className="w-full aspect-[4/3] object-cover"
          />
          <span className="absolute top-2 left-2 text-xs font-medium bg-violet-600 text-white px-2 py-0.5 rounded-full">
            AI Generated
          </span>
        </div>
      )}

      {/* Generating spinner */}
      {generating && (
        <div className="flex items-center justify-center gap-3 py-8 bg-violet-50">
          <svg className="animate-spin h-5 w-5 text-violet-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-violet-700 font-medium">Generating scene...</span>
        </div>
      )}

      {/* Generation error */}
      {genError && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {genError}
        </div>
      )}

      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
        <span className={`text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full ${badgeClass(room.style)}`}>
          {room.style}
        </span>
        <span className="text-xs text-stone-400">{room.combinationName}</span>
      </div>

      {/* Product images */}
      <div className="flex gap-3 p-5">
        {room.products.map((product) => (
          <div key={product.title} className="flex-1 flex flex-col items-center gap-2 min-w-0">
            <div className="w-full aspect-square rounded-xl overflow-hidden bg-stone-100 relative">
              {product.images[0] ? (
                <Image
                  src={product.images[0]}
                  alt={product.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 33vw, 200px"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-300 text-xs">
                  No image
                </div>
              )}
            </div>
            <p className="text-xs text-stone-600 text-center leading-tight line-clamp-2 w-full">
              {product.title}
            </p>
            {product.materials && (
              <p className="text-xs text-stone-400 text-center">{product.materials}</p>
            )}
          </div>
        ))}
      </div>

      {/* Prompt */}
      <div className="px-5 pb-2 flex-1">
        <label className="block text-xs font-medium text-stone-500 mb-1 uppercase tracking-wide">
          Higgsfield Prompt
        </label>
        <textarea
          readOnly
          value={room.prompt}
          className="w-full h-40 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-5 py-4">
        <button
          onClick={copyPrompt}
          className="flex-1 text-sm font-medium py-2 rounded-lg border border-stone-300 hover:bg-stone-100 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy Prompt'}
        </button>
        <button
          onClick={downloadZip}
          disabled={downloading}
          className="flex-1 text-sm font-medium py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {downloading ? 'Packaging...' : 'Download ZIP'}
        </button>
        <button
          onClick={generateImage}
          disabled={generating}
          className="flex-1 text-sm font-medium py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {generating ? 'Generating...' : generatedImage ? 'Regenerate' : 'Generate Image'}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Page() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setRooms([]);

    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setRooms(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          HTGT Room Ideas
        </h1>
        <p className="mt-2 text-stone-500 text-sm">
          Generates cohesive room vignettes from your Uttermost catalog — one per design style — with Higgsfield-ready prompts and reference images.
        </p>
      </div>

      {/* Generate button */}
      <div className="flex items-center gap-4 mb-10">
        <button
          onClick={generate}
          disabled={loading}
          className="px-6 py-3 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {loading ? 'Fetching rooms…' : rooms.length > 0 ? 'Regenerate Rooms' : 'Generate Rooms'}
        </button>

        {rooms.length > 0 && !loading && (
          <span className="text-sm text-stone-400">
            {rooms.length} room{rooms.length !== 1 ? 's' : ''} generated
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-stone-200 h-96 animate-pulse" />
          ))}
        </div>
      )}

      {/* Room cards */}
      {!loading && rooms.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {rooms.map((room) => (
            <RoomCard key={room.style} room={room} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && rooms.length === 0 && !error && (
        <div className="text-center py-24 text-stone-300">
          <p className="text-lg">Click Generate Rooms to get started</p>
        </div>
      )}
    </main>
  );
}
