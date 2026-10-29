// 👑 The People room (Owner only), shared by owner/people.html and the Owner's map home (owner/index.html, in a window): the Coordinators on
// the allowlist from the game backend (peoplelist). Add one, or change one's school and functions, or remove one (peoplecoordinator, POST,
// behind a confirm). The server checks the Owner again on every call. Every string reaches the DOM as a text node (LMCSGame.ui.h).
//   LMCSPeople.mount(root, { session, backendUrl, inline })   inline: the steps replace the list inside root (a window has no room for a
//   second modal); otherwise each step is its own <dialog> sheet, as on the People page.
var LMCSPeople = window.LMCSPeople = (function () {
  function place(c) { return c === 'ALL' ? 'All schools' : String(c || '').replace(/^LMS(\d)$/, 'LMS $1') || 'No school set'; }
  function fnText(f) { return (f || []).length ? f.join(', ') : 'No functions'; }

  function mount(root, opts) {
    const h = function (tag, attrs, kids) { return LMCSGame.ui.h(tag, attrs, kids); };
    const SESSION = opts.session, URL_ = opts.backendUrl;
    let DATA = null, BUSY = false;
    const statusEl = h('p', { id: 'pp-status', class: 'gb-muted', role: 'status' }, []), ul = h('ul', { class: 'gb-list', id: 'pp-list' }, []);
    const add = h('button', { type: 'button', class: 'gb-btn gb-btn-primary', id: 'pp-add', hidden: 'hidden' }, ['Add a Coordinator']);
    const main = h('section', { class: 'gb-section', 'aria-labelledby': 'pp-h' }, [h('h2', { class: 'gb-h2', id: 'pp-h' }, ['Coordinators']), ul,
      h('div', { class: 'pp-acts' }, [add]),
      h('p', { class: 'gb-muted', id: 'pp-note' }, ['A change reaches their sign-in within about 10 minutes. Someone who also holds another role (Principal, Accounts, ...) is changed in the allowlist sheet.'])]);
    const step = h('div', { class: 'pp-step', hidden: 'hidden' }, []);
    root.textContent = ''; root.appendChild(statusEl); root.appendChild(main); root.appendChild(step);
    const status = function (t) { statusEl.textContent = t; };

    function render() {
      ul.textContent = '';
      add.hidden = !DATA.canEdit;
      if (!DATA.coordinators.length) ul.appendChild(h('li', { class: 'gb-card' }, ['No Coordinators on the allowlist yet.']));
      DATA.coordinators.forEach(function (p) {
        const acts = DATA.canEdit && p.editable ? h('div', { class: 'pp-acts' }, [
          h('button', { type: 'button', class: 'gb-btn', onclick: function (e) { edit(p, e.currentTarget); } }, ['Change']),
          h('button', { type: 'button', class: 'gb-btn gb-btn-danger', onclick: function (e) { remove(p, e.currentTarget); } }, ['Remove'])]) : null;
        ul.appendChild(h('li', { class: 'gb-card pp-row' }, [h('b', {}, [p.name || p.email]), h('small', {}, [p.email]),
          h('small', {}, [place(p.campus) + ' · ' + fnText(p.functions)]), p.editable ? null : h('small', { class: 'gb-muted' }, ['Also holds another role: change in the allowlist sheet']), acts]));
      });
    }
    function load() {
      status('Loading…');
      return fetch(URL_ + '?action=peoplelist&idToken=' + encodeURIComponent(SESSION.idToken || ''), { cache: 'no-store' })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.success) throw new Error((d && d.error) || '');
          DATA = d; status(''); render();
        }).catch(function (e) { status((e && e.message) || "Couldn't load the People room. Check the connection, then try again."); });
    }

    // one step at a time: fill in, Next shows the plain sentence, Confirm posts. Esc / Cancel close it (not while sending).
    function sheet(title, body, opener) {
      if (opts.inline) { // inside a window: the step takes the list's place; Cancel brings the list back
        step.textContent = ''; step.hidden = false; main.hidden = true;
        const box = h('div', { class: 'pp-dlg pp-inline' }, [h('h2', { class: 'gb-h2', id: 'pp-dh', tabindex: '-1' }, [title])].concat(body));
        step.appendChild(box);
        // Esc closes the step, not the window: heard on window (capture) before the window's own trap on document
        const esc = function (e) { if (e.key === 'Escape' && !step.hidden) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
        const close = function () { if (BUSY) return; window.removeEventListener('keydown', esc, true); step.hidden = true; step.textContent = ''; main.hidden = false; if (opener && opener.isConnected) opener.focus(); };
        window.addEventListener('keydown', esc, true);
        return { dlg: box, close: close };
      }
      const dlg = h('dialog', { class: 'pp-dlg', 'aria-labelledby': 'pp-dh' }, [h('h2', { class: 'gb-h2', id: 'pp-dh' }, [title])].concat(body));
      const close = function () { if (BUSY) return; release(opener && opener.isConnected ? opener : null); dlg.close(); dlg.remove(); };
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      document.body.appendChild(dlg); dlg.showModal();
      const release = LMCSGame.ui.trap(dlg, close);
      return { dlg: dlg, close: close };
    }
    function confirmStep(s, text, body) {
      const err = h('p', { class: 'gb-field-err', role: 'alert' }, []);
      const go = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Confirm']);
      const back = h('button', { type: 'button', class: 'gb-btn', onclick: s.close }, ['Cancel']);
      const box = h('div', {}, [h('p', {}, [text]), err, h('div', { class: 'pp-acts' }, [go, back])]);
      [].slice.call(s.dlg.children, 1).forEach(function (n) { n.remove(); });
      s.dlg.appendChild(box); go.focus();
      go.onclick = function () {
        if (BUSY) return;
        BUSY = true; go.disabled = back.disabled = true; go.textContent = 'Sending…';
        fetch(URL_, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'peoplecoordinator', idToken: SESSION.idToken }, body)) })
          .then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.success) { const e = new Error((d && d.error) || ''); e.server = true; throw e; }
            BUSY = false; s.close();
            status(body.remove ? 'Removed.' : d.unchanged ? 'Nothing to change.' : 'Saved. It reaches their sign-in within about 10 minutes.');
            return load();
          }).catch(function (e) {
            BUSY = false; go.disabled = back.disabled = false; go.textContent = 'Confirm';
            err.textContent = e && e.server && e.message ? e.message : "That didn't go through. Nothing was changed. Please try again.";
          });
      };
    }
    // p = null: add a new Coordinator
    function edit(p, opener) {
      const s = sheet(p ? 'Change ' + (p.name || p.email) : 'Add a Coordinator', [], opener);
      const field = function (id, label, input) { return h('div', { class: 'gb-field' }, [h('label', { for: id }, [label]), input]); };
      const name = h('input', { id: 'pp-name', class: 'gb-input', type: 'text', maxlength: '80', autocomplete: 'off' });
      const email = h('input', { id: 'pp-email', class: 'gb-input', type: 'email', maxlength: '254', autocomplete: 'off' });
      // a campus the room doesn't offer (blank, or a list like "LMS1, LMS2" typed in the sheet): start on "Choose a school"
      const known = !!p && DATA.campuses.indexOf(p.campus) !== -1;
      const campus = h('select', { id: 'pp-campus', class: 'gb-input' }, [known ? null : h('option', { value: '', selected: true }, ['Choose a school'])].concat(
        DATA.campuses.map(function (c) { return h('option', { value: c, selected: known && p.campus === c ? true : null }, [place(c)]); })));
      const fns = h('fieldset', { class: 'pp-fns' }, [h('legend', {}, ['Looks after'])].concat(DATA.functions.map(function (f, i) {
        return h('label', { for: 'pp-f' + i }, [h('input', { type: 'checkbox', id: 'pp-f' + i, value: f, checked: p && p.functions.indexOf(f) !== -1 ? true : null }), f]);
      })));
      const err = h('p', { class: 'gb-field-err', role: 'alert' }, []);
      const next = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Next']);
      s.dlg.appendChild(h('div', {}, [p ? null : field('pp-name', 'Name', name), p ? null : field('pp-email', 'Email', email),
        field('pp-campus', 'School', campus), DATA.hasFunctions ? fns : h('p', { class: 'gb-muted' }, ['The allowlist has no Functions column yet, so only the school can be set.']),
        err, h('div', { class: 'pp-acts' }, [next, h('button', { type: 'button', class: 'gb-btn', onclick: s.close }, ['Cancel'])])]));
      (p ? campus : name).focus();
      next.onclick = function () {
        const picked = [].filter.call(fns.querySelectorAll('input:checked'), function () { return true; }).map(function (x) { return x.value; });
        const who = p ? p.email : email.value.trim().toLowerCase(), nm = p ? p.name : name.value.trim();
        if (!p && !nm) { err.textContent = 'Add their name.'; name.focus(); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)) { err.textContent = 'That email does not look right.'; email.focus(); return; }
        if (DATA.campuses.indexOf(campus.value) === -1) { err.textContent = 'Choose a school.'; campus.focus(); return; }
        const text = (p ? 'Change ' + (nm || who) + ' to ' : 'Add ' + nm + ' (' + who + ') as a Coordinator for ') + place(campus.value) + ', looking after ' + (picked.length ? picked.join(', ') : 'no functions') + '?';
        confirmStep(s, text, { email: who, name: p ? undefined : nm, campus: campus.value, functions: picked });
      };
    }
    function remove(p, opener) {
      const s = sheet('Remove ' + (p.name || p.email), [], opener);
      confirmStep(s, 'Remove ' + (p.name || p.email) + ' as a Coordinator? Their allowlist row goes, so they lose Coordinator access within about 10 minutes.', { email: p.email, remove: true });
    }
    add.addEventListener('click', function (e) { edit(null, e.currentTarget); });
    return load();
  }
  return { mount: mount, place: place, fnText: fnText };
})();
