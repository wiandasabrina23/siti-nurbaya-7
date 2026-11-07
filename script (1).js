(function () {
  "use strict";

  /* ============================================================
     PENGATURAN: tempel alamat Web app Google Apps Script di antara
     tanda kutip di bawah ini (alamat diawali https://script.google.com/...
     dan diakhiri /exec). Lihat panduan pemasangan, langkah 4.
     ============================================================ */
  var API_URL = "TEMPEL_ALAMAT_APPS_SCRIPT_DI_SINI";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  var BLN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  var HARI_P = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  var DOW = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
  var FLOW_LABEL = { ringan: "ringan", sedang: "sedang", banyak: "banyak" };
  var NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'\-]{1,29}$/u;
  var KELAS_RE = /^(?:[\p{L}\p{N}][\p{L}\p{N} .\-\/]{0,19})?$/u;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function longDate(s) { var d = parse(s); return HARI_P[d.getDay()] + ", " + d.getDate() + " " + BULAN[d.getMonth()] + " " + d.getFullYear(); }
  function shortDate(s) { var d = parse(s); return d.getDate() + " " + BLN[d.getMonth()]; }
  function weekStart(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function todayStr() { return fmt(new Date()); }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.textContent = ""; }, 4000);
  }

  /* ---------- koneksi ke server ---------- */
  var CONFIGURED = /^https?:\/\//.test(API_URL);
  var ERR = {
    nama_dipakai: "Nama itu sudah dipakai. Tambahkan inisial atau kelas, misalnya \"Siti A\".",
    login_gagal: "Nama atau PIN belum cocok. Periksa ejaan nama dan PIN-mu.",
    terkunci: "Terlalu banyak PIN yang salah. Tunggu 15 menit, lalu coba lagi.",
    input: "Isian belum sesuai. Periksa nama, kelas, dan PIN.",
    data_besar: "Catatan terlalu besar untuk disimpan. Hubungi petugas.",
    batas: "Jumlah hasil skrining yang bisa disimpan sudah penuh. Hubungi petugas.",
    jaringan: "Tidak bisa terhubung ke server. Periksa internet, lalu coba lagi.",
    crypto: "Browser ini belum mendukung penyimpanan aman. Buka website lewat alamat yang diawali https://.",
    buka: "Catatan tidak bisa dibuka. Hubungi petugas.",
    server: "Server sedang bermasalah. Coba lagi sebentar lagi."
  };
  function pesan(code) { return ERR[code] || ERR.server; }

  function api(body) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : null;
    return fetch(API_URL, { method: "POST", body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, redirect: "follow" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (timer) clearTimeout(timer); return j && typeof j === "object" ? j : { ok: false, error: "server" }; },
            function () { if (timer) clearTimeout(timer); return { ok: false, error: "jaringan" }; });
  }

  /* ---------- kunci dan enkripsi (di perangkat siswi) ---------- */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function hasCrypto() { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); }
  function nameKey(n) { return String(n).trim().toLowerCase().replace(/\s+/g, " "); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function baseKey(pin) { return crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits", "deriveKey"]); }
  // Bukti PIN untuk server. Server tidak pernah menerima PIN aslinya.
  function deriveAuth(key, pin) {
    return baseKey(pin).then(function (km) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("rematri-auth:" + key), iterations: 100000 }, km, 256);
    }).then(hex);
  }
  // Kunci untuk mengenkripsi catatan. Tidak pernah dikirim ke server.
  function deriveCrypt(key, pin) {
    return baseKey(pin).then(function (km) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("rematri-enc:" + key), iterations: 150000 }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encryptNotes(ck, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, ck, enc.encode(JSON.stringify(obj))).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
      return b64(out);
    });
  }
  function decryptNotes(ck, blob) {
    if (!blob) return Promise.resolve({ t: {}, h: {} });
    var a = unb64(blob);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: a.slice(0, 12) }, ck, a.slice(12)).then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }
  function cleanNotes(n) {
    var out = { ttd: {}, haid: {}, rem: defaultRem() };
    if (n && n.t && typeof n.t === "object") Object.keys(n.t).forEach(function (k) { if (isDate(k) && n.t[k] === true) out.ttd[k] = true; });
    if (n && n.h && typeof n.h === "object") Object.keys(n.h).forEach(function (k) { if (isDate(k) && FLOW_LABEL[n.h[k]]) out.haid[k] = n.h[k]; });
    out.rem = cleanRem(n && n.r);
    return out;
  }
  function cleanSkrining(list) {
    return (Array.isArray(list) ? list : []).map(function (s) {
      return { date: s.d, g: Number(s.g), f: Number(s.f), level: s.l, label: String(s.label || ""), bahaya: !!s.b };
    }).filter(function (s) { return isDate(s.date) && ["hi", "mid", "lo"].indexOf(s.level) >= 0; });
  }

  /* ---------- navigasi ---------- */
  var VIEWS = ["beranda", "kenali", "cegah", "aman", "gizi", "bahaya", "skrining", "pantau"];
  function route() {
    var h = (location.hash || "").replace("#", "");
    if (VIEWS.indexOf(h) < 0) h = "beranda";
    VIEWS.forEach(function (v) { $("#v-" + v).hidden = v !== h; });
    $$("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    if (h === "pantau") renderPantau();
    if (h === "skrining") updateResultActions();
  }
  window.addEventListener("hashchange", route);

  /* ---------- skrining ---------- */
  var lastResult = null;
  function countChecked(name) { return $$('input[name="' + name + '"]:checked').length; }
  function levelOf(g, f, d) {
    if (d > 0) return { key: "hi", label: "Perlu pemeriksaan segera" };
    if (g >= 5 || (g >= 3 && f >= 3)) return { key: "hi", label: "Kemungkinan anemia tinggi" };
    if (g >= 2 || f >= 3) return { key: "mid", label: "Ada tanda yang mengarah ke anemia" };
    return { key: "lo", label: "Tanda anemia belum menonjol" };
  }
  var TEXTS = {
    hi: "Hasil ini bukan diagnosis. Periksakan kadar Hb ke puskesmas, UKS, atau fasilitas kesehatan dalam minggu ini. Sambil menunggu, makan lauk sumber zat besi dan minum TTD sesuai anjuran.",
    mid: "Periksakan Hb bila keluhan berlanjut sampai dua minggu. Mulai sekarang perbaiki asupan zat besi dan minum TTD secara teratur.",
    lo: "Tetap minum TTD rutin dan makan sumber zat besi. Ulangi skrining bila muncul keluhan baru."
  };
  function onQuiz(e) {
    e.preventDefault();
    var g = countChecked("g"), f = countChecked("f"), d = countChecked("d");
    var lv = levelOf(g, f, d);
    lastResult = { date: todayStr(), g: g, f: f, d: d, level: lv.key, label: lv.label, saved: false, busy: false };
    var chip = $("#res-chip"); chip.textContent = lv.label; chip.className = "chip " + lv.key;
    $("#res-g").textContent = g + "/8"; $("#res-f").textContent = f + "/6";
    $("#res-text").textContent = d > 0 && lv.key === "hi" && g < 5 ? TEXTS.hi : TEXTS[lv.key];
    $("#res-danger").hidden = d === 0;
    var r = $("#result"); r.hidden = false;
    updateResultActions();
    r.scrollIntoView({ block: "nearest" }); r.focus({ preventScroll: true });
  }
  function updateResultActions() {
    var box = $("#res-actions"); if (!box) return;
    if (!lastResult) { box.innerHTML = ""; return; }
    if (current) {
      box.innerHTML = lastResult.saved
        ? '<span class="status-ok" style="font-weight:600">Tersimpan di akunmu.</span>'
        : '<button type="button" class="btn" id="btn-save-res"' + (lastResult.busy ? " disabled" : "") + '>Simpan hasil ke akunku</button><p class="hint" style="flex-basis:100%">Petugas puskesmas dapat melihat hasil yang kamu simpan, bersama nama panggilan dan kelasmu.</p>';
      var b = $("#btn-save-res"); if (b) b.addEventListener("click", saveResult);
    } else {
      box.innerHTML = '<a class="btn ghost" href="#pantau">Masuk untuk menyimpan hasil</a>';
    }
  }
  function saveResult() {
    if (!current || !lastResult || lastResult.saved || lastResult.busy) return;
    var me = current, res = lastResult;
    res.busy = true; updateResultActions();
    api({ a: "skrining", nama: me.name, auth: me.auth, g: res.g, f: res.f, level: res.level, label: res.label, b: res.d > 0 }).then(function (r) {
      res.busy = false;
      if (r.ok) {
        res.saved = true;
        if (current === me) me.skrining.unshift({ date: todayStr(), g: res.g, f: res.f, level: res.level, label: res.label, bahaya: res.d > 0 });
        toast("Hasil skrining tersimpan di akunmu.");
      } else toast(pesan(r.error));
      updateResultActions();
    });
  }

  /* ---------- sinkronisasi catatan ---------- */
  var current = null;
  var dirty = false, saving = false, saveTimer = null, retryTimer = null;
  function setSync(t) { var el = $("#sync"); if (el) el.textContent = t; }
  function scheduleRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(flush, 10000); }
  function markDirty() {
    dirty = true; setSync("Menyimpan…");
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
  }
  function mergeNotes(srv) {
    var c = cleanNotes(srv);
    Object.keys(c.ttd).forEach(function (k) { if (!current.ttd[k]) current.ttd[k] = true; });
    Object.keys(c.haid).forEach(function (k) { if (!current.haid[k]) current.haid[k] = c.haid[k]; });
  }
  function refreshAll() {
    if (!current || $("#dash").hidden) return;
    renderCalendar(); renderEditor(); renderSummary();
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!current || !dirty || saving) return Promise.resolve();
    saving = true; dirty = false;
    var me = current, snap = { t: Object.assign({}, me.ttd), h: Object.assign({}, me.haid), r: me.rem || defaultRem() };
    return encryptNotes(me.ck, snap).then(function (blob) {
      return api({ a: "save", nama: me.name, auth: me.auth, rev: me.rev, blob: blob });
    }).then(function (r) {
      saving = false;
      if (current !== me) return;
      if (r.ok) {
        me.rev = r.rev;
        if (dirty) return flush();
        setSync("Tersimpan"); return;
      }
      if (r.error === "konflik") {
        return decryptNotes(me.ck, r.blob).then(function (srv) {
          mergeNotes(srv); me.rev = r.rev; dirty = true; refreshAll(); return flush();
        });
      }
      dirty = true;
      if (["login_gagal", "input", "data_besar", "terkunci"].indexOf(r.error) >= 0) { setSync("Gagal menyimpan. " + pesan(r.error)); return; }
      setSync(r.error === "jaringan" ? "Belum tersimpan, menunggu koneksi…" : "Belum tersimpan, mencoba lagi…");
      scheduleRetry();
    }).catch(function () {
      saving = false; dirty = true; setSync("Belum tersimpan, mencoba lagi…"); scheduleRetry();
    });
  }

  /* ---------- akun ---------- */
  var authTab = "reg";
  function showAuthTab(which) {
    authTab = which;
    var reg = which === "reg";
    $("#form-reg").hidden = !reg; $("#form-log").hidden = reg;
    $("#tab-reg").className = "btn" + (reg ? "" : " ghost"); $("#tab-log").className = "btn" + (reg ? " ghost" : "");
    $("#tab-reg").setAttribute("aria-selected", reg); $("#tab-log").setAttribute("aria-selected", !reg);
  }
  function setBusy(form, busy, text) {
    $$("button, input", form).forEach(function (el) { el.disabled = busy; });
    var b = $("button[type=submit]", form);
    if (b) { if (busy) { b.dataset.t = b.textContent; b.textContent = text; } else if (b.dataset.t) { b.textContent = b.dataset.t; } }
  }
  function openSession(name, kelas, key, auth, ck, data) {
    return decryptNotes(ck, data.blob).then(function (n) {
      var c = cleanNotes(n);
      current = { name: name, kelas: kelas, key: key, auth: auth, ck: ck, rev: Number(data.rev) || 0, ttd: c.ttd, haid: c.haid, rem: c.rem, skrining: cleanSkrining(data.skrining) };
      dirty = false; saving = false; clearTimeout(saveTimer); clearTimeout(retryTimer);
      selected = todayStr(); var t = new Date(); view = { y: t.getFullYear(), m: t.getMonth() };
      setSync("");
      renderPantau(); updateResultActions();
    }, function () { throw "buka"; });
  }
  function onRegister(e) {
    e.preventDefault();
    var err = $("#reg-err"); err.textContent = "";
    var name = $("#reg-name").value.trim().replace(/\s+/g, " "), kelas = $("#reg-kelas").value.trim(), pin = $("#reg-pin").value, pin2 = $("#reg-pin2").value;
    if (!NAME_RE.test(name)) { err.textContent = "Nama panggilan 2–30 karakter: huruf, angka, spasi, titik, atau tanda hubung, diawali huruf atau angka."; return; }
    if (!KELAS_RE.test(kelas)) { err.textContent = "Kelas maksimal 20 karakter, tanpa simbol khusus."; return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = "PIN harus 4 sampai 6 angka."; return; }
    if (pin !== pin2) { err.textContent = "Kedua PIN belum sama."; return; }
    if (!hasCrypto()) { err.textContent = ERR.crypto; return; }
    var form = $("#form-reg"), key = nameKey(name);
    setBusy(form, true, "Membuat akun…");
    Promise.all([deriveAuth(key, pin), deriveCrypt(key, pin)]).then(function (k) {
      return api({ a: "register", nama: name, kelas: kelas, auth: k[0] }).then(function (r) {
        if (!r.ok) throw r.error;
        return openSession(name, kelas, key, k[0], k[1], { rev: 0, blob: "", skrining: [] });
      });
    }).then(function () {
      form.reset(); toast("Akun dibuat. Selamat datang, " + name + ".");
    }, function (c) {
      err.textContent = pesan(typeof c === "string" ? c : "server");
    }).then(function () { setBusy(form, false); });
  }
  function onLogin(e) {
    e.preventDefault();
    var err = $("#log-err"); err.textContent = "";
    var name = $("#log-acc").value.trim().replace(/\s+/g, " "), pin = $("#log-pin").value;
    if (!name) { err.textContent = "Tulis nama panggilanmu."; return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = "PIN harus 4 sampai 6 angka."; return; }
    if (!hasCrypto()) { err.textContent = ERR.crypto; return; }
    var form = $("#form-log"), key = nameKey(name);
    setBusy(form, true, "Memeriksa…");
    Promise.all([deriveAuth(key, pin), deriveCrypt(key, pin)]).then(function (k) {
      return api({ a: "login", nama: name, auth: k[0] }).then(function (r) {
        if (!r.ok) throw r.error;
        return openSession(String(r.nama || name), String(r.kelas || ""), key, k[0], k[1], r);
      });
    }).then(function () {
      form.reset();
    }, function (c) {
      err.textContent = pesan(typeof c === "string" ? c : "server");
    }).then(function () { setBusy(form, false); });
  }
  function endSession() {
    current = null; dirty = false; saving = false; clearTimeout(saveTimer); clearTimeout(retryTimer);
    renderPantau(); updateResultActions();
  }
  function doLogout() {
    flush().then(function () {
      if (dirty) { toast("Catatan terakhir belum tersimpan. Tunggu sampai muncul tulisan Tersimpan, lalu keluar."); return; }
      endSession(); toast("Kamu sudah keluar.");
    });
  }
  function doDelete() {
    var me = current, btn = $("#btn-del-yes"); btn.disabled = true;
    api({ a: "hapus", nama: me.name, auth: me.auth }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { toast(pesan(r.error)); return; }
      $("#del-confirm").hidden = true; endSession(); toast("Akun dihapus.");
    });
  }

  /* ---------- kalender & perhitungan ---------- */
  var view = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var selected = todayStr();

  function periods(acc) {
    var ds = Object.keys(acc.haid).sort(), out = [];
    ds.forEach(function (d) {
      var last = out[out.length - 1];
      if (last && diffDays(last.end, d) <= 2) { last.end = d; last.days.push(d); }
      else out.push({ start: d, end: d, days: [d] });
    });
    out.forEach(function (p) {
      p.len = diffDays(p.start, p.end) + 1;
      p.banyak = p.days.filter(function (d) { return acc.haid[d] === "banyak"; }).length;
    });
    return out;
  }
  function cycleStats(acc) {
    var ps = periods(acc), cycles = [];
    for (var i = 1; i < ps.length; i++) cycles.push(diffDays(ps[i - 1].start, ps[i].start));
    var good = cycles.filter(function (c) { return c >= 15 && c <= 90; }).slice(-3);
    var avg = good.length ? Math.round(good.reduce(function (a, b) { return a + b; }, 0) / good.length) : null;
    var last = ps[ps.length - 1] || null;
    var next = null;
    if (last) next = fmt(addDays(parse(last.start), avg || 28));
    return { ps: ps, cycles: cycles, avg: avg, last: last, next: next };
  }

  function renderCalendar(focusDate) {
    var y = view.y, m = view.m, today = todayStr();
    $("#cal-title").textContent = BULAN[m] + " " + y;
    var first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
    var cs = cycleStats(current), html = DOW.map(function (d) { return '<div class="dow" aria-hidden="true">' + d + "</div>"; }).join("");
    for (var i = 0; i < offset; i++) html += "<div></div>";
    for (var d = 1; d <= dim; d++) {
      var ds = fmt(new Date(y, m, d)), flow = current.haid[ds], ttd = current.ttd[ds];
      var cls = "day" + (flow ? " haid f-" + flow : "") + (ds === today ? " today" : "") + (cs.next === ds && ds > today && !flow ? " pred" : "");
      var label = longDate(ds) + (flow ? ", haid " + flow : "") + (ttd ? ", sudah minum TTD" : "") + (cs.next === ds && ds > today ? ", perkiraan haid berikutnya" : "");
      html += '<button type="button" class="' + cls + '" data-date="' + ds + '" aria-pressed="' + (ds === selected) + '" aria-label="' + esc(label) + '"' + (ds > today ? " disabled" : "") + (ds === today ? ' aria-current="date"' : "") + '>' +
        '<span class="dn">' + d + '</span><span class="marks">' + (flow ? '<svg class="ic" aria-hidden="true"><use href="#i-drop"/></svg>' : "") + (ttd ? '<i class="caps"></i>' : "") + "</span></button>";
    }
    $("#cal-grid").innerHTML = html;
    var now = new Date();
    $("#cal-next").disabled = (y > now.getFullYear()) || (y === now.getFullYear() && m >= now.getMonth());
    $("#cal-prev").disabled = (now.getFullYear() * 12 + now.getMonth()) - (y * 12 + m) >= 36;
    if (focusDate) { var b = $('[data-date="' + focusDate + '"]', $("#cal-grid")); if (b) b.focus(); }
  }

  function renderEditor() {
    var ds = selected, future = ds > todayStr();
    $("#ed-date").textContent = longDate(ds);
    var on = !!current.ttd[ds], t = $("#ed-ttd");
    t.setAttribute("aria-pressed", on); t.disabled = future;
    $(".box", t).textContent = on ? "✓" : "";
    $("#ed-ttd-t").textContent = on ? "Sudah minum TTD" : "Tandai sudah minum TTD";
    var fl = current.haid[ds] || "";
    $$("#ed-flow button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-flow") === fl); b.disabled = future; });
  }

  function renderSummary() {
    var today = new Date(), ts = fmt(today), ws = weekStart(today), cnt = 0, haidDays = 0, haidTaken = 0;
    for (var i = 0; i < 7; i++) {
      var d = fmt(addDays(ws, i));
      if (d > ts) break;
      if (current.ttd[d]) cnt++;
      if (current.haid[d]) { haidDays++; if (current.ttd[d]) haidTaken++; }
    }
    $("#st-ttd-big").innerHTML = '<span class="mono">' + cnt + "</span> tablet";
    var msg;
    if (current.haid[ts]) msg = current.ttd[ts] ? "Hari ini haid dan TTD sudah diminum. Lanjutkan setiap hari selama haid." : "Hari ini kamu haid. Minum 1 tablet TTD hari ini.";
    else if (cnt > 0) msg = "Target mingguan tercapai. Pilih hari yang sama setiap minggu agar tidak lupa.";
    else msg = "Minggu ini belum ada TTD. Pilih satu hari tetap, lalu tandai di kalender setelah minum.";
    if (haidDays > 0) msg += " Saat haid minggu ini: " + haidTaken + " dari " + haidDays + " hari.";
    $("#st-ttd-msg").textContent = msg;

    var wk = "", metCount = 0;
    for (var k = 7; k >= 0; k--) {
      var s = addDays(ws, -7 * k), c = 0;
      for (var j = 0; j < 7; j++) if (current.ttd[fmt(addDays(s, j))]) c++;
      var st = c > 0 ? "met" : (k === 0 ? "pend" : "miss");
      if (c > 0) metCount++;
      wk += '<div class="wk ' + st + '"><span class="wkb" aria-hidden="true">' + (st === "met" ? "✓" : st === "miss" ? "–" : "…") + "</span><span>" + pad(s.getDate()) + "/" + pad(s.getMonth() + 1) + '</span><span class="sr-only">' + (st === "met" ? "ada TTD" : st === "miss" ? "tidak ada TTD" : "minggu berjalan, belum ada TTD") + "</span></div>";
    }
    var w = $("#weeks"); w.innerHTML = wk; w.setAttribute("aria-label", "Kepatuhan TTD: " + metCount + " dari 8 minggu terakhir ada catatan");

    var cs = cycleStats(current), notes = [], big, cm;
    if (!cs.last) {
      big = "Belum ada catatan";
      cm = "Tandai hari haid di kalender. Setelah dua kali haid tercatat, siklusmu akan dihitung.";
    } else {
      var daysTo = diffDays(ts, cs.next);
      big = "Haid terakhir: " + shortDate(cs.last.start);
      cm = "Lama haid terakhir " + cs.last.len + " hari. ";
      cm += cs.avg ? "Rata-rata siklus " + cs.avg + " hari. " : "Perkiraan memakai siklus 28 hari karena baru ada satu catatan. ";
      if (daysTo > 0) cm += "Haid berikutnya diperkirakan " + shortDate(cs.next) + ", sekitar " + daysTo + " hari lagi.";
      else if (daysTo === 0) cm += "Haid diperkirakan mulai hari ini.";
      else cm += "Perkiraan haid sudah lewat " + (-daysTo) + " hari. Catat bila haid sudah mulai.";
      if (cs.last.len > 7 || cs.last.banyak >= 3) notes.push("Haid terakhir lama atau banyak. Haid seperti ini membuat tubuh kehilangan lebih banyak zat besi. Ceritakan ke guru UKS atau petugas puskesmas dan periksakan Hb.");
      var lastCycle = cs.cycles.length ? cs.cycles[cs.cycles.length - 1] : null;
      if (lastCycle !== null && (lastCycle < 21 || lastCycle > 45)) notes.push("Siklus terakhir " + lastCycle + " hari, di luar kisaran umum 21–45 hari pada remaja. Pantau beberapa bulan. Bila terulang, tanyakan ke petugas kesehatan.");
    }
    $("#st-cyc-big").textContent = big; $("#st-cyc-msg").textContent = cm;
    $("#st-notes").innerHTML = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");

    var h = current.skrining.slice(0, 5);
    $("#hist").innerHTML = h.length ? h.map(function (s) {
      return '<li><span class="mono">' + esc(shortDate(s.date)) + '</span><span class="chip ' + esc(s.level) + '">' + esc(s.label) + '</span><span class="hint">keluhan ' + s.g + "/8, risiko " + s.f + "/6</span></li>";
    }).join("") : '<li class="hint">Belum ada hasil tersimpan. Isi skrining, lalu simpan hasilnya ke akunmu.</li>';
  }

  function renderDash() {
    $("#dash-sub").textContent = current.kelas ? "Kelas " + current.kelas : "Akun pribadi";
    $("#dash-hello").textContent = "Halo, " + current.name;
    renderCalendar(); renderEditor(); renderSummary(); remRender(); remTick();
  }

  function renderPantau() {
    $("#mem-notice").hidden = CONFIGURED;
    if (!current) {
      $("#auth").hidden = false; $("#dash").hidden = true;
      $$("#auth input, #auth button").forEach(function (el) { el.disabled = !CONFIGURED; });
      showAuthTab(authTab);
    } else {
      $("#auth").hidden = true; $("#dash").hidden = false; renderDash();
    }
  }

  function afterChange(focusDate) { markDirty(); renderCalendar(focusDate); renderEditor(); renderSummary(); remTick(); }


  /* ---------- pengingat minum TTD ---------- */
  var REM_DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
  var ICS_DAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  var REM_SW = true;
  var snoozeUntil = 0, memNotified = "";
  function defaultRem() { return { on: false, day: 0, time: "19:00", haid: true, notif: false }; }
  function cleanRem(r) {
    var d = defaultRem();
    if (!r || typeof r !== "object") return d;
    if (typeof r.on === "boolean") d.on = r.on;
    if (Number.isInteger(r.day) && r.day >= 0 && r.day <= 6) d.day = r.day;
    if (typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) d.time = r.time;
    if (typeof r.haid === "boolean") d.haid = r.haid;
    if (typeof r.notif === "boolean") d.notif = r.notif;
    return d;
  }
  function remGet() { if (!current.rem) current.rem = defaultRem(); return current.rem; }
  function persistRem() { markDirty(); }
  function dtStr(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00"; }
  function nextStart(day, time) {
    var now = new Date(), p = time.split(":").map(Number);
    for (var i = 0; i < 8; i++) {
      var b = addDays(now, i), d = new Date(b.getFullYear(), b.getMonth(), b.getDate(), p[0], p[1], 0);
      if ((d.getDay() + 6) % 7 === day && d > now) return d;
    }
    return addDays(now, 1);
  }
  function weekHasTtd(now) {
    var ws = weekStart(now), ts = fmt(now);
    for (var i = 0; i < 7; i++) { var d = fmt(addDays(ws, i)); if (d > ts) break; if (current.ttd[d]) return true; }
    return false;
  }
  function remDue() {
    if (!current) return false;
    var r = remGet(); if (!r.on) return false;
    var now = new Date(), today = fmt(now), hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (hm < r.time || current.ttd[today]) return false;
    if (r.haid && current.haid[today]) return true;
    return (now.getDay() + 6) % 7 >= r.day && !weekHasTtd(now);
  }
  function wasNotified(key) { try { return localStorage.getItem("rematri.notified") === key; } catch (e) { return memNotified === key; } }
  function setNotified(key) { memNotified = key; try { localStorage.setItem("rematri.notified", key); } catch (e) {} }
  function legacyNote(title, body, tag) {
    try { var n = new Notification(title, { body: body, tag: tag }); n.onclick = function () { window.focus(); n.close(); }; } catch (e) {}
  }
  function showNote(title, body, tag) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        return navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.active && reg.showNotification) return reg.showNotification(title, { body: body, tag: tag });
          legacyNote(title, body, tag);
        }, function () { legacyNote(title, body, tag); });
      }
    } catch (e) {}
    legacyNote(title, body, tag);
  }
  function permState() { try { return "Notification" in window ? Notification.permission : "unsupported"; } catch (e) { return "unsupported"; } }
  function remText() {
    return current.haid[todayStr()] && remGet().haid ? "Hari ini kamu haid. Waktunya minum 1 tablet TTD." : "Waktunya minum tablet tambah darah (TTD) minggu ini.";
  }
  function remTick() {
    var b = $("#rem-banner"); if (!b) return;
    var due = !!current && remDue() && Date.now() >= snoozeUntil;
    b.hidden = !due;
    if (!due) return;
    $("#rem-banner-text").textContent = remText();
    var r = remGet(), key = todayStr() + "|" + current.name;
    if (r.notif && permState() === "granted" && !wasNotified(key)) { setNotified(key); showNote("SITI NURBAYA", remText(), "ttd-" + todayStr()); }
  }
  function gcalUrl(r) {
    var s = nextStart(r.day, r.time), e = new Date(s.getTime() + 15 * 60000);
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Minum tablet tambah darah (TTD)") +
      "&details=" + encodeURIComponent("Pengingat dari SITI NURBAYA. Minum 1 tablet TTD dengan air putih, setelah makan atau malam sebelum tidur.") +
      "&dates=" + dtStr(s) + "/" + dtStr(e) + "&recur=" + encodeURIComponent("RRULE:FREQ=WEEKLY;BYDAY=" + ICS_DAY[r.day]) + "&ctz=Asia%2FJakarta";
  }
  function icsText(r) {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SITI NURBAYA//Pengingat TTD//ID", "CALSCALE:GREGORIAN"];
    function ev(uid, start, rrule, summary, desc) {
      var end = new Date(start.getTime() + 15 * 60000);
      L.push("BEGIN:VEVENT", "UID:" + uid + "@siti-nurbaya", "DTSTAMP:" + stamp, "DTSTART:" + dtStr(start), "DTEND:" + dtStr(end), "RRULE:" + rrule,
        "SUMMARY:" + summary, "DESCRIPTION:" + desc, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + summary, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
    }
    ev("ttd-mingguan-" + stamp, nextStart(r.day, r.time), "FREQ=WEEKLY;BYDAY=" + ICS_DAY[r.day], "Minum tablet tambah darah (TTD)", "Minum 1 tablet TTD dengan air putih\\, setelah makan atau malam sebelum tidur.");
    if (r.haid) {
      var cs = cycleStats(current);
      if (cs.next && cs.next > todayStr()) {
        var p = r.time.split(":"), d0 = parse(cs.next);
        ev("ttd-haid-" + stamp, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), +p[0], +p[1], 0), "FREQ=DAILY;COUNT=7", "Perkiraan haid: minum TTD bila haid sudah mulai",
          "Perkiraan haid dimulai hari ini. Bila haid benar-benar mulai\\, minum 1 tablet TTD setiap hari selama haid.");
      }
    }
    L.push("END:VCALENDAR");
    return L.join("\r\n") + "\r\n";
  }
  function saveFile(name, text, mime) {
    function viaBlob() {
      var url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
    var use = window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null);
    return use.then(function (dl) {
      if (!dl) { viaBlob(); return; }
      return dl.save({ filename: name, data: text }).catch(function (e) { if (!(e && e.code === "declined")) viaBlob(); });
    }, viaBlob);
  }
  function remRender() {
    if (!current) return;
    var r = remGet(), sel = $("#rem-day");
    if (!sel.options.length) sel.innerHTML = REM_DAYS.map(function (d, i) { return '<option value="' + i + '">' + d + "</option>"; }).join("");
    sel.value = String(r.day); $("#rem-time").value = r.time; $("#rem-on").checked = r.on; $("#rem-haid").checked = r.haid;
    $("#rem-sum").textContent = r.on ? "Setiap " + REM_DAYS[r.day] + ", " + r.time.replace(":", ".") + (r.haid ? ", dan saat haid" : "") : "Belum diaktifkan";
    var perm = permState(), on = r.notif && perm === "granted", note;
    if (perm === "unsupported") note = "Browser ini tidak mendukung notifikasi. Banner pengingat tetap muncul saat website terbuka, dan kalender HP bisa dipakai.";
    else if (perm === "denied") note = "Notifikasi diblokir di browser. Izinkan lewat pengaturan situs, atau pakai kalender HP.";
    else if (on) note = "Notifikasi aktif. Berbunyi sekali sehari saat jam pengingat tiba, selama website masih terbuka.";
    else note = "Notifikasi browser belum diaktifkan.";
    $("#rem-notif").textContent = on ? "Matikan notifikasi browser" : "Aktifkan notifikasi browser";
    $("#rem-notif").disabled = perm === "unsupported";
    $("#rem-notif-note").textContent = note;
    $("#rem-gcal").href = gcalUrl(r);
  }
  function remChanged() { persistRem(); remRender(); remTick(); }
  function enableNotif() {
    var r = remGet();
    if (r.notif && permState() === "granted") { r.notif = false; remChanged(); return; }
    var done = false;
    function after(p) { if (done) return; done = true; r.notif = p === "granted"; if (r.notif) r.on = true; remChanged(); }
    try { var res = Notification.requestPermission(after); if (res && res.then) res.then(after); } catch (e) { after("denied"); }
  }
  function remInit() {
    if (REM_SW && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(function () {});
    $("#rem-on").addEventListener("change", function () { remGet().on = this.checked; remChanged(); });
    $("#rem-day").addEventListener("change", function () { remGet().day = Number(this.value); remChanged(); });
    $("#rem-time").addEventListener("change", function () { if (/^\d{2}:\d{2}$/.test(this.value)) { remGet().time = this.value; remChanged(); } });
    $("#rem-haid").addEventListener("change", function () { remGet().haid = this.checked; remChanged(); });
    $("#rem-notif").addEventListener("click", enableNotif);
    $("#rem-ics").addEventListener("click", function () { saveFile("pengingat-ttd.ics", icsText(remGet()), "text/calendar"); toast("File pengingat siap. Buka file itu untuk menambahkannya ke kalender."); });
    $("#rem-done").addEventListener("click", function () { current.ttd[todayStr()] = true; afterChange(); remTick(); toast("TTD hari ini tercatat."); });
    $("#rem-snooze").addEventListener("click", function () { snoozeUntil = Date.now() + 3600000; remTick(); toast("Diingatkan lagi satu jam lagi."); });
    setInterval(remTick, 30000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") remTick(); });
  }

  /* ---------- pasang event ---------- */
  function init() {
    $("#quiz").addEventListener("submit", onQuiz);
    $("#quiz-reset").addEventListener("click", function () {
      $("#quiz").reset(); $("#result").hidden = true; lastResult = null; window.scrollTo(0, 0);
    });

    $("#tab-reg").addEventListener("click", function () { showAuthTab("reg"); });
    $("#tab-log").addEventListener("click", function () { showAuthTab("log"); });
    $("#form-reg").addEventListener("submit", onRegister);
    $("#form-log").addEventListener("submit", onLogin);
    $("#btn-logout").addEventListener("click", doLogout);

    $("#cal-grid").addEventListener("click", function (e) {
      var b = e.target.closest("[data-date]"); if (!b || b.disabled) return;
      selected = b.getAttribute("data-date"); renderCalendar(selected); renderEditor();
    });
    $("#cal-prev").addEventListener("click", function () { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); });
    $("#cal-next").addEventListener("click", function () { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); });
    $("#ed-ttd").addEventListener("click", function () {
      if (selected > todayStr()) return;
      if (current.ttd[selected]) delete current.ttd[selected]; else current.ttd[selected] = true;
      afterChange();
    });
    $("#ed-flow").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-flow]"); if (!b || b.disabled || selected > todayStr()) return;
      var v = b.getAttribute("data-flow");
      if (v) current.haid[selected] = v; else delete current.haid[selected];
      afterChange();
    });

    $("#btn-del").addEventListener("click", function () { $("#del-confirm").hidden = false; });
    $("#btn-del-no").addEventListener("click", function () { $("#del-confirm").hidden = true; });
    $("#btn-del-yes").addEventListener("click", doDelete);

    window.addEventListener("online", function () { if (dirty) flush(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && dirty) flush(); });

    remInit();
    route();
  }
  init();
})();
