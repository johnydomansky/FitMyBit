import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";

/* ─── helpers ─── */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));


/* ─── Helper to describe settings changes for history ─── */
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtBytes = (b) => {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
};

const Chevron = ({ collapsed }) => (
  <svg className={`w-3 h-3 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
    fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const FORMATS = ["png", "jpeg", "webp"];
const FORMAT_LABELS = { png: "PNG", jpeg: "JPG", webp: "WebP" };

function estimateSize(w, h, format, quality) {
  const pixels = w * h;
  if (format === "png") return pixels * 3.5 * 0.55;
  return pixels * 3 * (quality / 100) * 0.18;
}

/* ─── Draw blur background at user-defined position/size ─── */
function drawBlurBg(ctx, img, canvasW, canvasH, cropX, cropY, cropW, cropH, blurAmount, bgX, bgY, bgW, bgH) {
  /* Draw the background image at its custom position, stretch edges to fill canvas, then blur */
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = canvasW;
  tmpCanvas.height = canvasH;
  const tc = tmpCanvas.getContext("2d");

  /* Tile the image at the BG layer's scale to fill the entire canvas.
     All tiles are the SAME scale — no double-background zone, no harsh edge strips.
     With blur applied afterwards the tile seams are completely invisible. */
  const safeBgW = Math.max(1, bgW);
  const safeBgH = Math.max(1, bgH);
  const startTX = Math.floor(-bgX / safeBgW) - 1;
  const endTX   = Math.ceil((canvasW - bgX) / safeBgW);
  const startTY = Math.floor(-bgY / safeBgH) - 1;
  const endTY   = Math.ceil((canvasH - bgY) / safeBgH);
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      tc.drawImage(img, cropX, cropY, cropW, cropH,
        bgX + tx * safeBgW, bgY + ty * safeBgH, safeBgW, safeBgH);
    }
  }

  /* Blur and composite onto main context */
  ctx.filter = `blur(${blurAmount}px)`;
  ctx.drawImage(tmpCanvas, 0, 0);
  ctx.filter = "none";
}

/* ─── Render final canvas ─── */
function renderToCanvas(img, s) {
  const { canvasW, canvasH, imgX, imgY, imgW, imgH, cropX, cropY, cropW, cropH, rotation, bgMode, bgColor, blurAmount, blurBgX, blurBgY, blurBgW, blurBgH } = s;
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");

  if (bgMode === "color") {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgMode === "blur") {
    const bgX = blurBgX ?? imgX;
    const bgY = blurBgY ?? imgY;
    const bgW = blurBgW ?? imgW;
    const bgH = blurBgH ?? imgH;
    drawBlurBg(ctx, img, canvasW, canvasH, cropX, cropY, cropW, cropH, blurAmount, bgX, bgY, bgW, bgH);
  }

  ctx.save();
  const cx = imgX + imgW / 2;
  const cy = imgY + imgH / 2;
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);

  const roundedImgX = Math.round(-imgW / 2);
  const roundedImgY = Math.round(-imgH / 2);
  const roundedImgW = Math.round(imgW);
  const roundedImgH = Math.round(imgH);

  ctx.drawImage(img, cropX, cropY, cropW, cropH, roundedImgX, roundedImgY, roundedImgW, roundedImgH);
  ctx.restore();
  return canvas;
}

const checkerBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23ccc'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23ccc'/%3E%3Crect x='10' width='10' height='10' fill='%23fff'/%3E%3Crect y='10' width='10' height='10' fill='%23fff'/%3E%3C/svg%3E")`;

/* ─── Export Dialog Modal ─── */
function ExportDialog({ item, imgRef, settings, onClose }) {
  const s = settings;
  const baseName = item.name.replace(/\.[^.]+$/, "");
  const [fileName, setFileName] = useState(`${baseName}_converted`);
  const [optMode, setOptMode] = useState("full");
  const [customQ, setCustomQ] = useState(85);
  const [saving, setSaving] = useState(false);
  const [realSize, setRealSize] = useState(null);

  const isPng = s.format === "png";

  const getExportFormat = () => {
    if (!isPng) return s.format;
    if (optMode === "full") return "png";
    return s.bgMode === "transparent" ? "webp" : "jpeg";
  };

  const getExportQuality = () => {
    const fmt = getExportFormat();
    if (fmt === "png") return undefined;
    if (optMode === "full") return 1;
    if (optMode === "web") return 0.75;
    return customQ / 100;
  };

  const exportFmt = getExportFormat();
  const exportExt = exportFmt === "jpeg" ? "jpg" : exportFmt;
  const exportMime = exportFmt === "jpeg" ? "image/jpeg" : exportFmt === "webp" ? "image/webp" : "image/png";

  const isUnmodified = () => {
    return (
      s.canvasW === s.origW &&
      s.canvasH === s.origH &&
      s.imgX === 0 &&
      s.imgY === 0 &&
      s.imgW === s.origW &&
      s.imgH === s.origH &&
      s.cropX === 0 &&
      s.cropY === 0 &&
      s.cropW === s.origW &&
      s.cropH === s.origH &&
      s.rotation === 0
    );
  };

  useEffect(() => {
    if (!imgRef) return;
    setRealSize(null);
    const canvas = renderToCanvas(imgRef, s);
    const q = getExportQuality();
    canvas.toBlob((blob) => {
      if (blob) setRealSize(blob.size);
    }, exportMime, q);
  }, [optMode, customQ, s.format, s.canvasW, s.canvasH, s.imgW, s.imgH, s.imgX, s.imgY, s.bgMode]);

  const doExport = async (usePicker) => {
    if (!imgRef) return;
    setSaving(true);
    const canvas = renderToCanvas(imgRef, s);
    const q = getExportQuality();

    canvas.toBlob(async (blob) => {
      const fullName = `${fileName}.${exportExt}`;
      if (usePicker && window.showSaveFilePicker) {
        try {
          const types = [];
          if (exportFmt === "png") types.push({ description: "PNG Image", accept: { "image/png": [".png"] } });
          else if (exportFmt === "jpeg") types.push({ description: "JPEG Image", accept: { "image/jpeg": [".jpg", ".jpeg"] } });
          else types.push({ description: "WebP Image", accept: { "image/webp": [".webp"] } });

          const handle = await window.showSaveFilePicker({ suggestedName: fullName, types });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setSaving(false);
          onClose();
          return;
        } catch (err) {
          if (err.name === "AbortError") { setSaving(false); return; }
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fullName;
      a.click();
      URL.revokeObjectURL(a.href);
      setSaving(false);
      onClose();
    }, exportMime, q);
  };

  const formatSizeDisplay = () => {
    if (realSize === null) return "Calculating...";

    if (isUnmodified() && optMode === "full" && s.format === "png") {
      return `${fmtBytes(item.fileSize)} (original)`;
    }

    if (isUnmodified() && optMode === "full" && s.format === item.originalFormat) {
      return `${fmtBytes(item.fileSize)} (original)`;
    }

    if (item.fileSize && realSize > item.fileSize) {
      const percent = Math.round(((realSize - item.fileSize) / item.fileSize) * 100);
      return `${fmtBytes(realSize)} (+${percent}%)`;
    } else if (item.fileSize && realSize < item.fileSize) {
      const percent = Math.round(((item.fileSize - realSize) / item.fileSize) * 100);
      return `${fmtBytes(realSize)} (-${percent}%)`;
    }

    return fmtBytes(realSize);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-6 px-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-white">Export Image</h2>

        <div>
          <label className="text-xs text-gray-400 font-medium block mb-1">File Name</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
              autoFocus
            />
            <span className="text-sm text-gray-400 font-mono bg-gray-800 px-2 py-2 rounded-lg">.{exportExt}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1">Source Format</label>
            <span className="text-sm text-white font-semibold">{FORMAT_LABELS[s.format]}</span>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1">Canvas</label>
            <span className="text-sm text-green-400 font-semibold">{s.canvasW} x {s.canvasH}</span>
          </div>
          {exportFmt !== s.format && (
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Export As</label>
              <span className="text-sm text-amber-400 font-semibold">{FORMAT_LABELS[exportFmt] || exportFmt.toUpperCase()}</span>
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-gray-400 font-medium block mb-2">Optimization</label>
          <div className="space-y-2">
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${optMode === "full" ? "bg-green-600/10 border-green-500" : "bg-gray-800 border-gray-700 hover:border-gray-500"}`}>
              <input type="radio" name="opt" checked={optMode === "full"} onChange={() => setOptMode("full")} className="accent-green-500" />
              <div className="flex-1">
                <span className="text-sm text-white font-medium">Full Quality</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isPng ? "Lossless PNG — maximum quality, largest file" : "100% quality — no compression artifacts"}
                </p>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${optMode === "web" ? "bg-teal-600/10 border-teal-500" : "bg-gray-800 border-gray-700 hover:border-gray-500"}`}>
              <input type="radio" name="opt" checked={optMode === "web"} onChange={() => setOptMode("web")} className="accent-teal-500" />
              <div className="flex-1">
                <span className="text-sm text-white font-medium">Optimized for Web</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isPng
                    ? `Converts to ${s.bgMode === "transparent" ? "WebP" : "JPG"} at 75% — great balance of quality and size`
                    : "75% quality — great balance of quality and size"}
                </p>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${optMode === "custom" ? "bg-amber-600/10 border-amber-500" : "bg-gray-800 border-gray-700 hover:border-gray-500"}`}>
              <input type="radio" name="opt" checked={optMode === "custom"} onChange={() => setOptMode("custom")} className="accent-amber-500" />
              <div className="flex-1">
                <span className="text-sm text-white font-medium">Custom Quality</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isPng
                    ? `Converts to ${s.bgMode === "transparent" ? "WebP" : "JPG"} at ${customQ}%`
                    : `${customQ}% quality — adjust with slider`}
                </p>
              </div>
            </label>
            {optMode === "custom" && (
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 rounded-lg">
                <span className="text-xs text-gray-400">Low</span>
                <input type="range" min={1} max={100} value={customQ} onChange={(e) => setCustomQ(+e.target.value)} className="flex-1 accent-amber-500" />
                <span className="text-xs text-gray-400">High</span>
                <span className="text-sm text-white font-bold font-mono w-12 text-right">{customQ}%</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg px-4 py-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Actual file size</span>
            {realSize !== null ? (
              <span className="text-base text-green-400 font-bold">{formatSizeDisplay()}</span>
            ) : (
              <span className="text-xs text-gray-400 animate-pulse">Calculating...</span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Output format</span>
            <span className="text-xs text-white font-medium">{(FORMAT_LABELS[exportFmt] || exportFmt.toUpperCase())} (.{exportExt})</span>
          </div>
          {isPng && optMode !== "full" && (
            <div className="text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-1.5 mt-1">
              PNG is lossless and cannot be compressed with a quality slider. To reduce file size, this will export as {s.bgMode === "transparent" ? "WebP (keeps transparency)" : "JPG"} instead.
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => doExport(true)}
            disabled={saving}
            className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save As..."}
          </button>
          <button
            onClick={() => doExport(false)}
            disabled={saving}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            Quick Download
          </button>
        </div>
        <button onClick={onClose} className="w-full text-xs text-gray-400 hover:text-gray-300 transition-colors py-1">Cancel</button>
      </div>
    </div>
  );
}

/* ─── Interactive Preview with Free Transform Handles + Blur BG Layer Editing ─── */
function InteractivePreview({ settings, imgEl, onUpdate, cropMode = false, onCropChange }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const axisLockRef = useRef(null); // null | "x" | "y" — for shift-constrained drag
  const [hovered, setHovered] = useState(false);
  const [showLabel, setShowLabel] = useState(true);
  const [editMode, setEditMode] = useState("image"); // "image" | "blurbg"
  const s = settings;

  // Reset to image edit mode when leaving blur background mode
  useEffect(() => {
    if (s.bgMode !== "blur") setEditMode("image");
  }, [s.bgMode]);

  const getLayout = () => {
    const el = containerRef.current;
    if (!el) return { scale: 1, ox: 0, oy: 0 };
    const rect = el.getBoundingClientRect();
    const sx = rect.width / s.canvasW;
    const sy = rect.height / s.canvasH;
    const scale = Math.min(sx, sy);
    const ox = (rect.width - s.canvasW * scale) / 2;
    const oy = (rect.height - s.canvasH * scale) / 2;
    return { scale, ox, oy };
  };

  // Image rect in screen coords
  const imgScreenRect = () => {
    const { scale, ox, oy } = getLayout();
    return { x: ox + s.imgX * scale, y: oy + s.imgY * scale, w: s.imgW * scale, h: s.imgH * scale };
  };

  // Blur BG rect in screen coords
  const bgScreenRect = () => {
    const { scale, ox, oy } = getLayout();
    const bgX = s.blurBgX ?? s.imgX;
    const bgY = s.blurBgY ?? s.imgY;
    const bgW = s.blurBgW ?? s.imgW;
    const bgH = s.blurBgH ?? s.imgH;
    return { x: ox + bgX * scale, y: oy + bgY * scale, w: bgW * scale, h: bgH * scale };
  };

  // Active rect (the one with handles, based on current edit mode)
  const screenRect = () => editMode === "blurbg" ? bgScreenRect() : imgScreenRect();

  const canvasScreenRect = () => {
    const { scale, ox, oy } = getLayout();
    /* Use the same pixel-snapped bounds as the canvas drawing useEffect */
    const cvL = Math.floor(ox);
    const cvT = Math.floor(oy);
    const cvW = Math.ceil(ox + s.canvasW * scale) - cvL;
    const cvH = Math.ceil(oy + s.canvasH * scale) - cvT;
    return { x: cvL, y: cvT, w: cvW, h: cvH };
  };

  // Crop mode: full original image displayed within the canvas area, letterboxed
  const getCropDisplayLayout = () => {
    const { scale: previewScale, ox, oy } = getLayout();
    const cvW = s.canvasW * previewScale;
    const cvH = s.canvasH * previewScale;
    const imgScale = Math.min(cvW / s.origW, cvH / s.origH);
    const imgDispW = s.origW * imgScale;
    const imgDispH = s.origH * imgScale;
    const imgDispX = ox + (cvW - imgDispW) / 2;
    const imgDispY = oy + (cvH - imgDispH) / 2;
    return { imgScale, imgDispX, imgDispY, imgDispW, imgDispH };
  };

  const makeHandles = (r) => [
    { id: "tl", cx: r.x, cy: r.y, cursor: "nwse-resize" },
    { id: "tc", cx: r.x + r.w / 2, cy: r.y, cursor: "ns-resize" },
    { id: "tr", cx: r.x + r.w, cy: r.y, cursor: "nesw-resize" },
    { id: "ml", cx: r.x, cy: r.y + r.h / 2, cursor: "ew-resize" },
    { id: "mr", cx: r.x + r.w, cy: r.y + r.h / 2, cursor: "ew-resize" },
    { id: "bl", cx: r.x, cy: r.y + r.h, cursor: "nesw-resize" },
    { id: "bc", cx: r.x + r.w / 2, cy: r.y + r.h, cursor: "ns-resize" },
    { id: "br", cx: r.x + r.w, cy: r.y + r.h, cursor: "nwse-resize" },
  ];

  const onHandleDown = (e, handleId) => {
    e.preventDefault();
    e.stopPropagation();
    const { scale } = getLayout();
    if (editMode === "blurbg") {
      const bgX = s.blurBgX ?? s.imgX;
      const bgY = s.blurBgY ?? s.imgY;
      const bgW = s.blurBgW ?? s.imgW;
      const bgH = s.blurBgH ?? s.imgH;
      axisLockRef.current = null;
      setDrag({ handle: handleId, startMouseX: e.clientX, startMouseY: e.clientY, startImgX: bgX, startImgY: bgY, startImgW: bgW, startImgH: bgH, scale, mode: "blurbg" });
    } else {
      axisLockRef.current = null;
      setDrag({ handle: handleId, startMouseX: e.clientX, startMouseY: e.clientY, startImgX: s.imgX, startImgY: s.imgY, startImgW: s.imgW, startImgH: s.imgH, scale, mode: "image" });
    }
  };

  const onCropHandleDown = (e, handleId) => {
    e.preventDefault();
    e.stopPropagation();
    const { imgScale } = getCropDisplayLayout();
    setDrag({
      handle: handleId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startCropX: s.cropX,
      startCropY: s.cropY,
      startCropW: s.cropW,
      startCropH: s.cropH,
      imgScale,
      mode: "crop"
    });
  };

  const onBodyDown = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Crop mode: clicking inside image area starts crop-move drag
    if (cropMode) {
      const { imgScale, imgDispX, imgDispY, imgDispW, imgDispH } = getCropDisplayLayout();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Must click within the displayed image bounds
      if (mx < imgDispX || mx > imgDispX + imgDispW || my < imgDispY || my > imgDispY + imgDispH) return;
      e.preventDefault();
      setDrag({
        handle: "crop-move",
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startCropX: s.cropX,
        startCropY: s.cropY,
        startCropW: s.cropW,
        startCropH: s.cropH,
        imgScale,
        mode: "crop"
      });
      return;
    }

    const { scale, ox, oy } = getLayout();
    const mx = (e.clientX - rect.left - ox) / scale;
    const my = (e.clientY - rect.top - oy) / scale;

    if (editMode === "blurbg") {
      const bgX = s.blurBgX ?? s.imgX;
      const bgY = s.blurBgY ?? s.imgY;
      const bgW = s.blurBgW ?? s.imgW;
      const bgH = s.blurBgH ?? s.imgH;
      if (mx >= bgX && mx <= bgX + bgW && my >= bgY && my <= bgY + bgH) {
        e.preventDefault();
        axisLockRef.current = null;
        setDrag({ handle: "move", startMouseX: e.clientX, startMouseY: e.clientY, startImgX: bgX, startImgY: bgY, startImgW: bgW, startImgH: bgH, scale, mode: "blurbg" });
      }
    } else {
      if (mx >= s.imgX && mx <= s.imgX + s.imgW && my >= s.imgY && my <= s.imgY + s.imgH) {
        e.preventDefault();
        axisLockRef.current = null;
        setDrag({ handle: "move", startMouseX: e.clientX, startMouseY: e.clientY, startImgX: s.imgX, startImgY: s.imgY, startImgW: s.imgW, startImgH: s.imgH, scale, mode: "image" });
      }
    }
  };

  useEffect(() => {
    if (!drag) return;
    const lockAspect = drag.mode === "blurbg" ? false : s.lockImgAspect;
    const aspect = drag.mode === "blurbg"
      ? drag.startImgW / drag.startImgH
      : s.cropW / s.cropH;

    const onMove = (e) => {
      // Crop mode drag
      if (drag.mode === "crop") {
        const dx = (e.clientX - drag.startMouseX) / drag.imgScale;
        const dy = (e.clientY - drag.startMouseY) / drag.imgScale;
        const { startCropX: cx0, startCropY: cy0, startCropW: cw0, startCropH: ch0 } = drag;
        const MIN = 20;
        let nx = cx0, ny = cy0, nw = cw0, nh = ch0;

        if (drag.handle === "crop-move") {
          nx = clamp(cx0 + dx, 0, s.origW - cw0);
          ny = clamp(cy0 + dy, 0, s.origH - ch0);
        } else if (drag.handle === "crop-br") { nw = clamp(cw0 + dx, MIN, s.origW - cx0); nh = clamp(ch0 + dy, MIN, s.origH - cy0); }
        else if (drag.handle === "crop-bl") { nw = clamp(cw0 - dx, MIN, cx0 + cw0); nh = clamp(ch0 + dy, MIN, s.origH - cy0); nx = cx0 + cw0 - nw; }
        else if (drag.handle === "crop-tr") { nw = clamp(cw0 + dx, MIN, s.origW - cx0); nh = clamp(ch0 - dy, MIN, cy0 + ch0); ny = cy0 + ch0 - nh; }
        else if (drag.handle === "crop-tl") { nw = clamp(cw0 - dx, MIN, cx0 + cw0); nh = clamp(ch0 - dy, MIN, cy0 + ch0); nx = cx0 + cw0 - nw; ny = cy0 + ch0 - nh; }
        else if (drag.handle === "crop-mr") { nw = clamp(cw0 + dx, MIN, s.origW - cx0); }
        else if (drag.handle === "crop-ml") { nw = clamp(cw0 - dx, MIN, cx0 + cw0); nx = cx0 + cw0 - nw; }
        else if (drag.handle === "crop-bc") { nh = clamp(ch0 + dy, MIN, s.origH - cy0); }
        else if (drag.handle === "crop-tc") { nh = clamp(ch0 - dy, MIN, cy0 + ch0); ny = cy0 + ch0 - nh; }

        onCropChange({ cropX: Math.round(nx), cropY: Math.round(ny), cropW: Math.round(nw), cropH: Math.round(nh) });
        return;
      }

      let dx = (e.clientX - drag.startMouseX) / drag.scale;
      let dy = (e.clientY - drag.startMouseY) / drag.scale;
      const h = drag.handle;

      if (h === "move") {
        if (e.shiftKey) {
          if (axisLockRef.current === null) {
            const rawDx = Math.abs(e.clientX - drag.startMouseX);
            const rawDy = Math.abs(e.clientY - drag.startMouseY);
            if (rawDx + rawDy > 5) {
              axisLockRef.current = rawDx >= rawDy ? "x" : "y";
            }
          }
          if (axisLockRef.current === "x") dy = 0;
          if (axisLockRef.current === "y") dx = 0;
        } else {
          axisLockRef.current = null;
        }

        if (drag.mode === "blurbg") {
          onUpdate({ blurBgX: drag.startImgX + dx, blurBgY: drag.startImgY + dy });
        } else {
          onUpdate({ imgX: drag.startImgX + dx, imgY: drag.startImgY + dy });
        }
        return;
      }

      let nX = drag.startImgX, nY = drag.startImgY, nW = drag.startImgW, nH = drag.startImgH;

      if (h === "br") { nW = Math.max(20, drag.startImgW + dx); if (lockAspect) nH = nW / aspect; else nH = Math.max(20, drag.startImgH + dy); }
      else if (h === "mr") { nW = Math.max(20, drag.startImgW + dx); if (lockAspect) nH = nW / aspect; }
      else if (h === "bc") { nH = Math.max(20, drag.startImgH + dy); if (lockAspect) nW = nH * aspect; }
      else if (h === "tl") { nW = Math.max(20, drag.startImgW - dx); if (lockAspect) nH = nW / aspect; else nH = Math.max(20, drag.startImgH - dy); nX = drag.startImgX + drag.startImgW - nW; nY = drag.startImgY + drag.startImgH - nH; }
      else if (h === "tr") { nW = Math.max(20, drag.startImgW + dx); if (lockAspect) nH = nW / aspect; else nH = Math.max(20, drag.startImgH - dy); nY = drag.startImgY + drag.startImgH - nH; }
      else if (h === "bl") { nW = Math.max(20, drag.startImgW - dx); if (lockAspect) nH = nW / aspect; else nH = Math.max(20, drag.startImgH + dy); nX = drag.startImgX + drag.startImgW - nW; }
      else if (h === "tc") { nH = Math.max(20, drag.startImgH - dy); if (lockAspect) nW = nH * aspect; nY = drag.startImgY + drag.startImgH - nH; }
      else if (h === "ml") { nW = Math.max(20, drag.startImgW - dx); if (lockAspect) nH = nW / aspect; nX = drag.startImgX + drag.startImgW - nW; }

      if (drag.mode === "blurbg") {
        onUpdate({ blurBgX: nX, blurBgY: nY, blurBgW: Math.round(nW), blurBgH: Math.round(nH) });
      } else {
        onUpdate({ imgX: nX, imgY: nY, imgW: Math.round(nW), imgH: Math.round(nH) });
      }
    };
    const onUp = () => { axisLockRef.current = null; setDrag(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, s.lockImgAspect, s.cropW, s.cropH, s.origW, s.origH, onCropChange, cropMode]);

  /* Draw preview canvas */
  useEffect(() => {
    if (!imgEl) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth;
    const ch = cv.clientHeight;
    cv.width = cw * dpr;
    cv.height = ch * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    const sx = cw / s.canvasW;
    const sy = ch / s.canvasH;
    const scale = Math.min(sx, sy);
    const ox = (cw - s.canvasW * scale) / 2;
    const oy = (ch - s.canvasH * scale) / 2;

    /* Pixel-snapped canvas bounds — used consistently everywhere to prevent sub-pixel gaps */
    const cvL = Math.floor(ox);
    const cvT = Math.floor(oy);
    const cvR = Math.ceil(ox + s.canvasW * scale);
    const cvB = Math.ceil(oy + s.canvasH * scale);
    const cvW = cvR - cvL;
    const cvH = cvB - cvT;

    /* ── Crop Mode: show full original image + darkened overlay + crop rect + grid ── */
    if (cropMode) {
      ctx.fillStyle = "#1a1e1a";
      ctx.fillRect(0, 0, cw, ch);

      const imgScale = Math.min(cvW / s.origW, cvH / s.origH);
      const imgDispW = s.origW * imgScale;
      const imgDispH = s.origH * imgScale;
      const imgDispX = cvL + (cvW - imgDispW) / 2;
      const imgDispY = cvT + (cvH - imgDispH) / 2;

      // 1. Draw full image dimmed
      ctx.globalAlpha = 0.35;
      ctx.drawImage(imgEl, 0, 0, s.origW, s.origH, imgDispX, imgDispY, imgDispW, imgDispH);
      ctx.globalAlpha = 1;

      // 2. Draw crop region at full brightness
      const cx = imgDispX + s.cropX * imgScale;
      const cy = imgDispY + s.cropY * imgScale;
      const cw2 = s.cropW * imgScale;
      const ch2 = s.cropH * imgScale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cw2, ch2);
      ctx.clip();
      ctx.drawImage(imgEl, 0, 0, s.origW, s.origH, imgDispX, imgDispY, imgDispW, imgDispH);
      ctx.restore();

      // 3. Dark overlay outside crop (4 rects)
      ctx.fillStyle = "rgba(0,0,0,0.52)";
      ctx.fillRect(imgDispX, imgDispY, imgDispW, cy - imgDispY);
      ctx.fillRect(imgDispX, cy + ch2, imgDispW, imgDispY + imgDispH - cy - ch2);
      ctx.fillRect(imgDispX, cy, cx - imgDispX, ch2);
      ctx.fillRect(cx + cw2, cy, imgDispX + imgDispW - cx - cw2, ch2);

      // 4. Crop border (teal)
      ctx.strokeStyle = "#14b8a6";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw2 - 1, ch2 - 1);

      // 5. Rule-of-thirds grid
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(cx + cw2 * i / 3, cy); ctx.lineTo(cx + cw2 * i / 3, cy + ch2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy + ch2 * i / 3); ctx.lineTo(cx + cw2, cy + ch2 * i / 3); ctx.stroke();
      }
      ctx.setLineDash([]);

      // 6. Outer image boundary (subtle)
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(imgDispX + 0.5, imgDispY + 0.5, imgDispW - 1, imgDispH - 1);
      return;
    }
    /* ── Normal rendering continues below ── */

    if (s.bgMode === "transparent") {
      /* Clip checkerboard so the last tiles don't overshoot the canvas edge */
      ctx.save();
      ctx.beginPath();
      ctx.rect(cvL, cvT, cvW, cvH);
      ctx.clip();
      const sz = 10;
      for (let y = 0; y < cvH; y += sz) {
        for (let x = 0; x < cvW; x += sz) {
          const col = ((Math.floor(x / sz) + Math.floor(y / sz)) % 2 === 0) ? "#ccc" : "#fff";
          ctx.fillStyle = col;
          ctx.fillRect(cvL + x, cvT + y, sz, sz);
        }
      }
      ctx.restore();
    } else if (s.bgMode === "color") {
      ctx.fillStyle = s.bgColor;
      ctx.fillRect(cvL, cvT, cvW, cvH);
    } else if (s.bgMode === "blur") {
      /* Use the blur background's position/size (independent from foreground image) */
      const bgX = s.blurBgX ?? s.imgX;
      const bgY = s.blurBgY ?? s.imgY;
      const bgW = s.blurBgW ?? s.imgW;
      const bgH = s.blurBgH ?? s.imgH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(cvL, cvT, cvW, cvH);
      ctx.clip();

      const roundOx = cvL;
      const roundOy = cvT;
      const roundCW = cvW;
      const roundCH = cvH;

      const tmpCv = document.createElement("canvas");
      tmpCv.width = roundCW;
      tmpCv.height = roundCH;
      const tc = tmpCv.getContext("2d");

      /* Tile the image at BG layer scale — same logic as renderToCanvas/drawBlurBg */
      const roundBx = Math.round(bgX * scale);
      const roundBy = Math.round(bgY * scale);
      const roundBw = Math.max(1, Math.round(bgW * scale));
      const roundBh = Math.max(1, Math.round(bgH * scale));
      const stX = Math.floor(-roundBx / roundBw) - 1;
      const enX = Math.ceil((roundCW - roundBx) / roundBw);
      const stY = Math.floor(-roundBy / roundBh) - 1;
      const enY = Math.ceil((roundCH - roundBy) / roundBh);
      for (let ty = stY; ty <= enY; ty++) {
        for (let tx = stX; tx <= enX; tx++) {
          tc.drawImage(imgEl, s.cropX, s.cropY, s.cropW, s.cropH,
            roundBx + tx * roundBw, roundBy + ty * roundBh, roundBw, roundBh);
        }
      }

      ctx.filter = `blur(${s.blurAmount}px)`;
      ctx.drawImage(tmpCv, roundOx, roundOy, roundCW, roundCH);
      ctx.filter = "none";
      ctx.restore();
    }

    /* Canvas boundary — drawn BEFORE the image so the image covers it.
       Only visible on transparent/exposed areas, never creates a line on top of the image. */
    ctx.strokeStyle = "rgba(76,175,80,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cvL + 0.5, cvT + 0.5, cvW - 1, cvH - 1);

    /* Draw the foreground image — clip to pixel-snapped canvas bounds */
    ctx.save();
    ctx.beginPath();
    ctx.rect(cvL, cvT, cvW, cvH);
    ctx.clip();

    /* Compute edges relative to the floating-point origin so that when
       imgX=0 & imgW=canvasW the image exactly fills cvL→cvR with no gap. */
    const ix = Math.floor(ox + s.imgX * scale);
    const iy = Math.floor(oy + s.imgY * scale);
    const iw = Math.ceil(ox + (s.imgX + s.imgW) * scale) - ix;
    const ih = Math.ceil(oy + (s.imgY + s.imgH) * scale) - iy;

    if (s.rotation !== 0) {
      ctx.translate(ix + iw / 2, iy + ih / 2);
      ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.drawImage(imgEl, s.cropX, s.cropY, s.cropW, s.cropH, -iw / 2, -ih / 2, iw, ih);
    } else {
      ctx.drawImage(imgEl, s.cropX, s.cropY, s.cropW, s.cropH, ix, iy, iw, ih);
    }
    ctx.restore();
  }, [s, imgEl, cropMode]);

  const sr = screenRect();
  const cr = canvasScreenRect();
  const hs = makeHandles(sr);
  const isActive = hovered || drag;

  /* Colors: green for image mode, amber for blur bg mode */
  const activeColor = editMode === "blurbg" ? "#f59e0b" : "#4caf50";

  /* Reference outlines for the non-active layer */
  const imgSr = imgScreenRect();
  const bgSr = bgScreenRect();

  /* Crop mode: screen-space rect and handles */
  const cropLayout = cropMode ? getCropDisplayLayout() : null;
  const cropSr = cropLayout ? {
    x: cropLayout.imgDispX + s.cropX * cropLayout.imgScale,
    y: cropLayout.imgDispY + s.cropY * cropLayout.imgScale,
    w: s.cropW * cropLayout.imgScale,
    h: s.cropH * cropLayout.imgScale
  } : null;
  const cropHandles = cropSr ? [
    { id: "crop-tl", cx: cropSr.x,              cy: cropSr.y,              cursor: "nwse-resize" },
    { id: "crop-tc", cx: cropSr.x + cropSr.w/2,  cy: cropSr.y,              cursor: "ns-resize" },
    { id: "crop-tr", cx: cropSr.x + cropSr.w,    cy: cropSr.y,              cursor: "nesw-resize" },
    { id: "crop-ml", cx: cropSr.x,              cy: cropSr.y + cropSr.h/2,  cursor: "ew-resize" },
    { id: "crop-mr", cx: cropSr.x + cropSr.w,    cy: cropSr.y + cropSr.h/2,  cursor: "ew-resize" },
    { id: "crop-bl", cx: cropSr.x,              cy: cropSr.y + cropSr.h,   cursor: "nesw-resize" },
    { id: "crop-bc", cx: cropSr.x + cropSr.w/2,  cy: cropSr.y + cropSr.h,   cursor: "ns-resize" },
    { id: "crop-br", cx: cropSr.x + cropSr.w,    cy: cropSr.y + cropSr.h,   cursor: "nwse-resize" },
  ] : [];

  /* Cursor: in crop mode crosshair (grabbing when dragging crop) */
  const containerCursor = cropMode
    ? (drag ? (drag.handle === "crop-move" ? "grabbing" : "crosshair") : "crosshair")
    : (drag ? (drag.handle === "move" ? "grabbing" : "auto") : "default");

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl select-none"
      style={{ height: 400, background: "#1a1e1a", cursor: containerCursor }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!drag) setHovered(false); }}
      onMouseDown={onBodyDown}
    >
      {/* Rendered preview canvas */}
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />

      {/* Canvas dimension label */}
      {showLabel && (
        <div style={{
          position: "absolute",
          left: cr.x + 6,
          top: cr.y + 4,
          fontSize: 12,
          color: "#fff",
          pointerEvents: "none",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.6)",
          padding: "4px 8px",
          borderRadius: "4px"
        }}>
          {s.canvasW} x {s.canvasH}
        </div>
      )}

      {/* Label toggle button */}
      <button
        onClick={() => setShowLabel(!showLabel)}
        style={{
          position: "absolute",
          right: cr.x + cr.w - 4,
          top: cr.y + 4,
          width: "24px",
          height: "24px",
          background: "rgba(76,175,80,0.6)",
          color: "#fff",
          border: "none",
          borderRadius: "3px",
          cursor: "pointer",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "auto"
        }}
        title={showLabel ? "Hide label" : "Show label"}
      >
        {showLabel ? "✓" : "○"}
      </button>

      {/* BG Layer edit mode toggle — only visible when Blur Fill is active */}
      {s.bgMode === "blur" && (
        <button
          onClick={(e) => { e.stopPropagation(); setEditMode(m => m === "blurbg" ? "image" : "blurbg"); }}
          style={{
            position: "absolute",
            left: cr.x + 6,
            top: cr.y + cr.h - 32,
            padding: "3px 10px",
            background: editMode === "blurbg" ? "rgba(245,158,11,0.92)" : "rgba(20,20,30,0.80)",
            color: editMode === "blurbg" ? "#fff" : "#f59e0b",
            border: `1.5px solid ${editMode === "blurbg" ? "#f59e0b" : "rgba(245,158,11,0.55)"}`,
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "bold",
            pointerEvents: "auto",
            zIndex: 20,
            userSelect: "none",
            letterSpacing: "0.03em",
          }}
          title="Toggle: edit image position ↔ edit blur background layer"
        >
          {editMode === "blurbg" ? "◉ BG Layer" : "○ BG Layer"}
        </button>
      )}

      {/* Reference outline for the non-active layer (only in blur mode while hovered/dragging) */}
      {s.bgMode === "blur" && isActive && editMode === "image" && (
        <div style={{
          position: "absolute",
          left: bgSr.x, top: bgSr.y, width: bgSr.w, height: bgSr.h,
          border: "1.5px dashed rgba(245,158,11,0.45)",
          borderRadius: 1,
          pointerEvents: "none"
        }} />
      )}
      {s.bgMode === "blur" && isActive && editMode === "blurbg" && (
        <div style={{
          position: "absolute",
          left: imgSr.x, top: imgSr.y, width: imgSr.w, height: imgSr.h,
          border: "1.5px dashed rgba(76,175,80,0.45)",
          borderRadius: 1,
          pointerEvents: "none"
        }} />
      )}

      {/* Active transform bounding box — hidden in crop mode */}
      {isActive && !cropMode && (
        <>
          <div style={{ position: "absolute", left: sr.x, top: sr.y, width: sr.w, height: sr.h, border: `2px solid ${activeColor}`, borderRadius: 1, pointerEvents: "none", boxShadow: "0 0 0 1px rgba(0,0,0,0.3)" }} />
          <div style={{ position: "absolute", left: sr.x + sr.w / 2 - 8, top: sr.y + sr.h / 2, width: 16, height: 1, background: `${activeColor}88`, pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: sr.x + sr.w / 2, top: sr.y + sr.h / 2 - 8, width: 1, height: 16, background: `${activeColor}88`, pointerEvents: "none" }} />
        </>
      )}

      {/* 8 Drag handles — hidden in crop mode */}
      {isActive && !cropMode && hs.map((h) => (
        <div
          key={h.id}
          onMouseDown={(e) => onHandleDown(e, h.id)}
          style={{
            position: "absolute", left: h.cx - 5, top: h.cy - 5, width: 10, height: 10,
            background: activeColor, border: "2px solid #fff", borderRadius: 2,
            cursor: h.cursor, zIndex: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
          }}
        />
      ))}

      {/* Snap guide lines (image mode only, not in crop mode) */}
      {isActive && !cropMode && editMode === "image" && Math.abs(s.imgX) < 4 && (
        <div style={{ position: "absolute", left: cr.x, top: cr.y, width: 2, height: cr.h, background: "#f59e0b", pointerEvents: "none" }} />
      )}
      {isActive && !cropMode && editMode === "image" && Math.abs(s.imgY) < 4 && (
        <div style={{ position: "absolute", left: cr.x, top: cr.y, width: cr.w, height: 2, background: "#f59e0b", pointerEvents: "none" }} />
      )}
      {isActive && !cropMode && editMode === "image" && Math.abs((s.imgX + s.imgW) - s.canvasW) < 4 && (
        <div style={{ position: "absolute", left: cr.x + cr.w - 2, top: cr.y, width: 2, height: cr.h, background: "#f59e0b", pointerEvents: "none" }} />
      )}
      {isActive && !cropMode && editMode === "image" && Math.abs((s.imgY + s.imgH) - s.canvasH) < 4 && (
        <div style={{ position: "absolute", left: cr.x, top: cr.y + cr.h - 2, width: cr.w, height: 2, background: "#f59e0b", pointerEvents: "none" }} />
      )}

      {/* Crop mode handles */}
      {cropMode && cropSr && cropHandles.map((h) => (
        <div
          key={h.id}
          onMouseDown={(e) => onCropHandleDown(e, h.id)}
          style={{
            position: "absolute", left: h.cx - 5, top: h.cy - 5, width: 10, height: 10,
            background: "#14b8a6", border: "2px solid #fff", borderRadius: 2,
            cursor: h.cursor, zIndex: 15, boxShadow: "0 1px 3px rgba(0,0,0,0.4)"
          }}
        />
      ))}

      {/* Dimension tooltip while dragging */}
      {drag && drag.mode === "crop" && cropSr && (
        <div style={{ position: "absolute", left: cropSr.x + cropSr.w / 2 - 80, top: Math.max(cropSr.y - 26, cr.y + 2), background: "rgba(0,0,0,0.85)", color: "#14b8a6", fontSize: 11, fontFamily: "monospace", padding: "3px 10px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20 }}>
          Crop: {Math.round(s.cropW)} × {Math.round(s.cropH)} @ ({Math.round(s.cropX)}, {Math.round(s.cropY)})
        </div>
      )}
      {drag && drag.mode !== "crop" && (
        <div style={{ position: "absolute", left: sr.x + sr.w / 2 - 70, top: Math.max(sr.y - 26, cr.y + 2), background: "rgba(0,0,0,0.85)", color: "#fff", fontSize: 11, fontFamily: "monospace", padding: "3px 10px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20 }}>
          {editMode === "blurbg"
            ? `BG: ${Math.round(s.blurBgW ?? s.imgW)} × ${Math.round(s.blurBgH ?? s.imgH)} @ (${Math.round(s.blurBgX ?? s.imgX)}, ${Math.round(s.blurBgY ?? s.imgY)})`
            : `${Math.round(s.imgW)} × ${Math.round(s.imgH)} @ (${Math.round(s.imgX)}, ${Math.round(s.imgY)})`
          }
        </div>
      )}
    </div>
  );
}

/* ─── Keyboard Shortcuts Panel ─── */
function ShortcutsPanel({ onClose, mode }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "Cmd" : "Ctrl";
  const shortcuts = useMemo(() => {
    const common = [
      { keys: `${mod}+Z`, action: "Undo" },
      { keys: `${mod}+Shift+Z`, action: "Redo" },
      { keys: "F", action: "Fit image to canvas" },
      { keys: "Shift+F", action: "Fill image in canvas" },
      { keys: "C", action: "Center image" },
      { keys: "Arrow Keys", action: "Nudge image 1px" },
      { keys: "Shift+Arrow", action: "Nudge image 10px" },
      { keys: "Escape", action: "Close this panel" },
    ];
    if (mode === "bulk") {
      return [...common, { keys: "Left/Right Arrow", action: "Navigate images in bulk" }];
    }
    return common;
  }, [mode, mod]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-white mb-4">Keyboard Shortcuts</h2>
        <div className="space-y-2">
          {shortcuts.map(s => (
            <div key={s.keys} className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-gray-800/50 transition-colors">
              <span className="text-xs text-gray-400">{s.action}</span>
              <kbd className="text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded border border-gray-600 font-mono">{s.keys}</kbd>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full text-xs text-gray-400 hover:text-gray-300 py-2 transition-colors">Close (Esc)</button>
      </div>
    </div>
  );
}

/* ─── Single Image Editor ─── */
function ImageEditor({ item, onChange, onRemove, customPresets, onAddPreset, onRemovePreset, onUndo, onRedo, canUndo, canRedo }) {
  const imgRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [realSize, setRealSize] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const toggleSection = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  const [cropMode, setCropMode] = useState(false);
  const savedCropRef = useRef(null);
  const s = item.settings;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "Cmd" : "Ctrl";

  // Exit crop mode when switching to a different image
  useEffect(() => { setCropMode(false); }, [item.id]);

  const enterCropMode = () => {
    savedCropRef.current = { cropX: s.cropX, cropY: s.cropY, cropW: s.cropW, cropH: s.cropH };
    setCollapsed(prev => ({ ...prev, crop: false })); // ensure section is expanded
    setCropMode(true);
  };
  const applyCropMode = () => {
    const sc = Math.min(s.canvasW / s.cropW, s.canvasH / s.cropH);
    const nW = Math.round(s.cropW * sc);
    const nH = Math.round(s.cropH * sc);
    set({
      imgW: nW,
      imgH: nH,
      imgX: Math.round((s.canvasW - nW) / 2),
      imgY: Math.round((s.canvasH - nH) / 2),
    });
    setCropMode(false);
  };
  const cancelCropMode = () => { set(savedCropRef.current); setCropMode(false); };
  const set = (patch) => {
    const newSettings = { ...s, ...patch };
    onChange({ ...item, settings: newSettings });
  };

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.src = item.dataUrl;
  }, [item.dataUrl]);

  useEffect(() => {
    if (!imgRef.current) return;
    setRealSize(null);
    const timer = setTimeout(() => {
      try {
        const canvas = renderToCanvas(imgRef.current, s);
        const mime = s.format === "jpeg" ? "image/jpeg" : s.format === "webp" ? "image/webp" : "image/png";
        const q = s.format === "png" ? undefined : s.quality / 100;
        canvas.toBlob((blob) => {
          if (blob) setRealSize(blob.size);
        }, mime, q);
      } catch (e) { /* canvas too large, skip */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [imgLoaded, s.canvasW, s.canvasH, s.imgW, s.imgH, s.imgX, s.imgY, s.format, s.quality, s.bgMode, s.bgColor, s.cropX, s.cropY, s.cropW, s.cropH, s.rotation, s.blurAmount, s.blurBgX, s.blurBgY, s.blurBgW, s.blurBgH]);

  const imgAspect = s.cropW / s.cropH;
  const setCanvasW = (w) => set({ canvasW: Math.max(1, Math.round(w)) });
  const setCanvasH = (h) => set({ canvasH: Math.max(1, Math.round(h)) });
  const setImgW = (w) => { w = Math.max(1, Math.round(w)); set(s.lockImgAspect ? { imgW: w, imgH: Math.round(w / imgAspect) } : { imgW: w }); };
  const setImgH = (h) => { h = Math.max(1, Math.round(h)); set(s.lockImgAspect ? { imgH: h, imgW: Math.round(h * imgAspect) } : { imgH: h }); };

  const imgScalePercent = Math.round((s.imgW / s.origW) * 100);
  const setImgScale = (pct) => { const w = Math.max(1, Math.round((s.origW * pct) / 100)); const h = Math.max(1, Math.round((s.origH * pct) / 100)); set({ imgW: w, imgH: h }); };

  const snapWidth = () => { const nW = s.canvasW; const nH = Math.round(nW / imgAspect); set({ imgW: nW, imgH: nH, imgX: 0, imgY: Math.round((s.canvasH - nH) / 2) }); };
  const snapHeight = () => { const nH = s.canvasH; const nW = Math.round(nH * imgAspect); set({ imgW: nW, imgH: nH, imgY: 0, imgX: Math.round((s.canvasW - nW) / 2) }); };
  const snapFit = () => { const sc = Math.min(s.canvasW / s.cropW, s.canvasH / s.cropH); const nW = Math.round(s.cropW * sc); const nH = Math.round(s.cropH * sc); set({ imgW: nW, imgH: nH, imgX: Math.round((s.canvasW - nW) / 2), imgY: Math.round((s.canvasH - nH) / 2) }); };
  const snapFill = () => { const sc = Math.max(s.canvasW / s.cropW, s.canvasH / s.cropH); const nW = Math.round(s.cropW * sc); const nH = Math.round(s.cropH * sc); set({ imgW: nW, imgH: nH, imgX: Math.round((s.canvasW - nW) / 2), imgY: Math.round((s.canvasH - nH) / 2) }); };
  const centerImage = () => set({ imgX: Math.round((s.canvasW - s.imgW) / 2), imgY: Math.round((s.canvasH - s.imgH) / 2) });

  /* Blur BG layer presets */
  const blurBgFillCanvas = () => { const sc = Math.max(s.canvasW / s.cropW, s.canvasH / s.cropH); const nW = Math.round(s.cropW * sc); const nH = Math.round(s.cropH * sc); set({ blurBgX: Math.round((s.canvasW - nW) / 2), blurBgY: Math.round((s.canvasH - nH) / 2), blurBgW: nW, blurBgH: nH }); };
  const blurBgMatchImage = () => set({ blurBgX: s.imgX, blurBgY: s.imgY, blurBgW: s.imgW, blurBgH: s.imgH });

  const presets = [
    { label: "Original", w: s.origW, h: s.origH },
    { label: "1920x1080", w: 1920, h: 1080 },
    { label: "1080x1080", w: 1080, h: 1080 },
    { label: "1080x1920", w: 1080, h: 1920 },
    { label: "800x600", w: 800, h: 600 },
    { label: "512x512", w: 512, h: 512 },
  ];

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 overflow-hidden mb-6">
      {/* Header row 1: filename + Export/Remove */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-gray-800 border-b border-gray-700/50">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-white break-all line-clamp-2">{item.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowExport(true)} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded-lg transition-colors">Export</button>
          {onRemove && <button onClick={() => onRemove(item.id)} className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors">Remove</button>}
        </div>
      </div>

      {/* Header row 2: Undo / Redo controls with breathing room */}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-gray-800/60 border-b border-gray-700">
        <button
          onClick={onUndo} disabled={!canUndo}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-25 text-gray-200 text-xs font-medium rounded-lg transition-colors"
          title={`Undo (${mod}+Z)`}
        >
          <span className="text-base leading-none">↶</span><span>Undo</span>
        </button>
        <button
          onClick={onRedo} disabled={!canRedo}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-25 text-gray-200 text-xs font-medium rounded-lg transition-colors"
          title={`Redo (${mod}+Shift+Z)`}
        >
          <span>Redo</span><span className="text-base leading-none">↷</span>
        </button>
        <div className="relative group ml-1">
          <button className="text-gray-500 hover:text-gray-400 transition-colors p-1 rounded" tabIndex={-1}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h12"/>
            </svg>
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2.5 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 font-mono">
            {mod}+Z · {mod}+Shift+Z
          </div>
        </div>
      </div>

      {/* Preview + Sidebar */}
      <div className="flex flex-col lg:flex-row border-b border-gray-700">
        {/* Preview Column */}
        <div className="lg:w-3/5 xl:w-2/3 p-4 flex flex-col">
          {/* Compact Original Thumbnail */}
          <div className="flex items-center gap-3 mb-3 bg-gray-800/40 rounded-lg p-2">
            <div className="relative bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ width: 100, height: 70, backgroundImage: checkerBg }}>
              <img src={item.dataUrl} className="max-w-full max-h-full object-contain" alt="original" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Original</h3>
              <div className="text-xs text-gray-400 mt-0.5">{s.origW} x {s.origH} px — {fmtBytes(item.fileSize)}</div>
            </div>
          </div>

          {/* Interactive Preview */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Preview — Canvas {s.canvasW}x{s.canvasH} — Image {Math.round(s.imgW)}x{Math.round(s.imgH)}
            </h3>
            <span className="text-xs text-gray-400">Hover to transform</span>
          </div>
          {imgLoaded && (
            <InteractivePreview settings={s} imgEl={imgRef.current} onUpdate={(patch) => set(patch)} cropMode={cropMode} onCropChange={(patch) => set(patch)} />
          )}
          <div className="mt-2 flex items-center justify-center gap-3">
            <span className="text-xs text-gray-400">
              {realSize !== null ? <span className="text-green-400 font-medium">{fmtBytes(realSize)}</span> : <span className="animate-pulse">Calculating...</span>}
            </span>
            <span className="text-xs text-gray-500">|</span>
            <span className="text-xs text-gray-400">{FORMAT_LABELS[s.format]}</span>
          </div>
        </div>

        {/* Sidebar: Background + Blur + Export */}
        <div className="lg:w-2/5 xl:w-1/3 p-4 border-t lg:border-t-0 lg:border-l border-gray-700 space-y-4">
          {/* Background */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><span className="w-2 h-2 bg-green-400 rounded-full inline-block"></span> Background</h4>
            <div className="flex flex-wrap items-center gap-3">
              {["transparent", "color", "blur"].map((mode) => (
                <label key={mode} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name={`bg-${item.id}`} checked={s.bgMode === mode} onChange={() => set({ bgMode: mode })} className="accent-green-500" />
                  <span className="text-xs text-gray-400 capitalize">{mode === "blur" ? "Blur Fill" : mode}</span>
                </label>
              ))}
            </div>
            {s.bgMode === "color" && (
              <div className="flex items-center gap-2 mt-3">
                <input type="color" value={s.bgColor} onChange={(e) => set({ bgColor: e.target.value })} className="w-7 h-7 rounded cursor-pointer border-0" />
                <input type="text" value={s.bgColor} onChange={(e) => set({ bgColor: e.target.value })} className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white text-xs focus:border-green-500 focus:outline-none" />
              </div>
            )}
          </div>

          {/* Blur Settings — right next to preview */}
          {s.bgMode === "blur" && (
            <div className="bg-gray-800/50 rounded-xl p-4 space-y-3" style={{ animation: "slideDown 200ms ease-out" }}>
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 bg-teal-400 rounded-full inline-block"></span> Blur Settings
              </h4>
              <div>
                <label className="text-xs text-gray-400 block mb-2">Blur Amount: {s.blurAmount}px</label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={s.blurAmount}
                  onChange={(e) => set({ blurAmount: +e.target.value })}
                  className="w-full accent-teal-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={blurBgFillCanvas} className="text-xs py-2 bg-gray-700 hover:bg-green-600 hover:text-white text-gray-300 rounded-lg transition-colors font-medium">Fill Canvas</button>
                <button onClick={blurBgMatchImage} className="text-xs py-2 bg-gray-700 hover:bg-amber-600 hover:text-white text-gray-300 rounded-lg transition-colors font-medium">Match Image</button>
              </div>
              <p className="text-xs text-gray-400">
                Use <span className="text-amber-400 font-semibold">○ BG Layer</span> in the preview to freely drag and resize.
              </p>
            </div>
          )}

          {/* Export */}
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-1.5"><span className="w-2 h-2 bg-green-400 rounded-full inline-block"></span> Export</h4>
            <div className="flex flex-wrap gap-1">
              {FORMATS.map((f) => (
                <button key={f} onClick={() => set({ format: f })} className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${s.format === f ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-400">
              <span className="text-green-400 font-medium">{s.canvasW}x{s.canvasH}</span>
              <span className="mx-1.5 text-gray-400">|</span>
              <span className="text-green-400 font-medium">{realSize !== null ? fmtBytes(realSize) : "..."}</span>
            </div>
            <button onClick={() => setShowExport(true)} className="w-full px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-green-600/20">
              Export {FORMAT_LABELS[s.format]}
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-5 py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Canvas Size */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <button onClick={() => toggleSection('canvas')} className="w-full flex items-center justify-between">
              <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full inline-block"></span> Canvas Size
              </h4>
              <Chevron collapsed={collapsed.canvas} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${collapsed.canvas ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Width</label>
                      <input type="number" value={s.canvasW} onChange={(e) => setCanvasW(+e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-green-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Height</label>
                      <input type="number" value={s.canvasH} onChange={(e) => setCanvasH(+e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-green-500 focus:outline-none" />
                    </div>
                  </div>
                  <div className="border-t border-gray-700/50"></div>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((p) => (
                      <button key={p.label} onClick={() => set({ canvasW: p.w, canvasH: p.h })} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg transition-colors">{p.label}</button>
                    ))}
                    {customPresets && customPresets.map((p) => (
                      <span key={p.label} className="inline-flex items-center gap-0.5">
                        <button onClick={() => set({ canvasW: p.w, canvasH: p.h })} className="text-xs px-2 py-1 bg-teal-900/40 hover:bg-teal-700/50 text-teal-300 rounded-l-lg transition-colors border border-teal-700/40">{p.label}</button>
                        <button onClick={() => onRemovePreset(p.label)} className="text-xs px-1 py-1 bg-teal-900/40 hover:bg-red-600/50 text-teal-500 hover:text-red-300 rounded-r-lg transition-colors border border-l-0 border-teal-700/40">×</button>
                      </span>
                    ))}
                    <button
                      onClick={() => onAddPreset({ label: `${s.canvasW}x${s.canvasH}`, w: s.canvasW, h: s.canvasH })}
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-green-600/60 text-gray-400 hover:text-green-200 rounded-lg transition-colors border border-dashed border-gray-600"
                      title="Save current canvas size as a custom preset"
                    >+ Save</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Image Size */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <button onClick={() => toggleSection('image')} className="w-full flex items-center justify-between">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 bg-amber-400 rounded-full inline-block"></span> Image Size
              </h4>
              <Chevron collapsed={collapsed.image} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${collapsed.image ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Width</label>
                      <input type="number" value={Math.round(s.imgW)} onChange={(e) => setImgW(+e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-amber-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Height</label>
                      <input type="number" value={Math.round(s.imgH)} onChange={(e) => setImgH(+e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-amber-500 focus:outline-none" />
                    </div>
                  </div>
                  <div className="border-t border-gray-700/50"></div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={1} max={400} value={imgScalePercent} onChange={(e) => setImgScale(+e.target.value)} className="flex-1 accent-amber-500" />
                    <span className="text-xs text-gray-400 w-10 text-right">{imgScalePercent}%</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={s.lockImgAspect} onChange={(e) => set({ lockImgAspect: e.target.checked })} className="accent-amber-500" />
                    <span className="text-xs text-gray-400">Lock aspect ratio</span>
                  </label>
                  <div className="border-t border-gray-700/50"></div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => { snapFit(); snapHeight(); }} className="text-xs py-2 bg-gray-700 hover:bg-green-600 hover:text-white text-gray-400 rounded-lg transition-colors font-medium leading-tight">Fit<br/><span className="font-normal opacity-70">(Snap H)</span></button>
                    <button onClick={() => { snapFill(); snapWidth(); }} className="text-xs py-2 bg-gray-700 hover:bg-green-600 hover:text-white text-gray-400 rounded-lg transition-colors font-medium leading-tight">Fill<br/><span className="font-normal opacity-70">(Snap W)</span></button>
                  </div>
                  <button onClick={centerImage} className="w-full text-xs py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">Center</button>
                </div>
              </div>
            </div>
          </div>

          {/* Crop & Rotate */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <button onClick={() => toggleSection('crop')} className="w-full flex items-center justify-between">
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5"><span className="w-2 h-2 bg-teal-400 rounded-full inline-block"></span> Crop & Rotate</h4>
              <Chevron collapsed={collapsed.crop} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${collapsed.crop ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  {/* Primary action: Enter / Apply / Cancel crop mode */}
                  {!cropMode ? (
                    <button onClick={enterCropMode} className="w-full text-xs py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-1.5">
                      ✂ Edit Crop
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={applyCropMode} className="flex-1 text-xs py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors font-semibold">✓ Apply</button>
                      <button onClick={cancelCropMode} className="flex-1 text-xs py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">✗ Cancel</button>
                    </div>
                  )}
                  {/* Secondary: numeric inputs for precision */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Crop X</label>
                      <input type="number" value={Math.round(s.cropX)} onChange={(e) => set({ cropX: clamp(+e.target.value, 0, s.origW - s.cropW) })} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-white text-sm focus:border-teal-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Crop Y</label>
                      <input type="number" value={Math.round(s.cropY)} onChange={(e) => set({ cropY: clamp(+e.target.value, 0, s.origH - s.cropH) })} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-white text-sm focus:border-teal-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Crop W</label>
                      <input type="number" value={Math.round(s.cropW)} onChange={(e) => set({ cropW: clamp(+e.target.value, 20, s.origW - s.cropX) })} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-white text-sm focus:border-teal-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Crop H</label>
                      <input type="number" value={Math.round(s.cropH)} onChange={(e) => set({ cropH: clamp(+e.target.value, 20, s.origH - s.cropY) })} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-white text-sm focus:border-teal-500 focus:outline-none" />
                    </div>
                  </div>
                  <button onClick={() => {
                    const sc = Math.min(s.canvasW / s.origW, s.canvasH / s.origH);
                    const nW = Math.round(s.origW * sc);
                    const nH = Math.round(s.origH * sc);
                    set({ cropX: 0, cropY: 0, cropW: s.origW, cropH: s.origH, imgW: nW, imgH: nH, imgX: Math.round((s.canvasW - nW) / 2), imgY: Math.round((s.canvasH - nH) / 2) });
                  }} className="w-full text-xs py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">Reset Crop</button>
                  <div className="border-t border-gray-700/50"></div>
                  <div>
                    <label className="text-xs text-gray-400">Rotation: {s.rotation}°</label>
                    <input type="range" min={-180} max={180} value={s.rotation} onChange={(e) => set({ rotation: +e.target.value })} className="w-full accent-teal-500" />
                    <div className="flex gap-1 mt-1">
                      {[0, 90, 180, 270].map((r) => (
                        <button key={r} onClick={() => set({ rotation: r })} className="flex-1 text-xs py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg">{r}°</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Export Dialog */}
      {showExport && (
        <ExportDialog item={item} imgRef={imgRef.current} settings={s} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

/* ─── Compute effective settings for an image using bulk options ─── */
function computeBulkSettings(orig, b) {
  const s = { ...orig };
  s.canvasW = b.canvasW; s.canvasH = b.canvasH;
  const aspect = s.cropW / s.cropH;
  if (b.snapMode === "fill") { const sc = Math.max(b.canvasW / s.cropW, b.canvasH / s.cropH); s.imgW = Math.round(s.cropW * sc); s.imgH = Math.round(s.cropH * sc); }
  else if (b.snapMode === "width") { s.imgW = b.canvasW; s.imgH = Math.round(b.canvasW / aspect); }
  else if (b.snapMode === "height") { s.imgH = b.canvasH; s.imgW = Math.round(b.canvasH * aspect); }
  else { const sc = Math.min(b.canvasW / s.cropW, b.canvasH / s.cropH); s.imgW = Math.round(s.cropW * sc); s.imgH = Math.round(s.cropH * sc); }
  s.imgX = Math.round((b.canvasW - s.imgW) / 2); s.imgY = Math.round((b.canvasH - s.imgH) / 2);
  s.bgMode = b.bgMode; s.bgColor = b.bgColor; s.format = b.format; s.quality = b.quality;
  if (b.bgMode === "blur") {
    s.blurAmount = b.blurAmount;
    if (b.blurBgSizeMode === "match") {
      s.blurBgX = s.imgX; s.blurBgY = s.imgY; s.blurBgW = s.imgW; s.blurBgH = s.imgH;
    } else {
      const bsc = Math.max(b.canvasW / s.cropW, b.canvasH / s.cropH);
      s.blurBgW = Math.round(s.cropW * bsc); s.blurBgH = Math.round(s.cropH * bsc);
      s.blurBgX = Math.round((b.canvasW - s.blurBgW) / 2); s.blurBgY = Math.round((b.canvasH - s.blurBgH) / 2);
    }
  }
  if (b.applyRotation) s.rotation = b.rotation;
  return s;
}

/* ─── Bulk Editor ─── */
function BulkEditor({ items, onRemove, onReorder, customPresets, onAddPreset, onRemovePreset }) {
  const [selIdx, setSelIdx] = useState(0);
  const imgRefs = useRef({});
  const [loadedMap, setLoadedMap] = useState({});
  const [realSize, setRealSize] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const thumbRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null); /* For drag-and-drop reordering */
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const toggleSection = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  /* Bulk settings */
  const [canvasW, setCanvasW] = useState(1920);
  const [canvasH, setCanvasH] = useState(1080);
  const [snapMode, setSnapMode] = useState("fit");
  const [bgMode, setBgMode] = useState("transparent");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [blurAmount, setBlurAmount] = useState(40);
  const [blurBgSizeMode, setBlurBgSizeMode] = useState("fill");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState(90);
  const [rotation, setRotation] = useState(0);
  const [applyRotation, setApplyRotation] = useState(false);

  const bulkOpts = { canvasW, canvasH, snapMode, bgMode, bgColor, blurAmount, blurBgSizeMode, format, quality, rotation, applyRotation };

  /* Load all images */
  useEffect(() => {
    items.forEach((item) => {
      if (imgRefs.current[item.id]) return;
      const img = new Image();
      img.onload = () => { imgRefs.current[item.id] = img; setLoadedMap((p) => ({ ...p, [item.id]: true })); };
      img.src = item.dataUrl;
    });
  }, [items]);

  /* Clamp selection */
  useEffect(() => { if (selIdx >= items.length) setSelIdx(Math.max(0, items.length - 1)); }, [items.length]);

  /* Resolution analysis: find majority resolution, flag outliers */
  const resInfo = (() => {
    const map = {};
    items.forEach((it) => { const k = `${it.settings.origW}x${it.settings.origH}`; map[k] = (map[k] || 0) + 1; });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const majorKey = sorted[0]?.[0] || "";
    const mismatch = sorted.length > 1;
    const outlierCount = mismatch ? items.length - (sorted[0]?.[1] || 0) : 0;
    const isOutlier = (it) => `${it.settings.origW}x${it.settings.origH}` !== majorKey;
    return { majorKey, mismatch, outlierCount, isOutlier };
  })();

  /* Selected item + effective settings */
  const selItem = items[selIdx] || items[0];
  const selImg = selItem ? imgRefs.current[selItem.id] : null;
  const effSettings = selItem ? computeBulkSettings(selItem.settings, bulkOpts) : null;

  /* Measure file size for preview */
  useEffect(() => {
    if (!selImg || !effSettings) return;
    setRealSize(null);
    const t = setTimeout(() => {
      try {
        const cv = renderToCanvas(selImg, effSettings);
        const mime = effSettings.format === "jpeg" ? "image/jpeg" : effSettings.format === "webp" ? "image/webp" : "image/png";
        const q = effSettings.format === "png" ? undefined : effSettings.quality / 100;
        cv.toBlob((blob) => { if (blob) setRealSize(blob.size); }, mime, q);
      } catch (e) { /* skip */ }
    }, 300);
    return () => clearTimeout(t);
  }, [selImg, canvasW, canvasH, snapMode, bgMode, bgColor, blurAmount, blurBgSizeMode, format, quality, rotation, applyRotation, selIdx]);

  const presets = [
    { label: "Original", w: selItem?.settings.origW || 1920, h: selItem?.settings.origH || 1080 },
    { label: "1920x1080", w: 1920, h: 1080 }, { label: "1080x1080", w: 1080, h: 1080 },
    { label: "1080x1920", w: 1080, h: 1920 }, { label: "800x600", w: 800, h: 600 }, { label: "512x512", w: 512, h: 512 },
  ];

  /* Export all to folder */
  const exportAll = async () => {
    setExporting(true);
    let dirHandle = null;
    if (window.showDirectoryPicker) {
      try { dirHandle = await window.showDirectoryPicker({ mode: "readwrite" }); } catch (e) { if (e.name === "AbortError") { setExporting(false); return; } }
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setExportProgress(`${i + 1} / ${items.length}: ${item.name}`);
      const img = imgRefs.current[item.id];
      if (!img) continue;
      const es = computeBulkSettings(item.settings, bulkOpts);
      const cv = renderToCanvas(img, es);
      const ext = es.format === "jpeg" ? "jpg" : es.format;
      const baseName = item.name.replace(/\.[^.]+$/, "");
      const fileName = `${baseName}-opt.${ext}`;
      const mime = es.format === "jpeg" ? "image/jpeg" : es.format === "webp" ? "image/webp" : "image/png";
      const q = es.format === "png" ? undefined : es.quality / 100;
      const blob = await new Promise((r) => cv.toBlob(r, mime, q));
      if (dirHandle) {
        try { const fh = await dirHandle.getFileHandle(fileName, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
        catch (e) { /* fallback */ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); URL.revokeObjectURL(a.href); }
      } else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); URL.revokeObjectURL(a.href); }
    }
    setExporting(false); setExportProgress("");
  };

  if (items.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 overflow-hidden mb-6">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">Bulk Edit</span>
          <span className="text-xs text-gray-400">{items.length} image{items.length !== 1 ? "s" : ""}</span>
          {exporting && <span className="text-xs text-teal-400 animate-pulse">{exportProgress}</span>}
        </div>
        <button onClick={exportAll} disabled={exporting} className="px-5 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
          {exporting ? "Exporting..." : "Export All"}
        </button>
      </div>

      {/* Resolution warning */}
      {resInfo.mismatch && (
        <div className="mx-5 mt-3 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-2">
          <span className="text-yellow-400 text-sm mt-0.5">&#9888;</span>
          <div>
            <span className="text-xs text-yellow-300 font-semibold">Resolution mismatch detected</span>
            <p className="text-xs text-yellow-400/80 mt-0.5">
              Majority resolution is <span className="font-mono font-bold text-yellow-300">{resInfo.majorKey}</span>.
              {" "}{resInfo.outlierCount} file{resInfo.outlierCount !== 1 ? "s have" : " has"} a different resolution (highlighted in yellow below).
            </p>
          </div>
        </div>
      )}

      {/* Thumbnail strip with drag-and-drop reordering */}
      <div className="relative border-b border-gray-700">
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-gray-900 to-transparent z-10 pointer-events-none"></div>
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-gray-900 to-transparent z-10 pointer-events-none"></div>
      <div ref={thumbRef} className="flex gap-2 px-5 py-3 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        {items.map((item, idx) => {
          const isOutlier = resInfo.isOutlier(item);
          const isSel = idx === selIdx;
          const isDragging = dragIdx === idx;
          const isDragTarget = dragIdx !== null && dragIdx !== idx;
          return (
            <React.Fragment key={item.id}>
              {dragOverIdx === idx && dragIdx !== null && dragIdx !== idx && (
                <div className="w-0.5 bg-teal-400 rounded-full self-stretch flex-shrink-0 -mx-0.5"></div>
              )}
            <div
              className={`flex-shrink-0 cursor-pointer group transition-all duration-150 ${isDragging ? "opacity-40 scale-95" : ""}`}
              style={{ width: 80 }}
              draggable
              onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                setDragOverIdx(e.clientX < midX ? idx : idx + 1);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx && onReorder) {
                  onReorder(dragIdx, idx);
                  if (selIdx === dragIdx) setSelIdx(idx);
                  else if (dragIdx < selIdx && idx >= selIdx) setSelIdx(selIdx - 1);
                  else if (dragIdx > selIdx && idx <= selIdx) setSelIdx(selIdx + 1);
                }
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              onClick={() => setSelIdx(idx)}
            >
              <div className={`relative rounded-lg overflow-hidden border-2 transition-colors ${isDragTarget ? "border-teal-400/70" : isSel ? "border-amber-500" : isOutlier ? "border-yellow-500/60" : "border-gray-700 group-hover:border-gray-500"}`} style={{ height: 52 }}>
                <img src={item.dataUrl} className="w-full h-full object-cover pointer-events-none" alt="" />
                {onRemove && (
                  <button onClick={(e) => { e.stopPropagation(); onRemove(item.id); }} className="absolute top-0 right-0 w-4 h-4 bg-red-600/80 hover:bg-red-500 text-white text-xs flex items-center justify-center rounded-bl opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                )}
              </div>
              <p className={`text-center mt-1 truncate text-xs ${isOutlier ? "text-yellow-400" : isSel ? "text-amber-400" : "text-gray-400"}`} title={item.name}>
                {item.name.length > 10 ? item.name.slice(0, 9) + "…" : item.name}
              </p>
              <p className={`text-center text-xs ${isOutlier ? "text-yellow-500/70 font-medium" : "text-gray-400"}`}>{item.settings.origW}x{item.settings.origH}</p>
            </div>
            {dragOverIdx === idx + 1 && dragIdx !== null && dragIdx !== idx + 1 && (
              <div className="w-0.5 bg-teal-400 rounded-full self-stretch flex-shrink-0 -mx-0.5"></div>
            )}
            </React.Fragment>
          );
        })}
      </div>
      </div>

      {/* Preview + Sidebar */}
      <div className="flex flex-col lg:flex-row border-b border-gray-700">
        {/* Preview Column */}
        <div className="lg:w-3/5 xl:w-2/3 p-4 flex flex-col">
          {/* Compact Original Thumbnail */}
          <div className="flex items-center gap-3 mb-3 bg-gray-800/40 rounded-lg p-2">
            <div className="relative bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ width: 100, height: 70, backgroundImage: checkerBg }}>
              {selItem && <img src={selItem.dataUrl} className="max-w-full max-h-full object-contain" alt="" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Original — {selItem?.name}</h3>
              <div className="text-xs text-gray-400 mt-0.5">{selItem?.settings.origW} x {selItem?.settings.origH} px — {fmtBytes(selItem?.fileSize || 0)}</div>
            </div>
          </div>

          {/* Interactive preview with bulk settings */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Preview — Canvas {canvasW}x{canvasH} — Image {effSettings ? `${Math.round(effSettings.imgW)}x${Math.round(effSettings.imgH)}` : "…"}
            </h3>
            <span className="text-xs text-gray-400">{selIdx + 1} / {items.length}</span>
          </div>
          {selImg && effSettings && (
            <InteractivePreview settings={effSettings} imgEl={selImg} onUpdate={() => {}} />
          )}
          <div className="mt-2 flex items-center justify-center gap-3">
            <span className="text-xs text-gray-400">
              {realSize !== null ? <span className="text-amber-400 font-medium">{fmtBytes(realSize)}</span> : <span className="animate-pulse">Calculating...</span>}
            </span>
            <span className="text-xs text-gray-500">|</span>
            <span className="text-xs text-gray-400">{FORMAT_LABELS[format]}</span>
          </div>
        </div>

        {/* Sidebar: Background + Export */}
        <div className="lg:w-2/5 xl:w-1/3 p-4 border-t lg:border-t-0 lg:border-l border-gray-700 space-y-4">
          {/* Background */}
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-400 rounded-full inline-block"></span> Background</h4>
            <div className="space-y-2">
              {["transparent", "color", "blur"].map((mode) => (
                <label key={mode} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="bulk-bg" checked={bgMode === mode} onChange={() => setBgMode(mode)} className="accent-amber-500" />
                  <span className="text-xs text-gray-400 capitalize">{mode === "blur" ? "Blur Fill" : mode}</span>
                </label>
              ))}
            </div>
            {bgMode === "color" && (
              <div className="flex items-center gap-2">
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border-0" />
                <input type="text" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white text-xs focus:border-amber-500 focus:outline-none" />
              </div>
            )}
            {bgMode === "blur" && (
              <div className="space-y-2" style={{ animation: "slideDown 200ms ease-out" }}>
                <label className="text-xs text-gray-400 block mb-1">Blur Amount: {blurAmount}px</label>
                <input type="range" min={1} max={100} value={blurAmount} onChange={(e) => setBlurAmount(+e.target.value)} className="w-full accent-teal-500" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => setBlurBgSizeMode("fill")}
                    className={`text-xs py-2 rounded-lg transition-colors font-medium ${blurBgSizeMode === "fill" ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-amber-600 hover:text-white"}`}
                  >Fill Canvas</button>
                  <button
                    onClick={() => setBlurBgSizeMode("match")}
                    className={`text-xs py-2 rounded-lg transition-colors font-medium ${blurBgSizeMode === "match" ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-teal-600 hover:text-white"}`}
                  >Match Image</button>
                </div>
              </div>
            )}
          </div>

          {/* Export Format + Quality */}
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-400 rounded-full inline-block"></span> Export Format</h4>
            <div className="flex flex-wrap gap-1">
              {FORMATS.map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${format === f ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>{FORMAT_LABELS[f]}</button>
              ))}
            </div>
            {format !== "png" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Quality</span>
                <input type="range" min={1} max={100} value={quality} onChange={(e) => setQuality(+e.target.value)} className="flex-1 accent-amber-500" />
                <span className="text-xs text-gray-400 w-10 text-right">{quality}%</span>
              </div>
            )}
            <div className="text-xs text-gray-400">
              <span className="text-amber-400 font-medium">{canvasW}x{canvasH}</span>
              <span className="mx-1.5 text-gray-400">|</span>
              <span className="text-amber-400 font-medium">{realSize !== null ? fmtBytes(realSize) : "…"}</span>
              <span className="text-gray-400 ml-1">(preview)</span>
            </div>
            <button onClick={exportAll} disabled={exporting} className="w-full px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-amber-600/20">
              {exporting ? "Exporting..." : `Export All (${items.length})`}
            </button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-5 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Canvas Size */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <button onClick={() => toggleSection('canvas')} className="w-full flex items-center justify-between">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 bg-amber-400 rounded-full inline-block"></span> Canvas Size
              </h4>
              <Chevron collapsed={collapsed.canvas} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${collapsed.canvas ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Width</label>
                      <input type="number" value={canvasW} onChange={(e) => setCanvasW(Math.max(1, +e.target.value))} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-amber-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Height</label>
                      <input type="number" value={canvasH} onChange={(e) => setCanvasH(Math.max(1, +e.target.value))} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:border-amber-500 focus:outline-none" />
                    </div>
                  </div>
                  <div className="border-t border-gray-700/50"></div>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((p) => (
                      <button key={p.label} onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg transition-colors">{p.label}</button>
                    ))}
                    {customPresets && customPresets.map((p) => (
                      <span key={p.label} className="inline-flex items-center gap-0.5">
                        <button onClick={() => { setCanvasW(p.w); setCanvasH(p.h); }} className="text-xs px-2 py-1 bg-teal-900/40 hover:bg-teal-700/50 text-teal-300 rounded-l-lg transition-colors border border-teal-700/40">{p.label}</button>
                        <button onClick={() => onRemovePreset(p.label)} className="text-xs px-1 py-1 bg-teal-900/40 hover:bg-red-600/50 text-teal-500 hover:text-red-300 rounded-r-lg transition-colors border border-l-0 border-teal-700/40">×</button>
                      </span>
                    ))}
                    <button onClick={() => onAddPreset({ label: `${canvasW}x${canvasH}`, w: canvasW, h: canvasH })} className="text-xs px-2 py-1 bg-gray-700 hover:bg-amber-600/60 text-gray-400 hover:text-amber-200 rounded-lg transition-colors border border-dashed border-gray-600" title="Save preset">+ Save</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Image Snap Mode */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <button onClick={() => toggleSection('snap')} className="w-full flex items-center justify-between">
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 bg-teal-400 rounded-full inline-block"></span> Image Snap
              </h4>
              <Chevron collapsed={collapsed.snap} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${collapsed.snap ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
              <div className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  <p className="text-xs text-gray-400">How images fit inside the canvas (per-image aspect ratio preserved)</p>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => setSnapMode("fit")} className={`text-xs py-2 rounded-lg font-medium transition-colors leading-tight ${snapMode === "fit" || snapMode === "height" ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>Fit<br/><span className="font-normal opacity-70">(Snap H)</span></button>
                    <button onClick={() => setSnapMode("fill")} className={`text-xs py-2 rounded-lg font-medium transition-colors leading-tight ${snapMode === "fill" || snapMode === "width" ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>Fill<br/><span className="font-normal opacity-70">(Snap W)</span></button>
                  </div>
                  {/* Rotation toggle */}
                  <div className="pt-2 border-t border-gray-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={applyRotation} onChange={(e) => setApplyRotation(e.target.checked)} className="accent-teal-500" />
                      <span className="text-xs text-gray-400">Apply shared rotation</span>
                    </label>
                    {applyRotation && (
                      <div className="mt-2">
                        <label className="text-xs text-gray-400">Rotation: {rotation}°</label>
                        <input type="range" min={-180} max={180} value={rotation} onChange={(e) => setRotation(+e.target.value)} className="w-full accent-teal-500" />
                        <div className="flex gap-1 mt-1">
                          {[0, 90, 180, 270].map((r) => (
                            <button key={r} onClick={() => setRotation(r)} className="flex-1 text-xs py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg">{r}°</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─── Main App ─── */
export default function FitMyBit() {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("individual");
  const [dragOver, setDragOver] = useState(false);
  const [customPresets, setCustomPresets] = useState([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [historyTick, setHistoryTick] = useState(0); /* Bumped after undo/redo to force canUndo/canRedo recalc */
  const inputRef = useRef(null);
  const itemHistoryRef = useRef({});
  /* Debounce timers: rapid changes (arrow key nudges, sliders) are batched into
     one history entry after 600ms of inactivity instead of 1 entry per px.     */
  const historyTimerRef = useRef({});

  const addPreset = useCallback((p) => {
    setCustomPresets((prev) => prev.some((e) => e.label === p.label) ? prev : [...prev, p]);
  }, []);
  const removePreset = useCallback((label) => {
    setCustomPresets((prev) => prev.filter((e) => e.label !== label));
  }, []);

  const addFiles = useCallback((files) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setItems((prev) => [...prev, {
            id: uid(), name: file.name, fileSize: file.size, dataUrl: e.target.result,
            settings: {
              origW: img.width, origH: img.height,
              canvasW: img.width, canvasH: img.height,
              imgX: 0, imgY: 0, imgW: img.width, imgH: img.height,
              lockImgAspect: true, rotation: 0,
              cropX: 0, cropY: 0, cropW: img.width, cropH: img.height,
              bgMode: "transparent", bgColor: "#ffffff",
              format: "png", quality: 90,
              blurAmount: 40,
              blurBgX: 0, blurBgY: 0, blurBgW: img.width, blurBgH: img.height,
            }
          }]);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); };

  const onReorder = useCallback((fromIdx, toIdx) => {
    setItems(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }, []);

  /* ── History model: hist.history is an array of settings SNAPSHOTS.
        hist.history[0] = the state before the first change (original).
        hist.history[1] = the state after first change, etc.
        hist.index = the index of the CURRENT displayed state.

     On change  → slice off any redo-future, push the NEW snapshot, advance index.
     On undo    → decrement index, apply hist.history[hist.index].
     On redo    → increment index, apply hist.history[hist.index].
     canUndo    → hist.index > 0  (something before us)
     canRedo    → hist.index < hist.history.length - 1  (something after us)   */

  /* Flush any pending debounced history entry for an item immediately.
     Called before undo/redo so a batch of arrow-key nudges becomes one entry. */
  const flushPending = useCallback((itemId) => {
    const hist = itemHistoryRef.current[itemId];
    if (!hist || hist.pending === undefined) return;
    clearTimeout(historyTimerRef.current[itemId]);
    delete historyTimerRef.current[itemId];
    hist.history = hist.history.slice(0, hist.index + 1);
    hist.history.push(hist.pending);
    hist.index = hist.history.length - 1;
    if (hist.history.length > 50) { hist.history.shift(); hist.index = Math.max(0, hist.index - 1); }
    delete hist.pending;
  }, []);

  /* onChange is stable (useCallback + reads itemsRef, not items) so the keyboard
     handler's empty-dep useEffect always has a working version — not a stale closure.
     History commits are debounced: rapid consecutive changes (arrow nudges, sliders)
     are batched into ONE history entry after 600ms, not one entry per pixel.         */
  const onChange = useCallback((updated) => {
    const prevItem = itemsRef.current.find(i => i.id === updated.id);
    if (prevItem && prevItem.settings !== updated.settings) {
      let hist = itemHistoryRef.current[updated.id];
      if (!hist) {
        /* First change ever — seed with the original snapshot */
        hist = { history: [prevItem.settings], index: 0 };
        itemHistoryRef.current[updated.id] = hist;
      }
      /* Store latest new settings as "pending" — cancel any existing timer */
      hist.pending = updated.settings;
      clearTimeout(historyTimerRef.current[updated.id]);
      /* Commit to history after 600ms with no further changes */
      historyTimerRef.current[updated.id] = setTimeout(() => {
        if (hist.pending !== undefined) {
          hist.history = hist.history.slice(0, hist.index + 1);
          hist.history.push(hist.pending);
          hist.index = hist.history.length - 1;
          if (hist.history.length > 50) { hist.history.shift(); hist.index = Math.max(0, hist.index - 1); }
          delete hist.pending;
          setHistoryTick(t => t + 1);
        }
      }, 600);
    }
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []); /* [] is safe — only reads refs (itemsRef, itemHistoryRef, historyTimerRef) */

  const onRemove = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  /* handleUndo/handleRedo use refs — never stale, safe from keyboard handler and buttons.
     Both flush any pending debounced change first so arrow-key nudges become ONE entry. */
  const handleUndo = useCallback(() => {
    const activeItem = itemsRef.current[activeIdxRef.current];
    if (!activeItem) return;
    flushPending(activeItem.id);
    const hist = itemHistoryRef.current[activeItem.id];
    if (!hist || hist.index <= 0) return;
    hist.index--;
    const snap = hist.history[hist.index];
    setItems(prev => prev.map(i => i.id === activeItem.id ? { ...i, settings: snap } : i));
    setHistoryTick(t => t + 1);
  }, [flushPending]);

  const handleRedo = useCallback(() => {
    const activeItem = itemsRef.current[activeIdxRef.current];
    if (!activeItem) return;
    flushPending(activeItem.id);
    const hist = itemHistoryRef.current[activeItem.id];
    if (!hist || hist.index >= hist.history.length - 1) return;
    hist.index++;
    const snap = hist.history[hist.index];
    setItems(prev => prev.map(i => i.id === activeItem.id ? { ...i, settings: snap } : i));
    setHistoryTick(t => t + 1);
  }, [flushPending]);

  const getHistoryState = (idx) => {
    void historyTick; /* Reading this makes React re-run this on every tick bump */
    const item = items[idx ?? activeImageIdx];
    if (!item) return { canUndo: false, canRedo: false };
    const hist = itemHistoryRef.current[item.id];
    if (!hist) return { canUndo: false, canRedo: false };
    return { canUndo: hist.index > 0, canRedo: hist.index < hist.history.length - 1 };
  };

  /* Use refs to avoid stale closures in keyboard handler */
  const itemsRef = useRef(items);
  const activeIdxRef = useRef(activeImageIdx);
  const modeRef = useRef(mode);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { activeIdxRef.current = activeImageIdx; }, [activeImageIdx]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey; /* Works on both Windows/Linux (Ctrl) and macOS (Cmd) */
      const key = e.key.toLowerCase();
      const curItems = itemsRef.current;
      const curIdx = activeIdxRef.current;
      const curMode = modeRef.current;

      /* Dual check: e.code is the physical key (layout-independent), e.key as fallback.
         Must call preventDefault() FIRST — before any condition — for Cmd+Z on macOS Chrome
         to prevent the browser's native "blink/undo" behaviour.                            */
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
      const isF = e.code === 'KeyF' || e.key === 'f' || e.key === 'F';
      const isC = e.code === 'KeyC' || e.key === 'c' || e.key === 'C';
      const isY = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y';

      if (mod && !e.shiftKey && isZ) {
        e.preventDefault(); handleUndo();
      } else if (mod && e.shiftKey && isZ) {
        e.preventDefault(); handleRedo();
      } else if (mod && isY) {
        e.preventDefault(); handleRedo();
      } else if (!mod && !e.shiftKey && isF) {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it && curMode === 'individual') {
          const s = it.settings; const sc = Math.min(s.canvasW / s.cropW, s.canvasH / s.cropH);
          const nW = Math.round(s.cropW * sc); const nH = Math.round(s.cropH * sc);
          onChange({ ...it, settings: { ...s, imgW: nW, imgH: nH, imgX: Math.round((s.canvasW - nW) / 2), imgY: Math.round((s.canvasH - nH) / 2) } });
        }
      } else if (!mod && e.shiftKey && isF) {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it && curMode === 'individual') {
          const s = it.settings; const sc = Math.max(s.canvasW / s.cropW, s.canvasH / s.cropH);
          const nW = Math.round(s.cropW * sc); const nH = Math.round(s.cropH * sc);
          onChange({ ...it, settings: { ...s, imgW: nW, imgH: nH, imgX: Math.round((s.canvasW - nW) / 2), imgY: Math.round((s.canvasH - nH) / 2) } });
        }
      } else if (!mod && !e.shiftKey && isC) {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it && curMode === 'individual') {
          const s = it.settings;
          onChange({ ...it, settings: { ...s, imgX: Math.round((s.canvasW - s.imgW) / 2), imgY: Math.round((s.canvasH - s.imgH) / 2) } });
        }
      } else if (e.key === 'ArrowUp' && !mod && curMode === 'individual') {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it) { const d = e.shiftKey ? -10 : -1; onChange({ ...it, settings: { ...it.settings, imgY: it.settings.imgY + d } }); }
      } else if (e.key === 'ArrowDown' && !mod && curMode === 'individual') {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it) { const d = e.shiftKey ? 10 : 1; onChange({ ...it, settings: { ...it.settings, imgY: it.settings.imgY + d } }); }
      } else if (e.key === 'ArrowLeft' && !mod && curMode === 'individual') {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it) { const d = e.shiftKey ? -10 : -1; onChange({ ...it, settings: { ...it.settings, imgX: it.settings.imgX + d } }); }
      } else if (e.key === 'ArrowRight' && !mod && curMode === 'individual') {
        e.preventDefault();
        const it = curItems[curIdx];
        if (it) { const d = e.shiftKey ? 10 : 1; onChange({ ...it, settings: { ...it.settings, imgX: it.settings.imgX + d } }); }
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
      } else if (e.key === 'Escape') {
        setShowShortcuts(false);
      } else if (curMode === 'bulk') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveImageIdx(prev => Math.max(0, prev - 1)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setActiveImageIdx(prev => Math.min(curItems.length - 1, prev + 1)); }
        else if (mod && e.shiftKey && key === 'e') { e.preventDefault(); }
      }
    };

    /* Use document + capture:true so our handler fires BEFORE Chrome's native
       Cmd+Z "undo" handler — that's what caused the page to blink with no effect. */
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []); /* Empty deps — all state accessed via refs */

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col">
      <style>{`@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } } ::selection { background-color: rgba(34,197,94,0.28); color: #fff; }`}</style>
      <div className="sticky top-0 z-50 bg-gray-900/90 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect width="100" height="100" rx="18" fill="#3EBE8B"/>
              <rect x="7"  y="7"  width="26" height="26" rx="4" fill="#A8DFCB"/>
              <rect x="37" y="7"  width="26" height="26" rx="4" fill="#7DD4B4"/>
              <rect x="7"  y="37" width="26" height="26" rx="4" fill="#5CC9A4"/>
              <rect x="67" y="37" width="26" height="26" rx="4" fill="#1B7A62"/>
              <rect x="37" y="67" width="26" height="26" rx="4" fill="#1E8268"/>
              <rect x="67" y="67" width="26" height="26" rx="4" fill="#145F4E"/>
            </svg>
            <h1 className="text-base font-bold text-white">Fit<span style={{ color: "#66bc8f" }}>My</span>Bit</h1>
            <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">{items.length} image{items.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              <button onClick={() => setMode("individual")} className={`px-4 py-2.5 sm:py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === "individual" ? "bg-green-700 text-white" : "text-gray-400 hover:text-white"}`}>Individual</button>
              <button onClick={() => setMode("bulk")} className={`px-4 py-2.5 sm:py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === "bulk" ? "bg-amber-600 text-white" : "text-gray-400 hover:text-white"}`}>Bulk</button>
            </div>
            <button onClick={() => setShowShortcuts(!showShortcuts)} className="px-3 py-2.5 sm:py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-lg transition-colors border border-gray-700 flex items-center gap-1.5" title="Keyboard shortcuts">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h12"/></svg>
              <span>Controls</span>
            </button>
            <button onClick={() => inputRef.current?.click()} className="px-4 py-2.5 sm:py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg transition-colors border border-gray-700">+ Add Images</button>
          </div>
        </div>
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />

      <div className="max-w-7xl mx-auto px-6 py-6 flex-1">
        {items.length === 0 ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-3xl p-20 text-center cursor-pointer transition-all ${dragOver ? "border-green-500 bg-green-500/10" : "border-gray-700 hover:border-gray-500 hover:bg-gray-900"}`}
          >
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
            </div>
            <p className="text-lg font-semibold text-gray-300 mb-1">Drop images here or click to browse</p>
            <p className="text-sm text-gray-400">Supports PNG, JPG, WebP, GIF, BMP, SVG and more</p>
          </div>
        ) : (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border border-dashed rounded-xl p-3 text-center mb-6 transition-all ${dragOver ? "border-green-500 bg-green-500/10" : "border-gray-800 hover:border-gray-600"}`}
            >
              <p className="text-xs text-gray-400">Drop more images here</p>
            </div>
            {mode === "bulk" ? (
              <BulkEditor items={items} onRemove={onRemove} onReorder={onReorder} customPresets={customPresets} onAddPreset={addPreset} onRemovePreset={removePreset} />
            ) : (
              items.map((item, idx) => {
                const histState = getHistoryState(idx);
                return (
                  <div key={item.id} data-item-id={item.id} onClick={() => setActiveImageIdx(idx)}>
                    <ImageEditor
                      item={item}
                      onChange={onChange}
                      onRemove={items.length > 1 ? onRemove : null}
                      customPresets={customPresets}
                      onAddPreset={addPreset}
                      onRemovePreset={removePreset}
                      onUndo={handleUndo}
                      onRedo={handleRedo}
                      canUndo={histState.canUndo}
                      canRedo={histState.canRedo}
                    />
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Shortcuts Panel */}
      {showShortcuts && (
        <ShortcutsPanel onClose={() => setShowShortcuts(false)} mode={mode} />
      )}

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect width="100" height="100" rx="18" fill="#3EBE8B"/>
              <rect x="7"  y="7"  width="26" height="26" rx="4" fill="#A8DFCB"/>
              <rect x="37" y="7"  width="26" height="26" rx="4" fill="#7DD4B4"/>
              <rect x="7"  y="37" width="26" height="26" rx="4" fill="#5CC9A4"/>
              <rect x="67" y="37" width="26" height="26" rx="4" fill="#1B7A62"/>
              <rect x="37" y="67" width="26" height="26" rx="4" fill="#1E8268"/>
              <rect x="67" y="67" width="26" height="26" rx="4" fill="#145F4E"/>
            </svg>
            <span className="text-xs font-medium text-white">Fit<span style={{ color: "#66bc8f" }}>My</span>Bit</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-xs text-gray-400">
              Coded with love and tea ☕ by{" "}
              <a
                href="https://johnydomansky.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors underline underline-offset-2"
              style={{ color: "#66bc8f", textDecorationColor: "#66bc8f" }}
              >
                Johny Domanský
              </a>
            </p>
            <p className="text-xs text-gray-400">© {new Date().getFullYear()} FitMyBit · All pixels stretched to fit</p>
          </div>
          <div className="hidden sm:block w-24" />{/* spacer to keep center balanced */}
        </div>
      </footer>
    </main>
  );
}
