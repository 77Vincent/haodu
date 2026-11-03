/* Versioned model-input normalization, independent of dataset rejection gates.
 * v20 parity is checked against training-produced text/offset fixtures. All
 * internal coordinates are Unicode code points; exported offsets are UTF-16.
 */
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HaoduMultiCutInput = api;
})(globalThis, function createInputAPI() {
  'use strict';
  const HAN = /^[\u3007\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\u{30000}-\u{323af}]$/u;
  const HSPACE = /^[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/u;
  // Python Unicode whitespace, including C0 separators, excluding U+FEFF.
  const SPACE = '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
  const IS_SPACE = new RegExp(`^${SPACE}$`, 'u');
  const ALNUM = /^[\p{L}\p{N}]$/u;
  const ASCII_ALNUM = /^[A-Za-z0-9]$/;
  const SIGN = '[+\\-−﹢﹣＋－]';
  const NUMBER = SIGN + '? *(?:\\d+(?:[.．]\\d*)?|[.．]\\d+)(?:[eEｅＥ]' + SIGN + '?\\d+)?';
  const CONTEXT_NUMBER = SIGN + '?(?:\\d+(?:[.．]\\d+)?|[.．]\\d+)(?:[eEｅＥ]' + SIGN + '?\\d+)?';
  const NUMERIC_TOKEN = /^[\p{Nd}A-Za-zＡ-Ｚａ-ｚ_+\-−﹢﹣＋－.．%％﹪]$/u;
  const fold = text => text.normalize('NFKC');
  const fragment = text => fold(text).replace(new RegExp(`${SPACE}+`, 'gu'), ' ').replace(/^ +| +$/g, '');
  const regex = (pattern, flags = '') => new RegExp(pattern.replace(/\\d/g, '\\p{Nd}'), `dgu${flags}`);
  function matches(text, pattern) {
    const offsets = new Map([[0, 0]]);
    let utf16 = 0, codepoints = 0;
    for (const c of text) { utf16 += c.length; offsets.set(utf16, ++codepoints); }
    pattern.lastIndex = 0;
    return Array.from(text.matchAll(pattern), m => ({
      start: offsets.get(m.index), end: offsets.get(m.index + m[0].length),
      groupStart: m.indices[1] ? offsets.get(m.indices[1][0]) : null,
    }));
  }

  function createNormalizer(policy) {
    if (policy?.standard !== 'unicode-context-v20') throw Error('Unsupported multi-cut input policy');
    const fixed = new Set(policy.proxy_punctuation), conditional = new Set(policy.conditional_proxy_punctuation);
    const quotePairs = new Map(policy.quote_boundaries.pairs), wrapperPairs = new Map(policy.wrapper_boundaries.pairs);
    const quotes = new Set([...quotePairs.keys(), ...quotePairs.values()]);
    const wrappers = new Set([...wrapperPairs.keys(), ...wrapperPairs.values()]);
    const closingQuotes = new Set([...quotePairs.values()].filter(c => !quotePairs.has(c)));
    const line = regex(policy.line_boundaries);
    const isLine = c => c !== undefined && matches(c, line).some(m => m.start === 0 && m.end === 1);
    const structures = Object.entries(policy.protected_structures.patterns).map(([name, value]) => [name, regex(value, 'i')]);
    const sequences = Object.values(policy.fixed_proxy_patterns).map(p => regex(p));
    const numericCommas = regex('(?<![\\d.．])' + NUMBER + ' *(，) *(?=' + NUMBER + ')');
    const bothCommas = regex('(?<![\\d.．])' + NUMBER + ' *([,，]) *(?=' + NUMBER + ')');
    const numericContext = new Map([
      [',', regex('^(?:' + CONTEXT_NUMBER + '[%％﹪])$')],
      [';', regex('^(?:' + CONTEXT_NUMBER + ')$')],
    ]);
    const units = new Set(policy.conditional_unit_neighbors);

    function boundaryRoles(chars) {
      const roles = new Map(), opened = new Set();
      chars.forEach((c, i) => {
        if (isLine(c) || c === '\0') opened.clear();
        else if (closingQuotes.has(c)) roles.set(i, 'close');
        else if (quotePairs.has(c)) {
          if (quotePairs.get(c) !== c) roles.set(i, 'open');
          else if ("'＇".includes(c) && ASCII_ALNUM.test(chars[i-1] || '') && ASCII_ALNUM.test(chars[i+1] || '')) return;
          else if (opened.has(c)) { roles.set(i, 'close'); opened.delete(c); }
          else { roles.set(i, 'open'); opened.add(c); }
        }
      });
      chars.forEach((c, i) => { if (wrappers.has(c)) roles.set(i, wrapperPairs.has(c) ? 'open' : 'close'); });
      return roles;
    }

    function protectedPositions(chars) {
      const shadowChars = chars.map(c => Array.from(fold(c)).length === 1 ? fold(c) : c);
      const shadow = shadowChars.join(''), result = new Set();
      for (const [name, pattern] of structures) {
        for (const match of matches(shadow, pattern)) {
          const previous = shadowChars[match.start-1];
          if (name === 'leading_decimal' && previous && (ALNUM.test(previous) || '_.' .includes(previous))) continue;
          let end = match.end;
          if (name === 'url' || name === 'domain') {
            for (let i = match.start; i < end; i++) { if (fixed.has(chars[i])) { end = i; break; } }
            while (end > match.start) {
              const c = shadowChars[end-1], part = shadowChars.slice(match.start, end);
              const unmatched = ')]'.includes(c) && part.filter(x => x === c).length >
                part.filter(x => x === (c === ')' ? '(' : '[')).length;
              if ('.,;:!?'.includes(c) || unmatched) end--; else break;
            }
          }
          for (let i = match.start; i < end; i++) result.add(i);
        }
      }
      return result;
    }

    function proxyPositions(chars, roles) {
      const raw = chars.join('');
      const numericText = chars.map(c => IS_SPACE.test(c) && !isLine(c) ? ' ' : c).join('');
      const numericProtected = new Set(matches(numericText, numericCommas).map(m => m.groupStart));
      const positions = new Set();
      chars.forEach((c, i) => { if (fixed.has(c) && !numericProtected.has(i)) positions.add(i); });
      for (const pattern of sequences) for (const m of matches(raw, pattern)) {
        for (let i = m.start; i < m.end; i++) positions.add(i);
      }
      const protectedSet = protectedPositions(chars);
      const numericView = chars.map(c => HSPACE.test(c) ? ' ' : Array.from(fold(c)).length === 1 ? fold(c) : c).join('');
      for (const m of matches(numericView, bothCommas)) protectedSet.add(m.groupStart);
      for (const i of protectedSet) positions.delete(i);
      const neighborIndex = (index, direction) => { while (roles.has(index)) index += direction; return index; };
      const neighbor = (index, direction) => {
        index = neighborIndex(index, direction);
        return index >= 0 && index < chars.length && (HAN.test(chars[index]) || HSPACE.test(chars[index]) || positions.has(index));
      };
      const extended = (left, right, marks) => {
        left = neighborIndex(left, -1); right = neighborIndex(right, 1);
        if (marks.every(c => '!?' .includes(fold(c)))) {
          let wave = left;
          while (wave >= 0 && '~～'.includes(chars[wave])) wave--;
          if (wave !== left && wave >= 0 && HAN.test(chars[wave])) left = wave;
        }
        if (left < 0 || right >= chars.length) return false;
        const folded = marks.map(fold).join('');
        if (/^,+$/.test(folded) && ALNUM.test(chars[left]) && ALNUM.test(chars[right])) return true;
        if (folded === '.' && ASCII_ALNUM.test(chars[left]) && HSPACE.test(chars[right])) {
          let following = right;
          while (following < chars.length && HSPACE.test(chars[following])) following++;
          following = neighborIndex(following, 1);
          if (following < chars.length && (HAN.test(chars[following]) || /^[\p{Nd}]{1,3}[)）.．]/u.test(chars.slice(following).join('')))) return true;
        }
        return (HAN.test(chars[left]) && (ALNUM.test(chars[right]) || units.has(chars[right]))) ||
          (HAN.test(chars[right]) && (ALNUM.test(chars[left]) || units.has(chars[left])));
      };
      const numericNeighbor = (index, direction, pattern) => {
        let end = index;
        while (end >= 0 && end < chars.length && NUMERIC_TOKEN.test(chars[end])) end += direction;
        const token = chars.slice(direction < 0 ? end+1 : index, direction < 0 ? index+1 : end).join('');
        return matches(token, pattern).length > 0;
      };
      chars.forEach((c, p) => {
        if (!conditional.has(c) || positions.has(p) || protectedSet.has(p)) return;
        const pattern = numericContext.get(fold(c));
        if (!pattern) return;
        const left = neighborIndex(p-1, -1), right = neighborIndex(p+1, 1);
        if (left < 0 || right >= chars.length) return;
        if ((HAN.test(chars[left]) && numericNeighbor(right, 1, pattern)) ||
            (HAN.test(chars[right]) && numericNeighbor(left, -1, pattern))) positions.add(p);
      });
      for (let i = 0; i < chars.length;) {
        if (!conditional.has(chars[i]) || positions.has(i) || protectedSet.has(i)) { i++; continue; }
        let end = i+1;
        while (end < chars.length) {
          let following = end;
          while (roles.has(following)) following++;
          if (following < chars.length && conditional.has(chars[following]) && !positions.has(following) && !protectedSet.has(following)) end = following+1;
          else break;
        }
        if ((neighbor(i-1, -1) && neighbor(end, 1)) || extended(i-1, end, chars.slice(i, end).filter(c => conditional.has(c)))) {
          for (let j = i; j < end; j++) if (conditional.has(chars[j])) positions.add(j);
        }
        i = end;
      }
      for (const m of matches(raw, line)) positions.add(m.start);
      return positions;
    }

    function spans(chars, proxies, roles) {
      const pairs = new Map([...quotePairs, ...wrapperPairs]);
      const stacks = new Map(), matched = new Set(), repeated = new Set();
      chars.forEach((c, i) => {
        if (isLine(c) || c === '\0') stacks.clear();
        else if (roles.get(i) === 'open') {
          const close = pairs.get(c), stack = stacks.get(close) || [];
          if (stack.length) repeated.add(i);
          stack.push(i); stacks.set(close, stack);
        } else if (roles.get(i) === 'close' && stacks.get(c)?.length) matched.add(stacks.get(c).pop());
      });
      let consumed = -1, start = 0;
      const result = [];
      for (const p of [...proxies].sort((a,b) => a-b)) {
        if (p < consumed) continue;
        if (isLine(chars[p])) { result.push([start, p]); start = p+1; consumed = start; continue; }
        const member = i => i >= 0 && i < chars.length && !isLine(chars[i]) &&
          (proxies.has(i) || roles.has(i) || HSPACE.test(chars[i]));
        let left = p, end = p+1;
        while (left > start && member(left-1)) left--;
        while (member(end)) end++;
        const opens = [], closes = [];
        for (let i = left; i < end; i++) {
          if (roles.get(i) === 'open') opens.push(i);
          if (roles.get(i) === 'close') closes.push(i);
        }
        const conflict = opens.length && closes.length && opens[0] < closes.at(-1);
        const ambiguous = opens.some(i => (i < p && (!matched.has(i) || repeated.has(i))) ||
          (repeated.has(i) && !matched.has(i) && quotes.has(chars[i])));
        let cut = conflict || ambiguous ? p : closes.length ? closes.at(-1)+1 : opens.length ? opens[0] : left;
        if (conflict) {
          const stack = []; let balanced = true;
          for (let i = left; i < end; i++) {
            if (!roles.has(i)) continue;
            if (wrapperPairs.has(chars[i])) stack.push(wrapperPairs.get(chars[i]));
            else if (stack.length && stack.at(-1) === chars[i]) stack.pop();
            else { balanced = false; break; }
          }
          if (balanced && !stack.length) cut = end;
        }
        result.push([start, cut]); start = cut; consumed = end;
      }
      result.push([start, chars.length]);
      return result;
    }

    return function normalize(raw) {
      const chars = Array.from(raw), roles = boundaryRoles(chars);
      const proxies = proxyPositions(chars, roles), parts = [], mapping = new Map();
      const rawOffsets = [0];
      for (const c of chars) rawOffsets.push(rawOffsets.at(-1) + c.length);
      let base = 0;
      for (const [start, end] of spans(chars, proxies, roles)) {
        const indices = [];
        for (let i = start; i < end; i++) if (!proxies.has(i)) indices.push(i);
        const piece = indices.map(i => chars[i]), normalized = fragment(piece.join(''));
        if (!normalized) continue;
        for (let i = 0; i <= piece.length; i++) {
          const left = fragment(piece.slice(0, i).join('')), right = fragment(piece.slice(i).join(''));
          const original = rawOffsets[i ? indices[i-1]+1 : start], gap = base + Array.from(left).length;
          if (left+right === normalized) { if (!mapping.has(gap)) mapping.set(gap, original); }
          else if (left && right && left+' '+right === normalized) {
            if (!mapping.has(gap)) mapping.set(gap, original);
            mapping.set(gap+1, original);
          }
        }
        base += Array.from(normalized).length;
        mapping.set(base, rawOffsets[end]); parts.push(normalized);
      }
      const text = parts.join(''), tokens = Array.from(text);
      for (const gap of mapping.keys()) if (gap <= 0 || gap >= tokens.length) mapping.delete(gap);
      return { text, tokens, mapping };
    };
  }
  return Object.freeze({ createNormalizer });
});
