(function () {
  const perfLog = window.__popupPerfLog || function () {};
  perfLog('boot-start');
  var theme = localStorage.getItem('theme') || 'dark';
  var font = localStorage.getItem('fontFamily') || 'system';
  var size = localStorage.getItem('fontSize') || 'medium';

  if (!['dark', 'green-dark', 'chrome-dark', 'slate-night'].includes(theme)) {
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
    'dark': '#111110',
    'green-dark': '#101610',
    'chrome-dark': '#13151a',
    'slate-night': '#0e181b'
  };
  document.documentElement.style.background = themeBackgrounds[theme] || '#111110';
  document.documentElement.style.colorScheme = 'dark';
  perfLog('boot-ready', { theme, font, size });
})();
