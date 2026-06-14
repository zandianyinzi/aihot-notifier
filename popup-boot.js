(function () {
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

  var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.documentElement.style.background = bg || '#111111';
})();
