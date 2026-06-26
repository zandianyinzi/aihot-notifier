(function () {
  const perfLog = window.__popupPerfLog || function () {};
  perfLog('boot-start');
  var theme = localStorage.getItem('theme') || 'dark';
  var font = localStorage.getItem('fontFamily') || 'system';
  var size = localStorage.getItem('fontSize') || 'medium';

  if (!['dark', 'green-dark', 'chrome-dark'].includes(theme)) {
    theme = 'dark';
    localStorage.setItem('theme', theme);
  }

  if (font === 'noto-sans') {
    font = 'system';
    localStorage.setItem('fontFamily', font);
  }

  if (!['system', 'noto-serif', 'lxgw'].includes(font)) {
    font = 'system';
    localStorage.setItem('fontFamily', font);
  }

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', font);
  document.documentElement.setAttribute('data-size', size);

  document.documentElement.style.background =
    theme === 'green-dark' ? '#101410' : theme === 'chrome-dark' ? '#111317' : '#111111';
  perfLog('boot-ready', { theme, font, size });
})();
