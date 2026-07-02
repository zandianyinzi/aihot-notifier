(function () {
  const perfLog = window.__popupPerfLog || function () {};
  perfLog('boot-start');
  var theme = localStorage.getItem('theme') || 'dark';
  var font = localStorage.getItem('fontFamily') || 'system';
  var size = localStorage.getItem('fontSize') || 'medium';

  if (!['dark', 'green-dark', 'chrome-dark', 'clear-light', 'slate-night'].includes(theme)) {
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

  const themeBackgrounds = {
    'dark': '#111111',
    'green-dark': '#101410',
    'chrome-dark': '#111317',
    'clear-light': '#f5f8fb',
    'slate-night': '#0d1117'
  };
  document.documentElement.style.background = themeBackgrounds[theme] || '#111111';
  document.documentElement.style.colorScheme = theme === 'clear-light' ? 'light' : 'dark';
  perfLog('boot-ready', { theme, font, size });
})();
