"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/protocol.ts
  var MAX_BODY = 24 * 1024 * 1024;
  var METHODS = ["document", "selection", "inspect", "find", "fonts", "apply", "patch", "delete", "select", "export", "image", "variables", "styles", "boolean", "boolean-set", "audit", "icon-shape", "eval"];
  var AgentError = class extends Error {
    constructor(code, message, recovery, details) {
      super(message);
      __publicField(this, "code", code);
      __publicField(this, "recovery", recovery);
      __publicField(this, "details", details);
    }
  };
  function fault(error) {
    if (error instanceof AgentError) return { code: error.code, message: error.message, recovery: error.recovery, details: error.details };
    return { code: "COMMAND_FAILED", message: error instanceof Error ? error.message : String(error) };
  }
  function validateCommand(input) {
    if (!input || typeof input.id !== "string" || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(input.id)) throw new AgentError("INVALID_REQUEST", "A request ID of 1\u2013120 safe characters is required.");
    if (!METHODS.includes(input.method)) throw new AgentError("INVALID_METHOD", "Unknown command method.", "Run figma-agent schema.");
    if (!input.params || typeof input.params !== "object" || Array.isArray(input.params)) throw new AgentError("INVALID_PARAMS", "params must be an object.");
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 3e5) throw new AgentError("INVALID_TIMEOUT", "timeoutMs must be an integer between 100 and 300000.");
    return input;
  }

  // src/plugin/design.ts
  var NODE_TYPES = ["FRAME", "COMPONENT", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR", "VECTOR", "SVG", "INSTANCE", "BOOLEAN", "IMAGE"];
  var PROPERTIES = ["name", "x", "y", "width", "height", "rotation", "visible", "locked", "opacity", "blendMode", "fills", "strokes", "strokeWeight", "strokeAlign", "dashPattern", "effects", "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius", "cornerSmoothing", "clipsContent", "layoutMode", "layoutWrap", "itemSpacing", "counterAxisSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "primaryAxisAlignItems", "counterAxisAlignItems", "primaryAxisSizingMode", "counterAxisSizingMode", "layoutSizingHorizontal", "layoutSizingVertical", "layoutGrow", "layoutAlign", "layoutPositioning", "minWidth", "maxWidth", "minHeight", "maxHeight", "constraints", "characters", "fontName", "fontSize", "textAutoResize", "textAlignHorizontal", "textAlignVertical", "lineHeight", "letterSpacing", "paragraphSpacing", "textCase", "textDecoration", "textTruncation", "maxLines", "vectorPaths", "pointCount", "innerRadius", "arcData", "layoutGrids"];
  var lastProps = ["layoutSizingHorizontal", "layoutSizingVertical", "layoutGrow", "layoutAlign", "layoutPositioning"];
  function solid(hex) {
    const value = hex.replace(/^#/, "");
    if (!/^(?:[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(value)) throw new AgentError("INVALID_COLOR", "Use a six- or eight-digit hex color.");
    return { type: "SOLID", color: { r: parseInt(value.slice(0, 2), 16) / 255, g: parseInt(value.slice(2, 4), 16) / 255, b: parseInt(value.slice(4, 6), 16) / 255 }, opacity: value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1 };
  }
  function checkProps(props, type) {
    if (!props || typeof props !== "object" || Array.isArray(props)) throw new AgentError("INVALID_PROPS", "Node props must be an object.");
    for (const [key, value] of Object.entries(props)) {
      if (!PROPERTIES.includes(key)) throw new AgentError("INVALID_PROPERTY", `Unsupported property: ${key}.`, "Use the Figma API through exec for methods or advanced fields.");
      if ((key === "width" || key === "height") && (typeof value !== "number" || !Number.isFinite(value) || (key === "height" && type === "LINE" ? value !== 0 : value < 0.01))) throw new AgentError("INVALID_SIZE", `${key} must be at least 0.01; a LINE height must be exactly 0.`);
      if (key === "fontName" && (!value || typeof value.family !== "string" || typeof value.style !== "string")) throw new AgentError("INVALID_FONT", "fontName needs family and style.");
    }
  }
  function validateSpec(spec) {
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) throw new AgentError("INVALID_SPEC", "The design must contain a nonempty nodes array.");
    let count = 0;
    const keys = /* @__PURE__ */ new Set();
    const visit = (n, depth) => {
      if (++count > 2e3 || depth > 30) throw new AgentError("SPEC_TOO_LARGE", "A design may have at most 2000 nodes and 30 nesting levels.");
      if (!n || !NODE_TYPES.includes(n.type)) throw new AgentError("INVALID_NODE_TYPE", `Unsupported node type: ${n?.type}.`);
      checkProps(n.props ?? {}, n.type);
      if (n.key !== void 0) {
        if (typeof n.key !== "string" || !n.key || keys.has(n.key)) throw new AgentError("DUPLICATE_KEY", "Node keys must be nonempty unique strings.");
        keys.add(n.key);
      }
      if (n.tag !== void 0 && (typeof n.tag !== "string" || n.tag.length > 200)) throw new AgentError("INVALID_TAG", "Node tags must be strings of at most 200 characters.");
      if (n.type === "SVG" && typeof n.svg !== "string") throw new AgentError("INVALID_SVG", "SVG nodes require an svg string.");
      if (n.type === "INSTANCE" && !n.componentId && !n.componentKey) throw new AgentError("INVALID_INSTANCE", "An instance requires componentId or componentKey.");
      if (n.type === "BOOLEAN" && (!["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"].includes(n.operation ?? "") || !Array.isArray(n.children) || n.children.length < 2)) throw new AgentError("INVALID_BOOLEAN", "BOOLEAN needs an operation and at least two children in bottom-to-top order.");
      if (n.type === "IMAGE" && typeof n.imageBase64 !== "string" && typeof n.imagePath !== "string") throw new AgentError("INVALID_IMAGE", "IMAGE needs imagePath (CLI) or imageBase64 (Plugin API).");
      if (n.children !== void 0 && (!Array.isArray(n.children) || !["FRAME", "COMPONENT", "BOOLEAN"].includes(n.type))) throw new AgentError("INVALID_CHILDREN", "Declarative children are supported on FRAME, COMPONENT and BOOLEAN.");
      for (const child of n.children ?? []) visit(child, depth + 1);
    };
    for (const n of spec.nodes) visit(n, 0);
  }
  async function getNode(api, id) {
    if (typeof id !== "string" || !id) throw new AgentError("NODE_REQUIRED", "A node ID is required.");
    const node = await api.getNodeByIdAsync(id);
    if (!node) throw new AgentError("NODE_NOT_FOUND", `No node exists with ID ${id}.`, "Inspect the current document to obtain a fresh node ID.");
    return node;
  }
  async function loadFonts(api, node, nextFont) {
    const fonts = node.fontName === api.mixed ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
    if (nextFont) fonts.push(nextFont);
    const unique = new Map(fonts.map((f) => [JSON.stringify(f), f]));
    await Promise.all([...unique.values()].map((font) => api.loadFontAsync(font)));
  }
  function assignProps(node, props, phase) {
    for (const key of Object.keys(props)) if (!(key in node)) throw new AgentError("PROPERTY_NOT_SUPPORTED", `${node.type} does not support ${key}.`);
    if (phase === "base") {
      if (props.fontName) node.fontName = props.fontName;
      if (props.layoutMode !== void 0) node.layoutMode = props.layoutMode;
      if (props.width !== void 0 || props.height !== void 0) node.resize(props.width ?? node.width, props.height ?? node.height);
    }
    for (const [key, value] of Object.entries(props)) {
      if (["width", "height", "fontName", "layoutMode"].includes(key)) continue;
      if (lastProps.includes(key) !== (phase === "layout")) continue;
      node[key] = value;
    }
  }
  async function applyDesign(api, spec) {
    validateSpec(spec);
    const parent = spec.parentId ? await getNode(api, spec.parentId) : api.currentPage;
    if (!["PAGE", "FRAME", "COMPONENT", "SECTION"].includes(parent.type)) throw new AgentError("INVALID_PARENT", "Choose a page, frame, component, or section as parent.");
    const fonts = /* @__PURE__ */ new Map();
    const collect = (n) => {
      if (n.type === "TEXT") {
        const f = n.props?.fontName ?? { family: "Inter", style: "Regular" };
        fonts.set(JSON.stringify(f), f);
      }
      n.children?.forEach(collect);
    };
    spec.nodes.forEach(collect);
    await Promise.all([...fonts.values()].map((f) => api.loadFontAsync(f)));
    const created = [];
    const keys = /* @__PURE__ */ Object.create(null);
    const create = async (n, p) => {
      let node;
      switch (n.type) {
        case "FRAME":
          node = api.createFrame();
          break;
        case "COMPONENT":
          node = api.createComponent();
          break;
        case "TEXT":
          node = api.createText();
          break;
        case "RECTANGLE":
          node = api.createRectangle();
          break;
        case "ELLIPSE":
          node = api.createEllipse();
          break;
        case "LINE":
          node = api.createLine();
          break;
        case "POLYGON":
          node = api.createPolygon();
          break;
        case "STAR":
          node = api.createStar();
          break;
        case "VECTOR":
          node = api.createVector();
          break;
        case "IMAGE": {
          if (!n.imageBase64) throw new AgentError("IMAGE_NOT_PREPARED", "Local image paths must be loaded by the CLI before apply.");
          const image = api.createImage(api.base64Decode(n.imageBase64));
          const size = await image.getSizeAsync();
          node = api.createRectangle();
          created.push(node);
          node.resize(n.props?.width ?? size.width, n.props?.height ?? size.height);
          node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
          break;
        }
        case "BOOLEAN": {
          const stage = api.createFrame();
          created.push(stage);
          p.appendChild(stage);
          stage.fills = [];
          stage.clipsContent = false;
          const operands = [];
          for (const child of n.children) operands.push(await create(child, stage));
          node = api[n.operation.toLowerCase()](operands, p);
          created.push(node);
          stage.remove();
          break;
        }
        case "SVG":
          node = api.createNodeFromSvg(n.svg);
          break;
        case "INSTANCE": {
          const component = n.componentId ? await getNode(api, n.componentId) : await api.importComponentByKeyAsync(n.componentKey);
          if (component.type !== "COMPONENT") throw new AgentError("INVALID_COMPONENT", "The supplied node is not a component.");
          node = component.createInstance();
          break;
        }
        default:
          throw new AgentError("INVALID_NODE_TYPE", n.type);
      }
      if (!created.includes(node)) created.push(node);
      p.appendChild(node);
      if (node.type === "TEXT") {
        node.fontName = n.props?.fontName ?? { family: "Inter", style: "Regular" };
        node.textAutoResize = n.props?.textAutoResize ?? (n.props?.width ? "HEIGHT" : "WIDTH_AND_HEIGHT");
      }
      const props = { ...n.props };
      if ((node.type === "FRAME" || node.type === "COMPONENT") && ["HORIZONTAL", "VERTICAL"].includes(props.layoutMode)) {
        const horizontalAxis = props.layoutMode === "HORIZONTAL" ? "primaryAxisSizingMode" : "counterAxisSizingMode";
        const verticalAxis = props.layoutMode === "VERTICAL" ? "primaryAxisSizingMode" : "counterAxisSizingMode";
        if (props.width !== void 0 && props.layoutSizingHorizontal === void 0 && props[horizontalAxis] === void 0) props[horizontalAxis] = "FIXED";
        if (props.height !== void 0 && props.layoutSizingVertical === void 0 && props[verticalAxis] === void 0) props[verticalAxis] = "FIXED";
      }
      assignProps(node, props, "base");
      if (n.type !== "BOOLEAN") for (const child of n.children ?? []) await create(child, node);
      assignProps(node, props, "layout");
      if (n.key) keys[n.key] = node.id;
      if (n.tag) node.setPluginData("figma-agent:tag", n.tag);
      return node;
    };
    try {
      const roots = [];
      for (const n of spec.nodes) roots.push(await create(n, parent));
      return { roots: roots.map((n) => ({ id: n.id, name: n.name, type: n.type })), keys, created: created.filter((n) => !n.removed).length };
    } catch (error) {
      const failures = [];
      for (const node of created.reverse()) {
        try {
          if (!node.removed) node.remove();
        } catch {
          failures.push(node.id);
        }
      }
      if (failures.length) throw new AgentError("ROLLBACK_INCOMPLETE", error instanceof Error ? error.message : String(error), "Inspect these nodes before retrying.", { nodes: failures });
      throw error;
    }
  }
  async function patchNode(api, id, props) {
    const node = await getNode(api, id);
    checkProps(props, node.type);
    for (const key of Object.keys(props)) if (!(key in node)) throw new AgentError("PROPERTY_NOT_SUPPORTED", `${node.type} does not support ${key}.`);
    if (node.type === "TEXT") await loadFonts(api, node, props.fontName);
    const old = {};
    for (const key of Object.keys(props)) {
      if (node[key] === api.mixed) throw new AgentError("MIXED_PROPERTY", `${key} contains mixed values.`, "Use exec and Figma range setters to preserve mixed formatting.");
      old[key] = node[key];
    }
    if (props.width !== void 0 || props.height !== void 0) {
      old.width = node.width;
      old.height = node.height;
    }
    try {
      assignProps(node, props, "base");
      assignProps(node, props, "layout");
    } catch (error) {
      try {
        assignProps(node, old, "base");
        assignProps(node, old, "layout");
      } catch {
        throw new AgentError("ROLLBACK_INCOMPLETE", "The patch failed and some original properties could not be restored.", "Inspect the node before continuing.", { nodeId: id });
      }
      throw error;
    }
    return { id: node.id, name: node.name, type: node.type };
  }
  function inspectNode(node, depth = 2, limit = 1e3) {
    let remaining = limit;
    const visit = (n, level) => {
      remaining--;
      const result = { id: n.id, type: n.type, name: n.name };
      for (const key of [...PROPERTIES, "absoluteBoundingBox", "absoluteRenderBounds", "componentProperties", "boundVariables", "booleanOperation"]) {
        if (key === "name" || !(key in n)) continue;
        const value = n[key];
        if (typeof value === "symbol") result[key] = "MIXED";
        else if (value !== void 0) result[key] = value;
      }
      if ("children" in n) {
        result.childCount = n.children.length;
        if (level > 0) {
          result.children = [];
          for (const child of n.children) {
            if (remaining <= 0) break;
            result.children.push(visit(child, level - 1));
          }
          if (result.children.length !== n.children.length) result.truncated = true;
        } else if (n.children.length) result.truncated = true;
      }
      return result;
    };
    return visit(node, depth);
  }

  // src/plugin/node-roles.ts
  var GUIDE_TAG = "icon-guides-v1";
  var ARTWORK_TAG = "icon-artwork-v1";
  function isGuide(node) {
    let current = node;
    while (current) {
      if (current.getPluginData("figma-agent:tag") === GUIDE_TAG) return true;
      current = current.parent;
    }
    return false;
  }
  function artworkOf(node) {
    if (!("children" in node)) return void 0;
    const child = node.children.find((child2) => child2.getPluginData("figma-agent:tag") === ARTWORK_TAG);
    return child && child.type !== "PAGE" ? child : void 0;
  }
  function containsGuides(node) {
    return node.getPluginData("figma-agent:tag") === GUIDE_TAG || "children" in node && node.children.some(containsGuides);
  }

  // src/plugin/geometry.ts
  var BOOLEAN_OPERATIONS = ["union", "subtract", "intersect", "exclude"];
  var IDENTITY = [[1, 0, 0], [0, 1, 0]];
  function multiply(a, b) {
    return [[a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]], [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]]];
  }
  function inverse(t) {
    const d = t[0][0] * t[1][1] - t[0][1] * t[1][0];
    if (!Number.isFinite(d) || Math.abs(d) < 1e-10) throw new AgentError("SINGULAR_TRANSFORM", "The target parent has a non-invertible transform.");
    const a = t[1][1] / d, b = -t[0][1] / d, c = -t[1][0] / d, e = t[0][0] / d;
    return [[a, b, -a * t[0][2] - b * t[1][2]], [c, e, -c * t[0][2] - e * t[1][2]]];
  }
  function pageOf(node) {
    let p = node;
    while (p && p.type !== "PAGE") p = p.parent;
    return p;
  }
  function ancestors(node) {
    const result = [];
    let p = node.parent;
    while (p) {
      result.push(p);
      p = p.parent;
    }
    return result;
  }
  async function fontsIn(api, node) {
    if (node.type === "TEXT") await loadFonts(api, node);
    if ("children" in node) for (const child of node.children) await fontsIn(api, child);
  }
  async function booleanSet(api, id, operation) {
    if (!BOOLEAN_OPERATIONS.includes(operation)) throw new AgentError("INVALID_OPERATION", "Choose union, subtract, intersect or exclude.");
    const node = await getNode(api, id);
    if (node.type !== "BOOLEAN_OPERATION") throw new AgentError("NOT_A_BOOLEAN", "The node is not an editable boolean operation.");
    node.booleanOperation = operation.toUpperCase();
    return { id: node.id, operation: node.booleanOperation, operandIds: node.children.map((n) => n.id) };
  }
  async function geometry(api, request) {
    const { operation, ids } = request;
    if (![...BOOLEAN_OPERATIONS, "flatten", "outline"].includes(operation)) throw new AgentError("INVALID_OPERATION", "Choose union, subtract, intersect, exclude, flatten or outline.");
    const minimum = BOOLEAN_OPERATIONS.includes(operation) ? 2 : 1;
    if (!Array.isArray(ids) || ids.length < minimum || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) throw new AgentError("INVALID_OPERANDS", `Pass ${minimum}\u2013100 distinct scene node IDs.`);
    if (operation === "outline" && ids.length !== 1) throw new AgentError("INVALID_OPERANDS", "outline accepts exactly one node.");
    if (request.keepInputs !== void 0 && typeof request.keepInputs !== "boolean") throw new AgentError("INVALID_OPTIONS", "keepInputs must be boolean.");
    if (request.name !== void 0 && typeof request.name !== "string") throw new AgentError("INVALID_OPTIONS", "name must be a string.");
    const sources = await Promise.all(ids.map((id) => getNode(api, id)));
    const allowed = ["RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR", "VECTOR", "TEXT", "BOOLEAN_OPERATION", "GROUP", "FRAME", "COMPONENT", "INSTANCE"];
    for (const node of sources) {
      if (isGuide(node) || containsGuides(node)) throw new AgentError("GUIDE_OPERAND", "Construction guides cannot be consumed by boolean operations.", "Use the Artwork frame, or icon shape <workbench-id> <shape> to create an unlocked operand.");
      if (!allowed.includes(node.type)) throw new AgentError("INVALID_OPERAND_TYPE", `${node.type} is not a geometry operand.`);
      const parents = ancestors(node);
      if (parents.some((p) => ids.includes(p.id))) throw new AgentError("OVERLAPPING_OPERANDS", "Operands cannot include both an ancestor and its descendant.");
      if (!request.keepInputs && parents.some((p) => p.type === "INSTANCE")) throw new AgentError("INSTANCE_CHILD", "An instance child cannot be replaced.", "Use --keep-inputs to operate on a copy.");
    }
    const nodes = sources;
    const page = pageOf(nodes[0]);
    if (!page || nodes.some((n) => pageOf(n) !== page)) throw new AgentError("DIFFERENT_PAGES", "All operands must be on the same page.");
    if (!request.parentId && nodes.some((n) => n.parent !== nodes[0].parent)) throw new AgentError("PARENT_REQUIRED", "Operands have different parents.", "Pass --parent to specify the result container.");
    const parent = request.parentId ? await getNode(api, request.parentId) : nodes[0].parent;
    if (!["PAGE", "FRAME", "GROUP", "COMPONENT", "SECTION"].includes(parent.type) || pageOf(parent) !== page) throw new AgentError("INVALID_PARENT", "Choose a container on the operands\u2019 page.");
    if (ids.includes(parent.id) || ancestors(parent).some((p) => ids.includes(p.id) || p.type === "INSTANCE") || parent.type === "INSTANCE") throw new AgentError("INVALID_PARENT", "The result parent cannot be inside an operand or an instance.");
    const target = parent;
    if (operation === "outline" && !("outlineStroke" in nodes[0])) throw new AgentError("NO_STROKE_API", "This node cannot be outlined.");
    await Promise.all(nodes.map((n) => fontsIn(api, n)));
    const positions = nodes.map((n) => n.absoluteTransform.map((row) => [...row]));
    const targetTransform = "absoluteTransform" in parent ? parent.absoluteTransform : IDENTITY;
    const inverseTarget = inverse(targetTransform);
    const stage = api.createFrame();
    const clones = [];
    let result;
    let committed = false;
    const removed = [];
    try {
      page.appendChild(stage);
      stage.name = "Boolean staging";
      stage.relativeTransform = IDENTITY;
      stage.visible = false;
      stage.clipsContent = false;
      stage.fills = [];
      for (let i = 0; i < nodes.length; i++) {
        const clone = nodes[i].clone();
        clones.push(clone);
        stage.appendChild(clone);
        clone.relativeTransform = positions[i];
      }
      if (operation === "outline") {
        result = clones[0].outlineStroke() ?? void 0;
        if (!result) throw new AgentError("NO_VISIBLE_STROKE", "The node has no stroke to outline.");
      } else if (operation === "flatten") result = api.flatten(clones, stage);
      else result = api[operation](clones, stage);
      if (request.name) result.name = request.name;
      const absolute = result.absoluteTransform;
      target.appendChild(result);
      if ("layoutMode" in parent && parent.layoutMode !== "NONE") result.layoutPositioning = "ABSOLUTE";
      result.relativeTransform = multiply("absoluteTransform" in parent ? inverse(parent.absoluteTransform) : inverseTarget, absolute);
      committed = true;
      if (!request.keepInputs) for (const node of nodes) {
        node.remove();
        removed.push(node.id);
      }
      return { id: result.id, type: result.type, name: result.name, operation, sourceIds: ids, removedIds: removed, keptInputs: !!request.keepInputs, operandIds: result.type === "BOOLEAN_OPERATION" ? result.children.map((n) => n.id) : [], bounds: result.absoluteBoundingBox };
    } catch (error) {
      if (committed) throw new AgentError("GEOMETRY_COMMIT_INCOMPLETE", error instanceof Error ? error.message : String(error), "The result exists, but not all originals were removed. Inspect the listed IDs before continuing.", { resultId: result?.id, removedIds: removed, remainingIds: ids.filter((id) => !removed.includes(id)) });
      if (result && !result.removed && result.parent !== stage) result.remove();
      throw error;
    } finally {
      for (const clone of clones) if (!clone.removed && clone !== result && clone.parent !== result) clone.remove();
      if (!stage.removed) stage.remove();
    }
  }

  // src/plugin/keylines.ts
  var SHAPE_TAG = "icon-keyline-shape:";
  var KEYLINE_SHAPES = ["circle", "inner-circle", "square", "portrait", "landscape"];
  async function shapeFromKeyline(api, id, shape, color = "#28634B", name) {
    if (!KEYLINE_SHAPES.includes(shape)) throw new AgentError("INVALID_KEYLINE_SHAPE", "Choose circle, inner-circle, square, portrait or landscape.");
    const fill = solid(color), workbench = await getNode(api, id), artwork = artworkOf(workbench);
    if (!artwork || artwork.type !== "FRAME" || !("children" in workbench)) throw new AgentError("KEYLINE_WORKBENCH_REQUIRED", "Choose the workbench ID returned when applying an icon construction grid.");
    const guides = workbench.children.find((n) => n.getPluginData("figma-agent:tag") === GUIDE_TAG);
    const prototype = guides && "children" in guides ? guides.children.find((n) => n.getPluginData("figma-agent:tag") === SHAPE_TAG + shape) : null;
    if (!prototype || prototype.type !== "ELLIPSE" && prototype.type !== "RECTANGLE") throw new AgentError("KEYLINE_MISSING", "This construction grid no longer contains the requested shape.");
    const position = prototype.absoluteTransform;
    const copy = prototype.clone();
    try {
      artwork.appendChild(copy);
      copy.relativeTransform = multiply(inverse(artwork.absoluteTransform), position);
      copy.locked = false;
      copy.visible = true;
      copy.opacity = 1;
      copy.name = name ?? "Shape / " + shape;
      copy.setPluginData("figma-agent:tag", "");
      if ("fills" in copy) copy.fills = [fill];
      if ("strokes" in copy) copy.strokes = [];
      return { id: copy.id, type: copy.type, name: copy.name, artworkId: artwork.id, workbenchId: workbench.id, source: shape, bounds: copy.absoluteBoundingBox };
    } catch (error) {
      copy.remove();
      throw error;
    }
  }

  // src/plugin/audit.ts
  async function audit(api, id) {
    const root = await getNode(api, id);
    if (!("absoluteBoundingBox" in root)) throw new AgentError("INVALID_AUDIT_ROOT", "Audit a scene node or frame.");
    const counts = {};
    const text = [];
    const fullFrameImages = [];
    const overflow = [];
    let total = 0, autoLayout = 0, vectorShapes = 0, imageNodes = 0, iconMarks = 0;
    const bounds = root.absoluteBoundingBox;
    function visit(node, visible) {
      if (node.getPluginData("figma-agent:tag") === GUIDE_TAG) return;
      if (++total > 1e4) throw new AgentError("AUDIT_TOO_LARGE", "Audit a smaller frame; more than 10000 nodes were encountered.");
      counts[node.type] = (counts[node.type] ?? 0) + 1;
      visible = visible && node.visible && (!("opacity" in node) || node.opacity > 0);
      if (!visible) return;
      if (node.type === "TEXT" && node.characters.trim()) text.push({ id: node.id, characters: node.characters.slice(0, 300) });
      if ("layoutMode" in node && node.layoutMode !== "NONE") autoLayout++;
      const images = "fills" in node && Array.isArray(node.fills) && node.fills.some((p) => p.type === "IMAGE" && p.visible !== false);
      if (images) {
        imageNodes++;
        const box = node.absoluteBoundingBox;
        if (box && bounds && box.width >= bounds.width * 0.9 && box.height >= bounds.height * 0.9) fullFrameImages.push(node.id);
      } else if (["RECTANGLE", "ELLIPSE", "LINE", "VECTOR", "POLYGON", "STAR", "BOOLEAN_OPERATION"].includes(node.type)) vectorShapes++;
      if (!images && ["VECTOR", "ELLIPSE", "POLYGON", "STAR", "BOOLEAN_OPERATION"].includes(node.type)) iconMarks++;
      const parent = node.parent;
      if (parent && "clipsContent" in parent && parent.clipsContent && "absoluteBoundingBox" in parent && node.absoluteBoundingBox && parent.absoluteBoundingBox) {
        const a = node.absoluteBoundingBox, b = parent.absoluteBoundingBox;
        if (a.x < b.x - 1 || a.y < b.y - 1 || a.x + a.width > b.x + b.width + 1 || a.y + a.height > b.y + b.height + 1) overflow.push({ id: node.id, parentId: parent.id });
      }
      if ("children" in node) node.children.forEach((n) => visit(n, visible));
    }
    visit(root, true);
    return { rootId: id, tag: root.getPluginData("figma-agent:tag"), bounds, total, counts, textCount: text.length, text: text.slice(0, 100), autoLayoutCount: autoLayout, vectorShapeCount: vectorShapes, imageNodeCount: imageNodes, fullFrameImageNodeIds: fullFrameImages, possibleClippedNodes: overflow, hasEditableIcon: iconMarks > 0 && fullFrameImages.length === 0, hasEditableUI: text.length > 0 && (autoLayout > 0 || vectorShapes > 0), note: "Structural checks and axis-aligned clipping candidates do not establish visual fidelity. Inspect the exported image." };
  }

  // src/plugin/commands.ts
  function getContext(api) {
    return { document: api.root.name, page: api.currentPage.name, pageId: api.currentPage.id, selection: api.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type })) };
  }
  function integer(value, fallback, min, max) {
    if (value === void 0) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new AgentError("INVALID_NUMBER", `Expected an integer from ${min} to ${max}.`);
    return value;
  }
  function helpers(api) {
    return {
      solid,
      node: (id) => getNode(api, id),
      inspect: (node, depth = 2) => inspectNode(node, depth),
      loadFonts: (node, font) => loadFonts(api, node, font),
      apply: (nodes, parentId) => applyDesign(api, { nodes, parentId }),
      patch: (id, props) => patchNode(api, id, props),
      boolean: (request) => geometry(api, request)
    };
  }
  async function execute(api, command) {
    const p = command.params;
    switch (command.method) {
      case "icon-shape":
        return shapeFromKeyline(api, p.id, p.shape, p.color, p.name);
      case "boolean":
        return geometry(api, p);
      case "boolean-set":
        return booleanSet(api, p.id, p.operation);
      case "audit":
        return audit(api, p.id);
      case "document":
        return { ...getContext(api), pages: api.root.children.map((n) => ({ id: n.id, name: n.name })), viewport: { center: api.viewport.center, zoom: api.viewport.zoom } };
      case "selection":
        return api.currentPage.selection.map((n) => inspectNode(n, integer(p.depth, 1, 0, 10)));
      case "inspect":
        return inspectNode(p.id ? await getNode(api, p.id) : api.currentPage, integer(p.depth, 2, 0, 10), integer(p.limit, 1e3, 1, 5e3));
      case "find": {
        const scope = p.parentId ? await getNode(api, p.parentId) : api.currentPage;
        if (!("children" in scope)) throw new AgentError("INVALID_SCOPE", "The search scope must contain children.");
        const limit = integer(p.limit, 50, 1, 1e3);
        const found = [];
        let more = false;
        const query = String(p.query ?? "").toLocaleLowerCase();
        const walk = (node) => {
          if (found.length >= limit) {
            more = true;
            return;
          }
          if (node.name.toLocaleLowerCase().includes(query) && (!p.type || node.type === p.type)) found.push({ id: node.id, name: node.name, type: node.type });
          if ("children" in node) for (const child of node.children) {
            walk(child);
            if (more) break;
          }
        };
        for (const child of scope.children) {
          walk(child);
          if (more) break;
        }
        return { nodes: found, truncated: more, scopeId: scope.id };
      }
      case "fonts":
        return (await api.listAvailableFontsAsync()).filter((f) => !p.family || f.fontName.family.toLowerCase().includes(String(p.family).toLowerCase())).map((f) => f.fontName);
      case "apply":
        return applyDesign(api, p.spec);
      case "patch":
        return patchNode(api, p.id, p.props);
      case "delete": {
        if (!Array.isArray(p.ids) || !p.ids.length) throw new AgentError("NODE_REQUIRED", "Pass at least one node ID.");
        const nodes = await Promise.all(p.ids.map((id) => getNode(api, id)));
        if (nodes.some((n) => n.type === "DOCUMENT" || n.type === "PAGE")) throw new AgentError("INVALID_DELETE", "delete accepts scene nodes only.");
        const removed = [];
        try {
          for (const node of nodes) {
            if (!node.removed) {
              node.remove();
              removed.push(node.id);
            }
          }
        } catch (error) {
          throw new AgentError("PARTIAL_DELETE", error instanceof Error ? error.message : String(error), "Inspect the remaining IDs before continuing.", { removed });
        }
        return { removed };
      }
      case "select": {
        if (!Array.isArray(p.ids)) throw new AgentError("NODE_REQUIRED", "ids must be an array.");
        const nodes = await Promise.all(p.ids.map((id) => getNode(api, id)));
        for (const n of nodes) {
          let ancestor = n;
          while (ancestor && ancestor.type !== "PAGE") ancestor = ancestor.parent;
          if (ancestor !== api.currentPage || n.type === "PAGE") throw new AgentError("WRONG_PAGE", "All selected nodes must be on the current page.");
        }
        api.currentPage.selection = nodes;
        if (nodes.length) api.viewport.scrollAndZoomIntoView(nodes);
        return getContext(api);
      }
      case "export": {
        const source = p.id ? await getNode(api, p.id) : api.currentPage.selection.length === 1 ? api.currentPage.selection[0] : null;
        const node = source && !p.includeGuides ? artworkOf(source) ?? source : source;
        if (!node || !("exportAsync" in node)) throw new AgentError("EXPORT_NODE_REQUIRED", "Pass an exportable node ID or select exactly one node in Figma.");
        const format = String(p.format ?? "PNG").toUpperCase();
        if (!["PNG", "JPG", "SVG", "PDF"].includes(format)) throw new AgentError("INVALID_FORMAT", "Choose PNG, JPG, SVG, or PDF.");
        const scale = p.scale ?? 1;
        if (typeof scale !== "number" || scale <= 0 || scale > 4) throw new AgentError("INVALID_SCALE", "Export scale must be greater than 0 and at most 4.");
        const settings = format === "PNG" || format === "JPG" ? { format, constraint: { type: "SCALE", value: scale }, useAbsoluteBounds: !!p.layoutBounds } : { format };
        const bytes = await node.exportAsync(settings);
        if (bytes.length > 16 * 1024 * 1024) throw new AgentError("EXPORT_TOO_LARGE", "Export exceeds 16 MiB.", "Export a smaller frame or reduce --scale.");
        return { nodeId: node.id, requestedNodeId: source?.id, guidesExcluded: source !== node, format, base64: api.base64Encode(bytes), byteLength: bytes.length };
      }
      case "image": {
        if (typeof p.base64 !== "string") throw new AgentError("IMAGE_REQUIRED", "A base64 image is required.");
        const parent = p.parentId ? await getNode(api, p.parentId) : api.currentPage;
        if (!["PAGE", "FRAME", "COMPONENT", "SECTION"].includes(parent.type)) throw new AgentError("INVALID_PARENT", "Choose a page, frame, component, or section.");
        const image = api.createImage(api.base64Decode(p.base64));
        const size = await image.getSizeAsync();
        const node = api.createRectangle();
        try {
          parent.appendChild(node);
          node.name = p.name ?? "Image";
          node.resize(p.width ?? size.width, p.height ?? size.height);
          node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
          return { id: node.id, name: node.name, width: node.width, height: node.height };
        } catch (error) {
          node.remove();
          throw error;
        }
      }
      case "variables":
        return { collections: (await api.variables.getLocalVariableCollectionsAsync()).map((c) => ({ id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId, variableIds: c.variableIds })), variables: (await api.variables.getLocalVariablesAsync()).map((v) => ({ id: v.id, name: v.name, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, valuesByMode: v.valuesByMode, scopes: v.scopes })) };
      case "styles":
        return { paints: (await api.getLocalPaintStylesAsync()).map((s) => ({ id: s.id, name: s.name, paints: s.paints })), texts: (await api.getLocalTextStylesAsync()).map((s) => ({ id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight })), effects: (await api.getLocalEffectStylesAsync()).map((s) => ({ id: s.id, name: s.name, effects: s.effects })) };
      case "eval": {
        if (typeof p.code !== "string" || !p.code.trim()) throw new AgentError("CODE_REQUIRED", "Provide JavaScript with a JSON-serializable return value.");
        const run = new Function("figma", "h", "args", `"use strict"; return (async () => {
${p.code}
})();`);
        return await run(api, helpers(api), p.args ?? {});
      }
    }
  }

  // src/plugin/main.ts
  figma.showUI(__html__, { width: 368, height: 540, themeColors: true });
  function start() {
    let busy = false;
    const replies = /* @__PURE__ */ new Map();
    const context = () => {
      let message;
      try {
        message = { type: "context", context: getContext(figma) };
      } catch (error) {
        message = { type: "context-error", error: fault(error) };
      }
      figma.ui.postMessage(message);
    };
    figma.on("selectionchange", context);
    figma.on("currentpagechange", context);
    figma.ui.onmessage = async (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready" || message.type === "context") {
        context();
        return;
      }
      if (message.type !== "command") return;
      const id = message.command?.id ?? "";
      let reply;
      let ownsBusy = false;
      let fingerprint = "";
      try {
        const command = validateCommand(message.command);
        fingerprint = JSON.stringify({ method: command.method, params: command.params });
        const cached = replies.get(id);
        if (cached) {
          if (cached.fingerprint !== fingerprint) throw new Error("Request ID was reused with different command data.");
          figma.ui.postMessage({ type: "result", reply: cached.reply });
          return;
        }
        if (busy) throw new Error("The previous command is still running.");
        busy = true;
        ownsBusy = true;
        const isMutation = ["apply", "patch", "delete", "image", "boolean", "boolean-set", "icon-shape", "eval"].includes(command.method);
        if (isMutation) figma.commitUndo();
        try {
          const result = await execute(figma, command);
          const json = JSON.stringify(result ?? null);
          if (json.length > 23 * 1024 * 1024) throw new Error("Result exceeds 23 MiB. Return a smaller summary.");
          reply = { ok: true, id, result: JSON.parse(json) };
        } finally {
          if (isMutation) figma.commitUndo();
        }
      } catch (error) {
        reply = { ok: false, id, error: fault(error) };
      } finally {
        if (ownsBusy) busy = false;
      }
      if (ownsBusy) {
        replies.set(id, { fingerprint, reply });
        if (replies.size > 200) replies.delete(replies.keys().next().value);
      }
      figma.ui.postMessage({ type: "result", reply });
      context();
    };
    figma.ui.postMessage({ type: "runtime-ready", version: "0.3.3" });
    context();
  }
  try {
    start();
  } catch (error) {
    const failure = fault(error);
    console.error("[Figma Agent] Initialization failed:", failure.message);
    figma.ui.postMessage({ type: "runtime-error", version: "0.3.3", error: failure });
  }
})();
