// A small YAML reader, enough for .pages.yml: block maps and lists, flow { } and [ ], quoted strings, comments.
(function (root) {
  function stripComment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '\\' && q === '"') i++;
        else if (c === q) q = null;
      } else if (c === '"' || (c === "'" && (i === 0 || /[\s\[{,:]/.test(line[i - 1])))) q = c;
      else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }

  // Depth of unclosed brackets on a line, ignoring quoted text.
  function bracketDepth(text) {
    let d = 0, q = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '\\' && q === '"') i++;
        else if (c === q) q = null;
      } else if (c === '"' || (c === "'" && (i === 0 || /[\s\[{,:]/.test(text[i - 1])))) q = c;
      else if (c === '{' || c === '[') d++;
      else if (c === '}' || c === ']') d--;
    }
    return d;
  }

  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s[0] === '"') return JSON.parse(s);
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  function parseFlow(s) {
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function value(stops) {
      ws();
      if (s[i] === '{') return map();
      if (s[i] === '[') return list();
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i];
        let j = i + 1;
        while (j < s.length && (s[j] !== q || (q === "'" && s[j + 1] === "'"))) j += (s[j] === '\\' && q === '"') || (q === "'" && s[j] === "'") ? 2 : 1;
        const out = scalar(s.slice(i, j + 1));
        i = j + 1;
        return out;
      }
      let j = i;
      while (j < s.length && !stops.includes(s[j])) j++;
      const out = scalar(s.slice(i, j));
      i = j;
      return out;
    }
    function map() {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (s[i] === '}') { i++; return o; }
        const k = value([':', ',', '}']);
        ws();
        let v = null;
        if (s[i] === ':') { i++; v = value([',', '}']); }
        o[k] = v;
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === '}') { i++; return o; }
        else if (i >= s.length) return o;
      }
    }
    function list() {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (s[i] === ']') { i++; return a; }
        a.push(value([',', ']']));
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === ']') { i++; return a; }
        else if (i >= s.length) return a;
      }
    }
    return value([]);
  }

  function inlineValue(s) {
    s = s.trim();
    return s[0] === '{' || s[0] === '[' ? parseFlow(s) : scalar(s);
  }

  // Returns [key, rest] when text is "key: rest" (key may be quoted), else null.
  function splitKey(text) {
    if (text[0] === '{' || text[0] === '[') return null;
    let i = 0;
    if (text[0] === '"' || text[0] === "'") {
      const q = text[0];
      i = 1;
      while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1;
      i++;
      if (text[i] !== ':') return null;
      return [scalar(text.slice(0, i)), text.slice(i + 1).trim()];
    }
    for (; i < text.length; i++) {
      if (text[i] === ':' && (i === text.length - 1 || text[i + 1] === ' ')) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
    return null;
  }

  function parse(src) {
    const raw = src.replace(/\t/g, '  ').split(/\r?\n/);
    const lines = [];
    for (let n = 0; n < raw.length; n++) {
      const indent = raw[n].match(/^ */)[0].length;
      let text = stripComment(raw[n]).trim();
      if (!text || text === '---') continue;
      // Join flow collections that continue onto later lines.
      while (bracketDepth(text) > 0 && n + 1 < raw.length) text += ' ' + stripComment(raw[++n]).trim();
      lines.push({ indent, text, raw: raw[n] });
    }
    let i = 0;
    const isSeq = (l) => l.text === '-' || l.text.startsWith('- ');

    function node() {
      return isSeq(lines[i]) ? seq(lines[i].indent) : map(lines[i].indent);
    }
    function seq(ind) {
      const arr = [];
      while (i < lines.length && lines[i].indent === ind && isSeq(lines[i])) {
        const rest = lines[i].text.slice(1).trim();
        if (!rest) {
          i++;
          arr.push(i < lines.length && lines[i].indent > ind ? node() : null);
        } else if (splitKey(rest) || rest.startsWith('- ')) {
          const virt = ind + (lines[i].text.length - rest.length);
          lines[i] = { indent: virt, text: rest };
          arr.push(node());
        } else {
          i++;
          arr.push(inlineValue(rest));
        }
      }
      return arr;
    }
    function block(ind, folded) {
      const out = [];
      let base = null;
      while (i < lines.length && lines[i].indent > ind) {
        if (base === null) base = lines[i].indent;
        out.push(lines[i].raw ? lines[i].raw.slice(base) : lines[i].text);
        i++;
      }
      return out.join(folded ? ' ' : '\n');
    }
    function map(ind) {
      const obj = {};
      while (i < lines.length && lines[i].indent === ind && !isSeq(lines[i])) {
        const kv = splitKey(lines[i].text);
        if (!kv) throw new Error('Cannot read YAML line: ' + lines[i].text);
        const [key, rest] = kv;
        i++;
        if (rest === '') {
          const next = lines[i];
          obj[key] = next && (next.indent > ind || (next.indent === ind && isSeq(next))) ? node() : null;
        } else if (/^[|>][-+]?$/.test(rest)) {
          obj[key] = block(ind, rest[0] === '>');
        } else obj[key] = inlineValue(rest);
      }
      return obj;
    }
    return lines.length ? node() : null;
  }

  root.YAML = { parse };
  if (typeof module !== 'undefined') module.exports = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
