/**
 * Total Service Pro — active-org switcher for Android WebView HTML.
 * Uses the same organization_memberships + RPCs as the website.
 * Jobs stay scoped to user_profiles.organization_id (the active shop).
 *
 * Pending team invites: same product as web OrgSwitcher.
 *   - http(s) site origin → GET /api/org/memberships + POST /api/team/claim
 *   - file:// (Supabase only) → engineer_invitations + accept_team_invite RPC
 * Join (keep home) vs Join & leave {shop}. Founder/home shop cannot be stripped.
 */
(function () {
  'use strict';

  function client() {
    return window.supabaseClient || window.supabase || null;
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

  /** http(s) page origin — not file:// or android_asset. */
  function siteOrigin() {
    try {
      const loc = window.location;
      if (!loc) return null;
      const proto = String(loc.protocol || '').toLowerCase();
      if (proto !== 'http:' && proto !== 'https:') return null;
      const href = String(loc.href || '');
      if (/^file:|android_asset/i.test(href)) return null;
      if (!loc.origin || loc.origin === 'null') return null;
      return loc.origin;
    } catch (e) {
      return null;
    }
  }

  async function accessToken(sb) {
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  }

  function mapMemberships(rows, activeId) {
    return (rows || []).map(function (row) {
      return {
        organizationId: row.organization_id,
        name: (row.organizations && row.organizations.name) || ('Company ' + row.organization_id),
        role: row.role,
        isHome: !!row.is_home,
        isActive: String(row.organization_id) === String(activeId),
      };
    });
  }

  function mapPendingInvites(invites, memberships) {
    const memberOrgIds = {};
    (memberships || []).forEach(function (m) {
      memberOrgIds[String(m.organizationId)] = true;
    });
    return (invites || [])
      .filter(function (inv) {
        return inv && inv.organization_id != null && !memberOrgIds[String(inv.organization_id)];
      })
      .map(function (inv) {
        return {
          id: inv.id,
          organizationId: inv.organization_id,
          name: (inv.organizations && inv.organizations.name) || ('Company ' + inv.organization_id),
          role: inv.role || 'fse',
          createdAt: inv.created_at,
        };
      });
  }

  /** Non-home shops only — founder/home cannot be stripped by an invite. */
  function leaveCandidates(memberships) {
    return (memberships || []).filter(function (m) {
      return !m.isHome;
    });
  }

  async function loadViaHttp(origin, token) {
    const res = await fetch(origin + '/api/org/memberships', {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || 'Could not load companies');
    return {
      memberships: json.memberships || [],
      pendingInvites: json.pendingInvites || [],
      activeId: json.activeOrganizationId || null,
    };
  }

  async function loadPendingFromSupabase(sb, email, memberships) {
    const clean = String(email || '').toLowerCase().trim();
    if (!clean) return [];
    const { data: invites, error } = await sb
      .from('engineer_invitations')
      .select('id, organization_id, role, first_name, last_name, created_at, accepted, organizations(name)')
      .eq('email', clean)
      .eq('accepted', false)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn('org-switcher invites', error.message);
      return [];
    }
    return mapPendingInvites(invites, memberships);
  }

  async function loadMemberships() {
    const sb = client();
    if (!sb) return { memberships: [], pendingInvites: [], activeId: null };

    const origin = siteOrigin();
    const token = await accessToken(sb);
    if (origin && token) {
      try {
        return await loadViaHttp(origin, token);
      } catch (e) {
        console.warn('org-switcher memberships API', e && e.message);
      }
    }

    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData && sessionData.session && sessionData.session.user && sessionData.session.user.id;
    if (!uid) return { memberships: [], pendingInvites: [], activeId: null };

    const { data: profile } = await sb
      .from('user_profiles')
      .select('organization_id, active_organization_id, role, email')
      .eq('id', uid)
      .maybeSingle();
    const activeId = (profile && (profile.active_organization_id || profile.organization_id)) || null;
    const email = (
      (profile && profile.email) ||
      (sessionData.session.user && sessionData.session.user.email) ||
      ''
    ).toLowerCase().trim();

    const { data: rows, error } = await sb
      .from('organization_memberships')
      .select('organization_id, role, is_home, organizations(name)')
      .eq('user_id', uid);
    if (error) {
      console.warn('org-switcher memberships', error.message);
      return { memberships: [], pendingInvites: [], activeId: activeId };
    }
    const memberships = mapMemberships(rows, activeId);
    const pendingInvites = await loadPendingFromSupabase(sb, email, memberships);
    return { memberships: memberships, pendingInvites: pendingInvites, activeId: activeId };
  }

  async function switchOrg(organizationId) {
    const sb = client();
    if (!sb) throw new Error('Not signed in');
    const { error } = await sb.rpc('switch_active_organization', {
      p_organization_id: Number(organizationId),
    });
    if (error) throw error;
  }

  async function leaveOrg(organizationId) {
    const sb = client();
    if (!sb) throw new Error('Not signed in');
    const { error } = await sb.rpc('leave_organization', {
      p_organization_id: Number(organizationId),
    });
    if (error) throw error;
  }

  async function acceptInviteHttp(origin, token, inviteId, leaveOrganizationId) {
    const body = { inviteId: Number(inviteId) };
    if (leaveOrganizationId != null && leaveOrganizationId !== '') {
      body.leaveOrganizationId = leaveOrganizationId;
    }
    const res = await fetch(origin + '/api/team/claim', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || 'Could not accept invite');
    return json;
  }

  async function acceptInviteRpc(sb, inviteId, leaveOrganizationId) {
    const params = { p_invite_id: Number(inviteId) };
    if (leaveOrganizationId != null && leaveOrganizationId !== '') {
      params.p_leave_organization_id = Number(leaveOrganizationId);
    }
    const { error } = await sb.rpc('accept_team_invite', params);
    if (error) throw error;
  }

  async function acceptInvite(inviteId, leaveOrganizationId) {
    const sb = client();
    if (!sb) throw new Error('Not signed in');
    const origin = siteOrigin();
    const token = await accessToken(sb);
    if (origin && token) {
      return acceptInviteHttp(origin, token, inviteId, leaveOrganizationId);
    }
    return acceptInviteRpc(sb, inviteId, leaveOrganizationId);
  }

  function toast(msg) {
    if (typeof Android !== 'undefined' && Android.showToast) {
      Android.showToast(msg);
      return;
    }
    const t = document.getElementById('toast');
    if (t) {
      t.textContent = msg;
      t.className = 'toast show';
      setTimeout(function () { t.classList.remove('show'); }, 3000);
    }
  }

  function pendingInvitesHtml(pending, memberships) {
    if (!pending.length) return '';
    const leavers = leaveCandidates(memberships);
    const cards = pending.map(function (inv) {
      const leaveBtns = leavers.map(function (m) {
        return (
          '<button type="button" class="tspOrgJoinLeave" data-invite-id="' + esc(inv.id) +
          '" data-leave-id="' + esc(m.organizationId) +
          '" style="font-size:12px;padding:6px 10px;border-radius:8px;background:#161c24;color:#e8edf4;border:1px solid #243040;">' +
          'Join & leave ' + esc(m.name) +
          '</button>'
        );
      }).join('');
      return (
        '<div style="margin-top:8px;padding:8px;border-radius:8px;border:1px solid #243040;background:#12171e;">' +
          '<div style="font-weight:600;">' + esc(inv.name || 'Company') + '</div>' +
          '<div style="font-size:11px;color:#8b95a5;margin:2px 0 8px;">' + esc(roleLabel(inv.role)) + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
            '<button type="button" class="tspOrgJoinKeep" data-invite-id="' + esc(inv.id) +
            '" style="font-size:12px;padding:6px 10px;border-radius:8px;background:#d4af37;color:#1a1408;border:0;font-weight:600;">' +
            'Join (keep home)' +
            '</button>' +
            leaveBtns +
          '</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="tsp-org-invites" style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(212,175,55,0.25);">' +
        '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b95a5;">Pending invites</div>' +
        cards +
      '</div>'
    );
  }

  function bindAcceptButtons(mount, pending) {
    const byId = {};
    (pending || []).forEach(function (inv) { byId[String(inv.id)] = inv; });

    function onAccept(inviteId, leaveOrganizationId) {
      const inv = byId[String(inviteId)];
      const name = (inv && inv.name) || 'company';
      return acceptInvite(inviteId, leaveOrganizationId).then(function () {
        toast(
          leaveOrganizationId
            ? ('Joined ' + name + ' and left the previous shop. Your login is unchanged.')
            : ('Added ' + name + '. Home shop unchanged.')
        );
        window.location.reload();
      }).catch(function (e) {
        alert((e && e.message) || 'Could not accept invite');
      });
    }

    mount.querySelectorAll('.tspOrgJoinKeep').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        onAccept(btn.getAttribute('data-invite-id')).finally(function () {
          btn.disabled = false;
        });
      });
    });
    mount.querySelectorAll('.tspOrgJoinLeave').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        onAccept(btn.getAttribute('data-invite-id'), btn.getAttribute('data-leave-id')).finally(function () {
          btn.disabled = false;
        });
      });
    });
  }

  function render(mount, state) {
    if (!mount) return;
    const memberships = state.memberships || [];
    const pending = state.pendingInvites || [];
    if (!memberships.length && !pending.length) {
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

    const workingAs = memberships.length
      ? (
        '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b95a5;margin-bottom:6px;">Working as</div>' +
        '<select id="tspOrgSelect" style="width:100%;padding:8px;border-radius:8px;background:#161c24;color:#e8edf4;border:1px solid #243040;">' +
          options +
        '</select>' +
        '<div style="font-size:11px;color:#8b95a5;margin-top:6px;">Jobs stay in this shop. Switch to moonlight or home without mixing queues.</div>' +
        (memberships.length > 1
          ? '<button type="button" id="tspOrgLeave" style="margin-top:8px;font-size:12px;background:transparent;border:0;color:#f87171;padding:0;">Leave ' + esc(active.name || 'this shop') + '</button>'
          : '')
      )
      : '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b95a5;margin-bottom:6px;">Choose company</div>';

    mount.innerHTML =
      '<div class="tsp-org-switcher" style="margin:8px 0 12px;padding:10px 12px;border-radius:10px;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.35);">' +
        workingAs +
        pendingInvitesHtml(pending, memberships) +
      '</div>';

    const select = mount.querySelector('#tspOrgSelect');
    if (select) {
      select.addEventListener('change', async function () {
        try {
          await switchOrg(select.value);
          toast('Switched company');
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
    bindAcceptButtons(mount, pending);
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
    acceptInvite: acceptInvite,
    siteOrigin: siteOrigin,
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
