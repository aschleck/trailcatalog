import bidiFactory from 'bidi-js';

// Scripts whose graphemes look the same drawn alone as inside a word, so a label in them can bend
// between graphemes. Common and Inherited are digits, punctuation, and combining marks. Every other
// script is drawn a word at a time so the browser can join and shape it.
const PER_GRAPHEME = new RegExp(
    '^['
        + '\\p{Script=Latin}'
        + '\\p{Script=Greek}'
        + '\\p{Script=Cyrillic}'
        + '\\p{Script=Han}'
        + '\\p{Script=Hiragana}'
        + '\\p{Script=Katakana}'
        + '\\p{Script=Hangul}'
        + '\\p{Script=Common}'
        + '\\p{Script=Inherited}'
        + ']*$',
    'u');

// Every character here is Latin or Common, reads left to right, and is a grapheme of its own,
// which covers most labels without the cost of segmenting and running the bidi algorithm.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

const BIDI = bidiFactory();
const GRAPHEMES = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const WORDS = new Intl.Segmenter(undefined, {granularity: 'word'});

interface Unit {
  text: string;
  level: number;
}

/**
 * Splits text into the units the glypher draws, in the order they read left to right on screen.
 * A unit is a grapheme, or a whole word in scripts that shape across letters. With lineLength,
 * lines break at the first space past that many code units.
 */
export function segmentLabel(text: string, lineLength?: number): string[] {
  const lines: Unit[][] = [[]];
  let position = 0;
  let lastWrap = 0;
  const push = (unit: Unit) => {
    if (lineLength !== undefined && position - lastWrap > lineLength && unit.text === ' ') {
      lines.push([]);
      lastWrap = position;
    } else {
      lines[lines.length - 1].push(unit);
    }
    position += unit.text.length;
  };

  if (PRINTABLE_ASCII.test(text)) {
    for (const character of text) {
      push({text: character, level: 0});
    }
    return joinLines(lines);
  }

  const embedding = BIDI.getEmbeddingLevels(text);
  const mirrored = BIDI.getMirroredCharactersMap(text, embedding.levels);
  for (const {index, segment} of WORDS.segment(text)) {
    if (PER_GRAPHEME.test(segment)) {
      for (const grapheme of GRAPHEMES.segment(segment)) {
        const at = index + grapheme.index;
        push({
          text: mirrored.get(at) ?? grapheme.segment,
          level: embedding.levels[at],
        });
      }
    } else {
      push({text: segment, level: embedding.levels[index]});
    }
  }

  return joinLines(lines);
}

function joinLines(lines: Unit[][]): string[] {
  const units = [];
  for (const line of lines) {
    if (units.length > 0) {
      units.push('\n');
    }
    for (const unit of reorder(line)) {
      units.push(unit.text);
    }
  }
  return units;
}

// Rule L2 of UAX #9 applied to units rather than characters. A word unit keeps its letters in
// logical order because the browser lays out the inside of a word itself.
// https://www.unicode.org/reports/tr9/#L2
function reorder(units: Unit[]): Unit[] {
  let highest = 0;
  let lowestOdd = Infinity;
  for (const {level} of units) {
    highest = Math.max(highest, level);
    if (level % 2 === 1) {
      lowestOdd = Math.min(lowestOdd, level);
    }
  }
  if (lowestOdd === Infinity) {
    return units;
  }

  const ordered = [...units];
  for (let level = highest; level >= lowestOdd; --level) {
    let start = 0;
    while (start < ordered.length) {
      if (ordered[start].level < level) {
        start += 1;
        continue;
      }
      let end = start;
      while (end < ordered.length && ordered[end].level >= level) {
        end += 1;
      }
      const run = ordered.slice(start, end).reverse();
      ordered.splice(start, run.length, ...run);
      start = end;
    }
  }
  return ordered;
}
