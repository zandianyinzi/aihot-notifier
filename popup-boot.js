(function () {
  var theme = localStorage.getItem('theme') || 'dark';
  var font = localStorage.getItem('fontFamily') || 'system';
  var size = localStorage.getItem('fontSize') || 'medium';

  if (theme !== 'dark' && theme !== 'green-dark') {
    theme = 'dark';
    localStorage.setItem('theme', theme);
  }

  if (!['system', 'noto-sans', 'noto-serif', 'lxgw'].includes(font)) {
    font = 'system';
    localStorage.setItem('fontFamily', font);
  }

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', font);
  document.documentElement.setAttribute('data-size', size);
})();
