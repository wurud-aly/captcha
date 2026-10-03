/**
 * Loads the JSON configuration with paths relative to the page, so the app
 * works from a domain root and from a GitHub Pages sub-path alike.
 */
export const DATA_FILES = {
  letters: 'src/data/letters.json',
  words: 'src/data/words.json',
  composition: 'src/data/composition.json',
};

export async function loadJSON(path, base = document.baseURI) {
  const url = new URL(path, base);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json();
}

export async function loadAllData(base = document.baseURI) {
  const [letters, words, composition] = await Promise.all([
    loadJSON(DATA_FILES.letters, base),
    loadJSON(DATA_FILES.words, base),
    loadJSON(DATA_FILES.composition, base),
  ]);
  return { letters, words, composition };
}
