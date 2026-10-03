/** History & publish: backups, restore, GitHub publishing, password change. */
import { api, ApiError } from '../api.js';
import { h, t, toast, confirmDialog, section } from '../ui.js';

export function renderHistory(root, ctx) {
  const list = h('ul', { class: 'adm-backups', id: 'backup-list' }, h('li', { class: 'adm-muted' }, '…'));

  async function loadBackups() {
    try {
      const { backups } = await api('GET', 'backups');
      if (!backups.length) return list.replaceChildren(h('li', { class: 'adm-muted' }, t('noBackups')));
      list.replaceChildren(
        ...backups.map((b) => {
          const btn = h('button', { type: 'button', class: 'btn btn--small', dataset: { backup: b.id } }, t('restore'));
          btn.addEventListener('click', async () => {
            if (ctx.draft.isDirty()) return toast(t('restoreDirty'), 'error');
            if (!(await confirmDialog(t('restoreTitle'), t('restoreBody'), h('p', { dir: 'ltr' }, b.id)))) return;
            try {
              await api('POST', 'backups/restore', { id: b.id });
              await ctx.reload();
              toast(t('restored'), 'success');
              loadBackups();
            } catch (e) {
              ctx.showError(e);
            }
          });
          return h(
            'li',
            { class: 'adm-backup' },
            h('div', {}, h('strong', { dir: 'ltr' }, new Date(b.createdAt).toLocaleString(document.documentElement.lang === 'ar' ? 'ar' : 'en')), h('p', { class: 'adm-muted' }, t('backupMeta', { n: b.samples, words: b.words.join('، ') }))),
            btn,
          );
        }),
      );
    } catch (e) {
      ctx.showError(e);
    }
  }

  /* publishing */
  const pub = ctx.publish;
  const pubStatus = h('p', { class: 'status', id: 'publish-status', role: 'status', 'aria-live': 'polite' });
  const publishCard = pub.configured
    ? (() => {
        const btn = h('button', { type: 'button', class: 'btn btn--primary', id: 'publish-btn' }, t('publish'));
        btn.addEventListener('click', async () => {
          if (ctx.draft.isDirty()) return toast(t('publishDirty'), 'error');
          btn.disabled = true;
          btn.textContent = t('publishing');
          try {
            const r = await api('POST', 'publish');
            pubStatus.className = 'status status--success';
            pubStatus.textContent = r.committed ? t('publishedFiles', { n: r.files.length, sha: r.commit.slice(0, 7) }) : t('publishNoop');
          } catch (e) {
            pubStatus.className = 'status status--error';
            pubStatus.textContent = e.message;
          } finally {
            btn.disabled = false;
            btn.textContent = t('publish');
          }
        });
        return [h('p', {}, t('publishConfigured', { repo: pub.repo, branch: pub.branch })), btn, pubStatus];
      })()
    : [
        h('p', {}, t('publishManual')),
        h('pre', { class: 'adm-code', dir: 'ltr' }, 'git add src/data public/assets/handwritten\ngit commit -m "Update CAPTCHA data"\ngit push'),
      ];

  /* password */
  const cur = h('input', { class: 'adm-input', type: 'password', id: 'pw-current', autocomplete: 'current-password', dir: 'ltr' });
  const next = h('input', { class: 'adm-input', type: 'password', id: 'pw-next', autocomplete: 'new-password', minlength: 12, dir: 'ltr' });
  const again = h('input', { class: 'adm-input', type: 'password', id: 'pw-again', autocomplete: 'new-password', dir: 'ltr' });
  const pwStatus = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const pwForm = h(
    'form',
    { class: 'adm-stack', novalidate: true },
    h('label', { class: 'field', for: 'pw-current' }, h('span', {}, t('currentPassword')), cur),
    h('label', { class: 'field', for: 'pw-next' }, h('span', {}, t('newPassword')), next),
    h('label', { class: 'field', for: 'pw-again' }, h('span', {}, t('repeatPassword')), again),
    h('div', { class: 'adm-row' }, h('button', { type: 'submit', class: 'btn' }, t('changePassword'))),
    pwStatus,
  );
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (next.value !== again.value) {
      pwStatus.className = 'status status--error';
      pwStatus.textContent = t('passwordMismatch');
      return;
    }
    try {
      await api('POST', 'password', { current: cur.value, next: next.value });
      toast(t('passwordChanged'), 'success');
      setTimeout(() => location.replace('/admin/login'), 1200);
    } catch (err) {
      pwStatus.className = 'status status--error';
      pwStatus.textContent =
        err instanceof ApiError && err.code === 'weak_password'
          ? t('err_weak_password', { msg: err.message })
          : err instanceof ApiError && ['invalid_credentials', 'managed_by_env'].includes(err.code)
            ? t(`err_${err.code}`)
            : err.message;
    } finally {
      cur.value = next.value = again.value = '';
    }
  });

  root.replaceChildren(
    h('div', { class: 'adm-head' }, h('div', {}, h('h1', { class: 'adm-h1' }, t('historyTitle')))),
    h(
      'div',
      { class: 'adm-two' },
      section(t('backups'), t('backupsIntro'), list),
      h('div', { class: 'adm-stack' }, section(t('publishTitle'), t('publishIntro'), ...publishCard), section(t('account'), null, pwForm)),
    ),
  );
  loadBackups();
}
