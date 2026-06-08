(function () {
  var theme = localStorage.getItem('theme') || 'dark';
  var font = localStorage.getItem('fontFamily') || 'noto-sans';
  var size = localStorage.getItem('fontSize') || 'medium';

  if (theme !== 'dark' && theme !== 'green-dark') {
    theme = 'dark';
    localStorage.setItem('theme', theme);
  }

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', font);
  document.documentElement.setAttribute('data-size', size);
})();
