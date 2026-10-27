/* 800m Comeback app. Plain JS, no build step. Plan lives in plan.json, log lives in localStorage. */
(function () {
  "use strict";
  var KEY = "c800.v1";
  var plan = null;
  var S = { offset: 0, logs: {}, checks: {}, ackThrough: "", theme: "" };
  var view = { tab: "today", date: todayIso(), weekDate: todayIso() };
  var app = document.getElementById("app");

  /* ---------- storage ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var o = JSON.parse(raw); for (var k in o) S[k] = o[k]; }
    } catch (e) {}
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  var DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DOWFULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pretty(s) { var d = parse(s); return MONTHS[d.getMonth()] + " " + d.getDate(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* Map a calendar date onto a plan day, applying the user's week shift. */
  function planFor(date) {
    if (date === plan.starter.date) return { kind: "starter", day: plan.starter };
    var idx = diffDays(plan.startDate, date);
    if (idx < 0) return { kind: "pre", days: -idx };
    var calWeek = Math.floor(idx / 7) + 1;
    var w = calWeek + (S.offset || 0);
    var dow = idx % 7;
    if (w < 1) w = 1;
    if (w > 16) return { kind: "season", week: w, dow: dow };
    var week = plan.weeks[w - 1];
    return { kind: "day", week: week, day: week.days[dow], dow: dow, calWeek: calWeek };
  }

  /* ---------- foot status ---------- */
  function lightOf(l) {
    if (!l) return "";
    var d = num(l.painDuring), m = num(l.painAM);
    var flags = (l.flags || []).length;
    if (flags || (d != null && d >= 5) || (m != null && m >= 5)) return "R";
    if ((d != null && d >= 3) || (m != null && m >= 3) || l.stiff) return "Y";
    if (d != null || m != null) return "G";
    return "";
  }
  function num(v) { return v === "" || v == null || isNaN(+v) ? null : +v; }
  var LIGHT_TXT = {
    G: ["Green", "Keep going with the plan."],
    Y: ["Yellow", "No hard session today. Cut the easy run in half or cross-train. Yellow 2 days in a row: take 2 days off running and tell the PT."],
    R: ["Red", "Stop running. Do not run through it. Call the PT or doctor this week."]
  };

  /* ---------- advice engine (rules from the foot page of the plan) ---------- */
  function advice() {
    var out = [], today = todayIso();
    var dates = Object.keys(S.logs).sort();
    if (!dates.length) return out;

    var recentRed = dates.filter(function (d) { return diffDays(d, today) <= 7 && lightOf(S.logs[d]) === "R"; });
    if (recentRed.length) out.push({ lvl: "R", title: "Red foot signal in the last 7 days",
      body: "Stop running. Call the PT or doctor this week. Restart in Phase 1 at the week she can run pain-free, only after the PT clears her." });

    for (var i = dates.length - 1; i > 0; i--) {
      var a = dates[i - 1], b = dates[i];
      if (diffDays(b, today) > 3) break;
      if (diffDays(a, b) === 1 && lightOf(S.logs[a]) === "Y" && lightOf(S.logs[b]) === "Y") {
        out.push({ lvl: "Y", title: "Yellow 2 days in a row", body: "Take 2 days off running and tell the PT." });
        break;
      }
    }

    /* missed days: count planned days since the last completed one, up to yesterday */
    var ack = S.ackThrough || "";
    var missed = 0, cur = addDays(today, -1), first = dates[0], sawDone = false;
    while (cur >= first && cur > ack) {
      var l = S.logs[cur], p = planFor(cur);
      if (l && (l.status === "done" || l.status === "partial")) { sawDone = true; break; }
      if (p.kind === "day" && p.day.where !== "Off") missed++;
      cur = addDays(cur, -1);
    }
    if (sawDone || cur < first) {
      if (missed >= 12) out.push({ lvl: "R", title: "Missed more than 2 weeks", body: "Go back to Phase 1 at the week that matches what she can run pain-free, after the PT clears her.", apply: { label: "Set plan to match", mode: "phase1" } });
      else if (missed >= 6) out.push({ lvl: "Y", title: "Missed 1 to 2 weeks", body: "Go back two weeks in the plan.", apply: { label: "Back up 2 weeks", mode: "back2" } });
      else if (missed >= 3) out.push({ lvl: "Y", title: "Missed 3 to 6 days", body: "Repeat the last full week she completed, then continue.", apply: { label: "Repeat last week", mode: "back1" } });
    }
    return out;
  }

  function applyAdvice(mode) {
    var yesterday = addDays(todayIso(), -1);
    if (mode === "back1") S.offset -= 1;
    else if (mode === "back2") S.offset -= 2;
    else if (mode === "phase1") { S.offset = -(Math.max(1, Math.floor(diffDays(plan.startDate, todayIso()) / 7) + 1) - 1); }
    S.ackThrough = yesterday;
    save(); toast("Plan shifted. Check the Data tab to adjust.");
  }

  /* ---------- helpers for rendering ---------- */
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }
  function rows(list, cols) {
    return '<table class="t">' + list.map(function (r) {
      return "<tr>" + r.map(function (c, i) { return (i === 0 ? '<td><b>' : "<td>") + esc(c) + (i === 0 ? "</b>" : "") + "</td>"; }).join("") + "</tr>";
    }).join("") + "</table>";
  }
  function exBlock(title, list, cols) {
    return '<details class="ex"><summary>' + esc(title) + "</summary>" + rows(list, cols) + "</details>";
  }
  function phaseName(n) { return plan.phases[n] ? plan.phases[n].name : ""; }
  function runMinutesDone(weekStart) {
    var total = 0;
    for (var i = 0; i < 7; i++) {
      var l = S.logs[addDays(weekStart, i)];
      if (l && (l.status === "done" || l.status === "partial")) {
        var m = num(l.minutes);
        if (m == null) {
          var p = planFor(addDays(weekStart, i));
          m = p.kind === "day" ? (p.day.run || 0) * (l.status === "partial" ? 0.5 : 1) : 0;
        }
        total += m;
      }
    }
    return Math.round(total);
  }

  /* ---------- TODAY ---------- */
  function renderToday() {
    var date = view.date, isToday = date === todayIso();
    var p = planFor(date), l = S.logs[date] || {};
    var h = "";
    var d = parse(date);
    h += '<div class="datebar"><button class="iconbtn" data-act="day" data-n="-1" aria-label="Previous day">&#8249;</button>' +
      '<div class="mid"><b>' + DOWFULL[(d.getDay() + 6) % 7] + " " + pretty(date) + "</b>" +
      (isToday ? '<span class="muted">Today</span>' : '<button class="chip" data-act="gotoday">Jump to today</button>') +
      '</div><button class="iconbtn" data-act="day" data-n="1" aria-label="Next day">&#8250;</button></div>';

    var adv = isToday ? advice() : [];
    adv.forEach(function (a, i) {
      h += '<div class="alert ' + a.lvl + '"><b>' + esc(a.title) + "</b>" + esc(a.body) +
        (a.apply ? '<div class="btns"><button class="btn" data-act="apply" data-mode="' + a.apply.mode + '">' + esc(a.apply.label) + '</button><button class="btn ghost" data-act="dismiss">Not now</button></div>' : "") + "</div>";
    });

    var rec = null; /* what to record on this day */
    if (p.kind === "pre") {
      h += '<div class="hero"><div class="wk">Starts<br>Mon Oct 26</div></div><p class="muted">The plan has not started yet. ' + p.days + ' day' + (p.days === 1 ? "" : "s") + " to go. The optional starter session is Sunday Oct 25.</p>";
      return h;
    }
    if (p.kind === "season") {
      h += '<div class="hero"><div class="wk">Racing<small>season</small></div></div>';
      h += '<div class="card"><ul>' + plan.ref.phase4.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
      rec = { where: "Meet / workout", test: null };
    } else if (p.kind === "starter") {
      h += '<div class="hero"><div class="wk">Day<small>0</small></div></div><div class="badges"><span class="badge">Starter session</span></div>';
      h += '<div class="card session"><div class="where">TrueForm</div><div class="session-text">' + esc(p.day.session) + "</div>" + exFoot() + "</div>";
      rec = { where: "TrueForm", test: null };
    } else {
      var wk = p.week, dy = p.day;
      h += '<div class="hero"><div class="wk">Week ' + wk.n + "<small>" + dy.dow.toUpperCase() + "</small></div></div>";
      h += '<div class="badges"><span class="badge">Phase ' + wk.phase + ": " + esc(phaseName(wk.phase)) + "</span>" +
        (dy.hard ? '<span class="badge hard">Hard day</span>' : "") +
        (wk.light ? '<span class="badge light">Lighter week</span>' : "") +
        (S.offset ? '<span class="badge">Plan shifted ' + S.offset + " wk</span>" : "") + "</div>";
      if (wk.note) h += '<p class="muted">' + esc(wk.note) + "</p>";
      h += '<div class="card session"><div class="where">' + esc(dy.where) + "</div>" +
        '<div class="session-text">' + esc(dy.session) + "</div>" + tagsBlock(dy) + "</div>";
      if (dy.where === "Track" || dy.where === "TrueForm") {
        h += '<p class="muted">' + (dy.where === "Track" ? "Warm-up: 10-15 min easy jog, drills, 4 strides. Cool-down: 10 min easy jog." : "Easy runs stay outdoors. Never copy track paces onto the TrueForm. Compare only with her own TrueForm numbers.") + "</p>";
      }
      if (wk.n >= 11 && dy.hard) {
        h += '<label class="check"><input type="checkbox" data-f="school"' + (l.school ? " checked" : "") + '>School practice was a hard workout today</label>';
        if (l.school) h += '<div class="alert Y"><b>School workout is the hard day</b>Drop the hard session in this plan today so hard days never stack. Skip it, do not make it up.</div>';
      }
      rec = { where: dy.where, test: dy.test || null, run: dy.run };
    }
    h += logForm(date, l, rec);
    return h;
  }
  function tagsBlock(dy) {
    var h = "";
    var r = plan.ref;
    if (dy.tags.indexOf("jumps") >= 0) h += '<p class="where" style="margin-top:12px">Jumps first (only with PT OK and foot GREEN)</p>' + exBlock("Jump steps", r.jumps);
    if (dy.tags.indexOf("gymA") >= 0) h += exBlock("Gym A", r.gymA);
    if (dy.tags.indexOf("gymB") >= 0) h += exBlock("Gym B", r.gymB);
    if (dy.tags.indexOf("foot") >= 0) h += exFoot();
    if (dy.tags.length) h = '<p class="muted" style="margin-top:12px">Then: ' + dy.tags.map(function (t) { return { gymA: "Gym A", gymB: "Gym B", foot: "foot routine", jumps: "jumps" }[t]; }).join(" + ") + "</p>" + h;
    return h;
  }
  function exFoot() { return exBlock("Foot routine (about 10 min)", plan.ref.foot); }

  function numChips(field, val) {
    var h = '<div class="nums" role="group">';
    for (var i = 0; i <= 10; i++) {
      var c = i <= 2 ? "g" : i <= 4 ? "y" : "r";
      h += '<button data-act="num" data-f="' + field + '" data-v="' + i + '" data-c="' + c + '" aria-pressed="' + (val === i) + '">' + i + "</button>";
    }
    return h + "</div>";
  }
  function logForm(date, l, rec) {
    var h = '<h2>Log it</h2>';
    h += '<div class="seg" role="group" aria-label="Status">' +
      [["done", "Done", ""], ["partial", "Partial", ""], ["skipped", "Skipped", "skip"]].map(function (s) {
        return '<button class="' + s[2] + '" data-act="status" data-v="' + s[0] + '" aria-pressed="' + (l.status === s[0]) + '">' + s[1] + "</button>";
      }).join("") + "</div>";
    h += '<label class="f">Foot pain during (0 none, 10 worst)</label>' + numChips("painDuring", num(l.painDuring));
    h += '<label class="f">Foot pain next morning</label>' + numChips("painAM", num(l.painAM));
    h += '<label class="check"><input type="checkbox" data-f="stiff"' + (l.stiff ? " checked" : "") + '>Stiff this morning, gone after a few minutes of walking</label>';
    h += '<details class="ex"' + ((l.flags || []).length ? " open" : "") + '><summary>Any red signs?</summary>' +
      plan.ref.redFlags.map(function (f) {
        return '<label class="check"><input type="checkbox" data-flag="' + esc(f) + '"' + ((l.flags || []).indexOf(f) >= 0 ? " checked" : "") + ">" + esc(f) + "</label>";
      }).join("") + "</details>";
    var lt = lightOf(l);
    h += '<div class="light-box ' + lt + '" id="lightbox">' + lightHtml(lt) + "</div>";

    if (rec && (rec.where === "TrueForm" || rec.where === "TrueForm + gym")) {
      h += '<label class="f">TrueForm' + (rec.test ? " test numbers" : " (easy: write down pace + heart rate)") + "</label>" +
        '<div class="row2"><div><input type="text" inputmode="text" data-f="pace" placeholder="Avg pace" value="' + esc(l.pace) + '"></div>' +
        '<div><input type="number" inputmode="numeric" data-f="hr" placeholder="Avg HR" value="' + esc(l.hr) + '"></div></div>' +
        '<label class="f">Effort 0-10</label><input type="number" inputmode="numeric" min="0" max="10" data-f="effort" value="' + esc(l.effort) + '">';
    }
    if (rec && rec.where === "Track") {
      h += '<label class="f">Rep times</label><input type="text" data-f="reps" placeholder="e.g. 35, 35, 36, 35" value="' + esc(l.reps) + '">';
    }
    h += '<label class="f">Minutes actually run' + (rec && rec.run ? " (planned " + rec.run + ")" : "") + '</label><input type="number" inputmode="numeric" data-f="minutes" value="' + esc(l.minutes) + '">';
    h += '<label class="f">Notes</label><textarea data-f="notes" placeholder="How did it feel? Where exactly, and what made it worse?">' + esc(l.notes) + "</textarea>";
    h += '<p class="muted">Saved on this phone automatically.</p>';
    return h;
  }
  function lightHtml(lt) {
    if (!lt) return '<span class="dot"></span><div><b>Foot status</b>Pick a pain number to see the light.</div>';
    return '<span class="dot"></span><div><b>' + LIGHT_TXT[lt][0] + "</b>" + esc(LIGHT_TXT[lt][1]) + "</div>";
  }

  /* ---------- WEEK ---------- */
  function renderWeek() {
    var wd = view.weekDate;
    var dd = parse(wd); var dow = (dd.getDay() + 6) % 7;
    var start = addDays(wd, -dow);
    var p0 = planFor(start), pw = p0.kind === "day" ? p0.week : null;
    if (!pw) { var any = planFor(addDays(start, 3)); pw = any.kind === "day" ? any.week : null; }
    var h = '<div class="datebar"><button class="iconbtn" data-act="wk" data-n="-7" aria-label="Previous week">&#8249;</button><div class="mid"><b>' +
      pretty(start) + " - " + pretty(addDays(start, 6)) + '</b><span class="muted">' + (pw ? "Week " + pw.n + " of 16" : "Outside the 16 weeks") +
      '</span></div><button class="iconbtn" data-act="wk" data-n="7" aria-label="Next week">&#8250;</button></div>';
    if (pw) {
      var done = runMinutesDone(start), plannedMin = pw.minutes;
      h += '<div class="badges"><span class="badge">Phase ' + pw.phase + ": " + esc(phaseName(pw.phase)) + "</span>" + (pw.light ? '<span class="badge light">Lighter week</span>' : "") + "</div>";
      if (plannedMin) {
        var pct = Math.min(100, Math.round(done / plannedMin * 100));
        h += '<div class="card"><div class="where">Running minutes</div><div class="session-text mono">' + done + " / ~" + plannedMin + '</div><div class="bar"><i style="width:' + pct + '%"></i></div><p class="muted">Done so far against the plan. Never make up a missed workout.</p></div>';
      } else h += '<div class="card"><p class="muted">Lighter week. Roughly 15% less running than the week before.</p></div>';
    }
    h += '<ul class="daylist">';
    for (var i = 0; i < 7; i++) {
      var ds = addDays(start, i), p = planFor(ds), l = S.logs[ds], lt = lightOf(l);
      var txt = p.kind === "day" ? '<b>' + esc(p.day.where) + (p.day.hard ? " - HARD" : "") + "</b>" + esc(short(p.day.session)) : p.kind === "starter" ? "<b>Starter session</b>TrueForm" : p.kind === "season" ? "<b>Racing season</b>Meet or workout" : "Not started";
      var cls = lt || (l && l.status === "skipped" ? "S" : "");
      h += '<li data-act="open" data-d="' + ds + '" class="' + (ds === todayIso() ? "today" : "") + '"><div class="dn">' + DOWS[i] + "<small>" + pretty(ds) + '</small></div><div class="ds">' + txt + '</div><span class="dot2 ' + cls + '" title="' + (lt || "") + '"></span></li>';
    }
    h += "</ul><p class=\"muted\">Dot color is the foot light from the log. Hollow ring means skipped. Tap a day to open it.</p>";
    h += '<a class="btn ghost block" href="print.html?w=' + (pw ? pw.n : 1) + '" target="_blank" rel="noopener">Print garage sheet for this week</a>';
    return h;
  }
  function short(s) { s = s.replace(/^HARD DAY\.\s*/, ""); return s.length > 90 ? s.slice(0, 88) + "..." : s; }

  /* ---------- TESTS ---------- */
  function testLogs() {
    var res = { base: null, retest: null, final: null };
    Object.keys(S.logs).sort().forEach(function (d) {
      var l = S.logs[d]; if (l.test && res[l.test] !== undefined && (l.pace || l.hr)) res[l.test] = { date: d, pace: l.pace, hr: l.hr };
    });
    return res;
  }
  function secs(p) { var m = /^(\d+):(\d{2})$/.exec(String(p || "").trim()); return m ? +m[1] * 60 + +m[2] : null; }
  function renderTests() {
    var h = "<h2>Checkpoint: start Phase 2</h2><p class=\"muted\">End of week 4. Move on only if ALL are true. If not, repeat weeks 3 and 4.</p><div class=\"card\">";
    plan.ref.checkpoint4.forEach(function (c, i) {
      h += '<label class="check"><input type="checkbox" data-chk="cp4-' + i + '"' + (S.checks["cp4-" + i] ? " checked" : "") + ">" + esc(c) + "</label>";
    });
    var all = plan.ref.checkpoint4.every(function (c, i) { return S.checks["cp4-" + i]; });
    h += '<div class="light-box ' + (all ? "G" : "") + '"><span class="dot"></span><div><b>' + (all ? "Ready for Phase 2" : "Not yet") + "</b>" + (all ? "All four are true." : "Check all four to unlock.") + "</div></div></div>";
    h += "<p class=\"muted\">Note: week 4 only schedules a 25 min long run, so the '25-30 min nonstop' item means at least 25 min. Ask the PT if you want a 30 min run added.</p>";

    h += "<h2>Checkpoint: start Phase 3</h2><p class=\"muted\">The plan does not list a written gate here. Suggested: same foot rules as above, plus PT OK for sprints and 800 pace.</p><div class=\"card\">";
    ["Foot GREEN for all of the last 2 weeks, no next-morning pain.", "Jumps pain-free at step 2 or higher.", "Hard TrueForm days finished at the same speed every rep.", "PT OK for sprints and track 800 pace."].forEach(function (c, i) {
      h += '<label class="check"><input type="checkbox" data-chk="cp6-' + i + '"' + (S.checks["cp6-" + i] ? " checked" : "") + ">" + esc(c) + "</label>";
    });
    h += "</div>";

    var t = testLogs();
    h += "<h2>TrueForm tests</h2><p class=\"muted\">Progress means a faster pace at the same heart rate, or a lower heart rate at the same pace. Enter numbers on the day of the test (week 5 Tue, week 10 Tue, week 16 Thu) and they show here.</p><div class=\"card\"><div class=\"cmp\">";
    [["base", "Wk 5 base"], ["retest", "Wk 10"], ["final", "Wk 16"]].forEach(function (k) {
      var x = t[k[0]];
      h += "<div><b>" + k[1] + "</b><span>" + (x && x.pace ? esc(x.pace) : "--") + "</span><small>" + (x && x.hr ? esc(x.hr) + " bpm" : "no HR") + "</small></div>";
    });
    h += "</div>";
    var b = t.base, last = t.final || t.retest;
    if (b && last) {
      var s1 = secs(b.pace), s2 = secs(last.pace), hr1 = num(b.hr), hr2 = num(last.hr), msg = [];
      if (s1 != null && s2 != null) msg.push("Pace changed " + (s2 - s1 > 0 ? "+" : "") + (s2 - s1) + " sec (if pace is time per mile or km, negative is faster).");
      if (hr1 != null && hr2 != null) msg.push("Heart rate changed " + (hr2 - hr1 > 0 ? "+" : "") + (hr2 - hr1) + " bpm.");
      if (msg.length) h += "<p>" + msg.join(" ") + "</p>";
    }
    return h + "</div>";
  }

  /* ---------- GUIDE ---------- */
  function renderGuide() {
    var r = plan.ref, h = "<h2>Track paces</h2><div class=\"card\"><table class=\"t\"><tr><th>Pace</th><th>200</th><th>300</th><th>400</th></tr>" +
      r.paces.map(function (x) { return "<tr><td><b>" + esc(x.name) + "</b></td><td>" + x.p200 + "</td><td>" + x.p300 + "</td><td>" + x.p400 + "</td></tr>"; }).join("") +
      "</table><p class=\"muted\">Track only. Do not use them on the TrueForm.</p></div>";
    h += "<h2>Effort scale</h2><div class=\"card\">" + rows(r.effort) + "</div>";
    h += "<h2>Where work happens</h2><div class=\"card\">" + rows(r.where) + "</div>";
    h += "<h2>Foot light</h2><div class=\"card\"><div class=\"light-box G\"><span class=\"dot\"></span><div><b>Green</b>Pain 0-2, gone by next morning. Keep going.</div></div>" +
      "<div class=\"light-box Y\"><span class=\"dot\"></span><div><b>Yellow</b>Pain 3-4, or stiff next morning that eases after a few minutes of walking. No hard session. Easy run cut in half, or cross-train. Yellow 2 days in a row: 2 days off running, tell the PT.</div></div>" +
      "<div class=\"light-box R\"><span class=\"dot\"></span><div><b>Red</b>" + esc(r.redFlags.join(". ")) + ". Stop running. Call the PT or doctor this week.</div></div></div>";
    h += "<h2>Tell a parent and the coach the same day</h2><div class=\"card\"><ol>" + r.questions.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ol></div>";
    h += "<h2>Other signs of overload</h2><div class=\"card\"><ul>" + r.overload.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul></div>";
    h += "<h2>If days get missed</h2><div class=\"card\">" + rows(r.rework) + "</div>";
    h += "<h2>Home gym</h2><div class=\"card\"><p class=\"muted\">" + esc(r.gymNote) + "</p>" + exBlock("Foot routine", r.foot) + exBlock("Gym A", r.gymA) + exBlock("Gym B", r.gymB) + exBlock("Jump steps", r.jumps) + "</div>";
    h += "<h2>Racing season (Feb 15 on)</h2><div class=\"card\"><ul>" + r.phase4.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul></div>";
    h += "<p class=\"muted\">This plan is a starting point, not medical advice. The PT and school coach should see it before the first run.</p>";
    return h;
  }

  /* ---------- DATA ---------- */
  function summaryText() {
    var today = todayIso(), p = planFor(today), lines = [];
    lines.push("800m comeback summary, " + pretty(today) + (p.kind === "day" ? " (plan week " + p.week.n + ")" : ""));
    if (S.offset) lines.push("Plan shifted " + S.offset + " week(s) from the calendar.");
    lines.push("");
    var from = addDays(today, -13);
    Object.keys(S.logs).sort().filter(function (d) { return d >= from; }).forEach(function (d) {
      var l = S.logs[d], pd = planFor(d);
      var plan1 = pd.kind === "day" ? pd.day.where + ": " + short(pd.day.session) : "";
      lines.push(pretty(d) + " | " + (l.status || "-") + " | foot " + (l.painDuring == null ? "-" : l.painDuring) + " during, " + (l.painAM == null ? "-" : l.painAM) + " next AM" +
        (lightOf(l) ? " (" + LIGHT_TXT[lightOf(l)][0] + ")" : "") +
        (l.pace ? " | pace " + l.pace : "") + (l.hr ? " | HR " + l.hr : "") + (l.minutes ? " | " + l.minutes + " min" : "") +
        (l.reps ? " | reps " + l.reps : "") + (l.school ? " | school hard workout" : "") +
        (l.flags && l.flags.length ? " | RED: " + l.flags.join(", ") : "") + (l.notes ? " | " + l.notes.replace(/\n/g, " ") : "") +
        (plan1 ? "\n    plan: " + plan1 : ""));
    });
    var adv = advice();
    if (adv.length) { lines.push(""); adv.forEach(function (a) { lines.push("FLAG: " + a.title + ". " + a.body); }); }
    return lines.join("\n");
  }
  function csvText() {
    var cols = ["date", "status", "painDuring", "painAM", "stiff", "flags", "pace", "hr", "effort", "reps", "minutes", "school", "test", "notes"];
    var out = [cols.join(",")];
    Object.keys(S.logs).sort().forEach(function (d) {
      var l = S.logs[d];
      out.push([d].concat(cols.slice(1).map(function (c) {
        var v = l[c]; if (Array.isArray(v)) v = v.join("; "); if (v == null) v = "";
        return '"' + String(v).replace(/"/g, '""') + '"';
      })).join(","));
    });
    return out.join("\n");
  }
  function download(name, text, type) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
  }
  function renderData() {
    var h = "<h2>Send to Dad</h2><p class=\"muted\">Copies the last 2 weeks of logs plus any flags. Paste it in a text message so the plan can be adjusted.</p>" +
      '<button class="btn block" data-act="copy">Copy summary</button>' +
      '<button class="btn ghost block" data-act="share">Share...</button>';
    h += "<h2>Back up</h2><div class=\"btns\"><button class=\"btn ghost\" data-act=\"json\">Download JSON</button><button class=\"btn ghost\" data-act=\"csv\">Download CSV</button>" +
      '<label class="btn ghost">Import JSON<input type="file" accept="application/json" data-act="import" hidden></label></div>';
    h += "<h2>Plan shift</h2><p class=\"muted\">Moves the plan, not the calendar. Use it when the rework rules say to repeat a week or go back. Currently <b>" + (S.offset || 0) + "</b> week(s).</p>" +
      '<div class="btns"><button class="btn ghost" data-act="shift" data-n="-1">Back 1 week</button><button class="btn ghost" data-act="shift" data-n="1">Forward 1 week</button><button class="btn ghost" data-act="shift" data-n="0">Reset</button></div>';
    h += "<h2>Look</h2><div class=\"btns\"><button class=\"btn ghost\" data-act=\"theme\" data-v=\"dark\">Dark</button><button class=\"btn ghost\" data-act=\"theme\" data-v=\"light\">Light</button><button class=\"btn ghost\" data-act=\"theme\" data-v=\"\">Auto</button></div>";
    h += "<h2>Garage sheets</h2><a class=\"btn ghost block\" href=\"print.html\" target=\"_blank\" rel=\"noopener\">Open print page</a>";
    h += "<h2>Start over</h2><button class=\"btn danger block\" data-act=\"reset\">Erase all logs on this phone</button>";
    h += "<p class=\"muted\">Logs live only on this phone. Export now and then so nothing is lost.</p>";
    return h;
  }

  /* ---------- router + events ---------- */
  function render() {
    var fn = { today: renderToday, week: renderWeek, tests: renderTests, guide: renderGuide, data: renderData }[view.tab];
    app.innerHTML = fn();
    [].forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.setAttribute("aria-current", String(b.dataset.tab === view.tab)); });
  }
  function go(tab) { view.tab = tab; render(); window.scrollTo(0, 0); }
  function curLog() { var l = S.logs[view.date]; if (!l) { l = S.logs[view.date] = {}; stamp(l); } return l; }
  function stamp(l) {
    var p = planFor(view.date);
    if (p.kind === "day") { l.wk = p.week.n; l.dow = p.day.dow; if (p.day.test) l.test = p.day.test; }
  }

  document.getElementById("tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) go(b.dataset.tab); });

  app.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act]"); if (!t) return;
    var a = t.dataset.act;
    if (a === "day") { view.date = addDays(view.date, +t.dataset.n); render(); }
    else if (a === "gotoday") { view.date = todayIso(); render(); }
    else if (a === "status") { var l = curLog(); l.status = t.dataset.v; stamp(l); save(); render(); }
    else if (a === "num") { var l2 = curLog(); var f = t.dataset.f, v = +t.dataset.v; l2[f] = l2[f] === v ? null : v; save(); render(); }
    else if (a === "apply") { applyAdvice(t.dataset.mode); render(); }
    else if (a === "dismiss") { S.ackThrough = addDays(todayIso(), -1); save(); render(); }
    else if (a === "wk") { view.weekDate = addDays(view.weekDate, +t.dataset.n); render(); }
    else if (a === "open") { view.date = t.dataset.d; go("today"); }
    else if (a === "copy") {
      var txt = summaryText();
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Copied. Paste it in a text."); }, function () { prompt("Copy this:", txt); });
    }
    else if (a === "share") {
      var t2 = summaryText();
      if (navigator.share) navigator.share({ title: "800m summary", text: t2 }).catch(function () {}); else toast("Sharing is not available. Use Copy summary.");
    }
    else if (a === "json") download("800m-log-" + todayIso() + ".json", JSON.stringify(S, null, 1), "application/json");
    else if (a === "csv") download("800m-log-" + todayIso() + ".csv", csvText(), "text/csv");
    else if (a === "shift") { var n = +t.dataset.n; S.offset = n === 0 ? 0 : (S.offset || 0) + n; save(); render(); }
    else if (a === "theme") { S.theme = t.dataset.v; applyTheme(); save(); }
    else if (a === "reset") { if (confirm("Erase every logged day on this phone? Export first if you want a copy.")) { S.logs = {}; S.checks = {}; S.offset = 0; S.ackThrough = ""; save(); render(); toast("Cleared."); } }
  });

  app.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.act === "import") {
      var f = t.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { var o = JSON.parse(r.result); if (!o.logs) throw 0; S = Object.assign(S, o); save(); render(); toast("Imported."); } catch (x) { toast("That file did not look right."); } };
      r.readAsText(f); return;
    }
    if (t.dataset.chk) { S.checks[t.dataset.chk] = t.checked; save(); render(); return; }
    if (t.dataset.flag) {
      var l = curLog(); l.flags = l.flags || [];
      var i = l.flags.indexOf(t.dataset.flag); if (t.checked && i < 0) l.flags.push(t.dataset.flag); if (!t.checked && i >= 0) l.flags.splice(i, 1);
      save(); render(); return;
    }
    if (t.dataset.f === "stiff" || t.dataset.f === "school") { var l3 = curLog(); l3[t.dataset.f] = t.checked; save(); render(); }
  });
  app.addEventListener("input", function (e) {
    var t = e.target; if (!t.dataset.f || t.type === "checkbox") return;
    var l = curLog(); l[t.dataset.f] = t.value; stamp(l); save();
  });

  function applyTheme() {
    if (S.theme) document.documentElement.setAttribute("data-theme", S.theme); else document.documentElement.removeAttribute("data-theme");
  }

  /* ---------- boot ---------- */
  load(); applyTheme();
  fetch("plan.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
    plan = j;
    var t = todayIso();
    view.date = t; view.weekDate = t;
    render();
  }).catch(function () { app.innerHTML = '<div class="alert R"><b>Could not load the plan</b>Open the page once with internet, then it works offline.</div>'; });
  if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); }); }
})();
