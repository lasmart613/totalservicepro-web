/**
 * Same PNG / JPEG / WebP header check as web/lib/marketplace/listing-image.ts.
 * WebView pages cannot import that module. Filename and file.type are ignored.
 */
(function (global) {
  var PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  var REJECTED = 'Use a PNG, JPEG, or WebP photo. Other file types, including SVG, are not allowed.';

  function hasPrefix(bytes, signature) {
    if (!bytes || bytes.length < signature.length) return false;
    for (var i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) return false;
    }
    return true;
  }

  function tspDetectImage(bytes) {
    if (hasPrefix(bytes, PNG)) return { contentType: 'image/png', extension: 'png' };
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { contentType: 'image/jpeg', extension: 'jpg' };
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return { contentType: 'image/webp', extension: 'webp' };
    }
    return null;
  }

  function tspImageTooLarge(maxBytes) {
    var mb = maxBytes / (1024 * 1024);
    var label = mb === Math.round(mb) ? String(mb) : String(Math.round(mb * 10) / 10);
    return 'Photo must be ' + label + ' MB or smaller.';
  }

  function tspInspectImage(file, maxBytes) {
    if (!file) return Promise.resolve({ ok: false, error: REJECTED });
    if (file.size > maxBytes) return Promise.resolve({ ok: false, error: tspImageTooLarge(maxBytes) });
    return file.slice(0, 16).arrayBuffer().then(function (buf) {
      var detected = tspDetectImage(new Uint8Array(buf));
      if (!detected) return { ok: false, error: REJECTED };
      return { ok: true, contentType: detected.contentType, extension: detected.extension };
    });
  }

  global.tspDetectImage = tspDetectImage;
  global.tspInspectImage = tspInspectImage;
  global.TSP_IMAGE_REJECTED = REJECTED;
})(window);
