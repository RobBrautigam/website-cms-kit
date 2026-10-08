/*
 * Website CMS Kit, interactive demo.
 *
 * A static, no-backend walk-through of the kit's admin surface. Everything is
 * invented sample data kept in this browser's own storage (localStorage); no
 * request leaves the page (the CSP sets connect-src 'none'). The real kit does
 * the same things against Supabase: see source/ and docs/.
 *
 * Shape: one hash router, one in-memory store persisted to localStorage, and a
 * view function per screen. Every value rendered into HTML goes through esc().
 */
(function () {
  'use strict';

  var STORE_KEY = 'cmskit-demo-v2';
  var THEME_KEY = 'cmskit-demo-theme';
  var SESSION_KEY = 'cmskit-demo-session';
  var DEMO_VERSION = 'v1.2.0 demo';
  var DEMO_TOTP = '123456';
  var CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MAX_UPLOAD = 5 * 1024 * 1024;
  var ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  var PAGE_SIZE = 50;

  // ---------------------------------------------------------------- helpers
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function uid() {
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nowIso() { return new Date().toISOString(); }
  function daysAgo(d, h) { return new Date(Date.now() - (d * 24 + (h || 0)) * 3600 * 1000).toISOString(); }
  var fmtDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var fmtDateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  function dateLabel(iso) { return iso ? fmtDate.format(new Date(iso)) : ''; }
  function dateTimeLabel(iso) { return iso ? fmtDateTime.format(new Date(iso)) : ''; }
  function ago(iso) {
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + ' seconds ago';
    var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function recoveryCodes() {
    var out = [];
    while (out.length < 10) {
      var b = new Uint8Array(12); crypto.getRandomValues(b);
      var c = '';
      for (var i = 0; i < 12; i++) { c += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; if (i === 3 || i === 7) c += '-'; }
      if (out.indexOf(c) === -1) out.push(c);
    }
    return out;
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Inline icons (lucide-style strokes).
  var ICONS = {
    posts: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    audit: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    redirect: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    play: '<path d="m6 3 14 9-14 9V3z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  function icon(name, label) {
    var a11y = label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true" focusable="false"';
    return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + a11y + '>' + ICONS[name] + '</svg>';
  }
  var MARK = '<svg class="mark" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.14"/><path d="M7 16 L12 7 L17 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9.2" y1="13.2" x2="14.8" y2="13.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // --------------------------------------------------------- sample data
  // Invented content only. Images are generated SVG artwork, not photos.
  function art(h1, h2, shape) {
    var shapes = {
      circles: '<circle cx="240" cy="170" r="110" fill="white" fill-opacity=".18"/><circle cx="420" cy="300" r="70" fill="white" fill-opacity=".22"/>',
      waves: '<path d="M0 300 C160 220 320 380 640 260 L640 480 L0 480Z" fill="white" fill-opacity=".2"/><path d="M0 360 C200 300 380 440 640 340 L640 480 L0 480Z" fill="white" fill-opacity=".18"/>',
      grid: '<g stroke="white" stroke-opacity=".25" stroke-width="2"><path d="M80 0V480M200 0V480M320 0V480M440 0V480M560 0V480M0 80H640M0 200H640M0 320H640M0 440H640"/></g><rect x="200" y="200" width="120" height="120" fill="white" fill-opacity=".3"/>',
      peaks: '<path d="M0 480 L180 200 L300 340 L440 120 L640 480Z" fill="white" fill-opacity=".22"/>'
    };
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + h1 + ',70%,55%)"/><stop offset="1" stop-color="hsl(' + h2 + ',70%,40%)"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/>' + shapes[shape] + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function t(text, marks) { var n = { type: 'text', text: text }; if (marks) n.marks = marks; return n; }
  function p() { return { type: 'paragraph', content: Array.prototype.slice.call(arguments).map(function (x) { return typeof x === 'string' ? t(x) : x; }) }; }
  function h(level, text) { return { type: 'heading', attrs: { level: level }, content: [t(text)] }; }
  function ul(items) { return { type: 'bulletList', content: items.map(function (i) { return { type: 'listItem', content: [p(i)] }; }) }; }
  function quote(text) { return { type: 'blockquote', content: [p(text)] }; }
  function doc() { return { type: 'doc', content: Array.prototype.slice.call(arguments) }; }
  var B = [{ type: 'bold' }];

  function seed() {
    var media = [
      { id: uid(), name: 'spring-launch.svg', type: 'image/svg+xml', size: 1520, w: 640, h: 480, alt: 'Abstract blue gradient with circles', src: art(215, 250, 'circles'), createdAt: daysAgo(30) },
      { id: uid(), name: 'field-notes.svg', type: 'image/svg+xml', size: 1480, w: 640, h: 480, alt: 'Abstract teal gradient with waves', src: art(170, 200, 'waves'), createdAt: daysAgo(24) },
      { id: uid(), name: 'grid-study.svg', type: 'image/svg+xml', size: 1610, w: 640, h: 480, alt: 'Abstract violet gradient with a grid', src: art(260, 290, 'grid'), createdAt: daysAgo(18) },
      { id: uid(), name: 'summit.svg', type: 'image/svg+xml', size: 1390, w: 640, h: 480, alt: 'Abstract amber gradient with mountain peaks', src: art(30, 10, 'peaks'), createdAt: daysAgo(9) },
      { id: uid(), name: 'quiet-hours.svg', type: 'image/svg+xml', size: 1450, w: 640, h: 480, alt: 'Abstract rose gradient with waves', src: art(340, 310, 'waves'), createdAt: daysAgo(3) }
    ];
    function post(o) {
      var content = { title: o.title, slug: slugify(o.title), excerpt: o.excerpt, metaDescription: o.meta || o.excerpt, category: o.category, cover: o.cover || '', body: o.body };
      var rec = { id: uid(), status: o.status, author: o.author, createdAt: daysAgo(o.age + 2), updatedAt: daysAgo(o.age, o.hours || 0), publishedAt: o.status === 'published' ? daysAgo(o.age) : null, publishAt: o.publishAt || null, draft: content, live: o.status === 'published' ? clone(content) : null };
      if (o.pending) { rec.draft = clone(content); rec.draft.title = o.pending.title || content.title; rec.draft.excerpt = o.pending.excerpt || content.excerpt; rec.draft.body = o.pending.body || content.body; rec.updatedAt = daysAgo(0, 2); }
      // The staged copy's review state, as in migration 001 (null: nothing staged).
      rec.review = o.review ? { status: o.review.status, stagedBy: o.review.stagedBy, stagedAt: daysAgo(0, o.review.hours || 2), requestedBy: o.review.requestedBy || null, approvedBy: o.review.approvedBy || null } : null;
      return rec;
    }
    var posts = [
      post({ title: 'Five habits of teams that ship content every week', status: 'published', category: 'Guides', author: 'Avery Park', age: 2, cover: media[0].src,
        excerpt: 'A steady publishing rhythm is a process problem, not a talent problem. Here is the process.',
        body: doc(p('Most teams do not run out of ideas. They run out of a ', t('repeatable way', B), ' to turn ideas into published pages.'), h(2, 'Write the brief first'), p('One paragraph: who it is for, what they should do after reading, and the one claim the piece has to prove.'), h(2, 'Keep a short list, not a backlog'), ul(['Five topics, ranked', 'One owner per topic', 'A date on every topic']), quote('A calendar with fewer, dated items beats a backlog with many undated ones.'), p('The rest is review and publish, which this admin makes a two-click job.')) }),
      post({ title: 'How we review a post before it goes live', status: 'published', category: 'Guides', author: 'Jordan Blake', age: 6, cover: media[1].src,
        excerpt: 'Draft, staging preview, publish: the three steps every change takes.',
        body: doc(p('Every change starts as a draft. Drafts are visible only inside the admin.'), h(2, 'Preview the whole site'), p('The staging preview shows the site exactly as it will look once the change is published, next to the live version.'), h(2, 'Publish, then verify'), p('Publishing writes an audit-log entry with who, what and when, so there is never a question about where a change came from.')),
        pending: { title: 'How we review a post before it goes live (updated checklist)', excerpt: 'Draft, staging preview, approve, publish: the four steps every change takes.' },
        review: { status: 'in_review', stagedBy: 'Jordan Blake', requestedBy: 'Jordan Blake', hours: 2 } }),
      post({ title: 'Release notes: faster image uploads', status: 'published', category: 'Product', author: 'Avery Park', age: 11, cover: media[2].src,
        excerpt: 'Images now upload in the background and are resized before they leave the browser.',
        body: doc(p('Uploads are now checked for type and size before they start, and large images are resized on the way in.'), ul(['JPEG, PNG, WebP and GIF', 'Up to 5 MB per file', 'Alt text on every image'])),
        pending: { title: 'Release notes: faster image uploads and alt text reminders', excerpt: 'Images upload in the background, are resized before they leave the browser, and now ask for alt text.',
          body: doc(p('Uploads are now checked for type and size before they start, and large images are resized on the way in.'), ul(['JPEG, PNG, WebP and GIF', 'Up to 5 MB per file', 'Alt text on every image']), h(2, 'New: alt text reminders'), p('The editor now asks for alt text before an image is saved, so no image goes live without one.')) },
        review: { status: 'staged', stagedBy: 'Avery Park', hours: 1 } }),
      post({ title: 'Writing alt text that actually helps', status: 'published', category: 'Guides', author: 'Sam Ortiz', age: 15, cover: media[3].src,
        excerpt: 'Describe what the image does for the reader, not every pixel in it.',
        body: doc(p('Good alt text is short and specific. If the image is decorative, say so by leaving it empty.'), h(3, 'A quick test'), p('Read the paragraph aloud with the alt text in place of the image. If it still makes sense, the alt text works.')) }),
      post({ title: 'Our studio is moving to a four-day week', status: 'published', category: 'Company', author: 'Jordan Blake', age: 21,
        excerpt: 'What we tried, what we measured, and what changes for clients.',
        body: doc(p('After a three-month trial we are making the four-day week permanent.'), h(2, 'What changes for clients'), p('Nothing in response times. Coverage on Fridays rotates across the team.')) }),
      post({ title: 'A practical guide to redirects after a redesign', status: 'scheduled', category: 'Guides', author: 'Avery Park', age: 1, publishAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), cover: media[4].src,
        excerpt: 'Map every old address to its new home before launch day, not after.',
        body: doc(p('A redesign that drops old addresses loses the links other sites gave you. A redirect map keeps them.'), ul(['Export every old path', 'Match each to its new page', 'Use permanent redirects for moved pages']), p('The Redirects screen tests each rule before it goes live.')) }),
      post({ title: 'Draft: questions to ask before you pick a CMS', status: 'draft', category: 'Guides', author: 'Sam Ortiz', age: 0, hours: 5,
        excerpt: 'Who edits, how often, and what needs approval decide more than any feature list.',
        body: doc(p('Start with the people: who writes, who approves, and who fixes things when they break.'), p('Then the cadence, then the features.')),
        review: { status: 'approved', stagedBy: 'Sam Ortiz', requestedBy: 'Sam Ortiz', approvedBy: 'Jordan Blake', hours: 4 } }),
      post({ title: 'Draft: spring open house recap', status: 'draft', category: 'News', author: 'Jordan Blake', age: 1, hours: 3,
        excerpt: '', body: doc(p('Notes from the open house go here.')) })
    ];
    var me = { id: uid(), name: 'Avery Park', email: 'avery@example.com', role: 'super_admin', status: 'active', mfa: true, lastActive: nowIso(), createdAt: daysAgo(120) };
    var team = [
      me,
      { id: uid(), name: 'Jordan Blake', email: 'jordan@example.com', role: 'admin', status: 'active', mfa: true, lastActive: daysAgo(0, 4), createdAt: daysAgo(90) },
      { id: uid(), name: 'Sam Ortiz', email: 'sam@example.com', role: 'admin', status: 'active', mfa: false, lastActive: daysAgo(1), createdAt: daysAgo(4) },
      { id: uid(), name: 'Riley Chen', email: 'riley@example.com', role: 'admin', status: 'deactivated', mfa: true, lastActive: daysAgo(40), createdAt: daysAgo(200) }
    ];
    var redirects = [
      { id: uid(), from: '/blog/old-launch-post', to: '/blog/five-habits-of-teams-that-ship-content-every-week', permanent: true, enabled: true, hits: 214, lastHit: daysAgo(0, 1), createdAt: daysAgo(60) },
      { id: uid(), from: '/careers', to: '/jobs', permanent: true, enabled: true, hits: 1032, lastHit: daysAgo(0, 3), createdAt: daysAgo(120) },
      { id: uid(), from: '/book', to: 'https://calendar.example.com/acme/intro', permanent: false, enabled: true, hits: 88, lastHit: daysAgo(2), createdAt: daysAgo(20) },
      { id: uid(), from: '/spring-sale', to: '/blog', permanent: false, enabled: false, hits: 12, lastHit: daysAgo(35), createdAt: daysAgo(70) }
    ];
    function a(who, action, type, id, payload, d, hr) { return { id: uid(), at: daysAgo(d, hr), actor: who.email, role: who.role, action: action, resourceType: type, resourceId: id, payload: payload || {}, ip: '203.0.113.' + (10 + Math.floor(Math.random() * 80)) }; }
    var audit = [
      a(me, 'auth.login_success', 'session', '', {}, 0, 1),
      a(me, 'blog_post.stage', 'blog_post', posts[2].id, { title: posts[2].draft.title, slug: posts[2].draft.slug, created: true }, 0, 1),
      a(team[1], 'blog_post.approve', 'blog_post', posts[6].id, { title: posts[6].draft.title, staged_by: team[2].email }, 0, 3),
      a(team[1], 'blog_post.request_review', 'blog_post', posts[1].id, { title: posts[1].draft.title }, 0, 2),
      a(team[1], 'blog_post.stage', 'blog_post', posts[1].id, { title: posts[1].draft.title, slug: posts[1].draft.slug, created: true }, 0, 2),
      a(team[2], 'blog_post.request_review', 'blog_post', posts[6].id, { title: posts[6].draft.title }, 0, 4),
      a(team[2], 'blog_post.stage', 'blog_post', posts[6].id, { title: posts[6].draft.title, slug: posts[6].draft.slug, created: true }, 0, 4),
      a(team[2], 'blog_post.create', 'blog_post', posts[6].id, { title: posts[6].draft.title }, 0, 5),
      a(me, 'blog_post.schedule', 'blog_post', posts[5].id, { publish_at: posts[5].publishAt }, 1, 0),
      a(team[1], 'blog_post.create', 'blog_post', posts[7].id, { title: posts[7].draft.title }, 1, 3),
      a(me, 'blog_post.publish', 'blog_post', posts[0].id, { title: posts[0].draft.title }, 2, 0),
      a(me, 'user.invite', 'user', team[2].id, { email: team[2].email, role: 'admin' }, 4, 0),
      a(me, 'redirect.create', 'redirect', redirects[2].id, { from: '/book' }, 20, 0),
      a(me, 'user.deactivate', 'user', team[3].id, { email: team[3].email }, 38, 0),
      a(team[1], 'auth.mfa.enrolled', 'user', team[1].id, {}, 60, 0)
    ];
    audit.sort(function (x, y) { return y.at.localeCompare(x.at); });
    return { version: 2, posts: posts, media: media, team: team, redirects: redirects, audit: audit, meId: me.id, viewAs: 'super_admin', mfaCodes: recoveryCodes(), mfaEnabled: true, categories: ['Guides', 'Product', 'News', 'Company'] };
  }

  // ------------------------------------------------------------- the store
  var db = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var d = JSON.parse(raw); if (d && d.version === 2 && Array.isArray(d.posts)) return d; }
    } catch (e) { /* corrupt or blocked: fall through to fresh sample data */ }
    var fresh = seed();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(fresh)); } catch (e) { /* storage blocked: run in memory */ }
    return fresh;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); return true; }
    catch (e) { toast('This browser’s storage is full. Delete an image or reset the demo data.', 'err'); return false; }
  }
  function me() { return db.team.filter(function (u) { return u.id === db.meId; })[0]; }
  function role() { return db.viewAs || me().role; }
  function isSuper() { return role() === 'super_admin'; }
  function audit(action, resourceType, resourceId, payload) {
    var u = me();
    db.audit.unshift({ id: uid(), at: nowIso(), actor: u.email, role: role(), action: action, resourceType: resourceType || '', resourceId: resourceId || '', payload: payload || {}, ip: '203.0.113.7' });
  }
  function resetDemo() {
    db = seed();
    save();
    sessionStorage.removeItem(SESSION_KEY);
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    toast('Demo data reset to the original sample.');
    go('#/login');
  }

  // ---------------------------------------------------------- the session
  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSession(s, remember) {
    var raw = JSON.stringify(s);
    sessionStorage.setItem(SESSION_KEY, raw);
    try { if (remember) localStorage.setItem(SESSION_KEY, raw); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function updateSession(patch) {
    var s = session() || {}; Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    var remembered = false; try { remembered = !!localStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    setSession(s, remembered);
  }
  function signOut() {
    audit('auth.logout', 'session', '');
    save();
    sessionStorage.removeItem(SESSION_KEY);
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    go('#/login');
  }

  // ------------------------------------------------------------- scheduler
  // Scheduled posts publish themselves once their time passes (the kit's
  // optional anon policy covers this with status = 'scheduled' and a time check).
  function runScheduler() {
    var changed = false;
    db.posts.forEach(function (p) {
      if (p.status === 'scheduled' && p.publishAt && new Date(p.publishAt) <= new Date()) {
        p.status = 'published'; p.live = clone(p.draft); p.publishedAt = p.publishAt; p.publishAt = null; changed = true;
        db.audit.unshift({ id: uid(), at: nowIso(), actor: 'scheduler', role: 'system', action: 'blog_post.scheduled_publish', resourceType: 'blog_post', resourceId: p.id, payload: { title: p.draft.title }, ip: '' });
      }
    });
    if (changed) save();
  }

  // -------------------------------------------------------- post helpers
  function postState(p) {
    if (p.status === 'published') return p.live && !same(p.live, p.draft) ? 'changed' : 'published';
    return p.status;
  }
  var STATE_LABEL = { published: 'Published', changed: 'Staged changes', draft: 'Draft', scheduled: 'Scheduled' };
  function chip(state, label) { return '<span class="chip chip-' + esc(state) + '">' + esc(label || STATE_LABEL[state] || state) + '</span>'; }

  // Staging and approval: the same rules as the kit's lib/staging/rules.ts
  // and migration 001. A published post's edits are its staged copy; a draft
  // is staged only when someone chooses "Stage for publishing".
  var REVIEW_LABEL = { staged: 'Staged', in_review: 'In review', approved: 'Approved' };
  var REVIEW_CHIP = { staged: 'changed', in_review: 'scheduled', approved: 'published' };
  function reviewOf(p) {
    var s = postState(p);
    if (s === 'changed') return p.review || { status: 'staged', stagedBy: p.author, stagedAt: p.updatedAt, requestedBy: null, approvedBy: null };
    if (s === 'draft' && p.review) return p.review;
    return null;
  }
  function reviewChip(r) { return chip(REVIEW_CHIP[r.status], REVIEW_LABEL[r.status]); }
  function canPublishReview(r) { return !r || r.status !== 'in_review'; }
  function canApprove(r) { return !!r && r.status === 'in_review' && r.stagedBy !== me().name; }
  function reviewLine(r) {
    var who = function (n) { return n === me().name ? 'you' : n; };
    if (r.status === 'in_review') return 'Staged by ' + who(r.stagedBy) + '. Review asked by ' + who(r.requestedBy || r.stagedBy) + '.';
    if (r.status === 'approved') return 'Staged by ' + who(r.stagedBy) + '. Approved by ' + who(r.approvedBy) + '.';
    return 'Staged by ' + who(r.stagedBy) + '.';
  }
  function teammate() { return db.team.filter(function (u) { return u.id !== db.meId && u.status === 'active'; })[0]; }
  // A content edit sends any review back to Staged, staged by whoever edited.
  function restage(p) {
    var r = p.review;
    if (r && r.status === 'staged' && r.stagedBy === me().name) return;
    p.review = { status: 'staged', stagedBy: me().name, stagedAt: nowIso(), requestedBy: null, approvedBy: null };
    audit('blog_post.stage', 'blog_post', p.id, { title: p.draft.title, slug: p.draft.slug, created: !r });
  }
  function setReview(p, to, actorName) {
    var r = reviewOf(p); if (!r) return;
    var from = r.status;
    if (to === 'in_review') { p.review = { status: 'in_review', stagedBy: r.stagedBy, stagedAt: r.stagedAt, requestedBy: me().name, approvedBy: null }; audit('blog_post.request_review', 'blog_post', p.id, { title: p.draft.title }); }
    else if (to === 'approved') {
      var by = actorName || me().name;
      p.review = { status: 'approved', stagedBy: r.stagedBy, stagedAt: r.stagedAt, requestedBy: r.requestedBy, approvedBy: by };
      var actor = db.team.filter(function (u) { return u.name === by; })[0] || me();
      db.audit.unshift({ id: uid(), at: nowIso(), actor: actor.email, role: actor.role, action: 'blog_post.approve', resourceType: 'blog_post', resourceId: p.id, payload: { title: p.draft.title, staged_by: r.stagedBy }, ip: '203.0.113.7' });
    } else { p.review = { status: 'staged', stagedBy: r.stagedBy, stagedAt: r.stagedAt, requestedBy: null, approvedBy: null }; audit('blog_post.withdraw_review', 'blog_post', p.id, { title: p.draft.title, from: from }); }
    p.updatedAt = nowIso();
  }
  function discardStage(p) {
    audit('blog_post.discard_staged', 'blog_post', p.id, { title: p.draft.title });
    if (p.live) p.draft = clone(p.live);
    p.review = null; p.updatedAt = nowIso();
  }
  function findPost(id) { return db.posts.filter(function (p) { return p.id === id; })[0]; }
  function wordCount(text) { var m = String(text || '').trim().match(/\S+/g); return m ? m.length : 0; }
  function docText(node) {
    if (!node) return '';
    if (node.text) return node.text;
    return (node.content || []).map(docText).join(' ');
  }
  function slugTaken(slug, exceptId) { return db.posts.some(function (p) { return p.id !== exceptId && (p.draft.slug === slug || (p.live && p.live.slug === slug)); }); }
  function publishPost(p, how, batch) {
    var r = reviewOf(p), wasLive = p.status === 'published' && p.publishedAt;
    p.live = clone(p.draft); p.status = 'published'; p.publishAt = null; if (!wasLive) p.publishedAt = nowIso(); p.updatedAt = nowIso();
    if (r) audit('blog_post.publish_staged', 'blog_post', p.id, { title: p.draft.title, slug: p.draft.slug, review_status: r.status, approved_by: r.approvedBy, batch: batch || 1 });
    else audit(how || 'blog_post.publish', 'blog_post', p.id, { title: p.draft.title });
    p.review = null;
  }
  function publishProblems(p) {
    var errs = [];
    if (!p.draft.title.trim()) errs.push('Add a title.');
    if (!SLUG_RE.test(p.draft.slug)) errs.push('Fix the URL slug (lowercase letters, numbers and dashes).');
    else if (slugTaken(p.draft.slug, p.id)) errs.push('Another post already uses this URL slug.');
    return errs;
  }

  // Rendering stored TipTap JSON to HTML, with the same link and image
  // allowlist the kit's TipTapRenderer applies.
  var renderExtensions = null;
  function bodyHtml(json) {
    if (!window.TipTap) return '<p>' + esc(docText(json)) + '</p>';
    if (!renderExtensions) renderExtensions = [window.TipTap.StarterKit.configure({ heading: { levels: [2, 3] } }), window.TipTap.Image];
    var html;
    try { html = window.TipTap.generateHTML(json, renderExtensions); } catch (e) { return '<p>' + esc(docText(json)) + '</p>'; }
    var tpl = document.createElement('template'); tpl.innerHTML = html;
    $all('a', tpl.content).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) a.setAttribute('href', '#');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
    });
    $all('img', tpl.content).forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (!/^(https?:|\/|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,])/i.test(src)) img.remove();
      else if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    });
    return tpl.innerHTML;
  }

  // ------------------------------------------------------------ the router
  var current = { path: null, cleanup: null };
  function go(hash) { if (location.hash === hash) render(true); else location.hash = hash; }
  function parse() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (raw.charAt(0) !== '/') raw = '/posts';
    var q = raw.split('?'); var parts = q[0].split('/').filter(Boolean);
    return { parts: parts, path: q[0] };
  }
  var PUBLIC = { login: 1, forgot: 1 };
  function render(force) {
    var r = parse();
    if (!force && r.path === current.path) return;
    if (current.cleanup) { try { current.cleanup(); } catch (e) { /* ignore */ } current.cleanup = null; }
    current.path = r.path;
    closeAllModals();
    runScheduler();
    var s = session();
    var first = r.parts[0] || 'posts';
    var authed = s && s.signedIn;
    // The three gates, demo-sized: no session -> login; aal1 with a factor -> verify;
    // no factor -> enroll. Mirrors updateSession() + requireAdmin().
    if (!PUBLIC[first] && !(first === 'login') && !authed) { location.replace('#/login'); return; }
    if (authed && first === 'login' && r.parts[1] !== 'verify' && s.aal === 'aal2') { location.replace('#/posts'); return; }
    if (authed && !PUBLIC[first] && first !== 'login' && first !== 'security') {
      if (db.mfaEnabled && s.aal !== 'aal2') { location.replace('#/login/verify'); return; }
      if (!db.mfaEnabled && s.mustEnroll) { location.replace('#/security/enroll'); return; }
    }
    var view = ROUTES[first] || viewNotFound;
    view(r.parts.slice(1));
    window.scrollTo(0, 0);
    var h1 = $('#root h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', function () { render(false); });
  // File inputs are visually hidden behind a <label class="btn">, so show the
  // keyboard focus ring on the label while its input has focus.
  function fileFocus(on) {
    return function (e) {
      var t = e.target;
      if (!t || t.type !== 'file' || !t.id) return;
      $all('label[for="' + t.id + '"]').forEach(function (l) { l.classList.toggle('has-focus', on); });
    };
  }
  document.addEventListener('focusin', fileFocus(true));
  document.addEventListener('focusout', fileFocus(false));

  // -------------------------------------------------------------- layout
  var NAV = [
    { title: 'Content', items: [
      { id: 'posts', label: 'Posts', icon: 'posts' },
      { id: 'media', label: 'Media', icon: 'image', proposed: true },
      { id: 'staging', label: 'Staging', icon: 'globe', badge: function () { return stagedChanges().length; } }
    ] },
    { title: 'Site', items: [{ id: 'redirects', label: 'Redirects', icon: 'redirect' }] },
    { title: 'Organization', items: [{ id: 'team', label: 'Team', icon: 'users', superOnly: true }] },
    { title: 'Audit', items: [{ id: 'audit', label: 'Audit log', icon: 'audit', superOnly: true }] }
  ];
  function shell(active, inner) {
    var u = me();
    var nav = NAV.map(function (sec) {
      var items = sec.items.filter(function (i) { return !i.superOnly || isSuper(); });
      if (!items.length) return '';
      return '<div class="sb-sec"><h2>' + esc(sec.title) + '</h2>' + items.map(function (i) {
        var n = i.badge ? i.badge() : 0;
        return '<a class="sb-link" href="#/' + i.id + '"' + (active === i.id ? ' aria-current="page"' : '') + '>' + icon(i.icon) + '<span>' + esc(i.label) + '</span>' + (i.proposed ? '<span class="tag-proposed" title="A proposed feature: not in the kit\'s source yet">Proposed</span>' : '') + (n ?'<span class="count" aria-label="' + esc(plural(n, 'staged change', 'staged changes')) + '">' + n + '</span>' : '') + '</a>';
      }).join('') + '</div>';
    }).join('');
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#root').innerHTML =
      '<div class="shell" id="shell">' +
        '<div class="scrim" data-act="close-nav"></div>' +
        '<aside class="sidebar" id="sidebar" aria-label="Admin navigation">' +
          '<div class="sb-logo">' + MARK + '<span>Acme Admin</span></div>' +
          '<nav class="sb-nav" aria-label="Sections">' + nav + '</nav>' +
          '<div class="sb-foot">' +
            '<div class="who"><div class="em">' + esc(u.email) + '</div><div class="role">' + esc(role() === 'super_admin' ? 'Super admin' : 'Admin') + '</div></div>' +
            '<a class="sb-action" href="#/settings"' + (active === 'settings' ? ' aria-current="page"' : '') + '>' + icon('settings') + 'Settings</a>' +
            '<button type="button" class="sb-action" data-act="toggle-theme" aria-label="Switch to ' + (dark ? 'light' : 'dark') + ' theme">' + icon(dark ? 'sun' : 'moon') + (dark ? 'Light theme' : 'Dark theme') + '</button>' +
            '<button type="button" class="sb-action" data-act="reset-demo">' + icon('reset') + 'Reset demo data</button>' +
            '<button type="button" class="sb-action" data-act="sign-out">' + icon('logout') + 'Sign out</button>' +
            '<div class="sb-ver">' + esc(DEMO_VERSION) + '</div>' +
          '</div>' +
        '</aside>' +
        '<div class="main">' +
          '<div class="topbar"><button type="button" class="icon-btn" data-act="open-nav" aria-controls="sidebar" aria-expanded="false" aria-label="Open navigation">' + icon('menu') + '</button><span class="brand">' + MARK + 'Acme Admin</span></div>' +
          '<main id="main" tabindex="-1"><div class="inner">' + inner + '</div></main>' +
        '</div>' +
      '</div>';
  }
  function authPage(inner) {
    $('#root').innerHTML = '<main id="main" class="auth" tabindex="-1"><div class="auth-card">' + inner + '</div></main>';
  }
  // Honesty marker for screens the kit's source does not have yet.
  function proposedNote(text, lead) {
    return '<p class="proposed-note"><strong>' + (lead || 'Proposed feature, not in the kit\'s source yet.') + '</strong> ' + text + '</p>';
  }
  function head(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="row">' + actions + '</div>' : '') + '</div>';
  }
  function setTitle(t) { document.title = t + ' | Acme Admin (demo)'; }

  // ------------------------------------------------------------ toasts
  function toast(msg, kind) {
    var box = $('#toasts'); if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { el.remove(); }, kind === 'err' ? 6000 : 4000);
  }

  // ------------------------------------------------------------ modals
  // Focus-trapped dialog: Escape and the backdrop close it, focus returns to
  // the control that opened it (the kit's ModalShell contract).
  var modalStack = [];
  function openModal(o) {
    var opener = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'backdrop';
    var titleId = 'm-' + uid().slice(0, 8);
    wrap.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
      '<h2 id="' + titleId + '">' + esc(o.title) + '</h2>' + (o.desc ? '<p class="desc">' + o.desc + '</p>' : '') +
      '<form novalidate class="m-form">' + (o.body || '') + '<div class="modal-actions">' + (o.actions || '<button type="button" class="btn btn-outline" data-close>Close</button>') + '</div></form></div>';
    document.body.appendChild(wrap);
    var modal = $('.modal', wrap);
    var form = $('form', wrap);
    function close() {
      wrap.remove();
      modalStack = modalStack.filter(function (m) { return m.wrap !== wrap; });
      document.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    }
    function onKey(e) {
      if (modalStack[modalStack.length - 1].wrap !== wrap) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        var f = $all('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal).filter(function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    $all('[data-close]', wrap).forEach(function (b) { b.addEventListener('click', close); });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (o.onSubmit) o.onSubmit(form, close); });
    modalStack.push({ wrap: wrap, close: close });
    var first = $('[autofocus]', modal) || $('input, select, textarea, button', modal);
    if (first) first.focus();
    if (o.onOpen) o.onOpen(modal, close);
    return close;
  }
  function closeAllModals() { modalStack.slice().forEach(function (m) { m.close(); }); }
  function confirmDialog(o) {
    openModal({
      title: o.title, desc: o.desc,
      actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '">' + esc(o.confirm || 'Confirm') + '</button>',
      onSubmit: function (form, close) { close(); o.onConfirm(); }
    });
  }

  // ======================================================= VIEWS: auth
  function viewLogin(rest) {
    if (rest[0] === 'verify') return viewVerify();
    setTitle('Sign in');
    authPage(
      '<div class="auth-head">' + MARK + '<h1>Sign in to Acme Admin</h1><p>Invite-only. Two-factor required.</p></div>' +
      '<div class="demo-cred"><strong>Demo login.</strong> The fields are pre-filled with a sample account; any password works. Nothing is checked against a server.</div>' +
      '<form id="login" novalidate>' +
        '<div class="field"><label class="lbl" for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" value="avery@example.com" required></div>' +
        '<div class="field"><label class="lbl" for="password">Password</label><div class="pw-wrap"><input class="input" id="password" type="password" autocomplete="current-password" value="demo-password-123!" required><button type="button" class="btn btn-ghost" data-act="toggle-pw" aria-controls="password" aria-pressed="false">Show</button></div></div>' +
        '<div class="row field"><label class="check"><input type="checkbox" id="remember"> Remember me for 30 days</label><span class="grow"></span><a href="#/forgot">Forgot password?</a></div>' +
        '<p class="hint err" id="login-err" role="alert"></p>' +
        '<button class="btn btn-primary btn-block" type="submit">Sign in</button>' +
      '</form>' +
      '<p class="auth-foot">No public sign-up: a super admin sends you an invite.</p>'
    );
    $('#login').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email').value.trim(), pw = $('#password').value;
      if (!EMAIL_RE.test(email) || !pw) { $('#login-err').textContent = 'Enter an email address and a password.'; return; }
      setSession({ signedIn: true, aal: db.mfaEnabled ? 'aal1' : 'aal2', mustEnroll: !db.mfaEnabled }, $('#remember').checked);
      audit('auth.login_success', 'session', ''); save();
      go(db.mfaEnabled ? '#/login/verify' : '#/posts');
    });
  }
  function viewVerify() {
    var s = session();
    if (!s || !s.signedIn) { location.replace('#/login'); return; }
    if (!db.mfaEnabled || s.aal === 'aal2') { location.replace('#/posts'); return; }
    setTitle('Two-factor check');
    authPage(
      '<div class="auth-head">' + MARK + '<h1>Two-factor check</h1><p>Enter the 6-digit code from your authenticator app.</p></div>' +
      '<div class="demo-cred"><strong>Demo code: ' + DEMO_TOTP + '.</strong> Or use a recovery code: <span class="mono">' + esc(db.mfaCodes[0] || 'none left') + '</span></div>' +
      '<form id="verify" novalidate>' +
        '<div class="field" id="totp-field"><label class="lbl" for="code">Authentication code</label><input class="input otp" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>' +
        '<div class="field" id="rec-field" hidden><label class="lbl" for="rcode">Recovery code</label><input class="input mono" id="rcode" autocomplete="off" placeholder="xxxx-xxxx-xxxx"><p class="hint">Using a recovery code turns two-factor off and asks you to set it up again, the same as the kit.</p></div>' +
        '<p class="hint err" id="verify-err" role="alert"></p>' +
        '<button class="btn btn-primary" type="submit" id="verify-btn">Verify</button> ' +
        '<button class="btn btn-ghost" type="button" data-act="toggle-recovery" aria-controls="rec-field" aria-expanded="false">Use a recovery code instead</button>' +
      '</form>' +
      '<p class="auth-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="sign-out">Cancel and sign out</button></p>'
    );
    $('#verify').addEventListener('submit', function (e) {
      e.preventDefault();
      var usingRec = !$('#rec-field').hidden;
      var err = $('#verify-err');
      if (usingRec) {
        var c = $('#rcode').value.trim().toLowerCase();
        var i = db.mfaCodes.indexOf(c);
        if (i === -1) { err.textContent = 'That recovery code is not valid or was already used.'; return; }
        db.mfaCodes.splice(i, 1); db.mfaEnabled = false; me().mfa = false;
        audit('auth.mfa.recovery_code_used', 'user', me().id); save();
        updateSession({ aal: 'aal1', mustEnroll: true });
        go('#/security/enroll');
        return;
      }
      if ($('#code').value.trim() !== DEMO_TOTP) { err.textContent = 'Wrong code. Try the next one (demo code: ' + DEMO_TOTP + ').'; return; }
      updateSession({ aal: 'aal2' });
      audit('auth.mfa.verified', 'session', ''); save();
      go('#/posts');
    });
  }
  function viewEnroll() {
    var s = session();
    if (!s || !s.signedIn) { location.replace('#/login'); return; }
    setTitle('Set up two-factor');
    if (db.mfaEnabled && s.aal === 'aal2') { location.replace('#/posts'); return; }
    authPage(
      '<div class="auth-head">' + MARK + '<h1>Set up two-factor</h1><p>Two-factor is required for every admin account.</p></div>' +
      '<form id="enroll" novalidate>' + enrollBody() +
      '<p class="hint err" id="enroll-err" role="alert"></p>' +
      '<button class="btn btn-primary btn-block" type="submit">Verify and turn on</button></form>' +
      '<p class="auth-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="sign-out">Cancel and sign out</button></p>'
    );
    $('#enroll').addEventListener('submit', function (e) {
      e.preventDefault();
      finishEnroll($('#enroll-code'), $('#enroll-err'), function () { go('#/posts'); });
    });
  }
  function enrollBody() {
    return '<img class="qr" alt="Sample QR pattern (not scannable in the demo)" src="' + esc(qrArt()) + '">' +
      '<p class="hint">In the kit, Supabase returns a real QR code and secret. Demo secret: <span class="mono">JBSW Y3DP EHPK 3PXP</span></p>' +
      '<div class="demo-cred"><strong>Demo code: ' + DEMO_TOTP + '.</strong></div>' +
      '<div class="field"><label class="lbl" for="enroll-code">6-digit code from the app</label><input class="input otp" id="enroll-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>';
  }
  function finishEnroll(codeInput, errEl, after) {
    if (codeInput.value.trim() !== DEMO_TOTP) { errEl.textContent = 'That code did not match. Try the next 30-second code (demo code: ' + DEMO_TOTP + ').'; return; }
    db.mfaEnabled = true; me().mfa = true; db.mfaCodes = recoveryCodes();
    audit('auth.mfa.enrolled', 'user', me().id); save();
    updateSession({ aal: 'aal2', mustEnroll: false });
    showCodes('Save your recovery codes', 'Each code works once. They are shown only now.', after);
  }
  function qrArt() {
    var cells = '';
    var seedN = 7;
    for (var y = 0; y < 21; y++) for (var x = 0; x < 21; x++) {
      seedN = (seedN * 1103515245 + 12345) & 0x7fffffff;
      var finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      var on = finder ? ((x % 14 === 0 || x % 14 === 6 || y % 14 === 0 || y % 14 === 6) || ((x % 14) > 1 && (x % 14) < 5 && (y % 14) > 1 && (y % 14) < 5)) : (seedN % 3 === 0);
      if (on) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><g fill="#0f172a">' + cells + '</g></svg>');
  }
  function showCodes(title, desc, after) {
    var codes = db.mfaCodes.slice();
    openModal({
      title: title, desc: esc(desc),
      body: '<div class="codes" aria-label="Recovery codes">' + codes.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>',
      actions: '<button type="button" class="btn btn-outline" data-act="dl-codes">' + icon('download') + 'Download .txt</button><button type="button" class="btn btn-outline" data-act="copy-codes">' + icon('copy') + 'Copy</button><button type="submit" class="btn btn-primary">I saved them</button>',
      onOpen: function (m) {
        $('[data-act="dl-codes"]', m).addEventListener('click', function () { download('acme-recovery-codes.txt', 'Acme Admin recovery codes (demo)\n\n' + codes.join('\n') + '\n', 'text/plain'); });
        $('[data-act="copy-codes"]', m).addEventListener('click', function () {
          if (navigator.clipboard) navigator.clipboard.writeText(codes.join('\n')).then(function () { toast('Recovery codes copied.'); }, function () { toast('Copy failed: select the codes and copy them by hand.', 'err'); });
        });
      },
      onSubmit: function (f, close) { close(); if (after) after(); }
    });
  }
  function viewSecurity(rest) { if (rest[0] === 'enroll') return viewEnroll(); viewNotFound(); }
  function viewForgot() {
    setTitle('Reset your password');
    authPage(
      '<div class="auth-head">' + MARK + '<h1>Reset your password</h1><p>We email a one-time link to set a new password.</p></div>' +
      '<form id="forgot" novalidate><div class="field"><label class="lbl" for="femail">Email</label><input class="input" id="femail" type="email" autocomplete="email" value="avery@example.com"></div>' +
      '<p class="hint err" id="forgot-err" role="alert"></p><div id="forgot-ok" role="status"></div>' +
      '<button class="btn btn-primary" type="submit">Send reset link</button></form>' +
      '<p class="auth-foot"><a href="#/login">Back to sign in</a></p>'
    );
    $('#forgot').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#femail').value.trim();
      if (!EMAIL_RE.test(v)) { $('#forgot-err').textContent = 'Enter a valid email address.'; return; }
      $('#forgot-err').textContent = '';
      $('#forgot-ok').innerHTML = '<div class="demo-cred">If an account exists for <strong>' + esc(v) + '</strong>, a reset link is on its way. <em>(Demo: no email is sent.)</em></div>';
    });
  }

  // ======================================================= VIEWS: posts
  var postFilters = { q: '', status: 'all', category: 'all', sort: 'updated' };
  function viewPosts() {
    setTitle('Posts');
    var counts = { published: 0, draft: 0, scheduled: 0, changed: 0 };
    db.posts.forEach(function (p) { var s = postState(p); counts[s] = (counts[s] || 0) + 1; if (s === 'changed') counts.published++; });
    shell('posts',
      head('Posts', 'Write, review and publish blog posts. Edits to a live post wait in staging until someone publishes them.', '<a class="btn btn-primary" href="#/posts/new">' + icon('plus') + 'New post</a>') +
      '<div class="stats">' +
        stat(counts.published, 'Published') + stat(counts.changed, 'Staged changes') + stat(counts.draft, 'Drafts') + stat(counts.scheduled, 'Scheduled') +
      '</div>' +
      '<div class="filters" role="search">' +
        '<div class="search">' + icon('search') + '<label class="sr-only" for="pq">Search posts</label><input class="input" id="pq" type="search" placeholder="Search title, excerpt or URL" value="' + esc(postFilters.q) + '"></div>' +
        '<label class="sr-only" for="pstatus">Status</label><select class="input" id="pstatus">' + opts([['all', 'All statuses'], ['published', 'Published'], ['changed', 'Staged changes'], ['draft', 'Draft'], ['scheduled', 'Scheduled']], postFilters.status) + '</select>' +
        '<label class="sr-only" for="pcat">Category</label><select class="input" id="pcat">' + opts([['all', 'All categories']].concat(db.categories.map(function (c) { return [c, c]; })), postFilters.category) + '</select>' +
        '<label class="sr-only" for="psort">Sort</label><select class="input" id="psort">' + opts([['updated', 'Last updated'], ['oldest', 'Oldest first'], ['az', 'Title A to Z'], ['za', 'Title Z to A']], postFilters.sort) + '</select>' +
      '</div>' +
      '<p class="count-line" id="pcount" aria-live="polite"></p>' +
      '<div class="table-wrap"><table class="tbl"><caption class="sr-only">Posts</caption><thead><tr><th scope="col">Title</th><th scope="col" class="col-wide">Status</th><th scope="col" class="col-opt">Category</th><th scope="col" class="col-opt">Updated</th><th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody id="prows"></tbody></table></div>'
    );
    // Max ~50 posts in the demo store. Plain render (the 50-row law: no virtualization below 50).
    function rows() {
      var q = postFilters.q.toLowerCase();
      var list = db.posts.filter(function (p) {
        var s = postState(p);
        if (postFilters.status !== 'all' && s !== postFilters.status) return false;
        if (postFilters.category !== 'all' && p.draft.category !== postFilters.category) return false;
        if (q && (p.draft.title + ' ' + p.draft.excerpt + ' ' + p.draft.slug).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (postFilters.sort === 'az') return a.draft.title.localeCompare(b.draft.title);
        if (postFilters.sort === 'za') return b.draft.title.localeCompare(a.draft.title);
        if (postFilters.sort === 'oldest') return a.updatedAt.localeCompare(b.updatedAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      $('#pcount').textContent = plural(list.length, 'post', 'posts') + (list.length !== db.posts.length ? ' of ' + db.posts.length : '');
      $('#prows').innerHTML = list.length ? list.map(function (p) {
        var s = postState(p);
        var when = s === 'scheduled' ? 'Goes live ' + dateTimeLabel(p.publishAt) : 'Updated ' + ago(p.updatedAt);
        var title = p.draft.title || 'Untitled post';
        var pubBtn = (s === 'published' || s === 'changed')
          ? '<button type="button" class="icon-btn" data-act="unpublish" data-id="' + esc(p.id) + '" aria-label="Unpublish ' + esc(title) + '" title="Unpublish">' + icon('eyeoff') + '</button>'
          : '<button type="button" class="icon-btn" data-act="publish" data-id="' + esc(p.id) + '" aria-label="Publish ' + esc(title) + '" title="Publish now">' + icon('send') + '</button>';
        var r = reviewOf(p);
        var staged = r ? ' <a class="staged-link" href="#/staging" title="Waiting in staging: the live post is unchanged">' + reviewChip(r) + '</a>' : '';
        return '<tr>' +
          '<td class="title-cell"><a href="#/posts/' + esc(p.id) + '">' + esc(title) + '</a><div class="sub mono">/blog/' + esc(p.draft.slug || '') + '</div><div class="col-narrow mt-4">' + chip(s) + staged + '</div></td>' +
          '<td class="col-wide">' + chip(s) + staged + '</td>' +
          '<td class="col-opt">' + esc(p.draft.category || '') + '</td>' +
          '<td class="col-opt"><span class="sub">' + esc(when) + '</span></td>' +
          '<td class="actions">' +
            '<a class="icon-btn" href="#/posts/' + esc(p.id) + '" aria-label="Edit ' + esc(title) + '" title="Edit">' + icon('edit') + '</a>' +
            '<a class="icon-btn opt" href="#/preview/' + esc(p.id) + '" aria-label="Preview ' + esc(title) + '" title="Preview">' + icon('eye') + '</a>' +
            '<button type="button" class="icon-btn opt" data-act="duplicate" data-id="' + esc(p.id) + '" aria-label="Duplicate ' + esc(title) + '" title="Duplicate">' + icon('copy') + '</button>' +
            pubBtn +
            '<button type="button" class="icon-btn danger" data-act="delete-post" data-id="' + esc(p.id) + '" aria-label="Delete ' + esc(title) + '" title="Delete">' + icon('trash') + '</button>' +
          '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">No posts match these filters. <button type="button" class="btn btn-ghost btn-sm" data-act="clear-post-filters">Clear filters</button></td></tr>';
    }
    rows();
    $('#pq').addEventListener('input', function (e) { postFilters.q = e.target.value; rows(); });
    $('#pstatus').addEventListener('change', function (e) { postFilters.status = e.target.value; rows(); });
    $('#pcat').addEventListener('change', function (e) { postFilters.category = e.target.value; rows(); });
    $('#psort').addEventListener('change', function (e) { postFilters.sort = e.target.value; rows(); });
    $('#prows').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var p = findPost(b.getAttribute('data-id'));
      var act = b.getAttribute('data-act');
      if (act === 'clear-post-filters') { postFilters = { q: '', status: 'all', category: 'all', sort: postFilters.sort }; render(true); return; }
      if (!p) return;
      var title = p.draft.title || 'Untitled post';
      if (act === 'publish') {
        var errs = publishProblems(p);
        if (!canPublishReview(reviewOf(p))) errs.push('It is waiting in review: a teammate approves it first.');
        if (errs.length) { toast('Cannot publish yet: ' + errs.join(' '), 'err'); return; }
        confirmDialog({ title: 'Publish this post?', desc: '<strong>' + esc(title) + '</strong> goes live on the public site.', confirm: 'Publish', onConfirm: function () { publishPost(p); save(); toast('Published: ' + title); rows(); refreshBadges(); } });
      } else if (act === 'unpublish') {
        confirmDialog({ title: 'Unpublish this post?', desc: '<strong>' + esc(title) + '</strong> is taken off the public site and kept as a draft.', confirm: 'Unpublish', onConfirm: function () { p.live = null; p.status = 'draft'; p.review = null; p.updatedAt = nowIso(); audit('blog_post.unpublish', 'blog_post', p.id, { title: title }); save(); toast('Moved to drafts: ' + title); rows(); refreshBadges(); } });
      } else if (act === 'duplicate') {
        var c = clone(p); c.id = uid(); c.status = 'draft'; c.live = null; c.publishAt = null; c.publishedAt = null; c.createdAt = nowIso(); c.updatedAt = nowIso(); c.author = me().name;
        c.draft.title = 'Copy of ' + p.draft.title; var base = slugify(c.draft.title), slug = base, n = 2; while (slugTaken(slug, c.id)) slug = base + '-' + (n++); c.draft.slug = slug;
        db.posts.unshift(c); audit('blog_post.duplicate', 'blog_post', c.id, { source_id: p.id }); save(); toast('Duplicated as a draft.'); rows(); refreshBadges();
      } else if (act === 'delete-post') {
        confirmDialog({ title: 'Delete this post?', desc: '<strong>' + esc(title) + '</strong> is deleted for good. This cannot be undone.', confirm: 'Delete post', danger: true, onConfirm: function () { db.posts = db.posts.filter(function (x) { return x.id !== p.id; }); audit('blog_post.delete', 'blog_post', p.id, { title: title }); save(); toast('Deleted: ' + title); rows(); refreshBadges(); } });
      }
    });
  }
  function stat(n, l) { return '<div class="stat"><div class="n">' + esc(n) + '</div><div class="l">' + esc(l) + '</div></div>'; }
  function opts(list, sel) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function refreshBadges() {
    $all('.sb-link[href="#/staging"] .count').forEach(function (el) { el.remove(); });
    var n = stagedChanges().length, link = $('.sb-link[href="#/staging"]');
    if (n && link) link.insertAdjacentHTML('beforeend', '<span class="count"><span aria-hidden="true">' + esc(n) + '</span><span class="sr-only">' + esc(plural(n, 'staged change', 'staged changes')) + '</span></span>');
  }

  // ------------------------------------------------------------ editor
  function viewPostEditor(rest) {
    if (!rest.length) return viewPosts();
    var isNew = rest[0] === 'new';
    var p = isNew ? null : findPost(rest[0]);
    if (!isNew && !p) return viewNotFound();
    if (isNew) {
      p = { id: uid(), status: 'draft', author: me().name, createdAt: nowIso(), updatedAt: nowIso(), publishedAt: null, publishAt: null, live: null,
        draft: { title: '', slug: '', excerpt: '', metaDescription: '', category: db.categories[0], cover: '', body: { type: 'doc', content: [] } }, _unsaved: true };
    }
    var slugTouched = !!p.draft.slug;
    setTitle(isNew ? 'New post' : 'Edit post');
    shell('posts',
      '<a class="backlink" href="#/posts">' + icon('back') + 'All posts</a>' +
      '<div class="page-head"><div><h1 id="ed-h1">' + (isNew ? 'New post' : 'Edit post') + '</h1><p><span id="ed-chip"></span> <span class="save-state" id="save-state" role="status"><span class="dot"></span><span id="save-text">' + (isNew ? 'Not saved yet' : 'Saved in this browser') + '</span></span></p></div>' +
        '<div class="row" id="ed-actions"></div></div>' +
      '<div class="editor-grid">' +
        '<div>' +
          '<label class="sr-only" for="title">Title</label><textarea class="title-input" id="title" rows="1" placeholder="Post title" maxlength="140">' + esc(p.draft.title) + '</textarea>' +
          '<div class="slug-line"><label for="slug">URL:</label><span class="mono">/blog/</span><input id="slug" value="' + esc(p.draft.slug) + '" spellcheck="false" aria-describedby="slug-err"><span class="hint err" id="slug-err"></span></div>' +
          '<div class="ed">' +
            '<div class="ed-toolbar" role="toolbar" aria-label="Formatting">' + toolbarHtml() + '</div>' +
            '<div id="editor"></div>' +
            '<div class="ed-foot"><span id="wc">0 words</span><span id="rt">1 min read</span></div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<section class="side-card" aria-labelledby="s-pub"><h2 id="s-pub">Publishing</h2><div id="pub-box"></div></section>' +
          '<section class="side-card" aria-labelledby="s-feat"><h2 id="s-feat">Featured image</h2><div id="feat-box"></div></section>' +
          '<section class="side-card" aria-labelledby="s-meta"><h2 id="s-meta">Details</h2>' +
            '<div class="field"><label class="lbl" for="category">Category</label><select class="input" id="category">' + opts(db.categories.map(function (c) { return [c, c]; }), p.draft.category) + '</select></div>' +
            '<div class="field"><label class="lbl" for="excerpt">Excerpt</label><textarea class="input" id="excerpt" maxlength="200" aria-describedby="ex-count">' + esc(p.draft.excerpt) + '</textarea><p class="hint" id="ex-count"></p></div>' +
            '<div class="field"><label class="lbl" for="meta">Search description</label><textarea class="input" id="meta" maxlength="160" aria-describedby="meta-count">' + esc(p.draft.metaDescription) + '</textarea><p class="hint" id="meta-count"></p></div>' +
          '</section>' +
        '</div>' +
      '</div>'
    );

    // The rich-text editor: the same TipTap the kit's PostEditor uses.
    var editor = null;
    if (window.TipTap) {
      editor = new window.TipTap.Editor({
        element: $('#editor'),
        injectCSS: false,
        extensions: [
          window.TipTap.StarterKit.configure({ heading: { levels: [2, 3] }, underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
          window.TipTap.Image.configure({ inline: false }),
          window.TipTap.Placeholder.configure({ placeholder: 'Start writing your post...' })
        ],
        content: p.draft.body && p.draft.body.content && p.draft.body.content.length ? p.draft.body : '',
        editorProps: { attributes: { class: 'prose', 'aria-label': 'Post body', 'aria-multiline': 'true', role: 'textbox' } },
        onUpdate: function () { p.draft.body = editor.getJSON(); counts(); changed(); },
        onSelectionUpdate: syncToolbar,
        onTransaction: syncToolbar
      });
    } else {
      $('#editor').innerHTML = '<p class="empty">The editor script did not load. Reload the page.</p>';
    }
    function counts() {
      var n = editor ? wordCount(editor.getText()) : wordCount(docText(p.draft.body));
      $('#wc').textContent = n.toLocaleString('en-US') + (n === 1 ? ' word' : ' words');
      $('#rt').textContent = Math.max(1, Math.ceil(n / 238)) + ' min read';
      $('#ex-count').textContent = $('#excerpt').value.length + ' / 200';
      $('#meta-count').textContent = $('#meta').value.length + ' / 160';
    }
    function syncToolbar() {
      if (!editor) return;
      $all('.tb[data-cmd]').forEach(function (b) {
        var c = b.getAttribute('data-cmd'), on = false;
        if (c === 'bold' || c === 'italic' || c === 'underline' || c === 'strike' || c === 'bulletList' || c === 'orderedList' || c === 'blockquote' || c === 'link') on = editor.isActive(c);
        else if (c === 'h2') on = editor.isActive('heading', { level: 2 });
        else if (c === 'h3') on = editor.isActive('heading', { level: 3 });
        if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (c === 'undo') b.disabled = !editor.can().undo();
        if (c === 'redo') b.disabled = !editor.can().redo();
      });
    }
    // Keep focus (and the selection) in the editor when a toolbar button is
    // pressed with the mouse; keyboard users still tab to the buttons.
    $('.ed-toolbar').addEventListener('mousedown', function (e) { if (e.target.closest('.tb')) e.preventDefault(); });
    $('.ed-toolbar').addEventListener('click', function (e) {
      var b = e.target.closest('.tb'); if (!b || !editor) return;
      var c = b.getAttribute('data-cmd'), ch = editor.chain().focus();
      if (c === 'bold') ch.toggleBold().run();
      else if (c === 'italic') ch.toggleItalic().run();
      else if (c === 'underline') ch.toggleUnderline().run();
      else if (c === 'strike') ch.toggleStrike().run();
      else if (c === 'h2') ch.toggleHeading({ level: 2 }).run();
      else if (c === 'h3') ch.toggleHeading({ level: 3 }).run();
      else if (c === 'bulletList') ch.toggleBulletList().run();
      else if (c === 'orderedList') ch.toggleOrderedList().run();
      else if (c === 'blockquote') ch.toggleBlockquote().run();
      else if (c === 'hr') ch.setHorizontalRule().run();
      else if (c === 'undo') ch.undo().run();
      else if (c === 'redo') ch.redo().run();
      else if (c === 'link') linkDialog(editor);
      else if (c === 'image') pickMedia(function (m) { editor.chain().focus().setImage({ src: m.src, alt: m.alt || '' }).run(); });
    });

    // Autosave: every change is written to this browser after a short pause,
    // the way the kit's PostForm autosaves to localStorage for restore.
    var timer = null;
    function changed() {
      $('#save-state').classList.add('saving'); $('#save-text').textContent = 'Saving...';
      clearTimeout(timer); timer = setTimeout(persist, 700);
    }
    function persist() {
      timer = null;
      if (p._unsaved) {
        if (!p.draft.title.trim() && !wordCount(docText(p.draft.body))) { $('#save-state').classList.remove('saving'); $('#save-text').textContent = 'Not saved yet'; return; }
        delete p._unsaved; db.posts.unshift(p); audit('blog_post.create', 'blog_post', p.id, { title: p.draft.title });
        history.replaceState(null, '', '#/posts/' + p.id); current.path = '/posts/' + p.id;
      }
      p.updatedAt = nowIso();
      // Edits to a live post are its staged copy; any edit resets a review.
      var st = postState(p);
      if (st === 'changed' || (st === 'draft' && p.review)) restage(p);
      else if (st === 'published') p.review = null;
      if (save()) { $('#save-state').classList.remove('saving'); $('#save-text').textContent = 'Saved in this browser ' + ago(p.updatedAt); }
      renderPub(); refreshBadges();
    }
    var tick = setInterval(function () { if (!timer && !p._unsaved) $('#save-text').textContent = 'Saved in this browser ' + ago(p.updatedAt); }, 15000);
    current.cleanup = function () { clearInterval(tick); if (timer) { clearTimeout(timer); persist(); } if (editor) editor.destroy(); };

    // The title wraps like the heading it becomes; Enter moves on to the body.
    function fitTitle() { var t = $('#title'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
    fitTitle();
    window.addEventListener('resize', fitTitle);
    var stopFit = current.cleanup;
    current.cleanup = function () { window.removeEventListener('resize', fitTitle); stopFit(); };
    $('#title').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (editor) editor.commands.focus('start'); }
    });
    $('#title').addEventListener('input', function (e) {
      fitTitle();
      e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
      p.draft.title = e.target.value;
      if (!slugTouched) { p.draft.slug = slugify(p.draft.title); $('#slug').value = p.draft.slug; checkSlug(); }
      changed();
    });
    $('#slug').addEventListener('input', function (e) { slugTouched = true; p.draft.slug = e.target.value.trim(); checkSlug(); changed(); });
    $('#slug').addEventListener('blur', function (e) { if (!p.draft.slug) { slugTouched = false; p.draft.slug = slugify(p.draft.title); e.target.value = p.draft.slug; checkSlug(); changed(); } });
    function checkSlug() {
      var s = p.draft.slug, msg = '';
      if (s && !SLUG_RE.test(s)) msg = 'Use lowercase letters, numbers and single dashes.';
      else if (s && slugTaken(s, p.id)) msg = 'Another post already uses this URL.';
      $('#slug-err').textContent = msg;
      $('#slug').setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    $('#category').addEventListener('change', function (e) { p.draft.category = e.target.value; changed(); });
    $('#excerpt').addEventListener('input', function (e) { p.draft.excerpt = e.target.value; counts(); changed(); });
    $('#meta').addEventListener('input', function (e) { p.draft.metaDescription = e.target.value; counts(); changed(); });

    function renderFeat() {
      var src = p.draft.cover;
      $('#feat-box').innerHTML = (src ? '<div class="feat"><img src="' + esc(src) + '" alt="Featured image preview"></div>' : '<p class="hint">No featured image.</p>') +
        '<div class="row"><button type="button" class="btn btn-outline btn-sm" data-act="pick-cover">' + icon('image') + (src ? 'Change' : 'Choose image') + '</button>' +
        (src ? '<button type="button" class="btn btn-ghost btn-sm" data-act="remove-cover">Remove</button>' : '') + '</div>';
    }
    $('#feat-box').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.getAttribute('data-act') === 'pick-cover') pickMedia(function (m) { p.draft.cover = m.src; renderFeat(); changed(); });
      else { p.draft.cover = ''; renderFeat(); changed(); }
    });

    function renderPub() {
      var s = p._unsaved ? 'draft' : postState(p);
      $('#ed-chip').innerHTML = chip(s);
      var box = '<div>';
      if (s === 'scheduled') box += '<p class="hint">Goes live ' + esc(dateTimeLabel(p.publishAt)) + '.</p>';
      var r = p._unsaved ? null : reviewOf(p);
      if (s === 'published') box += '<p class="hint">Live since ' + esc(dateLabel(p.publishedAt)) + '. Edit away: your edits are staged and the live post stays as it is until you publish them.</p>';
      if (s === 'changed') box += '<p class="hint">The live site shows the last published version. Your edits are saved as a staged change.</p>';
      if (s === 'draft') box += '<p class="hint">Only signed-in admins can see drafts.' + (r ? ' This draft is staged for publishing.' : '') + '</p>';
      if (r) box += '<p class="review-line">' + reviewChip(r) + ' <span class="hint">' + esc(reviewLine(r)) + '</span></p>';
      if (r && r.status === 'in_review') box += '<p class="hint">' + (canApprove(r) ? 'A teammate asked you to review this change.' : 'Waiting for a teammate to approve it. You cannot approve a change you staged.') + '</p>';
      box += '</div><div class="stack">';
      var primary = s === 'published' ? 'Published' : 'Publish now';
      var blocked = s === 'published' || !canPublishReview(r);
      box += '<button type="button" class="btn btn-primary" data-act="ed-publish"' + (blocked ? ' disabled' : '') + '>' + icon('send') + esc(primary) + '</button>';
      if (r) {
        box += '<div class="row">';
        if (r.status === 'staged') box += '<button type="button" class="btn btn-outline btn-sm" data-act="ed-request">Request review</button>';
        if (r.status === 'in_review') box += '<button type="button" class="btn btn-outline btn-sm" data-act="ed-approve"' + (canApprove(r) ? '' : ' disabled') + '>' + icon('check') + 'Approve</button>';
        if (r.status === 'in_review' && !canApprove(r) && teammate()) box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-approve-demo" title="Demo only: in the kit, your teammate signs in and approves">Demo: approve as ' + esc(teammate().name) + '</button>';
        if (r.status !== 'staged') box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-withdraw">' + (r.status === 'approved' ? 'Take back approval' : 'Withdraw request') + '</button>';
        box += '</div>';
      }
      box += '<div class="row">';
      box += '<a class="btn btn-outline btn-sm" href="#/preview/' + esc(p.id) + '"' + (p._unsaved ? ' aria-disabled="true" data-act="need-save"' : '') + '>' + icon('eye') + 'Preview</a>';
      if (s === 'draft' && !r && !p._unsaved) box += '<button type="button" class="btn btn-outline btn-sm" data-act="ed-stage">Stage for publishing</button>';
      if (s === 'draft' || s === 'scheduled') box += '<button type="button" class="btn btn-outline btn-sm" data-act="ed-schedule">' + icon('calendar') + (s === 'scheduled' ? 'Reschedule' : 'Schedule') + '</button>';
      if (r) box += '<a class="btn btn-ghost btn-sm" href="#/staging">Open staging</a>';
      if (s === 'changed') box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-discard">Discard changes</button>';
      if (s === 'draft' && r) box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-unstage">Remove from staging</button>';
      if (s === 'published' || s === 'changed') box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-unpublish">Unpublish</button>';
      if (s === 'scheduled') box += '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-unschedule">Back to draft</button>';
      box += '</div></div>';
      $('#pub-box').innerHTML = box;
      $('#ed-actions').innerHTML = p._unsaved ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-act="ed-delete">' + icon('trash') + 'Delete</button>';
    }
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'need-save') { e.preventDefault(); toast('Add a title or some text first, so there is something to preview.', 'err'); return; }
      if (act === 'ed-publish') {
        if (timer) { clearTimeout(timer); persist(); }
        if (p._unsaved) { toast('Add a title and some text first.', 'err'); return; }
        var errs = publishProblems(p);
        if (!canPublishReview(reviewOf(p))) errs.push('It is waiting in review: a teammate approves it first.');
        if (errs.length) { toast('Cannot publish yet: ' + errs.join(' '), 'err'); return; }
        var st = postState(p);
        confirmDialog({ title: st === 'changed' ? 'Publish these changes?' : 'Publish this post?', desc: 'The public site will show <strong>' + esc(p.draft.title) + '</strong> as it looks in the preview.', confirm: st === 'changed' ? 'Publish changes' : 'Publish', onConfirm: function () { publishPost(p); save(); toast('Published: ' + p.draft.title); renderPub(); refreshBadges(); } });
      } else if (act === 'ed-stage') {
        if (timer) { clearTimeout(timer); persist(); }
        var se = publishProblems(p);
        if (se.length) { toast('Cannot stage yet: ' + se.join(' '), 'err'); return; }
        restage(p); p.updatedAt = nowIso(); save(); toast('Staged for publishing. It waits in staging until someone publishes it.'); renderPub(); refreshBadges();
      } else if (act === 'ed-request') {
        if (timer) { clearTimeout(timer); persist(); }
        setReview(p, 'in_review'); save(); toast('Review requested. A teammate approves it before it can be published.'); renderPub(); refreshBadges();
      } else if (act === 'ed-approve') {
        if (!canApprove(reviewOf(p))) { toast('You cannot approve a change you staged. Ask a teammate to approve it.', 'err'); return; }
        setReview(p, 'approved'); save(); toast('Approved. Anyone can publish it now.'); renderPub(); refreshBadges();
      } else if (act === 'ed-approve-demo') {
        var tm = teammate(); if (!tm) return;
        setReview(p, 'approved', tm.name); save(); toast('Approved by ' + tm.name + ' (demo). Anyone can publish it now.'); renderPub(); refreshBadges();
      } else if (act === 'ed-withdraw') {
        setReview(p, 'staged'); save(); toast('Moved back to staged.'); renderPub(); refreshBadges();
      } else if (act === 'ed-unstage') {
        confirmDialog({ title: 'Remove this draft from staging?', desc: 'It stays a draft. Nothing changes on the public site.', confirm: 'Remove from staging', onConfirm: function () { discardStage(p); save(); toast('Removed from staging.'); renderPub(); refreshBadges(); } });
      } else if (act === 'ed-schedule') {
        if (timer) { clearTimeout(timer); persist(); }
        if (p._unsaved) { toast('Add a title and some text first.', 'err'); return; }
        scheduleDialog(p, function () { renderPub(); refreshBadges(); });
      } else if (act === 'ed-discard') {
        confirmDialog({ title: 'Discard your changes?', desc: 'The staged copy is deleted. The post goes back to the version that is live now.', confirm: 'Discard changes', danger: true, onConfirm: function () { discardStage(p); save(); toast('Changes discarded.'); render(true); } });
      } else if (act === 'ed-unpublish') {
        confirmDialog({ title: 'Unpublish this post?', desc: 'It comes off the public site and stays here as a draft.', confirm: 'Unpublish', onConfirm: function () { p.live = null; p.status = 'draft'; p.review = null; p.updatedAt = nowIso(); audit('blog_post.unpublish', 'blog_post', p.id, { title: p.draft.title }); save(); toast('Moved to drafts.'); renderPub(); refreshBadges(); } });
      } else if (act === 'ed-unschedule') {
        p.status = 'draft'; p.publishAt = null; p.updatedAt = nowIso(); audit('blog_post.unschedule', 'blog_post', p.id, { title: p.draft.title }); save(); toast('Back to draft.'); renderPub(); refreshBadges();
      } else if (act === 'ed-delete') {
        confirmDialog({ title: 'Delete this post?', desc: '<strong>' + esc(p.draft.title || 'Untitled post') + '</strong> is deleted for good.', confirm: 'Delete post', danger: true, onConfirm: function () { if (timer) clearTimeout(timer); timer = null; db.posts = db.posts.filter(function (x) { return x.id !== p.id; }); audit('blog_post.delete', 'blog_post', p.id, { title: p.draft.title }); save(); toast('Post deleted.'); go('#/posts'); } });
      }
    });
    renderFeat(); renderPub(); counts(); checkSlug(); syncToolbar();
    if (isNew) $('#title').focus();
  }
  function toolbarHtml() {
    var b = function (cmd, label, text, pressed) { return '<button type="button" class="tb" data-cmd="' + cmd + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (pressed ? ' aria-pressed="false"' : '') + '>' + text + '</button>'; };
    return b('bold', 'Bold', '<strong>B</strong>', 1) + b('italic', 'Italic', '<em>I</em>', 1) +
      '<span class="sep" aria-hidden="true"></span>' + b('h2', 'Heading 2', 'H2', 1) + b('h3', 'Heading 3', 'H3', 1) +
      '<span class="sep" aria-hidden="true"></span>' + b('bulletList', 'Bulleted list', '&bull; List', 1) + b('orderedList', 'Numbered list', '1. List', 1) + b('blockquote', 'Quote', '&ldquo; Quote', 1) +
      '<span class="sep" aria-hidden="true"></span>' + b('link', 'Link', 'Link', 1) + b('image', 'Insert image', 'Image') +
      '<span class="sep" aria-hidden="true"></span>' + b('undo', 'Undo', '&#8630;') + b('redo', 'Redo', '&#8631;');
  }
  function linkDialog(editor) {
    var prev = editor.getAttributes('link').href || '';
    openModal({
      title: prev ? 'Edit link' : 'Add a link',
      body: '<div class="field"><label class="lbl" for="link-url">Web address</label><input class="input" id="link-url" value="' + esc(prev) + '" placeholder="https://example.com or /blog/a-post" autofocus><p class="hint err" id="link-err" role="alert"></p><p class="hint">Allowed: https, http, mailto, tel and site paths. Anything else is refused, as in the kit.</p></div>',
      actions: (prev ? '<button type="button" class="btn btn-ghost" data-act="unlink">Remove link</button>' : '') + '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save link</button>',
      onOpen: function (m, close) { var u = $('[data-act="unlink"]', m); if (u) u.addEventListener('click', function () { close(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); }); },
      onSubmit: function (f, close) {
        var v = $('#link-url', f).value.trim();
        if (!v) { close(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v)) { $('#link-err', f).textContent = 'Use a full https:// address, a mailto: or tel: link, or a path starting with /.'; return; }
        close(); editor.chain().focus().extendMarkRange('link').setLink({ href: v }).run();
      }
    });
  }
  function scheduleDialog(p, after) {
    var d = new Date(Date.now() + 24 * 3600 * 1000); d.setMinutes(0, 0, 0);
    if (p.publishAt) d = new Date(p.publishAt);
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    openModal({
      title: 'Schedule this post',
      desc: 'It goes live on its own at the time you pick (your local time). Until then only signed-in admins see it.',
      body: '<div class="field"><label class="lbl" for="when">Publish at</label><input class="input" id="when" type="datetime-local" value="' + esc(local) + '"><p class="hint err" id="when-err" role="alert"></p></div>',
      actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">Schedule</button>',
      onSubmit: function (f, close) {
        var errs = publishProblems(p);
        if (errs.length) { $('#when-err', f).textContent = errs.join(' '); return; }
        var v = $('#when', f).value; var at = v ? new Date(v) : null;
        if (!at || isNaN(at.getTime()) || at <= new Date()) { $('#when-err', f).textContent = 'Pick a time in the future.'; return; }
        p.status = 'scheduled'; p.publishAt = at.toISOString(); p.updatedAt = nowIso();
        audit('blog_post.schedule', 'blog_post', p.id, { publish_at: p.publishAt }); save();
        close(); toast('Scheduled for ' + dateTimeLabel(p.publishAt) + '.'); after();
      }
    });
  }

  // ------------------------------------------------------------ preview
  function viewPreview(rest) {
    var p = findPost(rest[0]);
    if (!p) return viewNotFound();
    setTitle('Preview');
    var s = postState(p);
    shell('posts',
      '<a class="backlink" href="#/posts/' + esc(p.id) + '">' + icon('back') + 'Back to the editor</a>' +
      head('Preview', 'How this post will look on the site. ' + chip(s), '<a class="btn btn-outline" href="#/staging">' + icon('globe') + 'Preview the whole site</a>') +
      '<div class="site-frame"><div class="preview-banner">Preview: ' + esc(STATE_LABEL[s]) + '. Visitors ' + (s === 'published' ? 'see this version now.' : 'do not see this version yet.') + '</div>' +
      '<div class="site"><div class="site-body">' + articleHtml(p.draft, p) + '</div></div></div>'
    );
  }
  function articleHtml(c, p) {
    return '<article><p class="article-meta">' + esc(c.category || '') + (p.author ? ', by ' + esc(p.author) : '') + '</p>' +
      '<h2 class="site-hero-title">' + esc(c.title || 'Untitled post') + '</h2>' +
      (c.excerpt ? '<p class="muted">' + esc(c.excerpt) + '</p>' : '') +
      (c.cover ? '<img class="article-cover" src="' + esc(c.cover) + '" alt="">' : '') +
      '<div class="prose">' + bodyHtml(c.body) + '</div></article>';
  }

  // --------------------------------------------- site preview + staging
  // Everything that differs between the live site and the staged site.
  function stagedChanges() {
    var out = [];
    db.posts.forEach(function (p) {
      var r = reviewOf(p);
      if (!r) return;
      out.push({ p: p, r: r, kind: p.live ? 'Edited' : 'New', note: p.live ? 'Changes to a live post' : 'A draft, staged to go live' });
    });
    return out;
  }
  var siteState = { mode: 'staging', page: 'home', postId: null, compare: null };
  function viewSite() {
    setTitle('Staging');
    var changes = stagedChanges();
    if (!changes.some(function (c) { return c.p.id === siteState.compare; })) siteState.compare = changes.length ? changes[0].p.id : null;
    shell('staging',
      head('Staging', 'Edits wait here, in a private copy, until someone publishes them. The public site keeps showing the live posts. Pick the changes to publish together, or ask a teammate to review one first.') +
      '<section class="card" aria-labelledby="ch-h"><div class="row"><h2 id="ch-h" class="grow">Staged changes</h2>' +
        (changes.length ? '<span class="sub muted" id="pick-count" aria-live="polite"></span><button type="button" class="btn btn-primary btn-sm" data-act="publish-selected">' + icon('send') + 'Publish selected</button>' : '') + '</div>' +
        (changes.length ? '<ul class="changes">' + changes.map(function (c) {
          var r = c.r, id = esc(c.p.id), pub = canPublishReview(r);
          var acts = '<button type="button" class="btn btn-ghost btn-sm" data-act="st-compare" data-id="' + id + '"' + (siteState.compare === c.p.id ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>Compare</button>' +
            '<a class="btn btn-ghost btn-sm" href="#/posts/' + id + '">Edit</a>' +
            (r.status === 'staged' ? '<button type="button" class="btn btn-outline btn-sm" data-act="st-request" data-id="' + id + '">Request review</button>' : '') +
            (r.status === 'in_review' ? '<button type="button" class="btn btn-outline btn-sm" data-act="st-approve" data-id="' + id + '"' + (canApprove(r) ? '' : ' disabled title="You staged this change. A teammate approves it."') + '>' + icon('check') + 'Approve</button>' : '') +
            (r.status === 'in_review' && !canApprove(r) && teammate() ? '<button type="button" class="btn btn-ghost btn-sm" data-act="st-approve-demo" data-id="' + id + '" title="Demo only: in the kit, your teammate signs in and approves">Demo: approve as ' + esc(teammate().name) + '</button>' : '') +
            (r.status !== 'staged' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="st-withdraw" data-id="' + id + '">' + (r.status === 'approved' ? 'Take back approval' : 'Withdraw request') + '</button>' : '') +
            '<button type="button" class="btn btn-ghost btn-sm danger-text" data-act="st-discard" data-id="' + id + '">Discard</button>';
          return '<li class="change"><div class="change-main"><input type="checkbox" class="stage-pick" id="sp-' + id + '" value="' + id + '"' + (pub ? '' : ' disabled') + '><label for="sp-' + id + '" class="grow"><strong>' + esc(c.p.draft.title) + '</strong> ' + chip(c.kind === 'Edited' ? 'changed' : 'draft', c.kind) + ' ' + reviewChip(r) +
            '<span class="sub muted change-note">' + esc(c.note) + '. ' + esc(reviewLine(r)) + (pub ? '' : ' Needs an approval before it can be published.') + '</span></label></div>' +
            '<div class="row change-acts">' + acts + '</div></li>';
        }).join('') + '</ul>' : '<p class="muted">Nothing staged. The live site and staging are the same. Edit a live post, or choose "Stage for publishing" on a draft, and it waits here.</p>') +
      '</section>' +
      (siteState.compare ? compareHtml(findPost(siteState.compare)) : '') +
      '<div class="stage-bar"><span class="grow"><strong>Viewing:</strong> <span id="mode-label"></span></span>' +
        '<div class="seg" role="group" aria-label="Which version of the site"><button type="button" data-mode="live" aria-pressed="false">Live site</button><button type="button" data-mode="staging" aria-pressed="false">Staging</button></div></div>' +
      '<div class="site-frame"><div class="site-chrome"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="url" id="site-url"></span></div><div class="site" id="site"></div></div>'
    );
    function visible() {
      // Staging: the live posts with their staged copies laid over them, plus
      // staged drafts; the same set getPreviewPosts() returns in the kit.
      return db.posts.filter(function (p) {
        if (siteState.mode === 'live') return !!p.live;
        return !!p.live || !!reviewOf(p);
      }).map(function (p) { return { p: p, c: siteState.mode === 'live' ? p.live : p.draft, s: postState(p) }; })
        .sort(function (a, b) { return (b.p.publishedAt || b.p.publishAt || b.p.updatedAt).localeCompare(a.p.publishedAt || a.p.publishAt || a.p.updatedAt); });
    }
    function flag(item) {
      if (siteState.mode === 'live') return '';
      if (item.s === 'changed') return '<span class="stage-flag">' + chip('changed', 'Edited') + '</span>';
      if (item.s === 'draft') return '<span class="stage-flag">' + chip('draft', 'New') + '</span>';
      return '';
    }
    function card(item) {
      return '<button type="button" class="site-post-card" data-post="' + esc(item.p.id) + '"><span class="sub muted">' + esc(item.c.category) + '</span>' + flag(item) + '<h3>' + esc(item.c.title) + '</h3><p>' + esc(item.c.excerpt || '') + '</p></button>';
    }
    function draw() {
      $all('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode') === siteState.mode ? 'true' : 'false'); });
      $('#mode-label').textContent = siteState.mode === 'live' ? 'the live site, as visitors see it now' : 'staging, with ' + plural(changes.length, 'staged change', 'staged changes');
      var items = visible(), body = '', url = '/';
      if (siteState.page === 'post') {
        var it = items.filter(function (i) { return i.p.id === siteState.postId; })[0];
        if (!it) { siteState.page = 'blog'; return draw(); }
        url = '/blog/' + it.c.slug;
        body = flag(it) + articleHtml(it.c, it.p);
      } else if (siteState.page === 'blog') {
        url = '/blog';
        body = '<div class="site-hero"><h2>Blog</h2><p class="muted">' + plural(items.length, 'post', 'posts') + '</p></div>' + (items.length ? items.map(card).join('') : '<p class="muted">No posts yet.</p>');
      } else {
        body = '<div class="site-hero"><h2>We help small teams publish with confidence.</h2><p class="muted">Acme is a placeholder brand for this demo.</p></div><h3>Latest from the blog</h3>' + (items.slice(0, 3).map(card).join('') || '<p class="muted">No posts yet.</p>');
      }
      $('#site-url').textContent = (siteState.mode === 'live' ? 'https://www.example.com' : 'https://staging.example.com') + url;
      $('#site').innerHTML = '<div class="site-nav"><span class="brand">' + MARK + 'Acme</span><nav aria-label="Preview site"><button type="button" data-page="home"' + (siteState.page === 'home' ? ' aria-current="page"' : '') + '>Home</button><button type="button" data-page="blog"' + (siteState.page !== 'home' ? ' aria-current="page"' : '') + '>Blog</button></nav></div><div class="site-body">' + body + '</div>';
    }
    $('.seg').addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (!b) return; siteState.mode = b.getAttribute('data-mode'); draw(); });
    $('#site').addEventListener('click', function (e) {
      var pg = e.target.closest('[data-page]'); if (pg) { siteState.page = pg.getAttribute('data-page'); draw(); return; }
      var po = e.target.closest('[data-post]'); if (po) { siteState.page = 'post'; siteState.postId = po.getAttribute('data-post'); draw(); $('#site').scrollIntoView({ block: 'start' }); }
    });
    function pickCount() {
      var el = $('#pick-count'); if (!el) return;
      el.textContent = plural($all('.stage-pick:checked').length, 'change', 'changes') + ' picked';
    }
    $all('.stage-pick').forEach(function (c) { c.addEventListener('change', pickCount); });
    pickCount();
    var pubBtn = $('[data-act="publish-selected"]');
    if (pubBtn) pubBtn.addEventListener('click', function () {
      var ids = $all('.stage-pick:checked').map(function (c) { return c.value; });
      // The same checks as checkPublishSelection() and publish_staged_posts():
      // a pick that is empty, waiting in review or has a broken slug publishes nothing.
      if (!ids.length) { toast('Pick at least one staged change to publish.', 'err'); return; }
      var waiting = ids.map(findPost).filter(function (p) { return !canPublishReview(reviewOf(p)); })[0];
      if (waiting) { toast('"' + waiting.draft.title + '" needs an approval before it can be published. Nothing was published.', 'err'); return; }
      var bad = ids.map(findPost).filter(function (p) { return publishProblems(p).length; });
      if (bad.length) { toast('Fix before publishing: ' + bad.map(function (p) { return p.draft.title; }).join(', ') + '. Nothing was published.', 'err'); return; }
      confirmDialog({ title: 'Publish ' + plural(ids.length, 'change', 'changes') + '?', desc: 'They replace the live versions on the public site. All of them go live together, or none do.', confirm: 'Publish', onConfirm: function () {
        ids.forEach(function (id) { publishPost(findPost(id), null, ids.length); });
        save(); toast('Published ' + plural(ids.length, 'change', 'changes') + '.'); siteState.mode = 'live'; render(true);
      } });
    });
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act^="st-"]'); if (!b) return;
      var p = findPost(b.getAttribute('data-id')); if (!p) return;
      var act = b.getAttribute('data-act');
      if (act === 'st-compare') { siteState.compare = p.id; render(true); var cmp = $('#compare'); if (cmp) cmp.scrollIntoView({ block: 'start' }); return; }
      if (act === 'st-request') { setReview(p, 'in_review'); save(); toast('Review requested. A teammate approves it before it can be published.'); render(true); }
      else if (act === 'st-approve') { if (!canApprove(reviewOf(p))) { toast('You cannot approve a change you staged. Ask a teammate to approve it.', 'err'); return; } setReview(p, 'approved'); save(); toast('Approved. Anyone can publish it now.'); render(true); }
      else if (act === 'st-approve-demo') { var tm = teammate(); if (!tm) return; setReview(p, 'approved', tm.name); save(); toast('Approved by ' + tm.name + ' (demo). Anyone can publish it now.'); render(true); }
      else if (act === 'st-withdraw') { setReview(p, 'staged'); save(); toast('Moved back to staged.'); render(true); }
      else if (act === 'st-discard') {
        confirmDialog({ title: 'Discard this staged change?', desc: 'The staged copy of <strong>' + esc(p.draft.title) + '</strong> is deleted. ' + (p.live ? 'The live post stays exactly as it is.' : 'The draft stays a draft.'), confirm: 'Discard', danger: true, onConfirm: function () { discardStage(p); save(); toast('Staged change discarded.'); render(true); } });
      }
    });
    draw();
  }
  // Live and staged side by side for one staged change.
  function compareHtml(p) {
    if (!p) return '';
    return '<section class="card compare" id="compare" aria-labelledby="cmp-h"><h2 id="cmp-h">Live and staged, side by side</h2>' +
      '<div class="compare-grid">' +
        '<div class="compare-col"><p class="compare-label">Live now</p>' + (p.live ? articleHtml(p.live, p) : '<p class="muted">Not on the site yet. Publishing makes this a new post.</p>') + '</div>' +
        '<div class="compare-col staged"><p class="compare-label">Staged</p>' + articleHtml(p.draft, p) + '</div>' +
      '</div></section>';
  }

  // -------------------------------------------------------------- media
  function viewMedia() {
    setTitle('Media');
    shell('media',
      head('Media', 'Images for posts. JPEG, PNG, WebP or GIF, up to 5 MB each.', '<label class="btn btn-primary" for="file-in">' + icon('upload') + 'Upload images</label>') +
      proposedNote('In the kit today images are uploaded from the post form, one at a time, and there is no library page.') +
      '<input type="file" id="file-in" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="sr-only">' +
      '<div class="drop" id="drop">Drop images here, or use <strong>Upload images</strong>. Files stay in this browser.</div>' +
      '<p class="count-line" id="mcount" aria-live="polite"></p>' +
      '<div class="media-grid" id="mgrid"></div>'
    );
    function draw() {
      $('#mcount').textContent = plural(db.media.length, 'image', 'images');
      $('#mgrid').innerHTML = db.media.length ? db.media.map(function (m) {
        var used = db.posts.filter(function (p) { return p.draft.cover === m.src || JSON.stringify(p.draft.body).indexOf(m.src.slice(0, 120)) !== -1; }).length;
        return '<figure class="media-item">' +
          '<img src="' + esc(m.src) + '" alt="' + esc(m.alt) + '" loading="lazy">' +
          '<figcaption class="media-meta"><span class="nm" title="' + esc(m.name) + '">' + esc(m.name) + '</span><span class="muted">' + esc(m.w + ' x ' + m.h + ', ' + Math.max(1, Math.round(m.size / 1024)) + ' KB') + '</span><span class="muted">' + (m.alt ? 'Alt: ' + esc(m.alt) : '<span class="hint err">No alt text</span>') + '</span><span class="muted">' + esc(used ? 'Used in ' + plural(used, 'post', 'posts') : 'Not used yet') + '</span></figcaption>' +
          '<div class="media-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="alt" data-id="' + esc(m.id) + '" aria-label="Edit alt text for ' + esc(m.name) + '">' + icon('edit') + 'Alt text</button><span class="grow"></span><button type="button" class="icon-btn danger" data-act="del-media" data-id="' + esc(m.id) + '" aria-label="Delete ' + esc(m.name) + '">' + icon('trash') + '</button></div>' +
        '</figure>';
      }).join('') : '<p class="empty">No images yet. Upload one to get started.</p>';
    }
    draw();
    $('#file-in').addEventListener('change', function (e) { handleFiles(e.target.files, draw); e.target.value = ''; });
    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files, draw); });
    $('#mgrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var m = db.media.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (!m) return;
      if (b.getAttribute('data-act') === 'alt') {
        openModal({ title: 'Alt text', desc: 'Describe what the image shows for people using screen readers. Leave empty only for decorative images.',
          body: '<div class="field"><label class="lbl" for="alt-in">Alt text for ' + esc(m.name) + '</label><input class="input" id="alt-in" maxlength="200" value="' + esc(m.alt) + '" autofocus></div>',
          actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button>',
          onSubmit: function (f, close) { m.alt = $('#alt-in', f).value.trim(); audit('media.update', 'media', m.id, { name: m.name }); save(); close(); toast('Alt text saved.'); draw(); } });
      } else {
        var used = db.posts.filter(function (p) { return p.draft.cover === m.src; }).length;
        confirmDialog({ title: 'Delete this image?', desc: '<strong>' + esc(m.name) + '</strong>' + (used ? ' is the featured image of ' + plural(used, 'post', 'posts') + '; those posts will have none.' : ' is not used as a featured image.'), confirm: 'Delete image', danger: true, onConfirm: function () {
          db.media = db.media.filter(function (x) { return x.id !== m.id; });
          db.posts.forEach(function (p) { if (p.draft.cover === m.src) p.draft.cover = ''; });
          audit('media.delete', 'media', m.id, { name: m.name }); save(); toast('Image deleted.'); draw();
        } });
      }
    });
  }
  // Same checks as the kit's upload route: a type allowlist and a 5 MB cap,
  // with the stored name generated here rather than taken from the file.
  function handleFiles(fileList, after) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    files.forEach(function (f) {
      if (!ALLOWED_TYPES[f.type]) { toast(f.name + ': only JPEG, PNG, WebP or GIF images.', 'err'); return; }
      if (f.size > MAX_UPLOAD) { toast(f.name + ': larger than 5 MB.', 'err'); return; }
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1600 / img.naturalWidth), w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
        var src;
        if (f.type === 'image/gif' && f.size < 600 * 1024) { src = null; }
        else {
          var c = document.createElement('canvas'); c.width = w; c.height = hgt; c.getContext('2d').drawImage(img, 0, 0, w, hgt);
          src = c.toDataURL('image/webp', 0.82); if (src.indexOf('data:image/webp') !== 0) src = c.toDataURL('image/jpeg', 0.82);
        }
        URL.revokeObjectURL(url);
        var finish = function (dataUrl) {
          var name = Date.now() + '-' + uid().slice(0, 6) + '.' + (dataUrl.indexOf('data:image/webp') === 0 ? 'webp' : dataUrl.indexOf('data:image/jpeg') === 0 ? 'jpg' : ALLOWED_TYPES[f.type]);
          var m = { id: uid(), name: name, type: f.type, size: Math.round(dataUrl.length * 0.75), w: w, h: hgt, alt: '', src: dataUrl, createdAt: nowIso() };
          db.media.unshift(m);
          if (!save()) { db.media.shift(); return; }
          audit('media.upload', 'media', m.id, { name: name, original_name: f.name.slice(0, 80) });
          save(); toast('Uploaded ' + f.name + '. Add alt text next.'); after(m);
        };
        if (src) finish(src);
        else { var r = new FileReader(); r.onload = function () { finish(String(r.result)); }; r.readAsDataURL(f); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast(f.name + ': this file is not a readable image.', 'err'); };
      img.src = url;
    });
  }
  function pickMedia(onPick) {
    openModal({
      title: 'Choose an image', wide: true,
      body: '<p class="desc">Pick from the media library or upload a new image.</p><label class="btn btn-outline btn-sm" for="pick-up">' + icon('upload') + 'Upload</label><input type="file" id="pick-up" class="sr-only" accept="image/jpeg,image/png,image/webp,image/gif"><div class="pick-grid mt-12" id="pick-grid"></div>',
      onOpen: function (m, close) {
        var grid = $('#pick-grid', m);
        function draw() {
          grid.innerHTML = db.media.map(function (x) { return '<button type="button" class="pick" data-id="' + esc(x.id) + '" aria-label="Use ' + esc(x.alt || x.name) + '"><img src="' + esc(x.src) + '" alt=""></button>'; }).join('') || '<p class="muted">No images yet.</p>';
        }
        draw();
        grid.addEventListener('click', function (e) { var b = e.target.closest('.pick'); if (!b) return; var x = db.media.filter(function (y) { return y.id === b.getAttribute('data-id'); })[0]; close(); onPick(x); });
        $('#pick-up', m).addEventListener('change', function (e) { handleFiles(e.target.files, function (x) { close(); onPick(x); }); });
      }
    });
  }

  // --------------------------------------------------------------- team
  function viewTeam() {
    if (!isSuper()) return superOnly('Team');
    setTitle('Team');
    shell('team',
      head('Team', 'Invite people, set their role, and turn access off.', '<button type="button" class="btn btn-primary" data-act="invite">' + icon('plus') + 'Invite someone</button>') +
      proposedNote('The Invited status, Resend and Cancel invite are proposed. In the kit today an invited person appears on the team right away, marked "Pending first sign-in"; their sign-up link is sent once, with no resend or cancel button.', 'Partly proposed.') +
      '<div class="table-wrap"><table class="tbl"><caption class="sr-only">Team members</caption><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col" class="col-opt">Two-factor</th><th scope="col" class="col-wide">Status</th><th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody id="trows"></tbody></table></div>' +
      '<p class="hint">The last active super admin cannot be demoted or turned off, so the account can never lock itself out.</p>'
    );
    // Max ~50 team members. Plain render.
    function lastSuper(u) { return u.role === 'super_admin' && u.status === 'active' && db.team.filter(function (x) { return x.role === 'super_admin' && x.status === 'active'; }).length === 1; }
    function draw() {
      var order = { super_admin: 0, admin: 1 };
      var list = db.team.slice().sort(function (a, b) { return (a.status === 'deactivated') - (b.status === 'deactivated') || order[a.role] - order[b.role] || a.name.localeCompare(b.name); });
      $('#trows').innerHTML = list.map(function (u) {
        var you = u.id === db.meId;
        var st = u.status === 'invited' ? chip('invited', 'Invited') : u.status === 'deactivated' ? chip('deactivated', 'Turned off') : chip('active', 'Active');
        var mfa = u.status === 'invited' ? '<span class="muted">After sign-up</span>' : (u.mfa ? chip('on', 'On') : chip('off', 'Not set up'));
        return '<tr><td><strong>' + esc(u.name) + '</strong>' + (you ? ' <span class="muted">(you)</span>' : '') + '<div class="sub">' + esc(u.email) + '</div><div class="col-narrow mt-4">' + st + '</div></td>' +
          '<td><label class="sr-only" for="role-' + esc(u.id) + '">Role for ' + esc(u.name) + '</label><select class="input" id="role-' + esc(u.id) + '" data-role="' + esc(u.id) + '"' + (u.status === 'deactivated' ? ' disabled' : '') + '>' + opts([['super_admin', 'Super admin'], ['admin', 'Admin']], u.role) + '</select></td>' +
          '<td class="col-opt">' + mfa + '</td><td class="col-wide">' + st + '</td><td class="actions">' +
          (u.status === 'invited' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="resend" data-id="' + esc(u.id) + '">' + icon('mail') + 'Resend</button><button type="button" class="icon-btn danger" data-act="revoke" data-id="' + esc(u.id) + '" aria-label="Cancel the invite for ' + esc(u.name) + '">' + icon('x') + '</button>' :
            (u.status === 'active' ? '<button type="button" class="btn btn-ghost btn-sm opt" data-act="recover" data-id="' + esc(u.id) + '" aria-label="Send a password reset link to ' + esc(u.name) + '">' + icon('key') + '<span class="col-opt">Reset link</span></button><button type="button" class="btn btn-ghost btn-sm" data-act="deactivate" data-id="' + esc(u.id) + '" aria-label="Turn off access for ' + esc(u.name) + '">' + icon('power') + '<span class="col-opt">Turn off</span></button>' :
              '<button type="button" class="btn btn-ghost btn-sm" data-act="reactivate" data-id="' + esc(u.id) + '" aria-label="Turn access back on for ' + esc(u.name) + '">' + icon('power') + '<span class="col-opt">Turn on</span></button>')) +
          '</td></tr>';
      }).join('');
    }
    draw();
    $('#trows').addEventListener('change', function (e) {
      var sel = e.target.closest('[data-role]'); if (!sel) return;
      var u = db.team.filter(function (x) { return x.id === sel.getAttribute('data-role'); })[0];
      if (sel.value !== 'super_admin' && lastSuper(u)) { sel.value = 'super_admin'; toast('You cannot demote the last active super admin. Promote someone else first.', 'err'); return; }
      var from = u.role; u.role = sel.value;
      audit('user.role_change', 'user', u.id, { email: u.email, from: from, to: u.role }); save();
      toast(u.name + ' is now ' + (u.role === 'super_admin' ? 'a super admin' : 'an admin') + '.');
      if (u.id === db.meId) { db.viewAs = u.role; save(); render(true); return; }
      draw();
    });
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'invite') return inviteDialog(draw);
      var u = db.team.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (!u) return;
      if (act === 'recover') { audit('user.recover_password', 'user', u.id, { email: u.email }); save(); toast('Reset link sent to ' + u.email + ' (demo: no email is sent).'); }
      else if (act === 'resend') { audit('user.invite_resend', 'user', u.id, { email: u.email }); save(); toast('Invite sent again to ' + u.email + ' (demo: no email is sent).'); }
      else if (act === 'revoke') confirmDialog({ title: 'Cancel this invite?', desc: 'The link in the email to <strong>' + esc(u.email) + '</strong> stops working.', confirm: 'Cancel invite', danger: true, onConfirm: function () { db.team = db.team.filter(function (x) { return x.id !== u.id; }); audit('user.invite_revoke', 'user', u.id, { email: u.email }); save(); toast('Invite cancelled.'); draw(); } });
      else if (act === 'deactivate') {
        if (lastSuper(u)) { toast('You cannot turn off the last active super admin.', 'err'); return; }
        confirmDialog({ title: 'Turn off access for ' + u.name + '?', desc: 'They are signed out on their next request. Their history stays, and you can turn access back on at any time.', confirm: 'Turn off', danger: true, onConfirm: function () { u.status = 'deactivated'; audit('user.deactivate', 'user', u.id, { email: u.email }); save(); toast(u.name + ' can no longer sign in.'); if (u.id === db.meId) { signOut(); return; } draw(); } });
      } else if (act === 'reactivate') { u.status = 'active'; audit('user.reactivate', 'user', u.id, { email: u.email }); save(); toast(u.name + ' can sign in again.'); draw(); }
    });
  }
  function inviteDialog(after) {
    openModal({
      title: 'Invite someone', desc: 'They get an email link to set their own password. No password is ever sent.',
      body: '<div class="field"><label class="lbl" for="inv-name">Name</label><input class="input" id="inv-name" autocomplete="off" autofocus></div>' +
        '<div class="field"><label class="lbl" for="inv-email">Email</label><input class="input" id="inv-email" type="email" autocomplete="off" placeholder="name@example.com"></div>' +
        '<div class="field"><label class="lbl" for="inv-role">Role</label><select class="input" id="inv-role">' + opts([['admin', 'Admin: manages all content'], ['super_admin', 'Super admin: also manages the team and audit log']], 'admin') + '</select></div>' +
        '<p class="hint err" id="inv-err" role="alert"></p>',
      actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">' + icon('mail') + 'Send invite</button>',
      onSubmit: function (f, close) {
        var name = $('#inv-name', f).value.trim(), email = $('#inv-email', f).value.trim().toLowerCase(), r = $('#inv-role', f).value;
        var err = $('#inv-err', f);
        if (!name) { err.textContent = 'Add their name.'; return; }
        if (!EMAIL_RE.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
        if (db.team.some(function (u) { return u.email === email; })) { err.textContent = 'That email is already on the team.'; return; }
        var u = { id: uid(), name: name.slice(0, 80), email: email, role: r, status: 'invited', mfa: false, lastActive: null, createdAt: nowIso() };
        db.team.push(u); audit('user.invite', 'user', u.id, { email: email, role: r }); save();
        close(); toast('Invite sent to ' + email + ' (demo: no email is sent).'); after();
      }
    });
  }
  function superOnly(what) {
    setTitle(what);
    shell(what === 'Team' ? 'team' : 'audit', head(what, '') + '<div class="card"><h2>Super admins only</h2><p class="muted">You are viewing the demo as an admin. ' + esc(what) + ' is limited to super admins, the same as the kit’s requireSuperAdmin() gate. Switch roles in <a href="#/settings">Settings</a>.</p></div>');
  }

  // ---------------------------------------------------------- audit log
  var auditFilters = { q: '', action: 'all', actor: 'all', shown: PAGE_SIZE };
  function viewAudit() {
    if (!isSuper()) return superOnly('Audit log');
    setTitle('Audit log');
    var actions = db.audit.map(function (a) { return a.action; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort();
    var actors = db.audit.map(function (a) { return a.actor; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort();
    shell('audit',
      head('Audit log', 'Every sensitive change: who, what, when. Append-only.', '<button type="button" class="btn btn-outline" data-act="csv">' + icon('download') + 'Export CSV</button>') +
      '<div class="filters" role="search">' +
        '<div class="search">' + icon('search') + '<label class="sr-only" for="aq">Search the audit log</label><input class="input" id="aq" type="search" placeholder="Search actions, people or details" value="' + esc(auditFilters.q) + '"></div>' +
        '<label class="sr-only" for="aaction">Action</label><select class="input" id="aaction">' + opts([['all', 'All actions']].concat(actions.map(function (a) { return [a, a]; })), auditFilters.action) + '</select>' +
        '<label class="sr-only" for="aactor">Person</label><select class="input" id="aactor">' + opts([['all', 'Everyone']].concat(actors.map(function (a) { return [a, a]; })), auditFilters.actor) + '</select>' +
      '</div>' +
      '<p class="count-line" id="acount" aria-live="polite"></p>' +
      '<div class="table-wrap"><table class="tbl"><caption class="sr-only">Audit log entries</caption><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col" class="col-opt">Who</th><th scope="col" class="col-opt">Details</th></tr></thead><tbody id="arows"></tbody></table></div>' +
      '<div class="row" id="amore"></div>'
    );
    function filtered() {
      var q = auditFilters.q.toLowerCase();
      return db.audit.filter(function (a) {
        if (auditFilters.action !== 'all' && a.action !== auditFilters.action) return false;
        if (auditFilters.actor !== 'all' && a.actor !== auditFilters.actor) return false;
        if (q && (a.action + ' ' + a.actor + ' ' + JSON.stringify(a.payload)).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
    }
    function details(a) { return Object.keys(a.payload || {}).map(function (k) { return k + ': ' + a.payload[k]; }).join(', '); }
    // Unbounded list: paginated 50 at a time (pagination is the virtualization here).
    function draw() {
      var list = filtered(), shown = list.slice(0, auditFilters.shown);
      $('#acount').textContent = 'Showing ' + shown.length + ' of ' + plural(list.length, 'entry', 'entries');
      $('#arows').innerHTML = shown.length ? shown.map(function (a) {
        return '<tr><td><span title="' + esc(a.at) + '">' + esc(dateTimeLabel(a.at)) + '</span><div class="sub">' + esc(ago(a.at)) + '</div></td><td><span class="mono">' + esc(a.action) + '</span><div class="sub col-opt-inline">' + esc(a.actor) + '</div></td><td class="col-opt">' + esc(a.actor) + '<div class="sub">' + esc(a.role) + '</div></td><td class="col-opt"><span class="sub">' + esc(details(a)) + '</span></td></tr>';
      }).join('') : '<tr><td colspan="4" class="empty">No entries match these filters.</td></tr>';
      $('#amore').innerHTML = list.length > shown.length ? '<button type="button" class="btn btn-outline" data-act="more">Show 50 more</button>' : '';
    }
    draw();
    $('#aq').addEventListener('input', function (e) { auditFilters.q = e.target.value; auditFilters.shown = PAGE_SIZE; draw(); });
    $('#aaction').addEventListener('change', function (e) { auditFilters.action = e.target.value; auditFilters.shown = PAGE_SIZE; draw(); });
    $('#aactor').addEventListener('change', function (e) { auditFilters.actor = e.target.value; auditFilters.shown = PAGE_SIZE; draw(); });
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.getAttribute('data-act') === 'more') { auditFilters.shown += PAGE_SIZE; draw(); }
      if (b.getAttribute('data-act') === 'csv') {
        // Cells that start with = + - @ are prefixed so a spreadsheet never runs them as formulas.
        var cell = function (v) { var s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
        var rows = [['created_at', 'actor', 'role', 'action', 'resource_type', 'resource_id', 'details', 'ip']].concat(filtered().map(function (a) { return [a.at, a.actor, a.role, a.action, a.resourceType, a.resourceId, details(a), a.ip]; }));
        download('audit-log-' + new Date().toISOString().slice(0, 10) + '.csv', rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n', 'text/csv');
        toast('Exported ' + plural(rows.length - 1, 'entry', 'entries') + ' as CSV.');
      }
    });
  }

  // ---------------------------------------------------------- redirects
  function viewRedirects() {
    setTitle('Redirects');
    shell('redirects',
      head('Redirects', 'Send old addresses to their new home in one hop.', '<button type="button" class="btn btn-primary" data-act="new-redirect">' + icon('plus') + 'New redirect</button>') +
      proposedNote('The address tester and the checks for loops, two-hop chains, duplicates and reserved paths are proposed. In the kit today a redirect is checked for a path source (no query or fragment), a path or http(s) destination, and no pattern source pointing off-site.', 'Partly proposed.') +
      '<section class="card" aria-labelledby="rt-h"><h2 id="rt-h">Test an address</h2><form id="rtest" class="row" novalidate><label class="sr-only" for="rtest-in">Path to test</label><input class="input grow" id="rtest-in" placeholder="/careers" spellcheck="false"><button class="btn btn-outline" type="submit">' + icon('play') + 'Test</button></form><p id="rtest-out" class="hint" role="status"></p></section>' +
      '<div class="table-wrap mt-16"><table class="tbl"><caption class="sr-only">Redirect rules</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col" class="col-opt">Type</th><th scope="col" class="col-opt">Visits</th><th scope="col">On</th><th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody id="rrows"></tbody></table></div>'
    );
    // Max ~50 redirects in the demo. Plain render.
    function draw() {
      $('#rrows').innerHTML = db.redirects.length ? db.redirects.map(function (r) {
        return '<tr><td class="mono">' + esc(r.from) + '</td><td class="mono">' + esc(r.to) + '</td><td class="col-opt">' + (r.permanent ? '308 permanent' : '307 temporary') + '</td><td class="col-opt">' + esc(Number(r.hits).toLocaleString('en-US')) + (r.lastHit ? '<div class="sub">last ' + esc(ago(r.lastHit)) + '</div>' : '') + '</td>' +
          '<td><label class="check"><input type="checkbox" data-toggle="' + esc(r.id) + '"' + (r.enabled ? ' checked' : '') + '><span class="sr-only">Redirect from ' + esc(r.from) + ' is on</span></label></td>' +
          '<td class="actions"><button type="button" class="icon-btn" data-act="edit-redirect" data-id="' + esc(r.id) + '" aria-label="Edit redirect from ' + esc(r.from) + '">' + icon('edit') + '</button><button type="button" class="icon-btn danger" data-act="del-redirect" data-id="' + esc(r.id) + '" aria-label="Delete redirect from ' + esc(r.from) + '">' + icon('trash') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">No redirects yet.</td></tr>';
    }
    draw();
    $('#rrows').addEventListener('change', function (e) {
      var c = e.target.closest('[data-toggle]'); if (!c) return;
      var r = db.redirects.filter(function (x) { return x.id === c.getAttribute('data-toggle'); })[0];
      r.enabled = c.checked; audit(r.enabled ? 'redirect.enable' : 'redirect.disable', 'redirect', r.id, { from: r.from }); save();
      toast('Redirect from ' + r.from + ' is ' + (r.enabled ? 'on' : 'off') + '.');
    });
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      var r = db.redirects.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
      if (act === 'new-redirect') redirectDialog(null, draw);
      else if (act === 'edit-redirect' && r) redirectDialog(r, draw);
      else if (act === 'del-redirect' && r) confirmDialog({ title: 'Delete this redirect?', desc: 'Visitors to <span class="mono">' + esc(r.from) + '</span> will get a page-not-found error.', confirm: 'Delete redirect', danger: true, onConfirm: function () { db.redirects = db.redirects.filter(function (x) { return x.id !== r.id; }); audit('redirect.delete', 'redirect', r.id, { from: r.from }); save(); toast('Redirect deleted.'); draw(); } });
    });
    $('#rtest').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#rtest-in').value.trim().replace(/\/+$/, '') || '/';
      if (v.charAt(0) !== '/') v = '/' + v;
      var hit = db.redirects.filter(function (r) { return r.enabled && r.from.replace(/\/+$/, '') === v; })[0];
      var out = $('#rtest-out');
      if (!hit) { out.textContent = v + ' has no active redirect: the page itself loads (or shows page-not-found).'; return; }
      hit.hits++; hit.lastHit = nowIso(); save(); draw();
      out.textContent = v + ' redirects with a ' + (hit.permanent ? '308' : '307') + ' to ' + hit.to + '. Counted as a visit.';
    });
  }
  function redirectDialog(r, after) {
    var isNew = !r;
    openModal({
      title: isNew ? 'New redirect' : 'Edit redirect',
      body: '<div class="field"><label class="lbl" for="r-from">From (a path on this site)</label><input class="input mono" id="r-from" value="' + esc(r ? r.from : '') + '" placeholder="/old-page" spellcheck="false" autofocus></div>' +
        '<div class="field"><label class="lbl" for="r-to">To (a path or a full https:// address)</label><input class="input mono" id="r-to" value="' + esc(r ? r.to : '') + '" placeholder="/new-page" spellcheck="false"></div>' +
        '<div class="field"><label class="check"><input type="checkbox" id="r-perm"' + (!r || r.permanent ? ' checked' : '') + '> Permanent (308): the page moved for good</label></div>' +
        '<div class="field"><label class="check"><input type="checkbox" id="r-on"' + (!r || r.enabled ? ' checked' : '') + '> On</label></div>' +
        '<p class="hint err" id="r-err" role="alert"></p>',
      actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save redirect</button>',
      onSubmit: function (f, close) {
        var from = $('#r-from', f).value.trim(), to = $('#r-to', f).value.trim(), err = $('#r-err', f);
        // The kit's lib/redirects/validate.ts checks the path and destination
        // shapes; the reserved-path, loop, duplicate and chain checks are the
        // proposed additions shown on this page.
        if (!/^\/[^\s?#]*$/.test(from)) { err.textContent = 'From must be a path starting with / (no spaces, no ? or #).'; return; }
        if (/^\/(admin|api|_next)(\/|$)/.test(from)) { err.textContent = 'Paths under /admin, /api and /_next cannot be redirected.'; return; }
        if (!(/^\/[^\s]*$/.test(to) || /^https?:\/\/[^\s]+$/i.test(to))) { err.textContent = 'To must be a path starting with / or a full http(s):// address.'; return; }
        if (from.replace(/\/+$/, '') === to.replace(/\/+$/, '')) { err.textContent = 'From and To are the same address: that would loop.'; return; }
        if (db.redirects.some(function (x) { return x.from === from && (!r || x.id !== r.id); })) { err.textContent = 'There is already a redirect from ' + from + '.'; return; }
        var chain = db.redirects.some(function (x) { return x.from === to && (!r || x.id !== r.id); });
        var rec = r || { id: uid(), hits: 0, lastHit: null, createdAt: nowIso() };
        rec.from = from; rec.to = to; rec.permanent = $('#r-perm', f).checked; rec.enabled = $('#r-on', f).checked;
        if (isNew) db.redirects.unshift(rec);
        audit(isNew ? 'redirect.create' : 'redirect.update', 'redirect', rec.id, { from: from, to: to }); save();
        close(); toast(chain ? 'Saved. Note: ' + to + ' is itself redirected, so this makes a two-hop chain.' : 'Redirect saved.'); after();
      }
    });
  }

  // ----------------------------------------------------------- settings
  function viewSettings() {
    setTitle('Settings');
    var pref = 'system'; try { pref = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { /* ignore */ }
    var u = me();
    shell('settings',
      head('Settings', 'Your account, security, and the demo itself.') +
      '<div class="stack">' +
      '<section class="card" aria-labelledby="st-theme"><h2 id="st-theme">Appearance</h2><fieldset class="row fieldset-reset"><legend class="sr-only">Theme</legend>' +
        [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my device']].map(function (o) { return '<label class="check"><input type="radio" name="theme" value="' + o[0] + '"' + (pref === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>'; }).join('') +
      '</fieldset></section>' +
      '<section class="card" aria-labelledby="st-2fa"><h2 id="st-2fa">Two-factor authentication</h2>' +
        (db.mfaEnabled ? '<p>' + chip('on', 'On') + ' &nbsp;Authenticator app. <span class="muted">' + plural(db.mfaCodes.length, 'recovery code', 'recovery codes') + ' left.</span></p><div class="row"><button type="button" class="btn btn-outline" data-act="regen">' + icon('key') + 'New recovery codes</button><button type="button" class="btn btn-ghost" data-act="disable-2fa">Turn off two-factor</button></div>'
          : '<p>' + chip('off', 'Off') + ' &nbsp;<span class="muted">Required for every admin after the grace period.</span></p><button type="button" class="btn btn-primary" data-act="enable-2fa">' + icon('shield') + 'Set up two-factor</button>') +
      '</section>' +
      '<section class="card" aria-labelledby="st-pw"><h2 id="st-pw">Change password</h2><form id="pwform" novalidate>' +
        '<div class="field"><label class="lbl" for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" autocomplete="current-password"></div>' +
        '<div class="field"><label class="lbl" for="pw-new">New password</label><input class="input" id="pw-new" type="password" autocomplete="new-password" aria-describedby="pw-rules"><ul class="pw-rules" id="pw-rules"><li data-r="len">At least 12 characters</li><li data-r="let">A letter</li><li data-r="num">A number</li><li data-r="sym">A symbol</li></ul></div>' +
        '<div class="field"><label class="lbl" for="pw-conf">Confirm new password</label><input class="input" id="pw-conf" type="password" autocomplete="new-password"></div>' +
        '<p class="hint err" id="pw-err" role="alert"></p><button class="btn btn-primary" type="submit">Update password</button></form></section>' +
      '<section class="card" aria-labelledby="st-demo"><h2 id="st-demo">Demo controls</h2><p class="muted">Signed in as ' + esc(u.name) + ' (' + esc(u.email) + '). The kit shows Team and the Audit log to super admins only; switch roles to see the difference.</p>' +
        '<div class="row"><label class="lbl" for="viewas">View the admin as</label><select class="input w-auto" id="viewas">' + opts([['super_admin', 'Super admin'], ['admin', 'Admin']], role()) + '</select></div>' +
        '<div class="row mt-16"><button type="button" class="btn btn-danger" data-act="reset-demo">' + icon('reset') + 'Reset demo data</button><span class="muted">Puts every post, image, person and log entry back to the original sample.</span></div></section>' +
      '</div>'
    );
    $all('input[name="theme"]').forEach(function (r) { r.addEventListener('change', function () { setTheme(r.value); }); });
    $('#viewas').addEventListener('change', function (e) { db.viewAs = e.target.value; save(); toast('Viewing as ' + (db.viewAs === 'super_admin' ? 'a super admin' : 'an admin') + '.'); render(true); });
    var newPw = $('#pw-new');
    function rules(v) { return { len: v.length >= 12, let: /[A-Za-z]/.test(v), num: /\d/.test(v), sym: /[^A-Za-z0-9]/.test(v) }; }
    newPw.addEventListener('input', function () { var r = rules(newPw.value); $all('#pw-rules li').forEach(function (li) { li.classList.toggle('ok', r[li.getAttribute('data-r')]); }); });
    $('#pwform').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#pw-err'), r = rules(newPw.value);
      if (!$('#pw-cur').value) { err.textContent = 'Enter your current password (any value works in the demo).'; return; }
      if (!(r.len && r.let && r.num && r.sym)) { err.textContent = 'The new password does not meet every rule yet.'; return; }
      if (newPw.value !== $('#pw-conf').value) { err.textContent = 'The two new passwords do not match.'; return; }
      err.textContent = ''; e.target.reset(); $all('#pw-rules li').forEach(function (li) { li.classList.remove('ok'); });
      audit('auth.password_change', 'user', me().id); save(); toast('Password updated (demo: nothing is stored).');
    });
    $('.main').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'regen') confirmDialog({ title: 'Make new recovery codes?', desc: 'Your old codes stop working right away.', confirm: 'Make new codes', onConfirm: function () { db.mfaCodes = recoveryCodes(); audit('auth.mfa.regenerated_codes', 'user', me().id); save(); showCodes('Your new recovery codes', 'Each code works once. They are shown only now.', function () { render(true); }); } });
      else if (act === 'disable-2fa') openModal({
        title: 'Turn off two-factor?', desc: 'Confirm your password. Your recovery codes are deleted too.',
        body: '<div class="field"><label class="lbl" for="dis-pw">Password</label><input class="input" id="dis-pw" type="password" autocomplete="current-password" autofocus><p class="hint">Any value works in the demo.</p><p class="hint err" id="dis-err" role="alert"></p></div>',
        actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-danger">Turn off</button>',
        onSubmit: function (f, close) { if (!$('#dis-pw', f).value) { $('#dis-err', f).textContent = 'Enter your password.'; return; } db.mfaEnabled = false; db.mfaCodes = []; me().mfa = false; audit('auth.mfa.disabled', 'user', me().id); save(); close(); toast('Two-factor is off.'); render(true); }
      });
      else if (act === 'enable-2fa') openModal({
        title: 'Set up two-factor', body: enrollBody() + '<p class="hint err" id="en-err" role="alert"></p>',
        actions: '<button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-primary">Verify and turn on</button>',
        onSubmit: function (f, close) { var inp = $('#enroll-code', f); if (inp.value.trim() !== DEMO_TOTP) { $('#en-err', f).textContent = 'That code did not match (demo code: ' + DEMO_TOTP + ').'; return; } close(); finishEnroll(inp, $('#en-err', f), function () { render(true); }); }
      });
    });
  }
  function setTheme(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* ignore */ }
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function viewNotFound() {
    setTitle('Not found');
    var s = session();
    var inner = head('Page not found', 'That address is not part of the demo.') + '<a class="btn btn-primary" href="#/posts">Go to posts</a>';
    if (s && s.signedIn) shell('', inner); else authPage(inner);
  }

  var ROUTES = { login: viewLogin, security: viewSecurity, forgot: viewForgot, posts: viewPostEditorOrList, preview: viewPreview, staging: viewSite, site: viewSite, media: viewMedia, team: viewTeam, audit: viewAudit, redirects: viewRedirects, settings: viewSettings };
  function viewPostEditorOrList(rest) { return rest.length ? viewPostEditor(rest) : viewPosts(); }

  // ------------------------------------------------- global interactions
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'reset-demo') { confirmDialog({ title: 'Reset the demo data?', desc: 'Every post, image, person, redirect and log entry goes back to the original sample. You will be signed out.', confirm: 'Reset demo data', danger: true, onConfirm: resetDemo }); }
    else if (act === 'sign-out') signOut();
    else if (act === 'toggle-theme') {
      var nowDark = document.documentElement.getAttribute('data-theme') !== 'dark';
      setTheme(nowDark ? 'dark' : 'light');
      b.innerHTML = icon(nowDark ? 'sun' : 'moon') + (nowDark ? 'Light theme' : 'Dark theme');
      b.setAttribute('aria-label', 'Switch to ' + (nowDark ? 'light' : 'dark') + ' theme');
      $all('input[name="theme"]').forEach(function (r) { r.checked = r.value === (nowDark ? 'dark' : 'light'); });
    }
    else if (act === 'open-nav') { $('#shell').classList.add('nav-open'); b.setAttribute('aria-expanded', 'true'); var l = $('#sidebar a'); if (l) l.focus(); }
    else if (act === 'close-nav') closeNav();
    else if (act === 'toggle-pw') { var pw = $('#password'); var show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', show ? 'true' : 'false'); }
    else if (act === 'toggle-recovery') { var rf = $('#rec-field'), tf = $('#totp-field'); var on = rf.hidden; rf.hidden = !on; tf.hidden = on; b.textContent = on ? 'Use the authenticator code instead' : 'Use a recovery code instead'; b.setAttribute('aria-expanded', on ? 'true' : 'false'); (on ? $('#rcode') : $('#code')).focus(); $('#verify-err').textContent = ''; }
  });
  function closeNav() { var sh = $('#shell'); if (sh && sh.classList.contains('nav-open')) { sh.classList.remove('nav-open'); var ob = $('[data-act="open-nav"]'); if (ob) { ob.setAttribute('aria-expanded', 'false'); ob.focus(); } } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modalStack.length) closeNav(); });
  document.addEventListener('click', function (e) { if (e.target.closest('#sidebar a')) { var sh = $('#shell'); if (sh) sh.classList.remove('nav-open'); } });
  $('.skip').addEventListener('click', function (e) { e.preventDefault(); var m = $('#main'); if (m) m.focus(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { var pref = 'system'; try { pref = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { /* ignore */ } if (pref === 'system') setTheme('system'); });
  window.addEventListener('storage', function (e) { if (e.key === STORE_KEY) { db = load(); render(true); } });

  render(true);
})();
