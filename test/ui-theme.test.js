import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('Homebridge theme changes override the OS and update without reopening settings', async () => {
  const body = { classList: [] }, root = { dataset: {} }; let onMutation, onSystemChange;
  const query = { matches: true, addEventListener: (event,fn) => { assert.equal(event,'change'); onSystemChange = fn; } };
  runInNewContext(await readFile(new URL('../homebridge-ui/public/theme.js',import.meta.url),'utf8'), {
    window: { matchMedia: () => query }, document: { body, documentElement: root },
    MutationObserver: class { constructor(callback) { onMutation = callback; } observe(target,options) { assert.equal(target,body); assert.deepEqual([...options.attributeFilter],['class']); } },
  });
  assert.equal(root.dataset.theme,'dark');
  body.classList = ['config-ui-x-light']; onMutation(); assert.equal(root.dataset.theme,'light');
  body.classList = ['dark-mode']; onMutation(); assert.equal(root.dataset.theme,'dark');
  query.matches = false; onSystemChange(); assert.equal(root.dataset.theme,'dark');
  body.classList = ['config-ui-x-dark-mode-blue']; onMutation(); assert.equal(root.dataset.theme,'dark');
  body.classList = []; onMutation(); assert.equal(root.dataset.theme,'light');
  query.matches = true; onSystemChange(); assert.equal(root.dataset.theme,'dark');
});

test('primary text, hints, inputs, buttons and status labels retain readable contrast in both themes', async () => {
  const css = await readFile(new URL('../homebridge-ui/public/style.css',import.meta.url),'utf8');
  const luminance = hex => {
    const rgb = hex.match(/[a-f0-9]{2}/gi).map(c => parseInt(c,16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const block of css.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)) {
    const colors = Object.fromEntries([...block[1].matchAll(/--hhc-([\w-]+):\s*(#[a-f0-9]{6});/gi)].map(m => [m[1],m[2]]));
    for (const [fg,bg] of [['text','panel'],['text','soft'],['muted','panel'],['muted','soft'],['placeholder','input'],['on-accent','accent'],['on-accent','hover'],['good','good-bg'],['warning','warning-bg'],['danger','danger-bg']]) {
      const [low,high] = [luminance(colors[fg]),luminance(colors[bg])].sort((a,b) => a-b);
      const ratio = (high + .05) / (low + .05);
      assert.ok(ratio >= 4.5, `${block[0].startsWith(':root[') ? 'Dark' : 'Light'} ${fg}/${bg}: ${ratio.toFixed(2)}:1`);
    }
  }
});
