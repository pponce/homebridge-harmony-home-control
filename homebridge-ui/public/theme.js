(() => {
  // Homebridge applies its chosen theme to the iframe body. Use the system
  // preference only until the host has supplied that choice.
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => {
    const classes = [...document.body.classList];
    const hostDark = classes.includes('dark-mode') || classes.some(name => name.startsWith('config-ui-x-dark-mode-'));
    const hostLight = classes.some(name => name.startsWith('config-ui-x-')) && !hostDark;
    document.documentElement.dataset.theme = hostDark || !hostLight && system?.matches ? 'dark' : 'light';
  };
  apply();
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  system?.addEventListener?.('change', apply);
})();
