// OpenGHM schema-docs viewer.
//
// Static, dependency-free. Fetches the already-published spec JSON at read
// time (default https://schemas.openghm.org, override with ?base=) and
// renders it. Nothing here is generated ahead of time and nothing under
// schemas/ is touched — see docs/decisions/0020-a-live-schema-viewer-is-not-a-generated-rendering.md.

(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var BASE = (params.get("base") || "https://schemas.openghm.org").replace(/\/+$/, "");

  var SPECS = [
    { key: "snapshot-spec", label: "Snapshot spec" },
    { key: "model-input-spec", label: "Model input spec" }
  ];

  // Absolute URL -> Promise<{data, url}>. Shared across both specs for the
  // lifetime of the page load, so a definition fetched once (e.g. common/about)
  // is never re-fetched even if both specs reference it.
  var fetchCache = new Map();

  function getJson(url) {
    if (fetchCache.has(url)) return fetchCache.get(url);
    var p = fetch(url)
      .then(function (r) {
        if (!r.ok) {
          throw new Error("HTTP " + r.status + " " + r.statusText + " fetching " + url);
        }
        return r.json();
      })
      .then(function (data) {
        return { data: data, url: url };
      })
      .catch(function (err) {
        fetchCache.delete(url); // don't poison the cache with a failed fetch
        throw err;
      });
    fetchCache.set(url, p);
    return p;
  }

  // --- small DOM helper -----------------------------------------------

  function el(tag, opts, children) {
    opts = opts || {};
    var e = document.createElement(tag);
    if (opts.class) e.className = opts.class;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.href != null) e.href = opts.href;
    if (opts.target) e.target = opts.target;
    if (opts.rel) e.rel = opts.rel;
    (children || []).forEach(function (c) {
      if (c) e.append(c);
    });
    return e;
  }

  function rawLink(url) {
    return el("a", {
      class: "raw-link",
      text: "view raw JSON",
      href: url,
      target: "_blank",
      rel: "noopener noreferrer"
    });
  }

  function addMeta(dl, term, value) {
    dl.append(el("dt", { text: term }));
    dl.append(el("dd", { text: String(value) }));
  }

  // --- JSON Schema $ref resolution -------------------------------------

  // Resolve a JSON pointer ("#/$defs/simulation" or "#") against a document
  // already in memory (no fetch).
  function jsonPointer(doc, ref) {
    var path = ref.charAt(0) === "#" ? ref.slice(1) : ref;
    if (!path) return doc;
    var parts = path
      .split("/")
      .filter(function (p) { return p.length > 0; })
      .map(function (p) {
        return decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~");
      });
    var cur = doc;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || !Object.prototype.hasOwnProperty.call(cur, parts[i])) {
        throw new Error("JSON pointer " + ref + " does not resolve");
      }
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Follow a chain of $ref (local "#/..." pointers resolved in-document,
  // external relative paths fetched and cached) until a non-$ref schema is
  // reached. Relative external refs are resolved against the URL of the
  // file the $ref was *written in* (sourceUrl), per ADR 0018 / standard
  // relative-URL resolution (new URL(ref, sourceUrl)) — never against BASE
  // directly, so a ref two directories up from metadata/1.0.0.json lands in
  // the right place regardless of what base was passed on the query string.
  function resolveNode(schema, sourceUrl, doc) {
    var cur = schema;
    var curUrl = sourceUrl;
    var curDoc = doc;
    var guard = 0;

    function step() {
      if (!cur || typeof cur !== "object" || typeof cur.$ref !== "string") {
        return Promise.resolve({ schema: cur, url: curUrl, doc: curDoc });
      }
      if (++guard > 30) {
        return Promise.reject(new Error("$ref chain too deep (possible cycle) at " + curUrl));
      }
      var ref = cur.$ref;
      if (ref.charAt(0) === "#") {
        cur = jsonPointer(curDoc, ref);
        return step();
      }
      var hashIdx = ref.indexOf("#");
      var pathPart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
      var fragment = hashIdx === -1 ? null : ref.slice(hashIdx + 1);
      var absUrl = new URL(pathPart, curUrl).href;
      return getJson(absUrl).then(function (res) {
        curDoc = res.data;
        curUrl = res.url;
        cur = fragment ? jsonPointer(curDoc, "#" + fragment) : curDoc;
        return step();
      });
    }

    return step();
  }

  // --- rendering: JSON Schema (metadata/<ver>.json) ---------------------

  function formatType(schema) {
    if (Array.isArray(schema.type)) return schema.type.join(" | ");
    if (schema.type) return schema.type;
    if (schema.enum) return "enum";
    return "any";
  }

  function headingTag(level) {
    if (level <= 2) return "h2";
    if (level === 3) return "h3";
    if (level === 4) return "h4";
    return "h5";
  }

  // Renders one property (a key + its schema, possibly behind one or more
  // $ref hops) into `container`, recursing into nested object/array/combiner
  // schemas. ctx = { sourceUrl, doc, requiredList, level }
  function renderProperty(container, key, propSchema, ctx) {
    return resolveNode(propSchema, ctx.sourceUrl, ctx.doc).then(function (resolved) {
      var schema = resolved.schema || {};
      var isRequired = ctx.requiredList.indexOf(key) !== -1;

      var section = el("section", {
        class: "field level-" + ctx.level + (isRequired ? " required" : "")
      });

      var heading = el(headingTag(ctx.level), { class: "field-heading" });
      heading.append(el("span", { class: "field-key", text: key }));
      if (isRequired) heading.append(el("span", { class: "badge badge-required", text: "required" }));
      if (schema.deprecated) heading.append(el("span", { class: "badge badge-deprecated", text: "deprecated" }));
      section.append(heading);

      if (schema.title) section.append(el("p", { class: "field-title", text: schema.title }));
      if (schema.description) section.append(el("p", { class: "field-desc", text: schema.description }));

      var meta = el("dl", { class: "field-meta" });
      addMeta(meta, "Type", formatType(schema));
      if (schema.pattern) addMeta(meta, "Pattern", schema.pattern);
      if (schema.format) addMeta(meta, "Format", schema.format);
      if (schema.enum) addMeta(meta, "Enum", schema.enum.map(String).join(", "));
      if (Object.prototype.hasOwnProperty.call(schema, "default")) {
        addMeta(meta, "Default", JSON.stringify(schema.default));
      }
      if (schema.examples) {
        addMeta(meta, "Examples", schema.examples.map(function (e) { return JSON.stringify(e); }).join(", "));
      }
      if (schema.minLength != null) addMeta(meta, "Min length", schema.minLength);
      if (schema.maxLength != null) addMeta(meta, "Max length", schema.maxLength);
      if (schema.minItems != null) addMeta(meta, "Min items", schema.minItems);
      if (schema.uniqueItems) addMeta(meta, "Unique items", "true");
      if (schema.minimum != null) addMeta(meta, "Minimum", schema.minimum);
      if (schema.maximum != null) addMeta(meta, "Maximum", schema.maximum);
      if (schema.exclusiveMinimum != null) addMeta(meta, "Exclusive minimum", schema.exclusiveMinimum);
      if (schema.exclusiveMaximum != null) addMeta(meta, "Exclusive maximum", schema.exclusiveMaximum);
      if (meta.children.length) section.append(meta);

      section.append(rawLink(resolved.url));

      var nestedWork = Promise.resolve();

      if (schema.type === "object" && schema.properties) {
        var propsWrap = el("div", { class: "nested-props" });
        var childRequired = schema.required || [];
        nestedWork = Object.keys(schema.properties).reduce(function (p, childKey) {
          return p.then(function () {
            return renderProperty(propsWrap, childKey, schema.properties[childKey], {
              sourceUrl: resolved.url,
              doc: resolved.doc,
              requiredList: childRequired,
              level: ctx.level + 1
            });
          });
        }, Promise.resolve());
        nestedWork = nestedWork.then(function () { section.append(propsWrap); });
      } else if (schema.type === "array" && schema.items) {
        var itemsWrap = el("div", { class: "nested-items" });
        nestedWork = renderProperty(itemsWrap, "items[]", schema.items, {
          sourceUrl: resolved.url,
          doc: resolved.doc,
          requiredList: [],
          level: ctx.level + 1
        }).then(function () { section.append(itemsWrap); });
      }

      return nestedWork.then(function () {
        var combinerWork = Promise.resolve();
        ["oneOf", "anyOf", "allOf"].forEach(function (combiner) {
          if (!Array.isArray(schema[combiner])) return;
          var wrap = el("div", { class: "nested-combiner" });
          wrap.append(el("p", { class: "combiner-label", text: combiner }));
          combinerWork = combinerWork.then(function () {
            return schema[combiner].reduce(function (p, alt, i) {
              return p.then(function () {
                return renderProperty(wrap, combiner + "[" + i + "]", alt, {
                  sourceUrl: resolved.url,
                  doc: resolved.doc,
                  requiredList: [],
                  level: ctx.level + 1
                });
              });
            }, Promise.resolve());
          }).then(function () { section.append(wrap); });
        });
        return combinerWork;
      }).then(function () {
        container.append(section);
      });
    });
  }

  // Root of a metadata/<ver>.json document: its own title/description, then
  // each top-level property rendered via renderProperty.
  function renderMetadataRoot(container, doc, url) {
    var section = el("section", { class: "field level-1 root" });
    section.append(el("h2", { class: "field-heading", text: doc.title || "(untitled schema)" }));
    if (doc.description) section.append(el("p", { class: "field-desc", text: doc.description }));
    section.append(rawLink(url));
    var wrap = el("div", { class: "nested-props" });
    var required = doc.required || [];
    var props = doc.properties || {};
    var work = Object.keys(props).reduce(function (p, key) {
      return p.then(function () {
        return renderProperty(wrap, key, props[key], {
          sourceUrl: url,
          doc: doc,
          requiredList: required,
          level: 2
        });
      });
    }, Promise.resolve());
    return work.then(function () {
      section.append(wrap);
      container.append(section);
    });
  }

  // --- rendering: directory layout (layout/<ver>.json) -------------------
  // Not a JSON Schema document — a flat { specVersion, required[], optional[] }
  // list of paths a snapshot/model-input directory must/may contain.

  function renderLayout(container, doc, url) {
    var section = el("section", { class: "layout-section" });
    section.append(el("h2", { class: "field-heading", text: "Directory layout" }));
    section.append(el("p", { class: "field-desc", text: "specVersion " + doc.specVersion }));
    section.append(rawLink(url));

    section.append(el("h3", { text: "Required" }));
    var reqList = el("ul", { class: "path-list required-paths" });
    (doc.required || []).forEach(function (p) {
      reqList.append(el("li", { text: p }));
    });
    section.append(reqList);

    if (doc.optional && doc.optional.length) {
      section.append(el("h3", { text: "Optional" }));
      var optList = el("ul", { class: "path-list optional-paths" });
      doc.optional.forEach(function (p) {
        optList.append(el("li", { text: p }));
      });
      section.append(optList);
    }

    container.append(section);
  }

  // --- top-level flow -----------------------------------------------------

  function loadSpecVersion(spec, version, indexData) {
    var content = document.getElementById("content");
    content.innerHTML = "";
    content.append(el("p", { class: "loading", text: "Loading " + spec.label + " " + version + "…" }));

    var metaUrl = BASE + "/" + spec.key + "/metadata/" + version + ".json";
    var layoutUrl = BASE + "/" + spec.key + "/layout/" + version + ".json";

    Promise.all([getJson(metaUrl), getJson(layoutUrl)])
      .then(function (results) {
        var metaRes = results[0];
        var layoutRes = results[1];
        content.innerHTML = "";

        var headingWrap = el("div", { class: "content-heading" });
        headingWrap.append(el("h2", { text: spec.label + " — " + version }));
        if (version === indexData.current) {
          headingWrap.append(el("span", { class: "tag tag-current", text: "current" }));
        }
        if ((indexData.deprecated || []).indexOf(version) !== -1) {
          headingWrap.append(el("span", { class: "tag tag-deprecated", text: "deprecated" }));
        }
        content.append(headingWrap);

        content.append(el("h2", { class: "section-label", text: "Metadata schema" }));
        return renderMetadataRoot(content, metaRes.data, metaRes.url).then(function () {
          content.append(el("h2", { class: "section-label", text: "Layout schema" }));
          renderLayout(content, layoutRes.data, layoutRes.url);
        });
      })
      .catch(function (err) {
        content.innerHTML = "";
        content.append(
          el("p", {
            class: "error",
            text:
              "Failed to load " + spec.key + " " + version + ": " + err.message +
              ". If this is a network-level failure (not an HTTP status) and this page is not " +
              "being served from " + BASE + " itself, the browser may be blocking the " +
              "cross-origin request (CORS) rather than the data being missing or wrong."
          })
        );
      });
  }

  function loadIndex() {
    var nav = document.getElementById("spec-nav");
    nav.innerHTML = "";

    var work = SPECS.reduce(function (p, spec) {
      return p.then(function () {
        var specBlock = el("div", { class: "spec-block" });
        specBlock.append(el("h2", { class: "spec-name", text: spec.label }));

        var indexUrl = BASE + "/" + spec.key + "/index.json";
        return getJson(indexUrl)
          .then(function (res) {
            var data = res.data;
            specBlock.append(rawLink(res.url));
            var deprecated = data.deprecated || [];
            var list = el("ul", { class: "version-list" });
            (data.versions || []).forEach(function (v) {
              var li = el("li");
              var btn = el("button", { class: "version-btn", text: v });
              if (v === data.current) btn.classList.add("current");
              if (deprecated.indexOf(v) !== -1) btn.classList.add("deprecated");
              btn.addEventListener("click", function () {
                document.querySelectorAll(".version-btn.selected").forEach(function (b) {
                  b.classList.remove("selected");
                });
                btn.classList.add("selected");
                loadSpecVersion(spec, v, data);
              });
              li.append(btn);
              if (v === data.current) li.append(el("span", { class: "tag tag-current", text: "current" }));
              if (deprecated.indexOf(v) !== -1) li.append(el("span", { class: "tag tag-deprecated", text: "deprecated" }));
              list.append(li);
            });
            specBlock.append(list);
          })
          .catch(function (err) {
            specBlock.append(el("p", { class: "error", text: "Failed to load " + indexUrl + ": " + err.message }));
          })
          .then(function () {
            nav.append(specBlock);
          });
      });
    }, Promise.resolve());

    return work;
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("base-url").textContent = BASE;
    loadIndex();
  });
})();
