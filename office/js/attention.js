// "Needs attention" panel: entries the backend refused, with a plain-words reason, Retry and Discard.
// Pure helpers (describeEntry, explainCode) first; the panel is text-only DOM (dom.js h()).
import { h, setKids } from './dom.js';
import { formatInr, isoToDmy } from './format.js';
import { inflightGuard } from './daybook.js';
import { CODES, explainCode, entryReason } from './codes.js';

export { CODES, explainCode, entryReason };

const date = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? isoToDmy(d) : '');
const money = (p) => (Number.isFinite(p) ? formatInr(p) : '');
const join = (...p) => p.filter(Boolean).join(' ');
export function describeEntry(e) {
  const d = (e && e.data) || {};
  switch (e && e.action) {
    case 'daybook.add': return join('Day book entry', money(d.amount_paise), d.entry_date && 'on ' + date(d.entry_date));
    case 'daybook.reverse': return 'Reversal of a day book entry';
    case 'deposit.add': return join('Deposit', money(d.amount_paise));
    case 'deposit.sign': return 'Deposit signature';
    case 'report.submit': return join('Daily report', date(d.report_date));
    case 'file.upload': return 'Slip upload';
    case 'day.close': return join('Day close', date(d.close_date));
    case 'opening.set': return 'Opening balances';
    case 'erp.set': return join('ERP total', money(d.amount_paise), d.total_date && 'for ' + date(d.total_date));
    default: return String((e && e.action) || 'Unknown entry');
  }
}

// Another user's queued entry: who it waits for, and why it was refused if it was.
export const waitingFor = (e) => 'Waiting for ' + (e.owner || 'another user') + ' to sign in on this device' + (e.status === 'attention' ? '. Needs attention: ' + entryReason(e) : '.');

// Panel: open() shows it, refresh() redraws if open. Lists the signed-in user's attention entries (Retry, Discard)
// and, without buttons, entries another user queued on this device: they wait for that person to sign in (R38).
export function createAttentionPanel(outbox) {
  const guard = inflightGuard();
  const list = h('div', {});
  const panel = h('section', { id: 'attention-panel', class: 'office-form block', 'aria-label': 'Needs attention', hidden: true },
    h('h2', {}, 'Needs attention'), list,
    h('button', { type: 'button', class: 'secondary', onclick: () => { panel.hidden = true; } }, 'Close'));
  async function refresh() {
    if (panel.hidden) return;
    const es = await outbox.attention();
    const others = outbox.others ? await outbox.others() : [];
    if (!es.length && !others.length) { panel.hidden = true; return; }
    const own = es.map((e) => {
      const retry = h('button', { type: 'button', onclick: () => guard('retry:' + e.id, async () => { retry.disabled = discard.disabled = true; await outbox.retry(e.id).catch(() => {}); await refresh(); }) }, 'Retry');
      const discard = h('button', { type: 'button', class: 'secondary', onclick: () => guard('discard:' + e.id, async () => {
        if (!confirm('Discard "' + describeEntry(e) + '"? It will be deleted from this device and never sent.')) return;
        retry.disabled = discard.disabled = true;
        await outbox.discard(e.id); await refresh();
      }) }, 'Discard');
      return h('li', {}, h('div', {}, describeEntry(e)), h('div', { class: 'flag bad' }, entryReason(e)), h('div', { class: 'row' }, retry, discard));
    });
    const theirs = others.map((e) => h('li', {}, h('div', {}, describeEntry(e)), h('div', { class: e.status === 'attention' ? 'flag bad' : 'flag' }, waitingFor(e))));
    setKids(list, h('ul', { class: 'office-list' }, own.concat(theirs)));
  }
  return { el: panel, refresh, open: async () => { panel.hidden = false; await refresh(); panel.scrollIntoView && panel.scrollIntoView(); } };
}
