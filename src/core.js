/* CLEAN SEA Academy — núcleo de generación de certificados (pdf-lib + fontkit, globales por CDN).
   Usa la plantilla base (PDF original sin placeholders) y dibuja sólo los tres campos variables. */
var CSCore = (function () {
  var NAVY = [0.106, 0.216, 0.396];
  var ASC = 0.334; // centro óptico de Archivo: (ascent+descent)/2 en em
  // Geometría medida sobre el PDF original (pt, origen arriba-izquierda)
  var F = {
    name:  { font: "XB", size: 37.5, lh: 1.04, tc: -0.5625, maxlines: 2, minsize: 20, x0: 112.78, top: 186.98, w: 617.25, h: 81 },
    title: { font: "B",  size: 18,   lh: 1.30, tc: -0.09,   maxlines: 3, minsize: 11, x0: 136.16, top: 307.49, w: 570,    h: 72 },
    date:  { font: "SB", size: 11.25, cx: 565.06641, baseline: 402.75 }
  };
  var CHARSET = null; // Set de code points admitidos (intersección de las tres fuentes)

  function b64ToBytes(b64) {
    if (typeof atob === "function") {
      var s = atob(b64), u = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }

  var assets = null;
  function init(a) {
    var bytes = function (x) { return typeof x === "string" ? b64ToBytes(x) : x; };
    assets = { base: bytes(a.base), XB: bytes(a.XB), B: bytes(a.B), SB: bytes(a.SB) };
    CHARSET = new Set(a.charset);
  }

  function clean(s) { return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim(); }

  function unsupported(s) {
    var bad = [];
    for (var ch of s) { if (!CHARSET.has(ch.codePointAt(0)) && bad.indexOf(ch) < 0) bad.push(ch); }
    return bad;
  }

  function measure(font, text, size, tc) {
    var n = Array.from(text).length;
    return font.widthOfTextAtSize(text, size) + tc * Math.max(0, n - 1);
  }

  function wrap(font, text, size, tc, maxw) {
    var words = text.split(" "), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var cand = cur ? cur + " " + words[i] : words[i];
      if (!cur || measure(font, cand, size, tc) <= maxw) cur = cand;
      else { lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function layout(font, text, cfg) {
    var size = cfg.size;
    for (;;) {
      var tc = cfg.tc * size / cfg.size;
      var lines = wrap(font, text, size, tc, cfg.w);
      var fits = lines.length <= cfg.maxlines && lines.every(function (l) { return measure(font, l, size, tc) <= cfg.w; });
      if (fits || size <= cfg.minsize) return { size: size, tc: tc, lines: lines, fits: fits, reduced: size < cfg.size };
      size = Math.round((size - 0.5) * 100) / 100;
    }
  }

  function draw(page, font, key, lines, size, tc, xs, ysTop, H) {
    var P = PDFLib;
    var ops = [P.pushGraphicsState(), P.beginText(), P.setFontAndSize(key, size),
               P.setFillingRgbColor(NAVY[0], NAVY[1], NAVY[2]), P.setCharacterSpacing(tc)];
    for (var i = 0; i < lines.length; i++) {
      ops.push(P.setTextMatrix(1, 0, 0, 1, xs[i], H - ysTop[i]));
      ops.push(P.showText(font.encodeText(lines[i])));
    }
    ops.push(P.endText(), P.popGraphicsState());
    page.pushOperators.apply(page, ops);
  }

  // Analiza sin generar: sirve para validar nombres y títulos antes de emitir.
  var measureDoc = null;
  async function measureFonts() {
    if (measureDoc) return measureDoc;
    var doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    var opt = { subset: false, features: { kern: false, liga: false } };
    measureDoc = { XB: await doc.embedFont(assets.XB, opt), B: await doc.embedFont(assets.B, opt) };
    return measureDoc;
  }
  async function check(name, title) {
    var m = await measureFonts();
    return { name: name ? layout(m.XB, clean(name), F.name) : null, title: title ? layout(m.B, clean(title), F.title) : null };
  }

  async function generate(v) {
    var name = clean(v.name), title = clean(v.title), date = clean(v.date);
    if (!v.preview) {
      if (!name || !title || !date) throw new Error("Faltan datos obligatorios");
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) throw new Error("Fecha con formato inválido");
    }
    var bad = unsupported(name + title + date);
    if (bad.length) throw new Error("Caracteres no admitidos: " + bad.join(" "));

    var P = PDFLib;
    var doc = await P.PDFDocument.load(assets.base, { updateMetadata: false });
    doc.registerFontkit(fontkit);
    var opt = { subset: true, features: { kern: false, liga: false } };
    var fonts = { XB: await doc.embedFont(assets.XB, opt), B: await doc.embedFont(assets.B, opt), SB: await doc.embedFont(assets.SB, opt) };
    var page = doc.getPage(0);
    var H = page.getHeight();
    var info = {};
    // El content stream original modifica la matriz sin restaurarla: se lo encapsula en q/Q.
    var ctx = doc.context;
    var qRef = ctx.register(ctx.flateStream("q\n")), QRef = ctx.register(ctx.flateStream("\nQ\n"));
    page.node.wrapContentStreams(qRef, QRef);

    [["name", name], ["title", title]].forEach(function (pair) {
      if (!pair[1]) return;
      var cfg = F[pair[0]], font = fonts[cfg.font];
      var key = page.node.newFontDictionary(font.name, font.ref);
      var L = layout(font, pair[1], cfg), lead = L.size * cfg.lh, n = L.lines.length;
      var xs = [], ys = [];
      L.lines.forEach(function (ln, i) {
        xs.push(cfg.x0 + (cfg.w - measure(font, ln, L.size, L.tc)) / 2);
        ys.push(cfg.top + cfg.h / 2 - (n - 1) * lead / 2 + i * lead + ASC * L.size);
      });
      draw(page, font, key, L.lines, L.size, L.tc, xs, ys, H);
      info[pair[0]] = { lines: n, size: L.size, reduced: L.reduced, fits: L.fits };
    });
    var fd = fonts.SB, kd = page.node.newFontDictionary(fd.name, fd.ref);
    if (date) draw(page, fd, kd, [date], F.date.size, 0, [F.date.cx - measure(fd, date, F.date.size, 0) / 2], [F.date.baseline], H);

    doc.setTitle("Certificado de Asistencia — " + name);
    doc.setAuthor("CLEAN SEA S.A.");
    doc.setSubject(title);
    doc.setCreator("CLEAN SEA Academy — Generador de Certificados");
    doc.setProducer("CLEAN SEA Academy");
    var bytes = await doc.save({ useObjectStreams: true });
    return { bytes: bytes, info: info };
  }

  async function verify(bytes) {
    var d = await PDFLib.PDFDocument.load(bytes);
    var pages = d.getPages();
    if (pages.length !== 1) throw new Error("El PDF no tiene una sola página");
    var s = pages[0].getSize();
    if (Math.abs(s.width - 841.92) > 1 || Math.abs(s.height - 595.92) > 1) throw new Error("Tamaño de página inesperado");
    return true;
  }

  // ── Nombres de archivo ──
  function stripAccents(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function fsSafe(s) {
    return stripAccents(clean(s)).replace(/[\u2012-\u2015]/g, "-").replace(/[\\\/:*?"<>|#%{}~&\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  }
  function cut(s, max) {
    if (s.length <= max) return s;
    var c = s.slice(0, max), sp = c.lastIndexOf(" ");
    return (sp > max * 0.5 ? c.slice(0, sp) : c).replace(/[\s\-,;.]+$/, "");
  }
  function shortCourse(s, max) {
    return cut(fsSafe(s), max || 60).replace(/[\s.]+$/, "");
  }
  function fileName(company, name, course) {
    return "CLEAN SEA - " + cut(fsSafe(company), 60) + " - " + cut(fsSafe(name), 80).replace(/[\s.]+$/, "") + ".pdf";
  }
  function uniqueName(used, folder, fname) {
    var key = (folder + "/" + fname).toLowerCase(), base = fname.replace(/\.pdf$/i, ""), n = 1, out = fname;
    while (used.has(key)) { n++; out = base + " (" + n + ").pdf"; key = (folder + "/" + out).toLowerCase(); }
    used.add(key);
    return out;
  }

  return { init: init, generate: generate, verify: verify, check: check, unsupported: unsupported, clean: clean,
           fsSafe: fsSafe, cut: cut, shortCourse: shortCourse, fileName: fileName, uniqueName: uniqueName, stripAccents: stripAccents };
})();

// Carga la plantilla y las tipografías publicadas en /assets.
export async function cargarCore() {
  var get = async function (f) {
    var r = await fetch("/assets/" + f);
    if (!r.ok) throw new Error("No se pudo cargar " + f);
    return new Uint8Array(await r.arrayBuffer());
  };
  var res = await Promise.all([get("plantilla.pdf"), get("XB.ttf"), get("B.ttf"), get("SB.ttf"),
    fetch("/assets/charset.json").then(function (r) { return r.json(); })]);
  CSCore.init({ base: res[0], XB: res[1], B: res[2], SB: res[3], charset: res[4] });
  return CSCore;
}
export default CSCore;
