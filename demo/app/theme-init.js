// Applies the saved theme before first paint (external file: the page's CSP
// allows no inline script). "system" follows the OS setting.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('cmskit-demo-theme') || 'system'; } catch (e) { /* storage blocked */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
