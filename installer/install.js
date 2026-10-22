/*!
 * Aurum Theme Installer for Forumotion / Forumactif
 * - Lists exactly what will be overwritten (with a diff) before touching anything
 * - Forces a downloadable backup, can restore from it
 * - Runs inside the admin's own logged-in session; talks only to this forum and GitHub
 *
 * Loaded by installer.html. Config comes from window.AURUM_INSTALLER { owner, repo, ref }.
 */
(function () {
  'use strict';

  var L = (typeof window !== 'undefined' && window.AURUM_INSTALLER) || {};
  var CFG = {
    name: 'Aurum Theme',
    owner: L.owner || 'arsic1992',
    repo: L.repo || 'aurum-theme',
    ref: L.ref || 'main',
    cssPath: 'css/style.css',        // aurum-min.css is intentionally ignored
    templatesPath: 'templates/',
    delay: 150,                      // ms between admin requests (be gentle with the forum)
    concurrency: 4,
    retries: 2
  };

  /* ------------------------------------------------------------------ *
   * Forumotion (phpBB3 version) template IDs, keyed by template name.
   * Taken from the Forumactif Edge installer. Templates not listed here
   * can be added in manifest.json: { "ids": { "login_body": 117 } }
   * ------------------------------------------------------------------ */
  var IDS = {
    // general
    agreement: 101, confirm_body: 103, buy_credits: 105, error_body: 106, faq_body: 107, faq_dhtml: 108,
    greeting_popup: 109, index_body: 110, index_box: 111, jumpbox: 112, memberlist_body: 113,
    message_body: 114, overall_footer_begin: 115, overall_header: 116, search_body: 118,
    search_results_posts: 119, search_results_topics: 120, topics_list_box: 124, viewforum_body: 125,
    viewonline_body: 126, viewtopic_body: 127, topics_blog_box: 130, viewcomments_body: 131,
    overall_footer_end: 133,
    // portal
    mod_chatbox: 901, mod_news: 902, mod_poll: 903, mod_recent_topics: 904, mod_search: 905,
    mod_statistics: 906, mod_whoisonline: 907, standard: 911, mod_top_posters: 912, mod_keywords: 913,
    mod_social_bookmarking: 914, mod_rss_feeds: 915, mod_login: 916, mod_most_active_topics: 917,
    mod_most_viewed_topics: 918, mod_most_active_starters: 919, mod_top_post_users_week: 920,
    mod_top_post_users_month: 921,
    // gallery
    album_cat_body: 201, album_cat_top10: 202, album_edit_body: 203, album_formsearch_body: 204,
    album_index_body: 205, album_modcp_body: 206, album_moderate_body: 207, album_nuffimage_box: 208,
    album_search_body: 210, album_showpage_body: 211, album_slideshow_body: 212, album_upload_body: 213,
    // calendar
    birthday_list_box: 401, calendar_body: 402, calendar_box: 403, calendar_overview_profil: 404,
    calendar_overview_topic: 405, calendar_scheduler_body: 406,
    // user groups
    groupcp_info_body: 801, groupcp_pending_info: 802, groupcp_user_body: 803,
    // posting + private messages
    posting_body: 501, posting_poll_body: 504, posting_preview: 505, posting_topic_review: 509,
    privmsg_topic_review: 510, privmsgs_body: 511, privmsgs_popup: 512, privmsgs_preview: 513,
    privmsgs_read_body: 514,
    // moderation
    merge_body: 601, merge_select_body: 602, modcp_body: 603, modcp_move: 604, modcp_split: 605,
    modcp_viewip: 606, report_list_body: 607, report_popup_body: 608, report_view_body: 609,
    // profile
    profile_add_body: 701, profile_avatar_gallery: 702, profile_edit_signature: 704,
    profile_send_email: 705, profile_send_pass: 706, profile_view_body: 708, rpg_sheet: 710,
    rpg_sheet_edit: 711
  };
  var MOBILE_IDS = { overall_header: 1010 };

  /* ------------------------------------------------------------------ *
   * Pure helpers (unit-testable without a browser)
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim(); }

  // Encode one form value the way the forum's charset expects.
  // UTF-8 pages: normal encoding. Latin-1 pages (most Forumotion forums): Latin-1
  // percent-encoding, and anything above U+00FF becomes a numeric HTML entity.
  function encVal(s, charset) {
    s = String(s);
    if (/^utf-?8$/i.test(charset || 'utf-8')) { return encodeURIComponent(s); }
    var out = '';
    Array.from(s).forEach(function (ch) {
      var c = ch.codePointAt(0);
      if (c > 255) { out += '%26%23' + c + '%3B'; }
      else if (/[A-Za-z0-9\-_.~]/.test(ch)) { out += ch; }
      else { out += '%' + (c < 16 ? '0' : '') + c.toString(16).toUpperCase(); }
    });
    return out;
  }

  function encodeForm(data, charset) {
    return Object.keys(data).map(function (k) {
      return encodeURIComponent(k) + '=' + encVal(data[k], charset);
    }).join('&');
  }

  // Line diff. Returns [{t:'=' | '-' | '+' | '…', s:text}], unchanged runs collapsed.
  function diffLines(a, b, ctx) {
    ctx = ctx == null ? 2 : ctx;
    var A = norm(a).split('\n'), B = norm(b).split('\n');
    var s = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) { s++; }
    var ea = A.length, eb = B.length;
    while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    var a2 = A.slice(s, ea), b2 = B.slice(s, eb), ops = [], i, j;

    if (a2.length * b2.length > 4000000) {            // too big for LCS: show as replace
      a2.forEach(function (x) { ops.push({ t: '-', s: x }); });
      b2.forEach(function (x) { ops.push({ t: '+', s: x }); });
    } else {
      var n = a2.length, m = b2.length, dp = [];
      for (i = 0; i <= n; i++) { dp.push(new Uint16Array(m + 1)); }
      for (i = n - 1; i >= 0; i--) {
        for (j = m - 1; j >= 0; j--) {
          dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < n && j < m) {
        if (a2[i] === b2[j]) { ops.push({ t: '=', s: a2[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', s: a2[i++] }); }
        else { ops.push({ t: '+', s: b2[j++] }); }
      }
      while (i < n) { ops.push({ t: '-', s: a2[i++] }); }
      while (j < m) { ops.push({ t: '+', s: b2[j++] }); }
    }

    var full = A.slice(Math.max(0, s - ctx), s).map(function (x) { return { t: '=', s: x }; })
      .concat(ops)
      .concat(A.slice(ea, ea + ctx).map(function (x) { return { t: '=', s: x }; }));

    // collapse long unchanged runs inside the diff
    var res = [], run = [];
    function flush() {
      if (run.length > ctx * 2 + 2) {
        run.slice(0, ctx).forEach(function (x) { res.push(x); });
        res.push({ t: '…', s: (run.length - ctx * 2) + ' unchanged lines' });
        run.slice(run.length - ctx).forEach(function (x) { res.push(x); });
      } else { run.forEach(function (x) { res.push(x); }); }
      run = [];
    }
    full.forEach(function (x) { if (x.t === '=') { run.push(x); } else { flush(); res.push(x); } });
    flush();
    return res;
  }

  function planFromPaths(paths, manifest) {
    var ids = (manifest && manifest.ids) || {}, items = [], seen = {};
    paths.forEach(function (p) {
      if (p === CFG.cssPath) {
        items.push({ kind: 'css', name: 'style.css', path: p, id: null, lang: null });
      } else if (p.indexOf(CFG.templatesPath) === 0 && /\.html?$/i.test(p)) {
        var base = p.split('/').pop().replace(/\.html?$/i, '');
        if (base.charAt(0) === '.') { return; }
        var mobile = /(^|\/)mobile/i.test(p.slice(CFG.templatesPath.length));
        var key = (mobile ? 'mobile:' : '') + base;
        if (seen[key]) { return; }
        seen[key] = 1;
        var id = ids[(mobile ? 'mobile/' : '') + base] || (mobile ? MOBILE_IDS[base] : IDS[base]) || null;
        items.push({ kind: 'template', name: base, path: p, id: id, lang: mobile ? 'mobile' : 'main' });
      }
    });
    items.sort(function (a, b) {
      if (a.kind !== b.kind) { return a.kind === 'css' ? -1 : 1; }
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return items;
  }

  function fmtBytes(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
  function fmtDelta(n) { return n === 0 ? '±0' : (n > 0 ? '+' : '−') + fmtBytes(Math.abs(n)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pool(list, limit, fn) {
    return new Promise(function (resolve) {
      var i = 0, active = 0, done = 0;
      if (!list.length) { return resolve(); }
      (function next() {
        while (active < limit && i < list.length) {
          active++;
          Promise.resolve(fn(list[i++])).then(function () {}, function () {}).then(function () {
            active--; done++;
            if (done === list.length) { resolve(); } else { next(); }
          });
        }
      })();
    });
  }

  if (typeof module === 'object' && module.exports) {   // node: export helpers for tests and stop
    module.exports = { esc: esc, norm: norm, encVal: encVal, encodeForm: encodeForm, diffLines: diffLines, planFromPaths: planFromPaths, IDS: IDS };
    return;
  }

  /* ------------------------------------------------------------------ *
   * Network
   * ------------------------------------------------------------------ */
  var RAW = 'https://raw.githubusercontent.com/' + CFG.owner + '/' + CFG.repo + '/' + CFG.ref + '/';
  var TREE = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/git/trees/' + encodeURIComponent(CFG.ref) + '?recursive=1';
  var tid = null;

  function getText(url) {
    return fetch(url, { credentials: url.charAt(0) === '/' ? 'same-origin' : 'omit' }).then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status + ' for ' + url.split('?')[0]); }
      return r.text();
    });
  }
  function adminUrl(q) { return '/admin/?' + q + '&tid=' + tid; }
  function post(q, data) {
    return fetch(adminUrl(q), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeForm(data, document.characterSet)
    }).then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.text(); });
  }
  function retry(fn, n) {
    return fn().catch(function (e) {
      if (n <= 0) { throw e; }
      return sleep(700).then(function () { return retry(fn, n - 1); });
    });
  }

  function findTid() {
    var re = /[?&]tid=([0-9a-f]{32})/i, m, links = document.getElementsByTagName('a'), i;
    for (i = 0; i < links.length; i++) { m = re.exec(links[i].href); if (m) { return Promise.resolve(m[1]); } }
    m = re.exec(location.href); if (m) { return Promise.resolve(m[1]); }
    return getText('/admin/').then(function (t) { m = /tid=([0-9a-f]{32})/i.exec(t); return m ? m[1] : null; }, function () { return null; });
  }

  var TPL_EDIT = 'part=themes&sub=templates&mode=edit_main&extended_admin=1';
  function tplReadUrl(id, lang) { return adminUrl(TPL_EDIT + '&main_mode=edit&t=' + id + '&l=' + lang); }

  function textareaValue(html, names) {
    var doc = new DOMParser().parseFromString(html, 'text/html'), ta = null, i;
    for (i = 0; i < names.length && !ta; i++) { ta = doc.querySelector('textarea[name="' + names[i] + '"]'); }
    if (!ta) { throw new Error('editor not found (not logged in to the admin panel?)'); }
    return ta.value;
  }
  function readCurrent(it) {
    if (it.kind === 'css') {
      return getText(adminUrl('part=themes&sub=logos&mode=css&extended_admin=1')).then(function (h) { return textareaValue(h, ['edit_code']); });
    }
    return getText(tplReadUrl(it.id, it.lang)).then(function (h) { return textareaValue(h, ['template']); });
  }
  function writeTemplate(id, lang, name, content) {
    return post(TPL_EDIT, { t: id, l: lang, tpl_name: name, template: content, submit: 'Save' }).then(function () {
      return getText(adminUrl(TPL_EDIT + '&main_mode=edit&t=' + id + '&l=' + lang + '&pub=1'));   // publish
    });
  }
  function writeCss(content) {
    return post('part=themes&sub=logos&mode=css&extended_admin=1', { edit_code: content, submit: 'Submit' });
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var state = {
    stage: 'scan', scanMsg: 'Starting…', scanDone: 0, scanTotal: 0,
    items: [], filter: 'all', backupDone: false,
    opts: { verify: true, baseCss: false, phpbb3: false },
    log: [], progress: { done: 0, total: 0 }, failed: null, pending: null,
    summary: { ok: 0, warn: 0 }, errorMsg: '', modal: null, mode: 'install', theme: 'auto'
  };
  var root, host;

  function refKind() {
    if (/^[0-9a-f]{40}$/i.test(CFG.ref)) { return { cls: 'ok', txt: 'pinned to commit ' + CFG.ref.slice(0, 7) }; }
    if (/^v?\d/.test(CFG.ref)) { return { cls: 'ok', txt: 'release ' + CFG.ref }; }
    return { cls: 'warn', txt: 'branch “' + CFG.ref + '” (can change over time)' };
  }

  /* ------------------------------------------------------------------ *
   * Scan
   * ------------------------------------------------------------------ */
  function scan() {
    state.stage = 'scan'; state.scanMsg = 'Checking your admin session…'; render();
    return findTid().then(function (t) {
      if (!t) { throw new Error('admin'); }
      tid = t;
      state.scanMsg = 'Reading the theme file list from GitHub…'; render();
      return getText(RAW + 'manifest.json').then(function (t) { return JSON.parse(t); }, function () { return null; });
    }).then(function (manifest) {
      if (manifest && manifest.files) { return planFromPaths(manifest.files, manifest); }
      return getText(TREE).then(function (t) {
        var paths = (JSON.parse(t).tree || []).filter(function (x) { return x.type === 'blob'; }).map(function (x) { return x.path; });
        return planFromPaths(paths, manifest);
      });
    }).then(function (items) {
      if (!items.length) { throw new Error('No templates or css/style.css found in ' + CFG.owner + '/' + CFG.repo + '@' + CFG.ref); }
      state.items = items; state.scanTotal = items.length * 2; state.scanDone = 0;
      state.scanMsg = 'Downloading theme files and reading your current forum…'; render();
      return pool(items, CFG.concurrency, function (it) {
        return getText(RAW + it.path).then(function (c) { it.remote = c; }, function (e) { it.remoteErr = e.message; })
          .then(function () { state.scanDone++; renderProgressOnly(); })
          .then(function () {
            if (it.kind === 'template' && !it.id) { return; }
            return readCurrent(it).then(function (c) { it.current = c; }, function (e) { it.currentErr = e.message; });
          }).then(function () { state.scanDone++; renderProgressOnly(); });
      });
    }).then(function () {
      var readable = state.items.filter(function (it) { return it.current != null; }).length;
      if (!readable) { throw new Error('admin'); }
      state.items.forEach(classify);
      state.stage = 'review'; render();
    }).catch(function (e) {
      state.stage = 'fatal';
      state.errorMsg = e.message === 'admin'
        ? 'Could not reach the Administration Panel. Open the Administration Panel once and log in (re-enter your password if asked), then come back to this page and reload it.'
        : e.message;
      render();
    });
  }

  function classify(it) {
    if (it.remote == null) { it.status = 'bad'; it.note = 'could not download'; it.selected = false; return; }
    if (it.kind === 'template' && !it.id) { it.status = 'noid'; it.selected = false; return; }
    if (it.current == null) { it.status = 'unreadable'; it.selected = false; return; }
    if (norm(it.current) === norm(it.remote)) { it.status = 'same'; it.selected = false; return; }
    it.status = norm(it.current) === '' ? 'new' : 'diff';
    it.selected = true;
    it.delta = it.remote.length - it.current.length;
  }

  /* ------------------------------------------------------------------ *
   * Install / restore
   * ------------------------------------------------------------------ */
  function log(msg, cls) { state.log.push({ m: msg, c: cls || '' }); if (state.log.length > 400) { state.log.shift(); } updateLog(); }

  function buildTasks(entries) {   // entries: [{kind,name,id,lang,content}]
    var tasks = [], anyTpl = false;
    if (state.mode === 'install') {
      if (state.opts.phpbb3) {
        tasks.push({ label: 'Switching forum version to phpBB3', run: function () { return post('part=themes&sub=styles&mode=version&extended_admin=1', { tpl: 'prosilver', keep_theme: 2, code: 1, change_version: 'Save' }); } });
      }
      if (state.opts.baseCss) {
        tasks.push({ label: 'Deactivating Forumotion’s default CSS', run: function () { return post('part=themes&sub=logos&mode=css&extended_admin=1', { allow_css_perso: 0, css_base: 0, optimize_css: 0, submit_base_css: 'Save' }); } });
      }
    }
    entries.forEach(function (e) {
      if (e.kind === 'css') {
        tasks.push({ label: 'CSS: style.css', run: function () {
          return writeCss(e.content).then(function () {
            if (state.mode !== 'install' || !state.opts.verify) { return; }
            return readCurrent({ kind: 'css' }).then(function (c) { if (norm(c) !== norm(e.content)) { return { warn: 'style.css saved, but the stored text differs slightly' }; } });
          });
        } });
      } else {
        anyTpl = true;
        tasks.push({ label: 'Template: ' + e.name + (e.lang === 'mobile' ? ' (mobile)' : ''), run: function () {
          return writeTemplate(e.id, e.lang, e.name, e.content).then(function () {
            if (state.mode !== 'install' || !state.opts.verify) { return; }
            return readCurrent({ kind: 'template', id: e.id, lang: e.lang }).then(function (c) {
              if (norm(c) !== norm(e.content)) { return { warn: e.name + ' saved, but the stored text differs slightly' }; }
            });
          });
        } });
      }
    });
    if (anyTpl) {
      tasks.push({ label: 'Enabling custom templates', run: function () { return post('mode=main&part=themes&sub=templates', { switchTemplates: 2, submit: 'Save' }); } });
    }
    return tasks;
  }

  function exec(tasks, fresh) {
    if (fresh) { state.log = []; state.summary = { ok: 0, warn: 0 }; state.progress = { done: 0, total: tasks.length }; }
    state.stage = 'installing'; state.failed = null; render();
    window.onbeforeunload = function () { return 'Installation in progress.'; };
    var idx = 0;
    (function step() {
      if (idx >= tasks.length) { return finish(); }
      var t = tasks[idx];
      log(t.label + '…');
      retry(t.run, CFG.retries).then(function (res) {
        if (res && res.warn) { state.summary.warn++; log('⚠ ' + res.warn, 'warn'); } else { state.summary.ok++; }
        idx++; state.progress.done++; renderProgressOnly();
        return sleep(CFG.delay).then(step);
      }, function (err) {
        state.failed = { label: t.label, msg: err.message };
        state.pending = tasks.slice(idx);
        log('✖ ' + t.label + ' — ' + err.message, 'bad');
        window.onbeforeunload = null;
        state.stage = 'error'; render();
      });
    })();
  }
  function finish() {
    window.onbeforeunload = null;
    log(state.mode === 'restore' ? 'Restore finished.' : 'Installation finished.', 'ok');
    state.stage = 'done'; render();
  }

  function selectedEntries() {
    return state.items.filter(function (it) { return it.selected && (it.status === 'diff' || it.status === 'new' || it.status === 'same' || it.status === 'unreadable'); })
      .map(function (it) { return { kind: it.kind, name: it.name, id: it.id, lang: it.lang, content: it.remote }; });
  }

  function downloadBackup() {
    var sel = state.items.filter(function (it) { return it.selected && it.current != null; });
    var data = {
      format: 'aurum-installer-backup', version: 1, created: new Date().toISOString(), forum: location.host,
      items: sel.map(function (it) { return { kind: it.kind, name: it.name, id: it.id, lang: it.lang, content: it.current }; })
    };
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'forum-backup-' + location.host + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    root.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    state.backupDone = true; render();
  }

  function startInstall() {
    var entries = selectedEntries();
    if (!entries.length) { return; }
    state.mode = 'install';
    exec(buildTasks(entries), true);
  }

  function startRestore(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data;
      try { data = JSON.parse(fr.result); } catch (e) { alert('That file is not valid JSON.'); return; }
      if (!data || data.format !== 'aurum-installer-backup' || !data.items) { alert('That is not a backup made by this installer.'); return; }
      if (!confirm('Restore ' + data.items.length + ' item(s) from the backup made on ' + data.created + '?\nThis overwrites what is on the forum now.')) { return; }
      var go = function () { state.mode = 'restore'; exec(buildTasks(data.items), true); };
      if (tid) { go(); } else { findTid().then(function (t) { if (!t) { alert('Admin session not found. Log in to the Administration Panel first.'); return; } tid = t; go(); }); }
    };
    fr.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */
  var CSS = [
    // all:initial stops the forum's own page styles (text-align, colour, fonts) leaking in
    ':host{all:initial;display:block;',
    '--bg:#14110d;--panel:#1c1812;--panel2:#241f17;--line:#3a3224;--soft:#2b251b;--gold:#c9a24b;--gold2:#e8cb7c;--text:#f0e8d6;--mut:#a89f8a;',
    '--ok:#74c27a;--warn:#e3a94d;--bad:#e46c5d;--okln:#2f4a31;--warnln:#5a4524;--badln:#5a2a24;--goldln:#5b4a22;',
    '--b1:#e8cb7c;--b2:#c9a24b;--bt:#241a05;--logbg:#0e0c09;--errbg:#241512;--errtx:#f3c3bb;',
    '--addbg:#13251a;--addtx:#a5e6aa;--delbg:#2a1512;--deltx:#f1b5ac}',
    ':host([data-theme="light"]){',
    '--bg:#fbf8f1;--panel:#ffffff;--panel2:#f3ecdc;--line:#e0d4b6;--soft:#efe7d2;--gold:#b8892a;--gold2:#8a6212;--text:#2a2418;--mut:#7a705c;',
    '--ok:#2a7f43;--warn:#a85f00;--bad:#bd3a2b;--okln:#b9dcc2;--warnln:#ecd0a0;--badln:#eab9b2;--goldln:#e3cf99;',
    '--b1:#ecc96f;--b2:#d4a43a;--bt:#2a1d05;--logbg:#faf6ea;--errbg:#fdeeeb;--errtx:#7a2418;',
    '--addbg:#e3f4e6;--addtx:#1d5e30;--delbg:#fbe5e1;--deltx:#8a2a1e}',
    '*{box-sizing:border-box}',
    '.wrap{background:var(--bg);color:var(--text);text-align:left;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border:1px solid var(--line);border-radius:14px;padding:22px;max-width:980px;margin:16px auto}',
    '.wrap table,.wrap th,.wrap td,.wrap label,.wrap div,.wrap span{color:inherit;font-size:inherit}',
    '.hd{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:6px}',
    '.mark{width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,var(--b1),var(--b2) 60%,#8c6a22);display:grid;place-items:center;color:var(--bt);font-weight:800;font-size:20px;letter-spacing:.5px}',
    'h1{font-size:20px;margin:0;font-weight:700;color:var(--gold2)}',
    '.sub{color:var(--mut);font-size:12.5px;margin-top:2px}',
    '.tg{margin-left:auto;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:99px;padding:5px 13px;font-size:12.5px}',
    '.chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;border:1px solid var(--line);background:var(--panel2);color:var(--mut);white-space:nowrap}',
    '.chip.ok{color:var(--ok);border-color:var(--okln)}.chip.warn{color:var(--warn);border-color:var(--warnln)}.chip.bad{color:var(--bad);border-color:var(--badln)}.chip.gold{color:var(--gold2);border-color:var(--goldln)}',
    '.steps{display:flex;gap:6px;margin:14px 0 18px;flex-wrap:wrap}',
    '.step{flex:1;min-width:110px;padding:8px 10px;border-radius:8px;background:var(--panel);border:1px solid var(--line);color:var(--mut);font-size:12.5px;text-align:center}',
    '.step b{display:block;color:var(--text);font-weight:600}',
    '.step.on{border-color:var(--gold);color:var(--gold2)}.step.on b{color:var(--gold2)}.step.done{border-color:var(--okln)}',
    '.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}',
    '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}',
    '.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;text-align:center}',
    '.tile .n{font-size:26px;font-weight:700;line-height:1.1}.tile .l{color:var(--mut);font-size:12px}',
    '.tile.diff .n{color:var(--warn)}.tile.same .n{color:var(--ok)}.tile.bad .n{color:var(--bad)}',
    '.opts label{display:flex;gap:9px;align-items:flex-start;padding:5px 0;cursor:pointer;text-align:left}',
    '.opts small{display:block;color:var(--mut)}',
    'input[type=checkbox]{accent-color:var(--gold);margin-top:3px}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 10px}',
    '.f{cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--mut);border-radius:99px;padding:3px 12px;font-size:12.5px}',
    '.f.on{border-color:var(--gold);color:var(--gold2)}',
    '.tw{max-height:430px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}',
    'table{width:100%;border-collapse:collapse;font-size:13px;color:var(--text)}',
    'th{position:sticky;top:0;background:var(--panel2);text-align:left;color:var(--mut);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);z-index:1}',
    'td{padding:7px 10px;border-bottom:1px solid var(--soft);vertical-align:middle;color:var(--text);text-align:left}',
    'tr:last-child td{border-bottom:0}.nm{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--text)}',
    '.mut{color:var(--mut)}.r{text-align:right}',
    '.btn{cursor:pointer;border:1px solid var(--gold);background:linear-gradient(180deg,var(--b1),var(--b2));color:var(--bt);font-weight:700;border-radius:9px;padding:9px 18px;font-size:14px}',
    '.btn.ghost{background:transparent;color:var(--gold2)}',
    '.btn:disabled{opacity:.4;cursor:not-allowed}',
    '.lk{background:none;border:0;color:var(--gold2);cursor:pointer;padding:0;font-size:12.5px;text-decoration:underline}',
    '.acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}',
    '.prog{height:10px;background:var(--panel2);border:1px solid var(--line);border-radius:99px;overflow:hidden;margin:10px 0}',
    '.prog i{display:block;height:100%;background:linear-gradient(90deg,var(--b2),var(--b1));width:0;transition:width .2s}',
    '.log{background:var(--logbg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;height:230px;overflow:auto;font:12px/1.55 ui-monospace,Consolas,monospace;color:var(--mut)}',
    '.log .ok{color:var(--ok)}.log .warn{color:var(--warn)}.log .bad{color:var(--bad)}',
    '.note{color:var(--mut);font-size:12.5px;margin:8px 0}',
    '.err{border-color:var(--badln);background:var(--errbg);color:var(--errtx)}.err .note{color:var(--errtx)}',
    '.mo{position:fixed;inset:0;background:rgba(0,0,0,.6);display:grid;place-items:center;z-index:99999;padding:20px}',
    '.mb{background:var(--panel);color:var(--text);border:1px solid var(--gold);border-radius:12px;max-width:900px;width:100%;max-height:85vh;display:flex;flex-direction:column;text-align:left}',
    '.mb h2{margin:0;padding:12px 16px;font-size:15px;color:var(--gold2);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}',
    '.df{overflow:auto;padding:8px 0;font:12px/1.5 ui-monospace,Consolas,monospace}',
    '.df div{padding:0 16px;white-space:pre-wrap;word-break:break-all}',
    '.df .a{background:var(--addbg);color:var(--addtx)}.df .d{background:var(--delbg);color:var(--deltx)}.df .u{color:var(--mut)}.df .g{color:var(--gold2);text-align:center;padding:3px 16px}'
  ].join('');

  var STATUS = {
    diff: ['warn', 'Will overwrite'], 'new': ['gold', 'Empty → new'], same: ['ok', 'Identical (skipped)'],
    noid: ['bad', 'Unknown template ID'], unreadable: ['warn', 'Can’t read current'], bad: ['bad', 'Download failed']
  };

  function counts() {
    var c = { diff: 0, same: 0, bad: 0, sel: 0 };
    state.items.forEach(function (it) {
      if (it.status === 'diff' || it.status === 'new') { c.diff++; }
      else if (it.status === 'same') { c.same++; }
      else { c.bad++; }
      if (it.selected) { c.sel++; }
    });
    return c;
  }

  function stepper() {
    var order = ['scan', 'review', 'installing', 'done'], labels = ['Scan', 'Review', 'Install', 'Done'], subs = ['Read forum + GitHub', 'Check the list, back up', 'Writing templates + CSS', 'Reload your forum'];
    var cur = { scan: 0, fatal: 0, review: 1, installing: 2, error: 2, done: 3 }[state.stage];
    return '<div class="steps">' + order.map(function (s, i) {
      return '<div class="step ' + (i === cur ? 'on' : i < cur ? 'done' : '') + '"><b>' + (i + 1) + '. ' + labels[i] + '</b>' + subs[i] + '</div>';
    }).join('') + '</div>';
  }

  function header() {
    var k = refKind();
    return '<div class="hd"><div class="mark">Au</div><div><h1>' + esc(CFG.name) + ' Installer</h1>' +
      '<div class="sub">' + esc(CFG.owner + '/' + CFG.repo) + ' · <span class="chip ' + k.cls + '">' + esc(k.txt) + '</span></div></div>' +
      '<button class="tg" data-action="theme">' + (host.getAttribute('data-theme') === 'light' ? '☾ Dark' : '☀ Light') + '</button></div>';
  }

  function viewScan() {
    var pct = state.scanTotal ? Math.round(state.scanDone / state.scanTotal * 100) : 5;
    return '<div class="card"><b>' + esc(state.scanMsg) + '</b><div class="prog"><i id="sbar" style="width:' + pct + '%"></i></div>' +
      '<div class="note">Nothing is changed during the scan. It only reads.</div></div>';
  }

  function viewFatal() {
    return '<div class="card err"><b>Can’t continue</b><div style="margin-top:6px">' + esc(state.errorMsg) + '</div>' +
      '<div class="acts"><button class="btn" data-action="rescan">Try again</button></div></div>';
  }

  function viewReview() {
    var c = counts(), rows = state.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (r) {
      var s = r.it.status;
      return state.filter === 'all' || (state.filter === 'diff' && (s === 'diff' || s === 'new')) || (state.filter === 'same' && s === 'same') || (state.filter === 'bad' && (s === 'noid' || s === 'bad' || s === 'unreadable'));
    });
    var allOn = rows.length && rows.every(function (r) { return r.it.selected || r.it.status === 'noid' || r.it.status === 'bad'; });
    var h = '<div class="tiles">' +
      '<div class="tile diff"><div class="n">' + c.diff + '</div><div class="l">will be overwritten</div></div>' +
      '<div class="tile same"><div class="n">' + c.same + '</div><div class="l">already identical</div></div>' +
      '<div class="tile bad"><div class="n">' + c.bad + '</div><div class="l">can’t be installed</div></div></div>';

    h += '<div class="card opts"><label><input type="checkbox" data-field="verify"' + (state.opts.verify ? ' checked' : '') + '><span>Verify every item after saving<small>Reads each template back and compares it. Slower, but catches silent failures.</small></span></label>' +
      '<label><input type="checkbox" data-field="baseCss"' + (state.opts.baseCss ? ' checked' : '') + '><span>Deactivate Forumotion’s default CSS first<small>Only tick this if style.css is a complete stylesheet that replaces the default one.</small></span></label>' +
      '<label><input type="checkbox" data-field="phpbb3"' + (state.opts.phpbb3 ? ' checked' : '') + '><span>Switch the forum to the phpBB3 version first<small>The template IDs are for phpBB3 forums. Leave off if your forum already runs phpBB3.</small></span></label></div>';

    h += '<div class="bar">' + [['all', 'All'], ['diff', 'Will overwrite'], ['same', 'Identical'], ['bad', 'Problems']].map(function (f) {
      return '<button class="f ' + (state.filter === f[0] ? 'on' : '') + '" data-action="filter" data-v="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '<span class="mut" style="margin-left:auto">' + c.sel + ' selected</span></div>';

    h += '<div class="tw"><table><thead><tr><th style="width:34px"><input type="checkbox" data-action="all"' + (allOn ? ' checked' : '') + '></th><th>Item</th><th>ID</th><th>Status</th><th class="r">Change</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var it = r.it, st = STATUS[it.status], dis = it.status === 'noid' || it.status === 'bad';
      h += '<tr><td><input type="checkbox" data-action="toggle" data-i="' + r.i + '"' + (it.selected ? ' checked' : '') + (dis ? ' disabled' : '') + '></td>' +
        '<td class="nm">' + (it.kind === 'css' ? 'css/style.css' : esc(it.name) + (it.lang === 'mobile' ? ' <span class="chip">mobile</span>' : '')) + '</td>' +
        '<td class="mut">' + (it.id || '—') + '</td><td><span class="chip ' + st[0] + '">' + st[1] + '</span></td>' +
        '<td class="r mut">' + (it.delta != null ? fmtDelta(it.delta) : '') + '</td>' +
        '<td class="r">' + ((it.status === 'diff' || it.status === 'new') ? '<button class="lk" data-action="diff" data-i="' + r.i + '">view diff</button>' : '') + '</td></tr>';
    });
    if (!rows.length) { h += '<tr><td colspan="6" class="mut" style="text-align:center;padding:22px">Nothing in this filter.</td></tr>'; }
    h += '</tbody></table></div>';

    h += '<div class="note">Forumotion shows its default template for anything you haven’t customised, so “Will overwrite” also covers templates that are still on the default. ' +
      (c.bad ? 'Items marked “Unknown template ID” are skipped; add their IDs to manifest.json to include them.' : '') + '</div>';

    h += '<div class="acts"><button class="btn ghost" data-action="backup">' + (state.backupDone ? '✓ Backup downloaded — download again' : '1. Download backup of what will be overwritten') + '</button>' +
      '<button class="btn" data-action="install"' + (state.backupDone && c.sel ? '' : ' disabled') + '>2. Install ' + c.sel + ' item' + (c.sel === 1 ? '' : 's') + '</button>' +
      '<button class="lk" data-action="skipbackup"' + (state.backupDone ? ' style="display:none"' : '') + '>install without a backup</button>' +
      '<span style="flex:1"></span><button class="lk" data-action="restore">Restore from a backup file…</button>' +
      '<input type="file" id="rf" accept=".json,application/json" style="display:none"></div>';
    return h;
  }

  function viewInstalling() {
    var p = state.progress, pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    return '<div class="card"><b>' + (state.mode === 'restore' ? 'Restoring' : 'Installing') + '… <span id="pt">' + p.done + ' / ' + p.total + '</span></b>' +
      '<div class="prog"><i id="pb" style="width:' + pct + '%"></i></div><div class="log" id="lg"></div>' +
      '<div class="note">Keep this tab open until it finishes.</div></div>';
  }

  function viewError() {
    return '<div class="card err"><b>Stopped at: ' + esc(state.failed.label) + '</b><div style="margin-top:6px">' + esc(state.failed.msg) +
      '</div><div class="note" style="color:#f3c3bb">Nothing after this step was written. Items before it are already installed.</div>' +
      '<div class="acts"><button class="btn" data-action="retry">Retry from this step</button><button class="btn ghost" data-action="restore">Restore from backup…</button>' +
      '<input type="file" id="rf" accept=".json,application/json" style="display:none"></div></div>' +
      '<div class="log" id="lg"></div>';
  }

  function viewDone() {
    var s = state.summary;
    return '<div class="card"><b style="color:var(--ok);font-size:16px">' + (state.mode === 'restore' ? 'Restore complete' : 'Installation complete') + '</b>' +
      '<div style="margin-top:6px">' + s.ok + ' step' + (s.ok === 1 ? '' : 's') + ' succeeded' + (s.warn ? ', <span style="color:var(--warn)">' + s.warn + ' with a warning</span>' : '') + '.</div>' +
      '<div class="note">Reload the forum with Ctrl+F5 to see the result. If something looks wrong, restore from your backup file.</div>' +
      '<div class="acts"><a class="btn" style="text-decoration:none" href="/" target="_blank">Open the forum</a>' +
      '<button class="btn ghost" data-action="restore">Restore from a backup file…</button><input type="file" id="rf" accept=".json,application/json" style="display:none"></div></div>' +
      '<div class="log" id="lg"></div>';
  }

  function viewModal() {
    var it = state.modal;
    var rows = diffLines(it.current || '', it.remote || '', 2).map(function (d) {
      var cls = d.t === '+' ? 'a' : d.t === '-' ? 'd' : d.t === '…' ? 'g' : 'u';
      return '<div class="' + cls + '">' + (d.t === '…' ? '… ' + esc(d.s) + ' …' : (d.t === '=' ? '  ' : d.t + ' ') + esc(d.s)) + '</div>';
    }).join('');
    return '<div class="mo" data-action="closemodal"><div class="mb" data-keep="1"><h2><span>' + esc(it.kind === 'css' ? 'css/style.css' : it.name) +
      ' — <span class="mut">red = on your forum now, green = from the theme</span></span><button class="lk" data-action="closemodal">close</button></h2><div class="df">' + (rows || '<div class="u">No line differences.</div>') + '</div></div></div>';
  }

  function render() {
    var body = { scan: viewScan, fatal: viewFatal, review: viewReview, installing: viewInstalling, error: viewError, done: viewDone }[state.stage]();
    root.innerHTML = '<style>' + CSS + '</style><div class="wrap">' + header() + stepper() + body + '</div>' + (state.modal ? viewModal() : '');
    updateLog();
  }
  function renderProgressOnly() {
    var a = root.getElementById ? root.getElementById('pb') : root.querySelector('#pb');
    if (a) { a.style.width = (state.progress.total ? state.progress.done / state.progress.total * 100 : 0) + '%'; var t = root.querySelector('#pt'); if (t) { t.textContent = state.progress.done + ' / ' + state.progress.total; } }
    var s = root.querySelector('#sbar');
    if (s) { s.style.width = (state.scanTotal ? state.scanDone / state.scanTotal * 100 : 5) + '%'; }
  }
  function updateLog() {
    var el = root && root.querySelector('#lg');
    if (!el) { return; }
    el.innerHTML = state.log.map(function (l) { return '<div class="' + l.c + '">' + esc(l.m) + '</div>'; }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function bind() {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) { return; }
      var a = t.getAttribute('data-action'), i = +t.getAttribute('data-i');
      if (a === 'closemodal') { if (t.classList.contains('mo') && e.target !== t) { return; } state.modal = null; render(); }
      else if (a === 'filter') { state.filter = t.getAttribute('data-v'); render(); }
      else if (a === 'diff') { state.modal = state.items[i]; render(); }
      else if (a === 'backup') { downloadBackup(); }
      else if (a === 'skipbackup') { if (confirm('Install without a backup? You will not be able to undo this.')) { state.backupDone = true; render(); } }
      else if (a === 'install') { if (confirm('Install the selected items now? This overwrites them on your forum.')) { startInstall(); } }
      else if (a === 'retry') { exec(state.pending, false); }
      else if (a === 'rescan') { scan(); }
      else if (a === 'theme') {
        state.theme = host.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('aurum-installer-theme', state.theme); } catch (x) { /* storage blocked: fine */ }
        applyTheme(); render();
      }
      else if (a === 'restore') { var f = root.querySelector('#rf'); if (f) { f.click(); } }
    });
    root.addEventListener('change', function (e) {
      var t = e.target, a = t.getAttribute('data-action'), f = t.getAttribute('data-field');
      if (t.id === 'rf' && t.files && t.files[0]) { startRestore(t.files[0]); t.value = ''; }
      else if (f) { state.opts[f] = t.checked; }
      else if (a === 'toggle') { var it = state.items[+t.getAttribute('data-i')]; it.selected = t.checked; state.backupDone = false; render(); }
      else if (a === 'all') {
        state.items.forEach(function (it) {
          var visible = state.filter === 'all' || (state.filter === 'diff' && (it.status === 'diff' || it.status === 'new')) || (state.filter === 'same' && it.status === 'same') || (state.filter === 'bad' && (it.status === 'noid' || it.status === 'bad' || it.status === 'unreadable'));
          if (visible && it.status !== 'noid' && it.status !== 'bad') { it.selected = t.checked; }
        });
        state.backupDone = false; render();
      }
    });
  }

  function applyTheme() {
    var t = state.theme;
    if (t !== 'light' && t !== 'dark') { t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    host.setAttribute('data-theme', t);
  }

  function init() {
    host = document.getElementById('aurum-installer');
    if (!host) { return; }
    var saved = null;
    try { saved = localStorage.getItem('aurum-installer-theme'); } catch (x) { /* ignore */ }
    state.theme = saved || L.theme || 'auto';
    applyTheme();
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    if (!root.getElementById) { root.getElementById = function (id) { return host.querySelector('#' + id); }; }
    bind(); scan();
  }
  init();
})();
