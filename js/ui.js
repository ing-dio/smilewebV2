/**
 * DOM helpers.
 *
 * Everything is built with `createElement` + `textContent` rather than
 * `innerHTML`, which keeps user/dataset content incapable of injecting markup.
 */
import { escapeRegExp, formatNumber } from './util.js';

/** querySelector shorthand. */
export const $ = (selector, root = globalThis.document) => root?.querySelector?.(selector) ?? null;

/** querySelectorAll shorthand returning a real array. */
export const $$ = (selector, root = globalThis.document) =>
  Array.from(root?.querySelectorAll?.(selector) ?? []);

/** Set `textContent` only when it actually changed (avoids needless layout). */
export function setText(node, value) {
  if (!node) return;
  const next = String(value ?? '');
  if (node.textContent !== next) node.textContent = next;
}

/** Toggle the `hidden` attribute. */
export function setHidden(node, hidden) {
  if (!node) return;
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

/** Enable/disable a button properly (attributes + styling hooks). */
export function setDisabled(node, disabled) {
  if (!node) return;
  if (disabled) {
    node.setAttribute('disabled', '');
    node.setAttribute('aria-disabled', 'true');
  } else {
    node.removeAttribute('disabled');
    node.removeAttribute('aria-disabled');
  }
}

/** Create an element with attributes and children in one call. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // only ever used with trusted strings
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

/**
 * Append `text` to `parent`, wrapping every occurrence of one of `tokens` in
 * `<mark>` so search results show why they matched.
 */
export function appendHighlighted(parent, text, tokens = []) {
  const value = String(text ?? '');
  const clean = tokens.map((token) => escapeRegExp(token)).filter((token) => token.length > 1);
  if (clean.length === 0) {
    parent.append(document.createTextNode(value));
    return parent;
  }
  const pattern = new RegExp(`(${clean.join('|')})`, 'gi');
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parent.append(document.createTextNode(value.slice(lastIndex, index)));
    parent.append(el('mark', { text: match[0] }));
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) parent.append(document.createTextNode(value.slice(lastIndex)));
  return parent;
}

/**
 * Render one joke into the big "stage" card.
 *
 * @param {object} refs element references.
 * @param {object|null} joke
 * @param {object} [options]
 * @param {boolean} [options.fresh] play the entrance animation.
 * @param {boolean} [options.revealed] show the punchline immediately.
 * @param {boolean} [options.saved] favourite state.
 * @param {boolean} [options.empty] render the placeholder copy.
 */
export function renderJokeCard(refs, joke, options = {}) {
  const { card, setup, punchline, category, idLabel, favoriteButton, revealButton, shareButton } = refs;
  const { fresh = false, revealed = true, saved = false, empty = false } = options;

  if (!card) return;

  if (!joke || empty) {
    card.dataset.empty = 'true';
    card.dataset.fresh = 'false';
    setText(category, 'Welcome');
    setText(
      setup,
      'Press “Start smiling”, then smile at your camera and your first joke will pop in right here.',
    );
    setText(punchline, '');
    setHidden(punchline, true);
    setText(idLabel, '');
    setHidden(revealButton, true);
    setHidden(shareButton, true);
    setDisabled(favoriteButton, true);
    if (favoriteButton) favoriteButton.setAttribute('aria-pressed', 'false');
    return;
  }

  card.dataset.empty = 'false';
  card.dataset.fresh = String(Boolean(fresh));
  setText(category, joke.categoryName ?? 'Joke');
  setText(setup, joke.setup ?? joke.text);
  setText(punchline, joke.punchline ?? '');
  setHidden(punchline, !joke.punchline || !revealed);
  setHidden(revealButton, !joke.punchline || revealed);
  setText(idLabel, `Joke #${formatNumber(joke.number ?? 0)} · ${joke.categoryName ?? ''}`);
  setHidden(shareButton, !globalThis.navigator?.share);
  setDisabled(favoriteButton, false);

  if (favoriteButton) {
    favoriteButton.setAttribute('aria-pressed', String(saved));
    const label = favoriteButton.querySelector('[data-label]') ?? favoriteButton;
    label.textContent = saved ? '♥ Saved' : '♡ Save';
  }
}

/**
 * Render a page of search results.
 *
 * @param {HTMLElement} list the <ol> container.
 * @param {Array<object>} items jokes to render.
 * @param {object} options
 * @param {(joke: object) => boolean} options.isSaved
 * @param {string[]} options.tokens search tokens for highlighting.
 * @param {boolean} [options.append] add to the end instead of replacing.
 */
export function renderJokeList(list, items, { isSaved = () => false, tokens = [], append = false } = {}) {
  if (!list) return;
  if (!append) list.replaceChildren();

  if (items.length === 0 && !append) {
    list.append(
      el('li', { class: 'joke-list__empty' }, ['No jokes matched. Try a different word.']),
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const joke of items) {
    const text = el('p', { class: 'joke-list__text' });
    appendHighlighted(text, joke.setup ?? joke.text, tokens);
    if (joke.punchline) {
      const punch = el('b');
      appendHighlighted(punch, joke.punchline, tokens);
      text.append(punch);
    }

    const saved = isSaved(joke);
    const favButton = el('button', {
      type: 'button',
      class: 'icon-action',
      'data-list-action': 'favorite',
      'aria-pressed': String(saved),
      'aria-label': saved ? 'Remove from saved jokes' : 'Save this joke',
      title: saved ? 'Remove from saved' : 'Save',
      text: saved ? '♥' : '♡',
    });
    const copyButton = el('button', {
      type: 'button',
      class: 'icon-action',
      'data-list-action': 'copy',
      'aria-label': 'Copy this joke',
      title: 'Copy',
      text: '⧉',
    });

    const item = el('li', { class: 'joke-list__item', dataset: { jokeId: joke.id } }, [
      text,
      el('footer', { class: 'joke-list__footer' }, [
        el('span', { class: 'joke-list__cat', text: joke.categoryName ?? '' }),
        el('div', { class: 'joke-list__actions' }, [copyButton, favButton]),
      ]),
    ]);
    item.joke = joke;
    fragment.append(item);
  }

  list.append(fragment);
}

let toastTimer = null;

/** Show a transient status message at the bottom of the screen. */
export function toast(node, message, duration = 2600) {
  if (!node) return;
  node.textContent = message;
  setHidden(node, false);
  node.dataset.show = 'true';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.dataset.show = 'false';
    setHidden(node, true);
    toastTimer = null;
  }, duration);
}

/** Announce a message through an aria-live region, restarting the animation. */
export function announce(node, message) {
  if (!node) return;
  node.textContent = message;
  node.dataset.pop = 'false';
  // Force a reflow so the animation replays for consecutive announcements.
  void node.offsetWidth;
  node.dataset.pop = 'true';
}

/** Populate a `<select>` with the dataset categories. */
export function fillCategorySelect(select, categories) {
  if (!select) return;
  const current = select.value;
  select.replaceChildren(el('option', { value: '', text: 'All categories' }));
  for (const category of categories) {
    select.append(
      el('option', { value: category.id, text: `${category.name} (${formatNumber(category.count)})` }),
    );
  }
  select.value = current;
}
