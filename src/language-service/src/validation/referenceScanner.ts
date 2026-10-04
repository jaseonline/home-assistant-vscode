/**
 * Line-based scanner that finds the values of Home Assistant reference keys
 * (entity_id, area_id, label, action, ...) so the validators can check them
 * against the live registry.
 *
 * It deliberately stays line-based (no YAML AST) so ranges map 1:1 to the
 * source, but it understands enough YAML structure to avoid the false
 * positives the old per-validator regexes produced on dashboard YAML:
 *  - keys are anchored to the start of the line, so `show_label:` or
 *    `tap_action:` never match `label` / `action`;
 *  - block scalars (`|`, `>`) and their content are skipped, so button-card
 *    `[[[ JS ]]]` templates are never read as references;
 *  - a `- item` is only attributed to its real parent key (the nearest
 *    less-indented line), not to any matching key further up the block;
 *  - generic keys (plain `label`, `area`, ...) can be restricted to only
 *    count when nested under a key where HA actually accepts them.
 */

export interface ReferenceMatch {
  /** The reference value with surrounding quotes removed. */
  value: string;
  /** The key the value belongs to (e.g. "label_id"). */
  key: string;
  line: number;
  /** Range of the raw value (including quotes) on the line. */
  startColumn: number;
  endColumn: number;
}

export interface ReferenceScanOptions {
  /**
   * Keys that only count as references when one of their ancestor keys is
   * in `ancestorKeys`. Used for generic names such as `label`, which
   * button-card and other custom cards use for display text and styles.
   */
  requireAncestorFor?: string[];
  ancestorKeys?: string[];
}

/**
 * Where plain target-style keys (area, device, floor, label) are references.
 * `data`/`service_data` are deliberately excluded: action parameters such as
 * Harmony's `remote.send_command` `data.device: TV` reuse these names for
 * non-registry values. The `*_id` forms are validated everywhere.
 */
export const TARGET_ANCESTOR_KEYS = [
  "target",
  "trigger",
  "triggers",
  "condition",
  "conditions",
];

const KEY_LINE = /^(\s*)(-\s+)?([A-Za-z0-9_-]+)\s*:(?=\s|$)(.*)$/;
const LIST_ITEM = /^(\s*)-(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*\s*(#.*)?$/;
const MAPPING_LIKE = /^[A-Za-z0-9_-]+\s*:(\s|$)/;
const FLOW_PAIR = /([A-Za-z0-9_-]+)\s*:\s*(\[[^\]]*\]|[^,}\s][^,}]*)/g;

const indentOf = (line: string): number => line.length - line.trimStart().length;

const isSkippableLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
};

/** Strip a trailing ` # comment` from a plain value. */
const stripComment = (value: string): string => {
  const hash = value.search(/\s#/);
  return hash === -1 ? value : value.substring(0, hash);
};

const unquote = (value: string): string => value.replace(/^["']|["']$/g, "");

/**
 * True when the value is a literal reference worth checking, rather than a
 * template, YAML tag, special keyword, or nested mapping.
 */
export const isCheckableReference = (value: string): boolean => {
  if (value === "" || value === "null" || value === "~") {
    return false;
  }
  if (value === "none" || value === "all") {
    return false;
  }
  if (value.includes("{{") || value.includes("}}") || value.includes("[[[")) {
    return false;
  }
  if (value.startsWith("!")) {
    return false;
  }
  return !MAPPING_LIKE.test(value);
};

/**
 * Walk upwards from `lineIndex` and collect the keys of every enclosing
 * (less-indented) line, nearest first.
 */
const getAncestorKeys = (lines: string[], lineIndex: number, indent: number): string[] => {
  const keys: string[] = [];
  let threshold = indent;
  for (let i = lineIndex - 1; i >= 0 && threshold > 0; i--) {
    const line = lines[i];
    if (isSkippableLine(line)) {
      continue;
    }
    const lineIndent = indentOf(line);
    if (lineIndent >= threshold) {
      continue;
    }
    threshold = lineIndent;
    const keyMatch = line.match(KEY_LINE);
    if (keyMatch) {
      keys.push(keyMatch[3]);
    }
  }
  return keys;
};

/**
 * Find the parent key line of a `- item` at `dashIndent`: skip sibling items
 * and deeper content, stop at the first line that is less indented, or at
 * the same indent but not a list item (compact `key:\n- item` style).
 */
const findListParent = (
  lines: string[],
  lineIndex: number,
  dashIndent: number,
): { key: string; lineIndex: number; indent: number } | undefined => {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (isSkippableLine(line)) {
      continue;
    }
    const lineIndent = indentOf(line);
    if (lineIndent > dashIndent) {
      continue;
    }
    if (lineIndent === dashIndent && line.trimStart().startsWith("-")) {
      continue;
    }
    const keyMatch = line.match(KEY_LINE);
    if (!keyMatch || stripComment(keyMatch[4]).trim() !== "") {
      return undefined;
    }
    return { key: keyMatch[3], lineIndex: i, indent: lineIndent };
  }
  return undefined;
};

export function findReferenceValues(
  lines: string[],
  propertyNames: string[],
  options: ReferenceScanOptions = {},
): ReferenceMatch[] {
  const results: ReferenceMatch[] = [];
  const properties = new Set(propertyNames);
  const restricted = new Set(options.requireAncestorFor ?? []);
  const allowedAncestors = new Set(options.ancestorKeys ?? []);

  const ancestorAllowed = (key: string, lineIndex: number, indent: number, extra: string[] = []): boolean => {
    if (!restricted.has(key)) {
      return true;
    }
    if (extra.some((k) => allowedAncestors.has(k))) {
      return true;
    }
    return getAncestorKeys(lines, lineIndex, indent).some((k) => allowedAncestors.has(k));
  };

  const pushValue = (key: string, lineIndex: number, raw: string, startColumn: number): void => {
    const value = unquote(raw.trim());
    if (!isCheckableReference(value)) {
      return;
    }
    results.push({ value, key, line: lineIndex, startColumn, endColumn: startColumn + raw.trim().length });
  };

  const pushArray = (key: string, lineIndex: number, inner: string, innerStart: number): void => {
    let offset = 0;
    for (const part of inner.split(",")) {
      const leading = part.length - part.trimStart().length;
      if (part.trim() !== "") {
        pushValue(key, lineIndex, part.trim(), innerStart + offset + leading);
      }
      offset += part.length + 1;
    }
  };

  // Indent of the key that opened the current block scalar, or -1.
  let blockScalarIndent = -1;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].replace(/\r$/, "");

    if (blockScalarIndent >= 0) {
      if (line.trim() === "" || indentOf(line) > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = -1;
    }

    if (isSkippableLine(line)) {
      continue;
    }

    const keyMatch = line.match(KEY_LINE);
    if (keyMatch) {
      const key = keyMatch[3];
      const keyColumn = keyMatch[1].length + (keyMatch[2]?.length ?? 0);
      const rest = keyMatch[4];
      const restStart = line.length - rest.length;
      const value = stripComment(rest).trim();
      const valueStart = restStart + (rest.length - rest.trimStart().length);

      if (BLOCK_SCALAR.test(rest.trim())) {
        blockScalarIndent = keyColumn;
        continue;
      }

      if (value.startsWith("{")) {
        // Inline flow mapping: `target: { label_id: x, area_id: [a, b] }`
        FLOW_PAIR.lastIndex = 0;
        let pair;
        while ((pair = FLOW_PAIR.exec(value)) !== null) {
          const pairKey = pair[1];
          if (!properties.has(pairKey) || !ancestorAllowed(pairKey, lineIndex, keyColumn, [key])) {
            continue;
          }
          const pairValue = pair[2].trimEnd();
          const pairValueStart = valueStart + pair.index + pair[0].indexOf(pair[2]);
          if (pairValue.startsWith("[")) {
            pushArray(pairKey, lineIndex, pairValue.replace(/^\[|\]$/g, ""), pairValueStart + 1);
          } else {
            pushValue(pairKey, lineIndex, pairValue, pairValueStart);
          }
        }
        continue;
      }

      if (!properties.has(key) || value === "" || !ancestorAllowed(key, lineIndex, keyColumn)) {
        continue;
      }

      if (value.startsWith("[")) {
        const close = value.indexOf("]");
        if (close !== -1) {
          pushArray(key, lineIndex, value.substring(1, close), valueStart + 1);
        }
        continue;
      }

      pushValue(key, lineIndex, value, valueStart);
      continue;
    }

    const listMatch = line.match(LIST_ITEM);
    if (listMatch && listMatch[2] !== undefined) {
      const raw = stripComment(listMatch[2]);
      if (BLOCK_SCALAR.test(raw.trim())) {
        blockScalarIndent = listMatch[1].length;
        continue;
      }
      const parent = findListParent(lines, lineIndex, listMatch[1].length);
      if (!parent || !properties.has(parent.key) || !ancestorAllowed(parent.key, parent.lineIndex, parent.indent)) {
        continue;
      }
      pushValue(parent.key, lineIndex, raw, line.length - listMatch[2].length);
    }
  }

  return results;
}
