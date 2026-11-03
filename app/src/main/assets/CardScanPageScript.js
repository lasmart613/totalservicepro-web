(function() {
  function post(type, payload) {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tsp) {
        window.webkit.messageHandlers.tsp.postMessage({
          type: type,
          payload: payload == null ? '' : payload,
          requestId: ''
        });
      }
    } catch (e) {}
  }

  function context() {
    var path = (location.pathname || '');
    var file = path.split('/').pop() || '';
    if (file === 'customer_directory.html' || path === '/customers' || path === '/customers/') {
      return { mode: 'create', organizationId: '' };
    }
    var parts = path.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'customers') {
      var id = decodeURIComponent(parts[1] || '');
      if (id && id !== 'new' && id !== 'layout' && id !== 'page') {
        return { mode: 'update', organizationId: id };
      }
    }
    if (file === 'customer_profile.html') {
      var query = '';
      try { query = new URLSearchParams(location.search).get('id') || ''; } catch (e) {}
      if (query) return { mode: 'update', organizationId: query };
    }
    return null;
  }

  function notify() {
    post('cardPage', location.href || '');
  }

  function findAnchor(mode) {
    var nodes = document.querySelectorAll('button, a');
    var wanted = mode === 'update' ? ['Save Customer Profile', 'Update from card'] : ['Add Customer', 'Scan card'];
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (nodes[i].getAttribute('data-tsp-card-scan')) continue;
      for (var j = 0; j < wanted.length; j++) {
        if (text.indexOf(wanted[j]) !== -1) return nodes[i];
      }
    }
    return null;
  }

  function install() {
    var ctx = context();
    var injected = document.querySelector('[data-tsp-injected="1"]');
    if (!ctx) {
      if (injected) injected.remove();
      post('cardButton', '0');
      return;
    }
    var labeled = document.querySelector('[data-tsp-card-scan="' + ctx.mode + '"]');
    if (labeled && labeled.getAttribute('data-tsp-injected') !== '1') {
      if (injected) injected.remove();
      post('cardButton', '1');
      return;
    }
    if (injected && injected.getAttribute('data-tsp-card-scan') === ctx.mode) {
      post('cardButton', '1');
      return;
    }
    if (injected) injected.remove();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-tsp-card-scan', ctx.mode);
    btn.setAttribute('data-tsp-injected', '1');
    btn.textContent = ctx.mode === 'update' ? 'Update from card' : 'Scan card';
    btn.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;padding:8px 12px;border-radius:10px;border:1px solid #c4a35a;background:transparent;color:#c4a35a;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;';
    btn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      var payload = { mode: ctx.mode, organizationId: ctx.organizationId || '' };
      var pending = (window.Android && Android.captureCardImage) ? Android.captureCardImage(payload) : Promise.reject(new Error('Card scan is available in the iOS app.'));
      Promise.resolve(pending).catch(function(err) {
        var message = (err && err.message) || '';
        if (/cancel/i.test(message)) return;
        if (window.Android && Android.showToast) Android.showToast(message || 'Card scan failed');
      });
    });
    var anchor = findAnchor(ctx.mode);
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(btn, anchor);
    } else if (document.body) {
      btn.style.position = 'fixed';
      btn.style.top = '12px';
      btn.style.right = '12px';
      btn.style.zIndex = '80';
      btn.style.marginLeft = '0';
      document.body.appendChild(btn);
    }
    post('cardButton', '1');
  }

  var timer = null;
  var installing = false;
  var lastHref = '';
  function schedule() {
    if (installing) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() {
      if (location.href !== lastHref) {
        lastHref = location.href;
        notify();
      }
      installing = true;
      try { install(); } finally { installing = false; }
    }, 200);
  }

  var push = history.pushState;
  history.pushState = function() {
    var result = push.apply(this, arguments);
    schedule();
    return result;
  };
  var replace = history.replaceState;
  history.replaceState = function() {
    var result = replace.apply(this, arguments);
    schedule();
    return result;
  };
  window.addEventListener('popstate', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  if (document.body) {
    var observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      if (!document.body) return;
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
  schedule();
})();
