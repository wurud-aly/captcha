/**
 * Admin dashboard controller: session, draft state, routing, save/undo/discard.
 */
import { initAdminLanguage, toggleAdminLanguage, applyAdminLanguage } from '../static/admin-i18n.js';
import { api, initSession, ApiError } from './api.js';
import { Draft } from './draft.js';
import { LivePreview } from './preview.js';
import { LetterDatabase } from '../../src/scripts/letter-database.js';
import { WordDatabase } from '../../src/scripts/word-database.js';
import { h, t, toast, confirmDialog } from './ui.js';
import { renderLetters } from './views/letters.js';
import { renderWords } from './views/words.js';
import { renderLayout } from './views/layout.js';
import { renderCaptcha } from './views/captcha.js';
import { renderHistory } from './views/history.js';

const VIEWS = { letters: renderLetters, words: renderWords, layout: renderLayout, preview: renderCaptcha, history: renderHistory };
const $ = (id) => document.getElementById(id);

initAdminLanguage();

async function main() {
  await initSession();
  const data = await api('GET', 'data');
  const draft = new Draft(data);
  const preview = new LivePreview(() => draft.get(), draft.images);
  const savedPreview = new LivePreview(() => draft.saved);
  await Promise.all([preview.init(), savedPreview.init()]);

  const ctx = {
    draft,
    preview,
    savedPreview,
    publish: data.publish,
    viewState: {},
    previewHooks: [],
    onPreview(fn) {
      this.previewHooks.push(fn);
    },
    rerender: () => renderView(),
    reload,
    showError,
  };

  /* ---------------- routing ---------------- */
  function route() {
    const [view, param] = (location.hash.replace(/^#/, '') || 'letters').split('/');
    return { view: VIEWS[view] ? view : 'letters', param: param ? decodeURIComponent(param) : null };
  }
  function renderView() {
    const { view, param } = route();
    ctx.previewHooks = [];
    document.querySelectorAll('.adm-nav__link').forEach((a) => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
    const root = $('view');
    try {
      VIEWS[view](root, ctx, param);
    } catch (e) {
      console.error(e);
      root.replaceChildren(h('p', { class: 'status status--error' }, e.message));
    }
  }
  window.addEventListener('hashchange', renderView);

  /* ---------------- draft changes ---------------- */
  let validateTimer = 0;
  draft.subscribe(async (info) => {
    updateHeader();
    clearTimeout(validateTimer);
    validateTimer = setTimeout(updateIssues, 150);
    await preview.sync();
    if (info.structural) renderView();
    else ctx.previewHooks.forEach((fn) => fn());
  });

  function updateHeader() {
    const n = draft.changes().length;
    $('dirty-state').textContent = n ? t('dirty', { n }) : t('clean');
    $('dirty-state').classList.toggle('is-dirty', n > 0);
    $('undo-btn').disabled = !draft.canUndo();
    $('redo-btn').disabled = !draft.canRedo();
    $('discard-btn').disabled = n === 0;
    $('save-btn').disabled = n === 0 || currentIssues.length > 0 || saving;
  }

  let currentIssues = [];
  function updateIssues() {
    const s = draft.get();
    let problems = [];
    try {
      const letters = new LetterDatabase(s.letters);
      problems = [...letters.validate(), ...new WordDatabase(s.words, letters).validate()];
    } catch (e) {
      problems = [e.message];
    }
    currentIssues = problems;
    const box = $('issues');
    box.hidden = problems.length === 0;
    box.replaceChildren(h('strong', {}, t('issues')), h('ul', {}, problems.map((p) => h('li', { dir: 'ltr' }, p))));
    updateHeader();
  }

  /* ---------------- save / undo / discard ---------------- */
  let saving = false;
  async function save() {
    if (saving || !draft.isDirty()) return;
    saving = true;
    $('save-btn').textContent = t('saving');
    updateHeader();
    try {
      await api('POST', 'save', draft.payload());
      await reload();
      toast(`${t('saved')} ${data.publish.configured ? t('savedPublishHint') : ''}`, 'success', 6000);
    } catch (e) {
      showError(e);
    } finally {
      saving = false;
      $('save-btn').textContent = t('save');
      updateHeader();
    }
  }

  async function reload() {
    const fresh = await api('GET', 'data');
    draft.reset(fresh); // emits a structural change -> preview sync + render
    await savedPreview.sync();
    await preview.sync();
    renderView();
  }

  function showError(e) {
    if (e instanceof ApiError) {
      if (e.code === 'version_conflict') return toast(t('err_version_conflict'), 'error', 9000);
      if (e.code === 'unauthenticated') return toast(t('err_unauthenticated'), 'error');
      return toast(t('err_generic', { msg: e.message }), 'error', 9000);
    }
    toast(t('err_generic', { msg: e.message || String(e) }), 'error', 9000);
  }

  $('save-btn').addEventListener('click', save);
  $('undo-btn').addEventListener('click', () => draft.undo());
  $('redo-btn').addEventListener('click', () => draft.redo());
  $('discard-btn').addEventListener('click', async () => {
    if (await confirmDialog(t('discardConfirmTitle'), t('discardConfirmBody'))) draft.discard();
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // keep native text undo
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      draft.undo();
    } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
      e.preventDefault();
      draft.redo();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('save-btn').disabled) save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (draft.isDirty()) {
      e.preventDefault();
      e.returnValue = t('leaveWarning');
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    if (draft.isDirty() && !(await confirmDialog(t('discardConfirmTitle'), t('leaveWarning')))) return;
    await api('POST', 'logout').catch(() => {});
    draft.reset(draft.saved && { ...draft.saved, version: draft.version }); // avoid the unload prompt
    location.replace('/admin/login');
  });
  $('lang-btn').addEventListener('click', () => {
    toggleAdminLanguage();
    updateHeader();
    updateIssues();
    renderView();
  });

  applyAdminLanguage();
  updateHeader();
  updateIssues();
  renderView();
  document.documentElement.dataset.ready = 'true';
}

main().catch((e) => {
  console.error(e);
  if (!(e instanceof ApiError && e.status === 401)) $('view').replaceChildren(h('p', { class: 'status status--error' }, e.message));
});
