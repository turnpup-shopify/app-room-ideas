'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

// ─── Style badge colors ───────────────────────────────────────────────────────
const STYLE_COLORS = {
  Coastal:          'bg-sky-100 text-sky-800',
  Glam:             'bg-purple-100 text-purple-800',
  'Organic Modern': 'bg-amber-100 text-amber-800',
  'Art Deco':       'bg-yellow-100 text-yellow-800',
  Farmhouse:        'bg-green-100 text-green-800',
  'French Country': 'bg-pink-100 text-pink-800',
  Industrial:       'bg-zinc-200 text-zinc-800',
  Modern:           'bg-blue-100 text-blue-800',
  Rustic:           'bg-orange-100 text-orange-800',
  Traditional:      'bg-red-100 text-red-800',
  Transitional:     'bg-teal-100 text-teal-800',
};

function badgeClass(style) {
  return STYLE_COLORS[style] ?? 'bg-stone-200 text-stone-700';
}

// ─── Scene field definitions ─────────────────────────────────────────────────
// Keep in sync with SCENE_FIELDS in lib/promptBuilder.js
const SCENE_FIELDS = [
  { key: 'room_type',                   label: 'Room Type',        multiline: false },
  { key: 'room_details',                label: 'Room Details',     multiline: true  },
  { key: 'furniture_types',             label: 'Furniture Types',  multiline: false },
  { key: 'style_tags',                  label: 'Style Tags',       multiline: false },
  { key: 'materials',                   label: 'Materials',        multiline: false },
  { key: 'lighting',                    label: 'Lighting',         multiline: false },
  { key: 'camera',                      label: 'Camera',           multiline: false },
  { key: 'color_grade',                 label: 'Color Grade',      multiline: false },
  { key: 'hero_object_placement_logic', label: 'Placement Logic',  multiline: true  },
  { key: 'negative_styling_rules',      label: 'Avoid',            multiline: true  },
  { key: 'realism_constraints',         label: 'Realism',          multiline: true  },
];

// ─── Client-side prompt assembly ─────────────────────────────────────────────
// Mirrors assemblePrompt() in lib/promptBuilder.js.
// When a scene field is edited, this rebuilds the prompt textarea live.
// Keep in sync with the server-side version if you change the structure.
const PRODUCT_FIDELITY_INSTRUCTION =
  'Product fidelity (critical): Every featured product must be reproduced exactly as shown in the reference images. ' +
  'Do not alter the color, finish, material, texture, shape, silhouette, scale, or proportions of any product under any circumstances. ' +
  'Do not reinterpret, stylize, or adapt the products to match the scene — the scene must be built around the products as they are. ' +
  'Dimensional accuracy: When dimensions are given (e.g. 10W x 10D x 22H), the rendered product must match those proportions exactly — ' +
  'a narrow, delicate table must stay narrow and delicate, not become wider, chunkier, or more substantial. ' +
  'Preserve the exact thickness of table tops, the slenderness of legs and bases, and the overall visual weight of each piece.';

function assemblePromptFromScene(scene, itemList) {
  const parts = [];
  if (scene.room_type && scene.room_details) {
    let sceneDesc = `${scene.room_type} scene: ${scene.room_details}`;
    if (scene.accessories) {
      sceneDesc += ` ${scene.accessories}`;
    }
    parts.push(sceneDesc);
  }
  parts.push(`Featured products: a ${itemList}.`);
  parts.push(PRODUCT_FIDELITY_INSTRUCTION);
  if (scene.materials)                   parts.push(`Materials: ${scene.materials}.`);
  if (scene.lighting)                    parts.push(`Lighting: ${scene.lighting}.`);
  if (scene.camera)                      parts.push(`Camera: ${scene.camera}.`);
  if (scene.color_grade)                 parts.push(`Color grade: ${scene.color_grade}.`);
  if (scene.hero_object_placement_logic) parts.push(`Placement: ${scene.hero_object_placement_logic}.`);
  if (scene.negative_styling_rules)      parts.push(`Avoid: ${scene.negative_styling_rules}.`);
  if (scene.realism_constraints)         parts.push(`Realism: ${scene.realism_constraints}.`);
  return parts.join('\n\n');
}

// ─── Client-side product description helpers ──────────────────────────────────
// Mirrors describeProduct / formatItemList in lib/promptBuilder.js.
// Used to rebuild the item list when the user toggles products on/off.
function describeProduct(product) {
  const type = product.productType?.toLowerCase() || 'piece';
  const singular = type.replace(/s$/i, '');
  const material = product.materials?.toLowerCase();
  let desc = material
    ? `${material.split(/[\s,/&]+/).filter(Boolean)[0]} ${singular}`
    : singular;
  if (product.dimensions) {
    desc += ` (${product.dimensions})`;
  }
  return desc;
}

function buildItemList(products, selectedIds) {
  const selected = products.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) return '';
  const items = selected.map(describeProduct);
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ─── Pinterest mode icon ──────────────────────────────────────────────────────
function PinterestIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
    </svg>
  );
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────
function RoomCard({ room, mode, combinationNames = [], accessoriesList = [], featuredProductHandles = [] }) {
  const [prompt, setPrompt] = useState(room.prompt);
  const [scene, setScene] = useState(room.scene);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [allScenes, setAllScenes] = useState(null);
  const [products, setProducts] = useState(room.products);
  const [combinationName, setCombinationName] = useState(room.combinationName);
  const [reshuffling, setReshuffling] = useState(false);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [accessoryPickerOpen, setAccessoryPickerOpen] = useState(false);
  const [accessorySelection, setAccessorySelection] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // 'ok' | { error: string }
  // Per-slot alternative index: -1 = original product, 0+ = index into alternatives array
  const [activeAlts, setActiveAlts] = useState(() => new Map());
  const [selectedIds, setSelectedIds] = useState(() => new Set(room.products.map((p) => p.id)));

  // Derive the currently-displayed product per slot
  const activeProducts = products.map((original, i) => {
    const altIdx = activeAlts.get(i) ?? -1;
    if (altIdx < 0 || !original.alternatives?.length) return original;
    return original.alternatives[altIdx] || original;
  });

  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [genError, setGenError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [linkWarning, setLinkWarning] = useState(null); // non-null = back-link errors
  // Pinterest version (2:3) — used both by Pinterest mode and the standard-mode secondary button
  const [pinImage, setPinImage] = useState(null);
  const [generatingPin, setGeneratingPin] = useState(false);
  const [pinGenError, setPinGenError] = useState(null);
  const [savingPin, setSavingPin] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState(null);

  const isPinterest = mode === 'pinterest';

  const promptEdited = prompt !== room.prompt;

  // Toggle a product in/out of the scene; rebuild itemList and prompt.
  function toggleProduct(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      if (next.size <= 1) return; // always keep at least one
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
    const newItemList = buildItemList(activeProducts, next);
    if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));
  }

  // Cycle to a different alternative for a slot
  function cycleSlot(slotIndex, direction) {
    const original = products[slotIndex];
    const alts = original.alternatives || [];
    const totalOptions = 1 + alts.length; // original + alternatives
    if (totalOptions <= 1) return;

    const currentAlt = activeAlts.get(slotIndex) ?? -1;
    // Map -1 (original) to index 0, alt[0] to 1, etc.
    const currentPos = currentAlt + 1;
    const nextPos = (currentPos + direction + totalOptions) % totalOptions;
    const nextAlt = nextPos - 1; // back to -1 for original

    const oldProduct = activeProducts[slotIndex];
    const newProduct = nextAlt < 0 ? original : alts[nextAlt];

    // Update activeAlts
    const nextAlts = new Map(activeAlts);
    nextAlts.set(slotIndex, nextAlt);
    setActiveAlts(nextAlts);

    // Update selectedIds: swap old → new, preserving selected state of this slot
    const wasSelected = selectedIds.has(oldProduct.id);
    if (wasSelected) {
      const next = new Set(selectedIds);
      next.delete(oldProduct.id);
      next.add(newProduct.id);
      setSelectedIds(next);

      // Rebuild active products with the swap applied for prompt rebuild
      const updatedProducts = activeProducts.map((p, i) =>
        i === slotIndex ? newProduct : p
      );
      const newItemList = buildItemList(updatedProducts, next);
      if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));
    }
  }

  // Update a single scene field, then re-assemble the prompt live.
  function updateSceneField(key, value) {
    const newScene = { ...scene, [key]: value };
    setScene(newScene);
    const currentItemList = buildItemList(activeProducts, selectedIds);
    if (currentItemList) {
      setPrompt(assemblePromptFromScene(newScene, currentItemList));
    } else if (room.itemList) {
      setPrompt(assemblePromptFromScene(newScene, room.itemList));
    }
  }

  // Fetch all scene templates (lazy — first time scene breakdown opens or randomize is clicked)
  async function ensureAllScenes() {
    if (allScenes) return allScenes;
    try {
      const res = await fetch('/api/scenes');
      const data = await res.json();
      setAllScenes(data);
      return data;
    } catch {
      return null;
    }
  }

  // Randomize a single scene field from a random scene template
  async function randomizeField(key) {
    const scenes = await ensureAllScenes();
    if (!scenes || scenes.length === 0) return;
    // Collect non-empty values for this field (excluding current value)
    const candidates = scenes
      .map((s) => s[key])
      .filter((v) => v && v !== scene[key]);
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    updateSceneField(key, pick);
  }

  async function reshuffle(targetRoomType) {
    setReshuffling(true);
    try {
      const body = {
        style: room.style,
        productCount: products.length,
      };
      if (targetRoomType) body.roomType = targetRoomType;
      const activeHandles = featuredProductHandles.filter(h => h.trim());
      if (activeHandles.length > 0) body.featuredProductHandles = activeHandles;
      const res = await fetch('/api/rooms/reshuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reshuffle failed');

      setProducts(data.products);
      setCombinationName(data.combinationName);
      setActiveAlts(new Map());
      const newSelected = new Set(data.products.map((p) => p.id));
      setSelectedIds(newSelected);

      const newItemList = buildItemList(data.products, newSelected);
      if (newItemList) setPrompt(assemblePromptFromScene(scene, newItemList));

      setGeneratedImage(null);
      setPublished(false);
      setPublishError(null);
      setLinkWarning(null);
      setPinImage(null);
      setPinSaved(false);
    } catch (err) {
      console.error('Reshuffle failed:', err.message);
    } finally {
      setReshuffling(false);
    }
  }

  function resetAll() {
    setProducts(room.products);
    setCombinationName(room.combinationName);
    setPrompt(room.prompt);
    setScene(room.scene);
    setSyncStatus(null);
    setActiveAlts(new Map());
    setSelectedIds(new Set(room.products.map((p) => p.id)));
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function generateImage() {
    setGenerating(true);
    setGenError(null);
    setPinSaved(false);
    setPinError(null);
    try {
      const selectedProducts = activeProducts.filter((p) => selectedIds.has(p.id));
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          products: selectedProducts.map((p) => ({ title: p.title, images: p.images })),
          aspectRatio: isPinterest ? '2:3' : undefined,
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

  async function generatePinVersion() {
    setGeneratingPin(true);
    setPinGenError(null);
    setPinSaved(false);
    setPinError(null);
    try {
      const selectedProducts = activeProducts.filter((p) => selectedIds.has(p.id));
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          products: selectedProducts.map((p) => ({ title: p.title, images: p.images })),
          aspectRatio: '2:3',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      setPinImage(data.imageUrl);
    } catch (err) {
      setPinGenError(err.message);
    } finally {
      setGeneratingPin(false);
    }
  }

  async function publishToStore() {
    setPublishing(true);
    setPublishError(null);
    setLinkWarning(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: generatedImage,
          roomName: `${room.style} ${combinationName}`,
          style: room.style,
          scene,
          products: activeProducts
            .filter((p) => selectedIds.has(p.id))
            .map((p) => ({ id: p.id, title: p.title, materials: p.materials })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Publish failed');
      setPublished(true);
      if (data.linkResult?.errors?.length > 0) {
        setLinkWarning(`Room published, but product back-links failed: ${data.linkResult.errors.join(' | ')}`);
      }
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
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
          prompt,
          products: activeProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({ title: p.title, images: p.images })),
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

  async function savePin(imageUrl) {
    if (!imageUrl || savingPin || pinSaved) return;
    setSavingPin(true);
    setPinError(null);
    try {
      const filename = `${room.style}-${combinationName}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') + `-${Date.now()}`;
      const res = await fetch('/api/save-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setPinSaved(true);
    } catch (err) {
      setPinError(err.message);
    } finally {
      setSavingPin(false);
    }
  }

  async function syncToSheet() {
    if (!scene || typeof scene.rowIndex !== 'number') return;
    setSyncing(true);
    setSyncStatus(null);
    try {
      const { rowIndex, ...fields } = scene;
      const res = await fetch('/api/sync-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, scene: fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setSyncStatus('ok');
    } catch (err) {
      setSyncStatus({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden flex flex-col">
      {/* Generated image */}
      {generatedImage && (
        <div className="relative group">
          <img
            src={generatedImage}
            alt={`Generated ${room.style} room scene`}
            className="w-full aspect-square object-cover"
          />
          <span className="absolute top-2 left-2 text-xs font-medium bg-violet-600 text-white px-2 py-0.5 rounded-full">
            AI Generated
          </span>
          <button
            onClick={async () => {
              try {
                const res = await fetch(generatedImage);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${room.style}-${combinationName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                window.open(generatedImage, '_blank');
              }
            }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Save image"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
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

      {genError && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {genError}
        </div>
      )}
      {publishError && !isPinterest && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {publishError}
        </div>
      )}

      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
        <span className={`text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full ${badgeClass(room.style)}`}>
          {room.style}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">Combo:</span>
          {combinationNames.length > 1 && (
            <button
              onClick={() => {
                const idx = combinationNames.indexOf(combinationName);
                const prev = combinationNames[(idx - 1 + combinationNames.length) % combinationNames.length];
                reshuffle(prev);
              }}
              disabled={reshuffling}
              className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 disabled:opacity-50"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setComboPickerOpen(true)}
            disabled={reshuffling}
            className="text-xs text-stone-500 hover:text-stone-700 px-1 hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {reshuffling ? 'Loading…' : combinationName}
          </button>
          {combinationNames.length > 1 && (
            <button
              onClick={() => {
                const idx = combinationNames.indexOf(combinationName);
                const next = combinationNames[(idx + 1) % combinationNames.length];
                reshuffle(next);
              }}
              disabled={reshuffling}
              className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500 disabled:opacity-50"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Combination picker modal */}
      {comboPickerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setComboPickerOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setComboPickerOpen(false)}>
            <div
              className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-sm max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">Choose Combination</h3>
                <button
                  onClick={() => setComboPickerOpen(false)}
                  className="text-stone-400 hover:text-stone-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto py-2">
                {combinationNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      setComboPickerOpen(false);
                      if (name !== combinationName) reshuffle(name);
                    }}
                    className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${
                      name === combinationName
                        ? 'bg-stone-100 text-stone-900 font-medium'
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Product images — click to toggle inclusion in the scene */}
      <div className="flex gap-3 p-5">
        {activeProducts.map((product, slotIdx) => {
          const original = products[slotIdx];
          const alts = original.alternatives || [];
          const totalOptions = 1 + alts.length;
          const hasAlts = totalOptions > 1;
          const currentPos = (activeAlts.get(slotIdx) ?? -1) + 1; // 0 = original
          const selected = selectedIds.has(product.id);
          return (
            <div
              key={`slot-${slotIdx}`}
              className={`flex-1 flex flex-col items-center gap-2 min-w-0 select-none transition-opacity ${
                selected ? 'opacity-100' : 'opacity-35'
              }`}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden bg-stone-100 relative">
                <div
                  onClick={() => toggleProduct(product.id)}
                  title={selected ? 'Click to remove from scene' : 'Click to add to scene'}
                  className="cursor-pointer w-full h-full"
                >
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
                <span
                  className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm ${
                    selected ? 'bg-green-500' : 'bg-stone-500'
                  }`}
                >
                  {selected ? '\u2713' : '\u00d7'}
                </span>
                {/* Arrow navigation */}
                {hasAlts && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); cycleSlot(slotIdx, -1); }}
                      className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-stone-600 text-xs"
                      title="Previous alternative"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); cycleSlot(slotIdx, 1); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-stone-600 text-xs"
                      title="Next alternative"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-stone-600 text-center leading-tight line-clamp-2 w-full">
                {product.title}
              </p>
              {product.materials && (
                <p className="text-xs text-stone-400 text-center">{product.materials}</p>
              )}
              {hasAlts && (
                <p className="text-xs text-stone-400">{currentPos + 1}/{totalOptions}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Product combination panel */}
      <div className="mx-5 mb-3 border border-stone-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setProductsOpen((o) => !o)}
          className="flex items-center justify-between w-full px-4 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
        >
          <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
            Products ({activeProducts.filter((p) => selectedIds.has(p.id)).length}/{activeProducts.length})
          </span>
          <svg
            className={`w-3.5 h-3.5 text-stone-400 transition-transform ${productsOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {productsOpen && (
          <div className="border-t border-stone-200">
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-stone-100">
              <button
                type="button"
                onClick={() => {
                  const nextAlts = new Map();
                  const nextSelected = new Set();
                  products.forEach((original, slotIdx) => {
                    const alts = original.alternatives || [];
                    const totalOptions = 1 + alts.length;
                    // Pick a random option for this slot
                    const pick = Math.floor(Math.random() * totalOptions) - 1; // -1 = original
                    nextAlts.set(slotIdx, pick);
                    const product = pick < 0 ? original : (alts[pick] || original);
                    nextSelected.add(product.id);
                  });
                  setActiveAlts(nextAlts);
                  setSelectedIds(nextSelected);
                }}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle Products
              </button>
            </div>
            <div className="divide-y divide-stone-100">
            {activeProducts.map((product, slotIdx) => {
              const original = products[slotIdx];
              const alts = original.alternatives || [];
              const totalOptions = 1 + alts.length;
              const hasAlts = totalOptions > 1;
              const currentPos = (activeAlts.get(slotIdx) ?? -1) + 1;
              const selected = selectedIds.has(product.id);
              return (
                <div
                  key={`prod-panel-${slotIdx}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-opacity ${selected ? 'opacity-100' : 'opacity-40'}`}
                >
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0 relative">
                    {product.images[0] ? (
                      <Image
                        src={product.images[0]}
                        alt={product.title}
                        fill
                        className="object-cover"
                        sizes="40px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-300 text-[8px]">N/A</div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-stone-700 truncate">{product.title}</p>
                    <p className="text-[10px] text-stone-400 truncate">
                      {product.productType}
                      {product.materials ? ` · ${product.materials}` : ''}
                    </p>
                  </div>

                  {/* Alt cycling */}
                  {hasAlts && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => cycleSlot(slotIdx, -1)}
                        className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="text-[10px] text-stone-400 w-7 text-center">{currentPos + 1}/{totalOptions}</span>
                      <button
                        onClick={() => cycleSlot(slotIdx, 1)}
                        className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Toggle inclusion */}
                  <button
                    onClick={() => toggleProduct(product.id)}
                    className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                      selected ? 'bg-green-500 hover:bg-red-400' : 'bg-stone-300 hover:bg-green-400'
                    } transition-colors`}
                    title={selected ? 'Remove from scene' : 'Add to scene'}
                  >
                    {selected ? '\u2713' : '+'}
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>

      {/* Prompt */}
      <div className="px-5 pb-2 flex-1">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
            Higgsfield Prompt
          </label>
          {promptEdited && (
            <button
              onClick={resetAll}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-40 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
        />
      </div>

      {/* Scene breakdown (only shown when CSV data is available) */}
      {room.scene && (
        <div className="mx-5 mb-3 border border-stone-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setSceneOpen((o) => !o)}
            className="flex items-center justify-between w-full px-4 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
          >
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Scene Breakdown
            </span>
            <svg
              className={`w-3.5 h-3.5 text-stone-400 transition-transform ${sceneOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {sceneOpen && scene && (
            <div className="p-4 space-y-3 border-t border-stone-200">
              <button
                type="button"
                onClick={async () => {
                  const scenes = await ensureAllScenes();
                  if (!scenes || scenes.length === 0) return;
                  const newScene = { ...scene };
                  for (const { key } of SCENE_FIELDS) {
                    const candidates = scenes.map((s) => s[key]).filter(Boolean);
                    if (candidates.length > 0) {
                      newScene[key] = candidates[Math.floor(Math.random() * candidates.length)];
                    }
                  }
                  setScene(newScene);
                  const currentItemList = buildItemList(activeProducts, selectedIds);
                  if (currentItemList) {
                    setPrompt(assemblePromptFromScene(newScene, currentItemList));
                  } else if (room.itemList) {
                    setPrompt(assemblePromptFromScene(newScene, room.itemList));
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle All Fields
              </button>
              {SCENE_FIELDS.map(({ key, label, multiline }) => (
                <div key={key}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="text-xs font-medium text-stone-400">
                      {label}
                    </label>
                    <button
                      type="button"
                      onClick={() => randomizeField(key)}
                      title={`Randomize ${label}`}
                      className="p-0.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                  {multiline ? (
                    <textarea
                      value={scene[key] || ''}
                      onChange={(e) => updateSceneField(key, e.target.value)}
                      rows={2}
                      className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
                    />
                  ) : (
                    <input
                      type="text"
                      value={scene[key] || ''}
                      onChange={(e) => updateSceneField(key, e.target.value)}
                      className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono"
                    />
                  )}
                </div>
              ))}

              {/* Accessories — sourced from config, picker + editable textarea */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-medium text-stone-400">
                    Accessories
                  </label>
                  {accessoriesList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        // Pre-select accessories that match current text
                        const current = scene.accessories || '';
                        const sel = new Set();
                        accessoriesList.forEach((item, i) => {
                          if (current.includes(item)) sel.add(i);
                        });
                        setAccessorySelection(sel);
                        setAccessoryPickerOpen(true);
                      }}
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition-colors"
                    >
                      Choose
                    </button>
                  )}
                </div>
                <textarea
                  value={scene.accessories || ''}
                  onChange={(e) => updateSceneField('accessories', e.target.value)}
                  rows={2}
                  placeholder="e.g. A white Porsche GT3 is visible through the windows. Assouline travel books sit on the coffee table."
                  className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-stone-300 font-mono leading-relaxed"
                />
              </div>

              {/* Accessories picker modal */}
              {accessoryPickerOpen && (
                <>
                  <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setAccessoryPickerOpen(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAccessoryPickerOpen(false)}>
                    <div
                      className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md max-h-[70vh] flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                        <h3 className="text-sm font-semibold text-stone-800">Choose Accessories</h3>
                        <button
                          onClick={() => setAccessoryPickerOpen(false)}
                          className="text-stone-400 hover:text-stone-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="overflow-y-auto py-2 flex-1">
                        {accessoriesList.map((item, i) => {
                          const checked = accessorySelection.has(i);
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                const next = new Set(accessorySelection);
                                if (checked) next.delete(i); else next.add(i);
                                setAccessorySelection(next);
                              }}
                              className={`w-full text-left px-5 py-3 text-xs font-mono leading-relaxed transition-colors flex items-start gap-3 ${
                                checked ? 'bg-stone-100' : 'hover:bg-stone-50'
                              }`}
                            >
                              <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                                checked ? 'bg-stone-800 border-stone-800 text-white' : 'border-stone-300'
                              }`}>
                                {checked && (
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                              <span className="text-stone-600">{item}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="px-5 py-4 border-t border-stone-100 flex items-center justify-between gap-3">
                        <span className="text-xs text-stone-400">
                          {accessorySelection.size} selected
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAccessoryPickerOpen(false)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const selected = accessoriesList.filter((_, i) => accessorySelection.has(i));
                              updateSceneField('accessories', selected.join(' '));
                              setAccessoryPickerOpen(false);
                            }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Sync to sheet */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={syncToSheet}
                  disabled={syncing}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  {syncing ? 'Syncing…' : 'Sync to Sheet'}
                </button>
                {syncStatus === 'ok' && (
                  <span className="text-xs text-green-600">Saved to sheet</span>
                )}
                {syncStatus?.error && (
                  <span className="text-xs text-red-600 truncate" title={syncStatus.error}>
                    {syncStatus.error}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Post-generate actions */}
      {generatedImage && (
        <div className="px-5 pb-4 flex flex-col gap-2">
          {isPinterest ? (
            <>
              {/* Save to Downloads */}
              {pinError && (
                <p className="text-xs text-red-600">{pinError}</p>
              )}
              <button
                onClick={() => savePin(generatedImage)}
                disabled={savingPin || pinSaved}
                className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                  pinSaved
                    ? 'bg-green-100 text-green-800 cursor-default'
                    : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                }`}
              >
                {pinSaved ? 'Saved to Downloads' : savingPin ? 'Saving…' : 'Save to Downloads'}
              </button>
              {/* Pinterest — coming soon */}
              <button
                disabled
                title="Pinterest API keys not configured yet"
                className="w-full text-sm font-medium py-2 rounded-lg bg-rose-50 text-rose-400 border border-rose-200 cursor-not-allowed flex items-center justify-center gap-2"
              >
                <PinterestIcon className="w-4 h-4" />
                Publish to Pinterest (coming soon)
              </button>
            </>
          ) : (
            <>
              {/* Publish to Shopify */}
              {publishError && (
                <p className="text-xs text-red-600">{publishError}</p>
              )}
              {linkWarning && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{linkWarning}</p>
              )}
              <button
                onClick={publishToStore}
                disabled={publishing || published}
                className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                  published
                    ? 'bg-green-100 text-green-800 cursor-default'
                    : 'bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-wait'
                }`}
              >
                {published ? 'Published' : publishing ? 'Publishing...' : 'Publish to Store'}
              </button>

              {/* Pinterest 2:3 version */}
              <div className="pt-2 border-t border-stone-100">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <PinterestIcon className="w-3 h-3" />
                  Pinterest version (2:3)
                </p>

                {/* 2:3 image preview */}
                {pinImage && (
                  <div className="mb-2 rounded-lg overflow-hidden" style={{ aspectRatio: '2/3' }}>
                    <img src={pinImage} alt="Pinterest 2:3 version" className="w-full h-full object-cover" />
                  </div>
                )}

                {/* Generating spinner */}
                {generatingPin && (
                  <div className="flex items-center justify-center gap-2 py-3 bg-rose-50 rounded-lg mb-2">
                    <svg className="animate-spin h-4 w-4 text-rose-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-rose-600">Generating 2:3…</span>
                  </div>
                )}
                {pinGenError && <p className="text-xs text-red-600 mb-2">{pinGenError}</p>}

                <div className="flex gap-2">
                  <button
                    onClick={generatePinVersion}
                    disabled={generatingPin}
                    className="flex-1 text-sm font-medium py-2 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-wait transition-colors flex items-center justify-center gap-1.5"
                  >
                    <PinterestIcon className="w-3.5 h-3.5" />
                    {generatingPin ? 'Generating…' : pinImage ? 'Regenerate 2:3' : 'Create 2:3'}
                  </button>

                  {pinImage && (
                    <>
                      <button
                        onClick={() => savePin(pinImage)}
                        disabled={savingPin || pinSaved}
                        className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
                          pinSaved
                            ? 'bg-green-100 text-green-800 cursor-default'
                            : 'bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {pinSaved ? 'Saved' : savingPin ? 'Saving…' : 'Save Pin'}
                      </button>
                      {pinError && <p className="text-xs text-red-600">{pinError}</p>}
                      <button
                        disabled
                        title="Pinterest API keys not configured yet"
                        className="flex-1 text-sm font-medium py-2 rounded-lg bg-rose-50 text-rose-400 border border-rose-200 cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        <PinterestIcon className="w-3.5 h-3.5" />
                        Post
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter select / input shared styles ──────────────────────────────────────
const selectClass =
  'text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400';
const inputClass =
  'text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-48';

// ─── Product search picker ────────────────────────────────────────────────────
function ProductSearchPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchProducts = useCallback(async (q) => {
    setLoading(true);
    try {
      const url = q ? `/api/products/search?q=${encodeURIComponent(q)}` : '/api/products/search';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setHighlightIdx(-1);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open, fetchProducts]);

  // Click-outside to close
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightIdx];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  function handleOpen() {
    if (!open) {
      setOpen(true);
      setQuery('');
      setHighlightIdx(-1);
      fetchProducts('');
    }
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && results[highlightIdx]) {
      e.preventDefault();
      select(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  function select(product) {
    onChange(product);
    setQuery('');
    setOpen(false);
  }

  function clear(e) {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    // Focus the input after clearing so user can immediately search again
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-2 text-sm text-stone-700 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 h-[38px]">
          {value.thumbnail && (
            <img src={value.thumbnail + '&width=48'} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
          )}
          <span className="truncate max-w-[180px] font-medium">{value.title}</span>
          {value.productType && (
            <span className="text-xs text-amber-500 truncate max-w-[80px] hidden sm:inline">{value.productType}</span>
          )}
          <button onClick={clear} className="text-amber-400 hover:text-amber-700 ml-0.5 leading-none text-base shrink-0" title="Remove product">&times;</button>
        </div>
      ) : (
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleOpen}
            onKeyDown={handleKeyDown}
            placeholder="Pin a product…"
            className="text-sm text-stone-700 bg-white border border-stone-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-48"
          />
        </div>
      )}

      {open && !value && (
        <div ref={listRef} className="absolute top-full left-0 mt-1 w-80 max-h-72 overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-lg z-30">
          {loading && results.length === 0 && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">Loading…</div>
          )}
          {loading && results.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-stone-300 text-center bg-stone-50 border-b border-stone-100 sticky top-0">Updating…</div>
          )}
          {!loading && results.length === 0 && query && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">No products match &ldquo;{query}&rdquo;</div>
          )}
          {!loading && results.length === 0 && !query && (
            <div className="px-3 py-4 text-xs text-stone-400 text-center">No products found</div>
          )}
          {results.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`flex items-center gap-3 w-full px-3 py-2 transition-colors text-left ${
                idx === highlightIdx ? 'bg-stone-100' : 'hover:bg-stone-50'
              }`}
            >
              {p.thumbnail ? (
                <img src={p.thumbnail + '&width=64'} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-stone-100 shrink-0 flex items-center justify-center">
                  <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-700 truncate">{p.title}</div>
                {p.productType && (
                  <div className="text-xs text-stone-400 truncate">{p.productType}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tag chip input ───────────────────────────────────────────────────────────
function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('');

  function add() {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  }

  function remove(tag) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-stone-50 border border-stone-200 rounded-lg min-h-[38px]">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-stone-200 text-stone-700 text-xs rounded-md">
          {tag}
          <button onClick={() => remove(tag)} className="text-stone-400 hover:text-stone-700 leading-none">&times;</button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-stone-700 outline-none placeholder:text-stone-400"
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Page() {
  const [mode, setMode] = useState('standard'); // 'standard' | 'fantasy' | 'pinterest'
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [styleOptions, setStyleOptions] = useState([]);
  const [roomTypeOptions, setRoomTypeOptions] = useState([]);
  const [combinationNames, setCombinationNames] = useState([]);
  const [accessoriesList, setAccessoriesList] = useState([]);
  const [roomNameOptions, setRoomNameOptions] = useState([]);
  const [filters, setFilters] = useState({
    designStyle: '',
    roomType: '',
    roomName: '',
    lighting: '',
    camera: '',
    count: '',
    productCount: 3,
    featuredProducts: ['', '', ''],
    pickedProduct: null,
  });

  // ── Hamburger menu ──────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [criteria, setCriteria] = useState(null);   // null = not yet loaded
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [criteriaSaved, setCriteriaSaved] = useState(false);
  const [criteriaError, setCriteriaError] = useState(null);
  const [accessoriesOpen, setAccessoriesOpen] = useState(false);
  const [accessoriesInput, setAccessoriesInput] = useState('');
  const [accessoriesSaving, setAccessoriesSaving] = useState(false);
  const [accessoriesSaved, setAccessoriesSaved] = useState(false);
  const [accessoriesError, setAccessoriesError] = useState(null);

  async function openMenu() {
    setMenuOpen(true);
    if (!criteria) {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        setCriteria(data);
      } catch {
        setCriteria({ includeVendors: [], excludeTags: [], requireInventory: true, maxImagesPerProduct: 3 });
      }
    }
  }

  async function saveCriteria() {
    setCriteriaSaving(true);
    setCriteriaSaved(false);
    setCriteriaError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setCriteria(data);
      setCriteriaSaved(true);
      setTimeout(() => setCriteriaSaved(false), 2500);
    } catch (err) {
      setCriteriaError(err.message);
    } finally {
      setCriteriaSaving(false);
    }
  }

  async function saveAccessories() {
    setAccessoriesSaving(true);
    setAccessoriesSaved(false);
    setAccessoriesError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessories: criteria.accessories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setCriteria((c) => ({ ...c, accessories: data.accessories }));
      setAccessoriesSaved(true);
      setTimeout(() => setAccessoriesSaved(false), 2500);
    } catch (err) {
      setAccessoriesError(err.message);
    } finally {
      setAccessoriesSaving(false);
    }
  }

  useEffect(() => {
    fetch('/api/options')
      .then((r) => r.json())
      .then((data) => {
        setStyleOptions(data.styles ?? []);
        setRoomTypeOptions(data.roomTypes ?? []);
        setRoomNameOptions(data.roomNames ?? []);
        setCombinationNames(data.combinationNames ?? []);
        setAccessoriesList(data.accessoriesList ?? []);
      })
      .catch(() => {});
  }, []);

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function clearFilters() {
    setFilters({ designStyle: '', roomType: '', roomName: '', lighting: '', camera: '', count: '', productCount: 3, featuredProducts: ['', '', ''], pickedProduct: null });
  }

  const hasActiveFilters =
    !!(filters.designStyle || filters.roomType || filters.roomName || filters.lighting || filters.camera || filters.count || filters.pickedProduct || filters.featuredProducts.some(h => h)) ||
    filters.productCount !== 3;

  async function generate() {
    setLoading(true);
    setError(null);
    setRooms([]);

    const activeFilters = Object.fromEntries(
      Object.entries(filters).filter(([k, v]) => {
        if (k === 'featuredProducts') return false; // handled below
        return String(v).trim();
      })
    );
    const nonEmptyHandles = filters.featuredProducts.filter(h => h.trim());
    if (filters.pickedProduct) nonEmptyHandles.push(filters.pickedProduct.handle);
    if (nonEmptyHandles.length > 0) activeFilters.featuredProducts = nonEmptyHandles;
    if (mode !== 'standard') activeFilters.mode = mode;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: activeFilters }),
      });
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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
            HTGT Room Ideas
          </h1>
          <p className="mt-2 text-stone-500 text-sm">
            Generates cohesive room vignettes from your Uttermost catalog — one per design style — with Higgsfield-ready prompts and reference images.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode toggle */}
          <button
            onClick={() => setMode((m) => m === 'standard' ? 'fantasy' : m === 'fantasy' ? 'pinterest' : 'standard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              mode === 'pinterest'
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : mode === 'fantasy'
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {mode === 'pinterest' ? (
              <PinterestIcon className="w-4 h-4" />
            ) : mode === 'fantasy' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            ) : null}
            {mode === 'pinterest' ? 'Pinterest Mode' : mode === 'fantasy' ? 'Fantasy Mode' : 'Standard Mode'}
          </button>

          {/* Hamburger menu */}
          <div className="relative">
            <button
              onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
              className="flex flex-col justify-center items-center w-9 h-9 rounded-lg bg-stone-100 hover:bg-stone-200 transition-colors gap-1"
              aria-label="Menu"
            >
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
              <span className="block w-4 h-0.5 bg-stone-600 rounded-full" />
            </button>

            {menuOpen && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />

                {/* Dropdown */}
                <div className="absolute right-0 top-11 z-20 w-80 bg-white rounded-2xl shadow-lg border border-stone-200 overflow-hidden">
                  {/* Criteria row */}
                  <button
                    onClick={() => setCriteriaOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                  >
                    <span className="text-sm font-medium text-stone-700">Query Criteria</span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${criteriaOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Criteria panel */}
                  {criteriaOpen && criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-4">
                      <p className="text-xs text-stone-400">
                        Controls which Shopify products are pulled when building rooms. Changes take effect on the next Generate.
                      </p>

                      {/* Vendors */}
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Include vendors
                        </label>
                        <TagInput
                          tags={criteria.includeVendors ?? []}
                          onChange={(v) => setCriteria((c) => ({ ...c, includeVendors: v }))}
                          placeholder="Type vendor name, press Enter…"
                        />
                        <p className="text-xs text-stone-400 mt-1">Leave empty to include all vendors.</p>
                      </div>

                      {/* Excluded tags */}
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1.5">
                          Exclude tags
                        </label>
                        <TagInput
                          tags={criteria.excludeTags ?? []}
                          onChange={(v) => setCriteria((c) => ({ ...c, excludeTags: v }))}
                          placeholder="Type tag, press Enter…"
                        />
                      </div>

                      {/* Require inventory */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-stone-500">Require inventory</p>
                          <p className="text-xs text-stone-400">Skip products with zero stock</p>
                        </div>
                        <button
                          onClick={() => setCriteria((c) => ({ ...c, requireInventory: !c.requireInventory }))}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                            criteria.requireInventory ? 'bg-stone-800' : 'bg-stone-300'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
                            criteria.requireInventory ? 'translate-x-4' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>

                      {/* Max images */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-stone-500">Max images per product</p>
                          <p className="text-xs text-stone-400">Used in download ZIP and Higgsfield prompt</p>
                        </div>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={criteria.maxImagesPerProduct ?? 3}
                          onChange={(e) => setCriteria((c) => ({ ...c, maxImagesPerProduct: parseInt(e.target.value, 10) || 1 }))}
                          className="w-14 text-sm text-center text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-stone-400"
                        />
                      </div>

                      {/* How it works */}
                      <div className="border-t border-stone-100 pt-4 space-y-2">
                        <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">How room building works</p>
                        <div className="text-[11px] text-stone-400 space-y-1.5 leading-relaxed">
                          <p><span className="font-medium text-stone-500">1. Product pull:</span> All products matching the vendor, tag, and inventory filters above are fetched from Shopify. Products must also have a <code className="bg-stone-100 px-1 rounded text-[10px]">custom.design_style</code> metafield or they are skipped.</p>
                          <p><span className="font-medium text-stone-500">2. Style grouping:</span> Products are grouped by their design style (e.g. Coastal, Modern). Each room is built from products that share a style.</p>
                          <p><span className="font-medium text-stone-500">3. Combination matching:</span> Each room follows a product type combination from <code className="bg-stone-100 px-1 rounded text-[10px]">config.json</code> (e.g. &ldquo;Entryway&rdquo; = Console Tables + Mirrors + Table Lamps). The combo defines which <code className="bg-stone-100 px-1 rounded text-[10px]">productType</code> slots to fill. If no products exist for a required type in a given style, that combo is skipped.</p>
                          <p><span className="font-medium text-stone-500">4. Scoring:</span> Multiple candidate sets are sampled, then scored by shared styles and materials between products. A top-tier set is picked randomly so rooms are cohesive but vary each run.</p>
                          <p><span className="font-medium text-stone-500">5. Uniqueness:</span> Each product appears in at most one room per generate. Once assigned, it is excluded from subsequent rooms.</p>
                        </div>
                      </div>

                      {/* Save */}
                      {criteriaError && (
                        <p className="text-xs text-red-600">{criteriaError}</p>
                      )}
                      <button
                        onClick={saveCriteria}
                        disabled={criteriaSaving}
                        className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                          criteriaSaved
                            ? 'bg-green-100 text-green-800'
                            : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {criteriaSaved ? 'Saved' : criteriaSaving ? 'Saving…' : 'Save Criteria'}
                      </button>
                    </div>
                  )}

                  {/* Loading state */}
                  {criteriaOpen && !criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 text-xs text-stone-400">
                      Loading…
                    </div>
                  )}

                  {/* Accessories row */}
                  <button
                    onClick={() => setAccessoriesOpen((o) => !o)}
                    className="flex items-center justify-between w-full px-4 py-3 hover:bg-stone-50 transition-colors text-left border-t border-stone-100"
                  >
                    <span className="text-sm font-medium text-stone-700">Accessories</span>
                    <svg
                      className={`w-4 h-4 text-stone-400 transition-transform ${accessoriesOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Accessories panel */}
                  {accessoriesOpen && criteria && (
                    <div className="border-t border-stone-100 px-4 py-4 space-y-3">
                      <p className="text-xs text-stone-400">
                        Each generate randomly picks 1–2 from this list and appends them to the scene description.
                      </p>

                      {/* Existing entries */}
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {(criteria.accessories ?? []).map((item, i) => (
                          <div key={i} className="flex items-start gap-2 group">
                            <p className="flex-1 text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 font-mono leading-relaxed">
                              {item}
                            </p>
                            <button
                              onClick={() => setCriteria((c) => ({
                                ...c,
                                accessories: c.accessories.filter((_, j) => j !== i),
                              }))}
                              className="shrink-0 mt-1.5 text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              title="Remove"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {(criteria.accessories ?? []).length === 0 && (
                          <p className="text-xs text-stone-300 italic">No accessories yet.</p>
                        )}
                      </div>

                      {/* Add new */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={accessoriesInput}
                          onChange={(e) => setAccessoriesInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && accessoriesInput.trim()) {
                              setCriteria((c) => ({
                                ...c,
                                accessories: [...(c.accessories ?? []), accessoriesInput.trim()],
                              }));
                              setAccessoriesInput('');
                            }
                          }}
                          placeholder="A white Porsche GT3 is visible through the windows."
                          className="flex-1 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 font-mono placeholder:text-stone-400"
                        />
                        <button
                          onClick={() => {
                            if (accessoriesInput.trim()) {
                              setCriteria((c) => ({
                                ...c,
                                accessories: [...(c.accessories ?? []), accessoriesInput.trim()],
                              }));
                              setAccessoriesInput('');
                            }
                          }}
                          className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                        >
                          Add
                        </button>
                      </div>

                      {/* Save */}
                      {accessoriesError && (
                        <p className="text-xs text-red-600">{accessoriesError}</p>
                      )}
                      <button
                        onClick={saveAccessories}
                        disabled={accessoriesSaving}
                        className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                          accessoriesSaved
                            ? 'bg-green-100 text-green-800'
                            : 'bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait'
                        }`}
                      >
                        {accessoriesSaved ? 'Saved' : accessoriesSaving ? 'Saving…' : 'Save Accessories'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fantasy mode banner */}
      {mode === 'fantasy' && (
        <div className="mb-6 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3 text-sm text-indigo-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span>Fantasy mode — scene templates are drawn from rows tagged with &ldquo;Fantasy&rdquo; in column K (styles).</span>
        </div>
      )}

      {/* Pinterest mode banner */}
      {mode === 'pinterest' && (
        <div className="mb-6 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-sm text-rose-700">
          <PinterestIcon className="w-4 h-4 shrink-0" />
          <span>Pinterest mode — images generate at 2:3 (portrait). Generated pins are saved to <code className="font-mono text-xs bg-rose-100 px-1 py-0.5 rounded">~/Downloads/new_pins_generated</code>. Shopify publishing is disabled.</span>
        </div>
      )}

      {/* Featured product banner */}
      {(filters.featuredProducts.some(h => h) || filters.pickedProduct) && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-sm text-amber-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          <span>Featured product mode —{' '}
            {filters.pickedProduct && (
              <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">{filters.pickedProduct.title}</code>
            )}
            {filters.featuredProducts.filter(h => h).map((h, i) => (
              <span key={i}>{(i > 0 || filters.pickedProduct) && ', '}<code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">{h}</code></span>
            ))} will appear in every generated room.</span>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 p-4 bg-white border border-stone-200 rounded-xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-stone-500 uppercase tracking-wide mr-1">
            Pin
          </span>

          <select
            value={filters.designStyle}
            onChange={(e) => setFilter('designStyle', e.target.value)}
            className={selectClass}
          >
            <option value="">Any style</option>
            {styleOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={filters.roomType}
            onChange={(e) => setFilter('roomType', e.target.value)}
            className={selectClass}
          >
            <option value="">Any room type</option>
            {roomTypeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={filters.roomName}
            onChange={(e) => setFilter('roomName', e.target.value)}
            className={selectClass}
          >
            <option value="">Any scene</option>
            {roomNameOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <input
            type="text"
            value={filters.lighting}
            onChange={(e) => setFilter('lighting', e.target.value)}
            placeholder="Lighting override…"
            className={inputClass}
          />

          <input
            type="text"
            value={filters.camera}
            onChange={(e) => setFilter('camera', e.target.value)}
            placeholder="Camera override…"
            className={inputClass}
          />

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              Featured
            </span>
            <ProductSearchPicker
              value={filters.pickedProduct}
              onChange={(p) => setFilter('pickedProduct', p)}
            />
            {filters.featuredProducts.map((handle, idx) => (
              <input
                key={`fp-${idx}`}
                type="text"
                value={handle}
                onChange={(e) => {
                  const next = [...filters.featuredProducts];
                  next[idx] = e.target.value;
                  setFilter('featuredProducts', next);
                }}
                placeholder={`Handle ${idx + 1}…`}
                className={inputClass + ' w-36'}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              # Rooms
            </span>
            <input
              type="number"
              min="1"
              max="50"
              value={filters.count}
              onChange={(e) => setFilter('count', e.target.value)}
              placeholder="Default"
              className="text-sm text-stone-700 bg-white border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400 w-24"
            />
          </div>

          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide whitespace-nowrap">
              Products
            </span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setFilter('productCount', n)}
                  className={`w-7 h-7 text-xs font-medium rounded-md transition-colors ${
                    filters.productCount === n
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors ml-1"
            >
              Clear all
            </button>
          )}
        </div>
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
          {rooms.map((room, i) => (
            <RoomCard key={`${room.style}-${i}`} room={room} mode={mode} combinationNames={combinationNames} accessoriesList={accessoriesList} featuredProductHandles={[...filters.featuredProducts.filter(h => h.trim()), ...(filters.pickedProduct ? [filters.pickedProduct.handle] : [])]} />
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
