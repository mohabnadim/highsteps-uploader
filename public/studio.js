// High Steps studio composite.
// Takes a cut-out product (transparent PNG) and places it on a lit studio sweep with a
// realistic floor shadow. Only the backdrop, shadow and overall tone change: the product's
// own pixels are never redrawn, so logos, stitching and hardware stay exactly as shot.
(function () {
  const BACKDROPS = [
    { id: 'bone', name: 'Bone', color: '#EBE5DC' },
    { id: 'cream', name: 'Studio cream', color: '#E9E2D9' },
    { id: 'paper', name: 'Paper', color: '#F3F0EA' },
    { id: 'stone', name: 'Stone', color: '#DCD6CE' },
    { id: 'white', name: 'Pure white', color: '#FFFFFF' },
  ];
  const LOOK = { auto: true, exposure: 0, warmth: 0, contrast: 0, saturation: 0, edge: 0.25, shadow: 1 };
  const PLACE = { scale: 1, offX: 0, offY: 0, rotate: 0, keystone: 0 };
  const OUT = { W: 1600, H: 2000, padding: 0.11 };
  // Close-up framing matches the reference shoot: the body of the piece fills the frame
  // (about 84% of the width), sits low with a short floor, and thin straps or chains may
  // run off the edge. 'full' keeps the whole product inside the frame instead.
  const FRAMING = { closeup: { bodyW: 0.84, bodyH: 0.6, baseY: 0.86 } };

  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  })();

  const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb = (a, alpha = 1) => `rgba(${a.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${alpha})`;
  const shade = (c, k) => c.map((v) => (k >= 0 ? v + (255 - v) * k : v * (1 + k)));

  // Crop a cut-out to its visible pixels and measure where it touches the floor
  function trim(src) {
    const w = src.width, h = src.height;
    const d = src.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("Couldn't find the product in this photo.");
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
    x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    const cd = g.getImageData(0, 0, cw, ch).data;
    const band = Math.max(2, Math.round(ch * 0.07));
    let bx0 = cw, bx1 = -1;
    for (let y = ch - band; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (cd[(y * cw + x) * 4 + 3] > 128) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; }
      }
    }
    if (bx1 < 0) { bx0 = 0; bx1 = cw - 1; }
    return { canvas: c, base: { x0: bx0 / cw, x1: bx1 / cw } };
  }

  // Perspective (keystone) and straighten (rotate) on the cut-out, then re-trim and measure.
  // Keystone squeezes or widens the top relative to the bottom, undoing the "looking down"
  // look of a phone held above the product. Pixels are resampled, never repainted.
  function geometry(ph) {
    const P = ph.place, rot = P.rotate || 0, ks = P.keystone || 0;
    const key = rot + '|' + ks;
    if (ph._geo && ph._geoKey === key && ph._geoSrc === ph.cut) return ph._geo;
    let src = ph.cut;
    if (ks) {
      const w = src.width, h = src.height, maxF = 1 + Math.abs(ks);
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * maxF); c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const step = 2;
      for (let y = 0; y < h; y += step) {
        const t = y / (h - 1);              // 0 top .. 1 bottom
        const f = 1 + ks * (1 - 2 * t);     // ks>0 widens the top, narrows the bottom
        const dw = w * f;
        g.drawImage(src, 0, y, w, Math.min(step, h - y), (c.width - dw) / 2, y, dw, Math.min(step, h - y));
      }
      src = c;
    }
    if (rot) {
      const a = rot * Math.PI / 180, w = src.width, h = src.height;
      const cw = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)));
      const chh = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
      const c = document.createElement('canvas');
      c.width = cw; c.height = chh;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.translate(cw / 2, chh / 2); g.rotate(a); g.drawImage(src, -w / 2, -h / 2);
      src = c;
    }
    const t = (ks || rot) ? trim(src) : { canvas: src, base: ph.base, body: null };
    if (!t.body) t.body = bodyBox(t.canvas);
    ph._geo = t; ph._geoKey = key; ph._geoSrc = ph.cut;
    return t;
  }

  // The main body of the product, ignoring thin straps and chains, as fractions of the canvas
  function bodyBox(c) {
    const w = c.width, h = c.height;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const rows = new Uint32Array(h), cols = new Uint32Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) { rows[y]++; cols[x]++; }
    const span = (arr) => {
      let max = 0; for (const v of arr) if (v > max) max = v;
      const th = max * 0.22; let a = 0, b = arr.length - 1;
      while (a < b && arr[a] < th) a++;
      while (b > a && arr[b] < th) b--;
      return [a, b];
    };
    const [y0, y1] = span(rows), [x0, x1] = span(cols);
    return { x0: x0 / w, x1: (x1 + 1) / w, y0: y0 / h, y1: (y1 + 1) / h };
  }

  // Tone and edge adjustments on the cut-out, cached on the photo object
  function adjusted(ph) {
    const L = ph.look;
    const key = JSON.stringify([L.auto, L.exposure, L.warmth, L.contrast, L.saturation, L.edge]);
    const geo = geometry(ph);
    if (ph._adj && ph._adjKey === key && ph._adjSrc === geo.canvas) return ph._adj;
    const src = geo.canvas, w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;

    let lo = 0, hi = 255;
    if (L.auto) {
      if (!ph._stats || ph._statsSrc !== ph.cut) { // stats from the original cut-out
        const sd = ph.cut.getContext('2d').getImageData(0, 0, ph.cut.width, ph.cut.height).data;
        const hist = new Uint32Array(256); let n = 0;
        for (let i = 0; i < sd.length; i += 4) {
          if (sd[i + 3] > 200) { hist[(sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) | 0]++; n++; }
        }
        let acc = 0, a = 0, b = 255;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.004) { a = v; break; } }
        acc = 0;
        for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.004) { b = v; break; } }
        ph._stats = { lo: a, hi: b }; ph._statsSrc = ph.cut;
      }
      // Mild levels stretch on brightness only, so colours are not shifted
      lo = ph._stats.lo * 0.6;
      hi = 255 - (255 - ph._stats.hi) * 0.6;
      if (hi - lo < 40) { lo = 0; hi = 255; }
    }
    const span = hi - lo, ex = Math.pow(2, L.exposure), ct = 1 + L.contrast, sat = 1 + L.saturation;
    const wr = 1 + L.warmth * 0.08, wb = 1 - L.warmth * 0.08, e0 = L.edge * 110;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      let r = ((d[i] - lo) / span) * 255 * ex * wr;
      let gg = ((d[i + 1] - lo) / span) * 255 * ex;
      let b = ((d[i + 2] - lo) / span) * 255 * ex * wb;
      if (ct !== 1) { r = (r - 128) * ct + 128; gg = (gg - 128) * ct + 128; b = (b - 128) * ct + 128; }
      if (sat !== 1) {
        const y = r * 0.299 + gg * 0.587 + b * 0.114;
        r = y + (r - y) * sat; gg = y + (gg - y) * sat; b = y + (b - y) * sat;
      }
      d[i] = r; d[i + 1] = gg; d[i + 2] = b;
      if (e0 > 0 && a < 255) {
        const t = Math.max(0, Math.min(1, (a - e0) / (255 - e0)));
        d[i + 3] = 255 * t * t * (3 - 2 * t);
      }
    }
    g.putImageData(img, 0, 0);
    ph._adj = out; ph._adjKey = key; ph._adjSrc = geo.canvas;
    return out;
  }

  // Draws only the blurred shadow of a shape (works in every browser, Safari included)
  function shadowOnly(ctx, color, blur, draw) {
    const OFF = 20000;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = OFF;
    ctx.translate(-OFF, 0);
    draw();
    ctx.restore();
  }

  // ph needs: cut (canvas), base, look, place. Renders into canvas at OUT size.
  function render(ph, canvas, backdrop, framing = 'closeup') {
    const W = OUT.W, H = OUT.H;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const base = hexToRgb(backdrop);
    const white = backdrop.toUpperCase() === '#FFFFFF';

    ctx.fillStyle = rgb(base);
    ctx.fillRect(0, 0, W, H);
    if (!white) {
      const rg = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.hypot(W, H) * 0.62);
      rg.addColorStop(0, rgb(shade(base, 0.22)));
      rg.addColorStop(0.55, rgb(base));
      rg.addColorStop(1, rgb(shade(base, -0.06)));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.035; ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    const prod = adjusted(ph), geo = ph._geo, P = ph.place, pad = OUT.padding;
    let s, x, y;
    if (framing === 'closeup') {
      const F = FRAMING.closeup, B = geo.body;
      const bw = (B.x1 - B.x0) * prod.width, bh = (B.y1 - B.y0) * prod.height;
      s = Math.min((W * F.bodyW) / bw, (H * F.bodyH) / bh) * P.scale;
      // centre the body, sit its base low in the frame
      x = W / 2 - ((B.x0 + B.x1) / 2) * prod.width * s + P.offX * W;
      y = H * F.baseY - B.y1 * prod.height * s + P.offY * H;
    } else {
      s = Math.min((W * (1 - 2 * pad)) / prod.width, (H * (1 - 2 * pad)) / prod.height) * P.scale;
      x = (W - prod.width * s) / 2 + P.offX * W;
      y = (H - prod.height * s) / 2 + H * 0.03 + P.offY * H;
    }
    const dw = prod.width * s, dh = prod.height * s;
    const yb = y + dh, st = ph.look.shadow;

    if (st > 0) {
      const sc = shade(base, -0.72);
      const bx0 = x + geo.base.x0 * dw, bx1 = x + geo.base.x1 * dw;
      const bcx = (bx0 + bx1) / 2, bw = Math.max(bx1 - bx0, dw * 0.25);
      const k = Math.min(W, H) / 2000;
      // wide soft pool of shade under the piece
      shadowOnly(ctx, rgb(sc, 0.22 * st), 90 * k, () => {
        ctx.beginPath(); ctx.ellipse(bcx, yb - 4 * k, bw * 0.55, Math.max(dh * 0.03, 14 * k), 0, 0, Math.PI * 2); ctx.fill();
      });
      // the silhouette squashed onto the floor, so the shadow follows the shape
      shadowOnly(ctx, rgb(sc, 0.2 * st), 36 * k, () => {
        const fh = Math.max(dh * 0.07, 10 * k);
        ctx.drawImage(prod, x + dw * 0.02, yb - fh * 0.75, dw * 0.96, fh);
      });
      // tight, darker line where it touches the floor
      shadowOnly(ctx, rgb(sc, 0.5 * st), 12 * k, () => {
        ctx.beginPath(); ctx.ellipse(bcx, yb - 2 * k, bw * 0.47, Math.max(dh * 0.008, 4 * k), 0, 0, Math.PI * 2); ctx.fill();
      });
      // faint lift around the body for depth
      ctx.save();
      ctx.shadowColor = rgb(sc, 0.1 * st); ctx.shadowBlur = 40 * k; ctx.shadowOffsetY = 14 * k;
      ctx.drawImage(prod, x, y, dw, dh);
      ctx.restore();
    }
    ctx.drawImage(prod, x, y, dw, dh);
  }

  function toBlob(ph, backdrop, framing, quality = 0.92) {
    const c = document.createElement('canvas');
    render(ph, c, backdrop, framing);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  }

  window.Studio = { BACKDROPS, LOOK, PLACE, OUT, FRAMING, trim, render, toBlob };
})();
