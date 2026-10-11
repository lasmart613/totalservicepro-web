/**
 * Total Service Pro — active-org switcher for Android WebView HTML.
 * Reads organization_memberships. Switch and leave go through /api/org/switch and /api/org/leave.
 * Jobs stay scoped to user_profiles.organization_id (the active shop).
 */
(function () {
  'use strict';

  function client() {
    return window.supabaseClient || window.supabase || null;
  }

  function el(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roleLabel(role) {
    const r = String(role || '').toLowerCase();
    const map = {
      fse: 'FSE',
      engineer: 'FSE',
      company_admin: 'Admin',
      admin: 'Admin',
      owner: 'Owner',
      dispatcher: 'Dispatcher',
    };
    return map[r] || r.replace(/_/g, ' ') || 'Member';
  }

  async function loadMemberships() {
    const sb = client();
    if (!sb) return { memberships: [], activeId: null };
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return { memberships: [], activeId: null };

    const { data: profile } = await sb
      .from('user_profiles')
      .select('organization_id, active_organization_id, role')
      .eq('id', uid)
      .maybeSingle();
    const activeId = profile?.active_organization_id || profile?.organization_id || null;

    const { data: rows, error } = await sb
      .from('organization_memberships')
      .select('organization_id, role, is_home, organizations(name)')
      .eq('user_id', uid);
    if (error) {
      console.warn('org-switcher memberships', error.message);
      return { memberships: [], activeId };
    }
    const memberships = (rows || []).map(function (row) {
      return {
        organizationId: row.organization_id,
        name: (row.organizations && row.organizations.name) || ('Company ' + row.organization_id),
        role: row.role,
        isHome: !!row.is_home,
        isActive: String(row.organization_id) === String(activeId),
      };
    });
    return { memberships: memberships, activeId: activeId };
  }

  function apiOrigin() {
    try {
      if (location.protocol === 'https:' || location.protocol === 'http:') return location.origin;
    } catch (e) {}
    return 'https://repairplanet.net';
  }

  async function postOrg(path, organizationId) {
    const sb = client();
    if (!sb) throw new Error('Not signed in');
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData && sessionData.session && sessionData.session.access_token;
    if (!token) throw new Error('Not signed in');
    let filePage = false;
    try { filePage = location.protocol === 'file:'; } catch (e) {}
    if (filePage && typeof Android !== 'undefined' && Android.postOrgApi) {
      let json = {};
      try {
        json = JSON.parse(Android.postOrgApi(path, String(organizationId), token) || '{}');
      } catch (e) {
        throw new Error('Could not update this company');
      }
      if (!json || json.ok === false) {
        throw new Error((json && json.error) || 'Could not update this company');
      }
      return json;
    }
    const res = await fetch(apiOrigin() + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ organizationId: organizationId }),
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || 'Could not update this company');
    }
    return json;
  }

  async function switchOrg(organizationId) {
    await postOrg('/api/org/switch', organizationId);
  }

  async function leaveOrg(organizationId) {
    await postOrg('/api/org/leave', organizationId);
  }

  function render(mount, state) {
    if (!mount) return;
    const memberships = state.memberships || [];
    if (!memberships.length) {
      mount.innerHTML = '';
      return;
    }
    const active = memberships.filter(function (m) { return m.isActive; })[0] || memberships[0];
    const options = memberships.map(function (m) {
      return (
        '<option value="' + esc(m.organizationId) + '"' + (m.isActive ? ' selected' : '') + '>' +
        esc(m.name || 'Company') +
        ' — ' + esc(roleLabel(m.role)) +
        (m.isHome ? ' (home)' : '') +
        '</option>'
      );
    }).join('');

    mount.innerHTML =
      '<div class="tsp-org-switcher" style="margin:8px 0 12px;padding:10px 12px;border-radius:10px;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.35);">' +
        '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b95a5;margin-bottom:6px;">Working as</div>' +
        '<select id="tspOrgSelect" style="width:100%;padding:8px;border-radius:8px;background:#161c24;color:#e8edf4;border:1px solid #243040;">' +
          options +
        '</select>' +
        '<div style="font-size:11px;color:#8b95a5;margin-top:6px;">Jobs stay in this shop. Switch to moonlight or home without mixing queues.</div>' +
        (memberships.length > 1
          ? '<button type="button" id="tspOrgLeave" style="margin-top:8px;font-size:12px;background:transparent;border:0;color:#f87171;padding:0;">Leave ' + esc(active.name || 'this shop') + '</button>'
          : '') +
      '</div>';

    const select = mount.querySelector('#tspOrgSelect');
    if (select) {
      select.addEventListener('change', async function () {
        try {
          await switchOrg(select.value);
          if (typeof Android !== 'undefined' && Android.showToast) {
            Android.showToast('Switched company');
          }
          window.location.reload();
        } catch (e) {
          alert((e && e.message) || 'Could not switch company');
        }
      });
    }
    const leaveBtn = mount.querySelector('#tspOrgLeave');
    if (leaveBtn && active) {
      leaveBtn.addEventListener('click', async function () {
        if (!confirm('Leave ' + active.name + '? Your login stays. You will lose this shop\'s jobs.')) return;
        try {
          await leaveOrg(active.organizationId);
          window.location.reload();
        } catch (e) {
          alert((e && e.message) || 'Could not leave');
        }
      });
    }
  }

  async function mountSwitcher() {
    let mount = document.getElementById('orgSwitcherMount');
    if (!mount) {
      const greeting = document.querySelector('.greeting') || document.querySelector('.section');
      if (greeting) {
        mount = document.createElement('div');
        mount.id = 'orgSwitcherMount';
        greeting.parentNode.insertBefore(mount, greeting.nextSibling);
      }
    }
    if (!mount) return;
    try {
      const state = await loadMemberships();
      render(mount, state);
    } catch (e) {
      console.warn('org-switcher', e);
    }
  }

  window.tspOrgSwitcher = {
    loadMemberships: loadMemberships,
    switchOrg: switchOrg,
    leaveOrg: leaveOrg,
    mount: mountSwitcher,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(mountSwitcher, 400);
    });
  } else {
    setTimeout(mountSwitcher, 400);
  }
})();
