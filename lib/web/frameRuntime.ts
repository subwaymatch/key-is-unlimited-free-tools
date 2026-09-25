/**
 * The script that runs first in every previewed page, inside the sandbox.
 *
 * It turns the site's virtual addresses into blob: URLs of the site's own
 * bytes: the files the page was sent with are read from its configuration
 * as the page needs them, and the rest are asked of the tool page by
 * message. It writes the import map that lets module code find its
 * imports, loads fonts from their bytes, answers fetch() and
 * XMLHttpRequest for the site's files, points pictures and media at their
 * bytes however they were set, and passes clicks on the site's links back
 * to the tool page, which shows the next page. Errors, blocked requests
 * and the page's title go back to the tool page too.
 *
 * Plain ES2017, kept as a string: it is written into every page as it is.
 */
export const FRAME_RUNTIME = String.raw`
(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("__keyis_config").textContent);
  var ROOT = config.root;
  var PAGE = config.page;
  var TOKEN = config.token;
  var files = config.files || {};
  var known = config.known || {};
  var cache = {};
  var waiting = {};
  var next = 1;
  var realSetAttribute = Element.prototype.setAttribute;

  function post(message) {
    message.__keyis = TOKEN;
    try { parent.postMessage(message, "*"); } catch (error) {}
  }

  function has(path) { return Object.prototype.hasOwnProperty.call(known, path); }

  function find(path) {
    var clean = path.replace(/\/+$/, "");
    var folder = path.charAt(path.length - 1) === "/" || clean === "";
    var prefix = clean ? clean + "/" : "";
    var candidates = folder ? [prefix + "index.html", prefix + "index.htm"] : [clean, clean + "/index.html", clean + ".html", clean + "/index.htm", clean + ".htm"];
    for (var i = 0; i < candidates.length; i++) if (has(candidates[i])) return candidates[i];
    return null;
  }

  function localPath(url) {
    var absolute;
    try { absolute = new URL(url, document.baseURI).href; } catch (error) { return null; }
    if (absolute.indexOf(ROOT) !== 0) return null;
    var rest = absolute.slice(ROOT.length).split("#")[0].split("?")[0];
    try { rest = decodeURIComponent(rest); } catch (error) {}
    return rest;
  }

  function hashOf(url) {
    var at = String(url).indexOf("#");
    return at >= 0 ? String(url).slice(at) : "";
  }

  function blobUrl(found) {
    if (cache[found]) return cache[found];
    var entry = files[found];
    if (!entry) return null;
    var binary = atob(entry.d);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    cache[found] = URL.createObjectURL(new Blob([bytes], { type: entry.t }));
    return cache[found];
  }

  function request(found) {
    var ready = blobUrl(found);
    if (ready) return Promise.resolve(ready);
    return new Promise(function (resolve) {
      var id = next++;
      waiting[id] = resolve;
      post({ type: "request", id: id, path: found });
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.__keyis !== TOKEN || data.type !== "file" || !waiting[data.id]) return;
    var url = data.buffer ? URL.createObjectURL(new Blob([data.buffer], { type: data.mime })) : null;
    if (url) cache[data.path] = url;
    waiting[data.id](url);
    delete waiting[data.id];
  });

  /* Addresses: a site address becomes its bytes' blob: URL, now or when they arrive. */
  function mapUrl(value, apply) {
    var path = localPath(value);
    if (path === null) return false;
    var found = find(path);
    if (found === null) {
      post({ type: "missing", path: path });
      apply("about:blank#missing");
      return true;
    }
    var ready = blobUrl(found);
    if (ready) {
      apply(ready + hashOf(value));
      return true;
    }
    request(found).then(function (url) { if (url) apply(url + hashOf(value)); });
    return true;
  }

  function mapSrcset(value, apply) {
    var parts = String(value).split(",");
    var pending = 0;
    var out = parts.map(function (part) {
      var bits = part.trim().split(/\s+/);
      var path = localPath(bits[0]);
      if (path === null) return part.trim();
      var found = find(path);
      var ready = found === null ? "about:blank#missing" : blobUrl(found);
      if (ready === null) { pending++; return part.trim(); }
      bits[0] = ready;
      return bits.join(" ");
    });
    apply(out.join(", "));
    return pending === 0;
  }

  var MAPPED = { IMG: ["src", "srcset"], SOURCE: ["src", "srcset"], VIDEO: ["src", "poster"], AUDIO: ["src"], TRACK: ["src"], INPUT: ["src"], EMBED: ["src"], OBJECT: ["data"], IFRAME: ["src"], SCRIPT: ["src"], LINK: ["href"], IMAGE: ["href"] };

  function fixElement(element) {
    var names = ["src", "srcset", "poster", "data", "href", "xlink-href"];
    for (var i = 0; i < names.length; i++) {
      var marked = element.getAttribute("data-keyis-" + names[i]);
      if (marked === null) continue;
      element.removeAttribute("data-keyis-" + names[i]);
      var target = names[i] === "xlink-href" ? "href" : names[i];
      var set = (function (name) { return function (value) { realSetAttribute.call(element, name, value); }; })(target);
      if (target === "srcset") mapSrcset(marked, set);
      else mapUrl(marked, set);
    }
    var attributes = MAPPED[element.tagName.toUpperCase()];
    if (!attributes) return;
    for (var k = 0; k < attributes.length; k++) {
      var value = element.getAttribute(attributes[k]);
      if (!value || /^(blob|data|about):/i.test(value)) continue;
      if (element.tagName === "LINK" && !/icon|manifest|preload|prefetch/i.test(element.rel || "")) continue;
      var apply = (function (name) { return function (mapped) { realSetAttribute.call(element, name, mapped); }; })(attributes[k]);
      if (attributes[k] === "srcset") mapSrcset(value, apply);
      else mapUrl(value, apply);
    }
  }

  function fixTree(node) {
    if (node.nodeType !== 1) return;
    fixElement(node);
    var inside = node.querySelectorAll ? node.querySelectorAll("*") : [];
    for (var i = 0; i < inside.length; i++) fixElement(inside[i]);
  }

  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === "attributes") fixElement(record.target);
      else for (var j = 0; j < record.addedNodes.length; j++) fixTree(record.addedNodes[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "poster", "href", "data"] });

  /* Setting an address in code is caught before the browser can ask for it. */
  function patch(proto, name) {
    if (!proto) return;
    var descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        var element = this;
        var apply = function (mapped) { descriptor.set.call(element, mapped); };
        if (typeof value === "string" && !/^(blob|data|about):/i.test(value)) {
          if (name === "srcset") { mapSrcset(value, apply); return; }
          if (!(element.tagName === "LINK" && /stylesheet/i.test(element.rel || "")) && mapUrl(value, apply)) return;
        }
        descriptor.set.call(element, value);
      },
    });
  }
  patch(window.HTMLImageElement && HTMLImageElement.prototype, "src");
  patch(window.HTMLImageElement && HTMLImageElement.prototype, "srcset");
  patch(window.HTMLSourceElement && HTMLSourceElement.prototype, "src");
  patch(window.HTMLSourceElement && HTMLSourceElement.prototype, "srcset");
  patch(window.HTMLMediaElement && HTMLMediaElement.prototype, "src");
  patch(window.HTMLVideoElement && HTMLVideoElement.prototype, "poster");
  patch(window.HTMLTrackElement && HTMLTrackElement.prototype, "src");
  patch(window.HTMLScriptElement && HTMLScriptElement.prototype, "src");
  patch(window.HTMLEmbedElement && HTMLEmbedElement.prototype, "src");
  patch(window.HTMLObjectElement && HTMLObjectElement.prototype, "data");
  patch(window.HTMLIFrameElement && HTMLIFrameElement.prototype, "src");
  patch(window.HTMLLinkElement && HTMLLinkElement.prototype, "href");
  Element.prototype.setAttribute = function (name, value) {
    var element = this;
    var lower = String(name).toLowerCase();
    var attributes = MAPPED[String(element.tagName).toUpperCase()];
    if (attributes && attributes.indexOf(lower) >= 0 && typeof value === "string" && !/^(blob|data|about):/i.test(value)) {
      var apply = function (mapped) { realSetAttribute.call(element, lower, mapped); };
      if (lower === "srcset") { mapSrcset(value, apply); return; }
      if (!(element.tagName === "LINK" && !/icon|manifest|preload|prefetch/i.test(element.rel || "")) && mapUrl(value, apply)) return;
    }
    return realSetAttribute.apply(this, arguments);
  };

  /* Module code finds its imports through a map of virtual addresses to blob: URLs. */
  var imports = {};
  for (var path in files) if (Object.prototype.hasOwnProperty.call(files, path) && files[path].t === "text/javascript") imports[ROOT + path] = blobUrl(path);
  var siteMap = config.importMap || {};
  var virtualToBlob = function (value) {
    var local = localPath(value);
    var found = local === null ? null : find(local);
    return found !== null && blobUrl(found) ? blobUrl(found) : value;
  };
  for (var key in siteMap.imports || {}) imports[key] = virtualToBlob(siteMap.imports[key]);
  var scopes = {};
  for (var scope in siteMap.scopes || {}) {
    scopes[scope] = {};
    for (var entry in siteMap.scopes[scope]) scopes[scope][entry] = virtualToBlob(siteMap.scopes[scope][entry]);
  }
  var map = document.createElement("script");
  map.type = "importmap";
  map.textContent = JSON.stringify({ imports: imports, scopes: scopes });
  document.currentScript.after(map);

  /* Fonts from their bytes: the policy allows no font address. */
  (config.fonts || []).forEach(function (font) {
    var entry = files[font.path];
    if (!entry || !window.FontFace) return;
    var binary = atob(entry.d);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      var face = new FontFace(font.family, bytes, font.descriptors);
      document.fonts.add(face);
      face.load().catch(function () { post({ type: "log", level: "warn", text: "The font " + font.path + " could not be read." }); });
    } catch (error) {}
  });

  /* fetch and XMLHttpRequest answer from the site's files. */
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    var path = localPath(url);
    if (path === null) return realFetch.apply(this, arguments);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return Promise.resolve(new Response("A static site cannot take " + method + " requests.", { status: 405, statusText: "Method Not Allowed" }));
    var found = find(path);
    if (found === null) {
      post({ type: "missing", path: path });
      return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not Found" }));
    }
    return request(found).then(function (blob) { return realFetch(blob); });
  };
  var realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var path = localPath(String(url));
    if (path !== null) {
      var found = find(path);
      if (found === null) post({ type: "missing", path: path });
      arguments[1] = found === null ? "data:text/plain,Not%20found" : blobUrl(found) || "data:,";
    }
    return realOpen.apply(this, arguments);
  };

  /* History with an address only works for the real page; the rest is kept without one. */
  ["pushState", "replaceState"].forEach(function (name) {
    var real = history[name];
    history[name] = function (state, title, url) {
      try { return real.apply(history, arguments); } catch (error) { return real.call(history, state, title); }
    };
  });

  /* Links and forms: pages of the site open through the tool page; other sites in a new tab. */
  function scrollTo(hash) {
    if (!hash || hash === "#") { window.scrollTo(0, 0); return; }
    try { location.hash = hash; } catch (error) {}
    var id = decodeURIComponent(hash.slice(1));
    var target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (target) target.scrollIntoView();
  }

  function go(url, event) {
    var absolute;
    try { absolute = new URL(url, document.baseURI); } catch (error) { return; }
    if (absolute.href.indexOf(ROOT) !== 0) {
      if (/^(https?|mailto|tel):$/i.test(absolute.protocol)) {
        event.preventDefault();
        window.open(absolute.href, "_blank", "noopener,noreferrer");
      }
      return;
    }
    event.preventDefault();
    var path = localPath(absolute.href);
    var found = find(path);
    if (found === PAGE && absolute.hash) { scrollTo(absolute.hash); return; }
    post({ type: "navigate", path: path, hash: absolute.hash });
  }

  window.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button > 1) return;
    var link = event.target && event.target.closest ? event.target.closest("a[href], area[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href");
    if (href === null || /^\s*javascript:/i.test(href) || link.hasAttribute("download")) return;
    go(href, event);
  });

  window.addEventListener("submit", function (event) {
    if (event.defaultPrevented) return;
    var form = event.target;
    event.preventDefault();
    var method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") { post({ type: "log", level: "warn", text: "A form was sent, which a static site cannot receive." }); return; }
    go(form.getAttribute("action") || PAGE, event);
  });

  /* What happens in the page, for the tool page to show. */
  window.addEventListener("error", function (event) {
    if (event.target && event.target !== window) return;
    post({ type: "log", level: "error", text: String(event.message || "Error") + (event.filename ? " (" + (localPath(event.filename) || event.filename) + ":" + event.lineno + ")" : "") });
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    post({ type: "log", level: "error", text: "Unhandled: " + (reason && reason.message ? reason.message : String(reason)) });
  });
  ["error", "warn"].forEach(function (level) {
    var real = console[level];
    console[level] = function () {
      var text = Array.prototype.map.call(arguments, function (part) { try { return typeof part === "string" ? part : JSON.stringify(part); } catch (error) { return String(part); } }).join(" ");
      post({ type: "log", level: level, text: text.slice(0, 600) });
      return real.apply(console, arguments);
    };
  });
  document.addEventListener("securitypolicyviolation", function (event) {
    var blocked = event.blockedURI || "";
    if (/^https?:/i.test(blocked) && blocked.indexOf(ROOT) !== 0) post({ type: "blocked", url: blocked });
  });

  document.addEventListener("DOMContentLoaded", function () {
    post({ type: "loaded", title: document.title });
    if (config.hash) scrollTo(config.hash);
    if (config.refresh) setTimeout(function () { post({ type: "navigate", path: config.refresh.path, hash: config.refresh.hash || "" }); }, config.refresh.seconds * 1000);
  });
})();
`;
