// Maybe don't write a CSS parser...?
//
// Oh well!

import { checkArgument, checkExists } from 'js/common/asserts';

export interface TFontFace {
  family: string;
  style: string;
  weight: number;
  src: string;
  ranges: Array<[number, number]>;
}

export function parseCss(css: string): TFontFace[] {
  const stream = {position: 0, text: css, line: 1, column: 1};
  let token;
  const fontFaces = [];
  while ((token = nextToken(stream)).type !== 'eof') {
    if (token.type === 'comment') {
      continue;
    }

    const text = css.substring(token.start, token.end);
    if (token.type === 'rule') {
      if (text === '@font-face') {
        fontFaces.push(parseCssFontFace(stream));
      } else {
        throw new Error(`Unexpected rule ${text}`);
      }
    } else {
      throw new Error(`Unexpected ${token.type}: ${text}`);
    }
  }
  return fontFaces;
}

function parseCssFontFace(stream: CssStream): TFontFace {
  expect('block_begin', stream);

  let next = nextToken(stream);
  const declarations = new Map<string, Token[]>();
  while (next.type !== 'block_end') {
    if (next.type !== 'string_unquoted') {
      throw new Error(`Expected an identifier, got ${next.type}`);
    }
    const key = stream.text.substring(next.start, next.end);

    expect('assignment', stream);

    const values = [];
    let value = nextToken(stream);
    while (value.type !== 'declaration_end') {
      values.push(value);
      value = nextToken(stream);
    }

    declarations.set(key, values);

    next = nextToken(stream);
  }

  return {
    family: parseStringValue(checkExists(declarations.get('font-family')), stream),
    style: parseStringValue(checkExists(declarations.get('font-style')), stream),
    weight: parseNumericValue(checkExists(declarations.get('font-weight')), stream),
    src: parseFontFaceSrc(checkExists(declarations.get('src')), stream),
    ranges: parseFontFaceRanges(declarations.get('unicode-range') ?? [], stream),
  };
}

function parseFontFaceRanges(tokens: Token[], stream: CssStream): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type !== 'string_unquoted') {
      throw new Error(`Expected range identifier, got ${tokens[i].type}`);
    }

    const ends = stream.text.substring(tokens[i].start, tokens[i].end).split('-');
    if (ends.length === 2) {
      ranges.push([parseUnicodeCode(ends[0]), parseUnicodeCode(ends[1])]);
    } else if (ends.length === 1) {
      const single = parseUnicodeCode(ends[0]);
      ranges.push([single, single + 1]);
    } else {
      throw new Error(`Expected unicode range, got ${ends.join('-')}`);
    }

    if (i + 1 < tokens.length && tokens[i + 1].type !== 'list_delimeter') {
      throw new Error(`Expected ',', got ${tokens[i + 1].type}`);
    }

    i += 2;
  }

  return ranges;
}

function parseUnicodeCode(value: string): number {
  if (value.startsWith('U+')) {
    return parseInt(value.substring(2), 16);
  } else {
    return parseInt(value, 16);
  }
}

function parseFontFaceSrc(tokens: Token[], stream: CssStream): string {
  let format = undefined;
  let url = undefined;

  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type !== 'string_unquoted') {
      throw new Error(`Expected identifier, got ${tokens[i].type}`);
    }
    const call = stream.text.substring(tokens[i].start, tokens[i].end);
    if (tokens[i + 1].type !== 'call_begin') {
      throw new Error(`Expected (, got token of type ${tokens[i + 1].type}`);
    }

    if (call === 'format') {
      format = parseStringValue([tokens[i + 2]], stream);

      if (tokens[i + 3].type !== 'call_end') {
        throw new Error(`Expected ), got token of type ${tokens[i + 3].type}`);
      }
    } else if (call === 'url') {
      url = parseStringValue([tokens[i + 2]], stream);

      if (tokens[i + 3].type !== 'call_end') {
        throw new Error(`Expected ), got token of type ${tokens[i + 3].type}`);
      }
    }

    i += 4;
  }

  // It's crazy to parse this just to return it as it came in, but here we are.
  return `url(${url}) format('${format}')`;
}

function parseNumericValue(tokens: Token[], stream: CssStream): number {
  if (tokens.length !== 1) {
    throw new Error(`Only expected 1 token, got ${tokens.length}`);
  }

  const token = tokens[0];
  if (token.type === 'number') {
    return Number(stream.text.substring(token.start, token.end));
  } else {
    throw new Error(`Expected a number token, got ${token.type}`);
  }
}

function parseStringValue(tokens: Token[], stream: CssStream): string {
  if (tokens.length !== 1) {
    throw new Error(`Only expected 1 token, got ${tokens.length}`);
  }

  const token = tokens[0];
  if (token.type === 'string') {
    return stream.text.substring(token.start + 1, token.end - 1);
  } else if (token.type === 'string_unquoted') {
    return stream.text.substring(token.start, token.end);
  } else {
    throw new Error(`Expected a string token, got ${token.type}`);
  }
}

function expect(type: TokenType, stream: CssStream): Token {
  const next = nextToken(stream);
  if (type !== next.type) {
    throw new Error(`Expected ${type}, got ${next.type}`);
  }
  return next;
}

interface CssStream {
  position: number;
  text: string;
  line: number;
  column: number;
}

type TokenType =
  'assignment'
      |'block_begin'
      |'block_end'
      |'call_begin'
      |'call_end'
      |'comment'
      |'declaration_end'
      |'eof'
      |'list_delimeter'
      |'number'
      |'rule'
      |'string'
      |'string_unquoted';

interface Token {
  type: TokenType;
  start: number;
  end: number;
}

function nextToken(stream: CssStream): Token {
  while (
      stream.position < stream.text.length &&
      (stream.text[stream.position] === ' ' || stream.text[stream.position] === '\n')) {
    if (stream.text[stream.position] === '\n') {
      stream.line += 1;
      stream.column = 1;
    } else {
      stream.column += 1;
    }

    stream.position += 1;
  }

  if (stream.position >= stream.text.length) {
    return {type: 'eof', start: stream.text.length, end: stream.text.length};
  }

  const start = stream.position;
  if (stream.text[stream.position] === '/') {
    stream.column += 1;
    stream.position += 1;

    if (stream.text[stream.position] === '/') {
      stream.column += 1;
      stream.position += 1;

      while (stream.position < stream.text.length && stream.text[stream.position] !== '\n') {
        stream.column += 1;
        stream.position += 1;
      }

      stream.line += 1;
      stream.column = 1;

      return {type: 'comment', start, end: stream.position};
    } else if (stream.text[stream.position] === '*') {
      stream.column += 1;
      stream.position += 1;

      while (stream.text[stream.position] !== '*' || stream.text[stream.position + 1] !== '/') {
        if (stream.text[stream.position] === '\n') {
          stream.line += 1;
          stream.column = 1;
        } else {
          stream.column += 1;
        }

        stream.position += 1;
      }

      stream.column += 2;
      stream.position += 2;

      return {type: 'comment', start, end: stream.position};
    } else {
      throw new Error(
          `Unexpected character ${stream.text[stream.position]} at `
              + `line ${stream.line} column ${stream.column}`);
    }
  } else if (stream.text[stream.position] === '@') {
    stream.column += 1;
    stream.position += 1;

    while (
        (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
            || stream.text[stream.position] === '-') {
      stream.column += 1;
      stream.position += 1;
    }

    return {type: 'rule', start, end: stream.position};
  } else if ((stream.text[stream.position] >= '0' && stream.text[stream.position] <= '9')
      || stream.text[stream.position] === '-'
      || stream.text[stream.position] === '.') {
    stream.column += 1;
    stream.position += 1;

    while (
        (stream.text[stream.position] >= '0' && stream.text[stream.position] <= '9')
            || stream.text[stream.position] === '.') {
      stream.column += 1;
      stream.position += 1;
    }

    // Are we accidentally in a string?
    if (
        (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
            || stream.text[stream.position] === '-') {
      while (
          (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
              || stream.text[stream.position] === '-') {
        stream.column += 1;
        stream.position += 1;
      }
      return {type: 'string_unquoted', start, end: stream.position};
    }

    return {type: 'number', start, end: stream.position};
  } else if ((stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
      || stream.text[stream.position] === '-') {
    stream.column += 1;
    stream.position += 1;

    while (
        (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
            || stream.text[stream.position] === '-') {
      stream.column += 1;
      stream.position += 1;
    }

    // Special case for urls
    if (stream.text.substring(stream.position, stream.position + 3) === '://') {
      while (
          stream.text[stream.position] !== ','
              && stream.text[stream.position] !== ')'
              && stream.text[stream.position] !== ';'
              && stream.text[stream.position] !== ' ') {
        stream.column += 1;
        stream.position += 1;
      }
      return {type: 'string_unquoted', start, end: stream.position};
    }

    return {type: 'string_unquoted', start, end: stream.position};
  } else if (stream.text[stream.position] === '\'' || stream.text[stream.position] === '"') {
    const initial = stream.text[stream.position];
    stream.column += 1;
    stream.position += 1;

    while (stream.text[stream.position] !== initial) {
      stream.column = 1;
      stream.position += 1;

      if (stream.text[stream.position] === '\\' && stream.text[stream.position + 1] == initial) {
        stream.column += 2;
        stream.position += 2;
      }
    }

    stream.column += 1;
    stream.position += 1;

    return {type: 'string', start, end: stream.position};
  } else if (stream.text[stream.position] === '{') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'block_begin', start, end: stream.position};
  } else if (stream.text[stream.position] === '}') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'block_end', start, end: stream.position};
  } else if (stream.text[stream.position] === '(') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'call_begin', start, end: stream.position};
  } else if (stream.text[stream.position] === ')') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'call_end', start, end: stream.position};
  } else if (stream.text[stream.position] === ':') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'assignment', start, end: stream.position};
  } else if (stream.text[stream.position] === ';') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'declaration_end', start, end: stream.position};
  } else if (stream.text[stream.position] === ',') {
    stream.column += 1;
    stream.position += 1;
    return {type: 'list_delimeter', start, end: stream.position};
  } else if (
      (stream.text[stream.position] >= 'A' && stream.text[stream.position] <= 'Z')
          || (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
          || (stream.text[stream.position] >= '0' && stream.text[stream.position] <= '9')
          || (stream.text[stream.position] === 'U' && stream.text[stream.position + 1] === '+')) {
    stream.column += 1;
    stream.position += 1;

    while (
        (stream.text[stream.position] >= 'A' && stream.text[stream.position] <= 'Z')
            || (stream.text[stream.position] >= 'a' && stream.text[stream.position] <= 'z')
            || (stream.text[stream.position] >= '0' && stream.text[stream.position] <= '9')
            || stream.text[stream.position] === '+'
            || stream.text[stream.position] === '-'
            || stream.text[stream.position] === '.') {
      stream.column += 1;
      stream.position += 1;
    }

    return {type: 'string_unquoted', start, end: stream.position};
  } else {
    throw new Error(
        `Unexpected character ${stream.text[stream.position]} at `
            + `line ${stream.line} column ${stream.column}`);
  }
}

