/**
 * Android card scan for the live customer form.
 * cardPage and cardButton go through tspNative (or Android.noteCardScan on a
 * file page). A confirmed scan fills the open customer form. The page Save
 * button is what writes the customer.
 */
(function (root) {
    function splitPersonName(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return { first: '', last: '' };
        if (parts.length === 1) return { first: parts[0], last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
    }

    function formValuesFromCard(fields) {
        var src = fields || {};
        var company = String(src.company || '').trim();
        var person = String(src.name || '').trim();
        var business = company || person;
        var names = company && person ? splitPersonName(person) : { first: '', last: '' };
        return {
            businessName: business,
            website: String(src.website || '').trim(),
            phone: String(src.phone || '').trim(),
            email: String(src.email || '').trim(),
            address: String(src.address || '').trim(),
            city: String(src.city || '').trim(),
            state: String(src.state || '').trim(),
            zip: String(src.zip || '').trim(),
            firstName: names.first,
            lastName: names.last
        };
    }

    function pageContext(href) {
        var url;
        try { url = new URL(String(href || ''), 'https://repairplanet.net'); }
        catch (e) { return null; }
        var path = url.pathname || '';
        var file = path.split('/').pop() || '';
        if (file === 'customer_directory.html' || path === '/customers' || path === '/customers/') {
            return { mode: 'create', organizationId: '' };
        }
        var parts = path.split('/').filter(Boolean);
        if (parts.length === 2 && parts[0] === 'customers') {
            var id = '';
            try { id = decodeURIComponent(parts[1] || ''); } catch (e2) { id = parts[1] || ''; }
            if (id && id !== 'new' && id !== 'layout' && id !== 'page') {
                return { mode: 'update', organizationId: id };
            }
        }
        if (file === 'customer_profile.html') {
            var query = url.searchParams.get('id') || '';
            if (query) return { mode: 'update', organizationId: query };
        }
        return null;
    }

    function cardMessage(type, payload) {
        return { m: type, payload: payload == null ? '' : String(payload) };
    }

    function setReactValue(input, value) {
        if (!input || value == null || value === '') return;
        var proto = input.tagName === 'TEXTAREA'
            ? (root.HTMLTextAreaElement && root.HTMLTextAreaElement.prototype)
            : (root.HTMLInputElement && root.HTMLInputElement.prototype);
        var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
    }

    function customerFormRoot(doc) {
        if (!doc || !doc.querySelector) return null;
        var dialogs = doc.querySelectorAll('[role="dialog"]');
        for (var i = 0; i < dialogs.length; i++) {
            if (dialogs[i].querySelector('input[autocomplete="organization"]')) return dialogs[i];
        }
        if (doc.querySelector && doc.querySelector('input[autocomplete="organization"]')) return doc;
        return null;
    }

    function applyCardToForm(rootEl, fields) {
        if (!rootEl || !rootEl.querySelector) return false;
        var values = formValuesFromCard(fields);
        var business = rootEl.querySelector('input[autocomplete="organization"]');
        var website = rootEl.querySelector('input[type="url"]');
        var phone = rootEl.querySelector('input[type="tel"]:not([aria-label])');
        var email = rootEl.querySelector('input[type="email"]:not([aria-label])');
        var state = rootEl.querySelector('input[autocomplete="address-level1"]');
        var zip = rootEl.querySelector('input[maxlength="10"]');
        var first = rootEl.querySelector('input[autocomplete="given-name"]');
        var last = rootEl.querySelector('input[autocomplete="family-name"]');
        setReactValue(business, values.businessName);
        setReactValue(website, values.website);
        setReactValue(phone, values.phone);
        setReactValue(email, values.email);
        setReactValue(state, values.state);
        setReactValue(zip, values.zip);
        setReactValue(first, values.firstName);
        setReactValue(last, values.lastName);
        var grid = state && state.parentElement ? state.parentElement.parentElement : null;
        var city = null;
        if (grid && grid.children) {
            for (var c = 0; c < grid.children.length; c++) {
                var cell = grid.children[c];
                var candidate = cell && cell.querySelector ? cell.querySelector('input') : null;
                if (candidate && candidate !== state && candidate !== zip) {
                    city = candidate;
                    break;
                }
            }
        }
        var addressWrap = grid ? grid.previousElementSibling : null;
        var address = addressWrap && addressWrap.querySelector ? addressWrap.querySelector('input') : null;
        setReactValue(city, values.city);
        setReactValue(address, values.address);
        if (values.firstName || values.lastName) {
            var radioTries = 0;
            var radioTimer = setInterval(function () {
                var radio = rootEl.querySelector('input[name="directory-primary-contact"]');
                if (!radio || radio.checked || ++radioTries > 20) {
                    clearInterval(radioTimer);
                    return;
                }
                if (!radio.disabled) radio.click();
            }, 50);
        }
        return !!(business || website || phone || email);
    }

    function post(type, payload) {
        var msg = cardMessage(type, payload);
        try {
            if (root.tspNative && typeof root.tspNative.postMessage === 'function') {
                root.tspNative.postMessage(JSON.stringify(msg));
                return;
            }
        } catch (e) {}
        try {
            if (root.Android && typeof root.Android.noteCardScan === 'function') {
                root.Android.noteCardScan(msg.m, msg.payload);
            }
        } catch (e2) {}
    }

    function fieldsFromResult(value) {
        if (!value) return null;
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (e) { return null; }
        }
        if (value.fields) return value.fields;
        return null;
    }

    function startScan(ctx, form) {
        var payload = {
            mode: ctx.mode,
            organizationId: ctx.organizationId || '',
            prefillForm: !!form
        };
        var pending;
        try {
            pending = (root.Android && root.Android.captureCardImage)
                ? root.Android.captureCardImage(payload)
                : Promise.reject(new Error('Card scan is available in the Android app.'));
        } catch (e) {
            pending = Promise.reject(e);
        }
        Promise.resolve(pending).then(function (value) {
            var fields = fieldsFromResult(value);
            if (form && fields) {
                applyCardToForm(form, fields);
                if (root.Android && root.Android.showToast) {
                    root.Android.showToast('Card details are on the form. Tap Save when they look right.');
                }
            }
        }).catch(function (err) {
            var message = (err && err.message) || '';
            if (/cancel/i.test(message)) return;
            if (root.Android && root.Android.showToast) root.Android.showToast(message || 'Card scan failed');
        });
    }

    var ADD_CUSTOMER_LABELS = [
        'Add Customer',
        'افزودن مشتری',
        'Añadir cliente',
        'Ajouter un client',
        'הוספת לקוח',
        'Aggiungi cliente',
        'Kunde hinzufügen',
        'Adicionar cliente',
        'إضافة عميل'
    ];

    function labelText(node) {
        return String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function isAddCustomerButton(node) {
        if (!node || node.getAttribute && node.getAttribute('data-tsp-card-scan')) return false;
        var text = labelText(node);
        for (var i = 0; i < ADD_CUSTOMER_LABELS.length; i++) {
            if (text.indexOf(ADD_CUSTOMER_LABELS[i]) !== -1) return true;
        }
        return false;
    }

    function openAddThenScan(doc, ctx) {
        var form = customerFormRoot(doc);
        if (form) {
            startScan(ctx, form);
            return;
        }
        var buttons = doc.querySelectorAll('button');
        var add = null;
        for (var i = 0; i < buttons.length; i++) {
            if (isAddCustomerButton(buttons[i])) {
                add = buttons[i];
                break;
            }
        }
        if (add) add.click();
        var tries = 0;
        var timer = setInterval(function () {
            var opened = customerFormRoot(doc);
            if (opened || ++tries > 25) {
                clearInterval(timer);
                if (opened) startScan(ctx, opened);
            }
        }, 80);
    }

    function installButton(doc, ctx) {
        var form = customerFormRoot(doc);
        var host = form || doc.body;
        if (!host) return;
        var existing = (form || doc).querySelector('[data-tsp-card-scan="' + ctx.mode + '"]');
        if (existing) return;
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-tsp-card-scan', ctx.mode);
        btn.setAttribute('data-tsp-injected', '1');
        btn.textContent = form
            ? (ctx.mode === 'update' ? 'Update from card' : 'Scan card')
            : 'Add customer by scanning a business card';
        btn.style.cssText = 'display:inline-flex;align-items:center;margin:0 0 8px 8px;padding:8px 12px;border-radius:10px;border:1px solid #c4a35a;background:transparent;color:#c4a35a;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;';
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (form) startScan(ctx, form);
            else openAddThenScan(doc, ctx);
        });
        if (form && form !== doc) {
            var title = form.querySelector('#add-customer-title') || form.querySelector('h1, h2');
            if (title && title.parentNode) title.parentNode.insertBefore(btn, title.nextSibling);
            else form.insertBefore(btn, form.firstChild);
        } else if (form) {
            var business = form.querySelector('input[autocomplete="organization"]');
            var block = business && business.parentElement;
            if (block && block.parentNode) block.parentNode.insertBefore(btn, block);
            else form.insertBefore(btn, form.firstChild);
        } else if (doc.body) {
            var anchors = doc.querySelectorAll('button, a');
            var anchor = null;
            for (var i = 0; i < anchors.length; i++) {
                var label = labelText(anchors[i]);
                if (isAddCustomerButton(anchors[i]) || label.indexOf('Save Customer Profile') !== -1) {
                    anchor = anchors[i];
                    break;
                }
            }
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
            else doc.body.appendChild(btn);
        }
        noteButton('1');
    }

    var postedPage = null;
    var postedButton = null;
    function notePage(href) {
        if (postedPage === href) return;
        postedPage = href;
        post('cardPage', href);
    }
    function noteButton(flag) {
        if (postedButton === flag) return;
        postedButton = flag;
        post('cardButton', flag);
    }

    function boot() {
        var doc = root.document;
        if (!doc) return;
        var ctx = pageContext(root.location && root.location.href);
        function tick() {
            var next = pageContext(root.location && root.location.href);
            if (!next) {
                var stale = doc.querySelector('[data-tsp-injected="1"]');
                if (stale) stale.remove();
                noteButton('0');
                postedPage = null;
                return;
            }
            ctx = next;
            notePage(root.location.href || '');
            installButton(doc, ctx);
        }
        if (!root.__tspAndroidCardTimer) {
            root.__tspAndroidCardTimer = setInterval(tick, 700);
        }
        tick();
    }

    var api = {
        splitPersonName: splitPersonName,
        formValuesFromCard: formValuesFromCard,
        pageContext: pageContext,
        cardMessage: cardMessage,
        customerFormRoot: customerFormRoot,
        applyCardToForm: applyCardToForm,
        fieldsFromResult: fieldsFromResult
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TSPAndroidCardScan = api;
    if (root.document) boot();
})(typeof window !== 'undefined' ? window : globalThis);
