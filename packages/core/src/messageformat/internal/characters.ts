// Character classes from the MF2 ABNF, by code point.

/** `ws`: the only whitespace allowed outside text and quoted literals. */
export const isWhitespace = (c: number): boolean =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x3000;

/** `bidi`: ALM, LRM, RLM, LRI, RLI, FSI and PDI. */
export const isBidi = (c: number): boolean =>
  c === 0x061c || c === 0x200e || c === 0x200f || (c >= 0x2066 && c <= 0x2069);

const isAlpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;

// `name-start` above U+00A0: everything but whitespace, bidi controls,
// surrogates and noncharacters.
const isNameStartAboveLatin1 = (c: number): boolean =>
  c >= 0xa1 &&
  c <= 0x10fffd &&
  c !== 0x061c &&
  c !== 0x1680 &&
  !(c >= 0x2000 && c <= 0x200a) &&
  c !== 0x200e &&
  c !== 0x200f &&
  !(c >= 0x2028 && c <= 0x202f) &&
  c !== 0x205f &&
  !(c >= 0x2066 && c <= 0x2069) &&
  c !== 0x3000 &&
  !(c >= 0xd800 && c <= 0xdfff) &&
  !(c >= 0xfdd0 && c <= 0xfdef) &&
  (c & 0xfffe) !== 0xfffe;

/** `name-start`. */
export const isNameStart = (c: number): boolean =>
  isAlpha(c) || c === 0x2b || c === 0x5f || isNameStartAboveLatin1(c);

/** `name-char`. */
export const isNameChar = (c: number): boolean =>
  isNameStart(c) || isDigit(c) || c === 0x2d || c === 0x2e;
