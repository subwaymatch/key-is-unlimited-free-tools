/**
 * Arithmetic in GF(256) with QR codes' polynomial x^8 + x^4 + x^3 + x^2 + 1,
 * and the Reed-Solomon code built on it: correction codewords computed for
 * writing, and errors found and fixed for reading.
 *
 * Decoding follows the classic route: syndromes, then the error locator
 * and evaluator from the extended Euclidean algorithm, then Chien search
 * for where the errors are and Forney's formula for what they were.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    EXP[power] = value;
    LOG[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let power = 255; power < 512; power += 1) EXP[power] = EXP[power - 255];
}

export function multiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function inverse(a: number): number {
  if (a === 0) throw new RangeError("Zero has no inverse.");
  return EXP[255 - LOG[a]];
}

/** The generator polynomial for `degree` correction codewords, leading 1 dropped. */
export function generator(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = multiply(result[term], root);
      if (term + 1 < degree) result[term] ^= result[term + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

/** The correction codewords for a block of data. */
export function remainder(data: ArrayLike<number>, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (let index = 0; index < data.length; index += 1) {
    const factor = data[index] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let term = 0; term < divisor.length; term += 1) result[term] ^= multiply(divisor[term], factor);
  }
  return result;
}

/* ---- Decoding ------------------------------------------------------------ */

/** A polynomial as coefficients, highest degree first, with no leading zeros. */
class Poly {
  readonly coefficients: number[];

  constructor(coefficients: number[]) {
    let first = 0;
    while (first < coefficients.length - 1 && coefficients[first] === 0) first += 1;
    this.coefficients = coefficients.slice(first);
  }

  static monomial(degree: number, coefficient: number): Poly {
    if (coefficient === 0) return ZERO;
    const coefficients = new Array<number>(degree + 1).fill(0);
    coefficients[0] = coefficient;
    return new Poly(coefficients);
  }

  get degree(): number {
    return this.coefficients.length - 1;
  }

  get isZero(): boolean {
    return this.coefficients[0] === 0;
  }

  coefficient(degree: number): number {
    return this.coefficients[this.coefficients.length - 1 - degree];
  }

  evaluate(at: number): number {
    if (at === 0) return this.coefficient(0);
    let result = 0;
    for (const coefficient of this.coefficients) result = multiply(result, at) ^ coefficient;
    return result;
  }

  add(other: Poly): Poly {
    if (this.isZero) return other;
    if (other.isZero) return this;
    const [longer, shorter] = this.coefficients.length >= other.coefficients.length ? [this.coefficients, other.coefficients] : [other.coefficients, this.coefficients];
    const sum = longer.slice();
    const offset = longer.length - shorter.length;
    for (let index = 0; index < shorter.length; index += 1) sum[offset + index] ^= shorter[index];
    return new Poly(sum);
  }

  times(other: Poly): Poly {
    if (this.isZero || other.isZero) return ZERO;
    const product = new Array<number>(this.coefficients.length + other.coefficients.length - 1).fill(0);
    for (let a = 0; a < this.coefficients.length; a += 1) {
      for (let b = 0; b < other.coefficients.length; b += 1) product[a + b] ^= multiply(this.coefficients[a], other.coefficients[b]);
    }
    return new Poly(product);
  }

  scale(factor: number): Poly {
    return factor === 0 ? ZERO : new Poly(this.coefficients.map((coefficient) => multiply(coefficient, factor)));
  }

  shiftScale(degree: number, factor: number): Poly {
    if (factor === 0) return ZERO;
    return new Poly([...this.coefficients.map((coefficient) => multiply(coefficient, factor)), ...new Array<number>(degree).fill(0)]);
  }
}

const ZERO = new Poly([0]);
const ONE = new Poly([1]);

export class ReedSolomonError extends Error {}

/**
 * Corrects a block in place, data then correction codewords, and returns
 * how many codewords were wrong. Throws when there are more errors than
 * `eccCount / 2`, the most the code can fix.
 */
export function correct(block: Uint8Array, eccCount: number): number {
  const received = new Poly(Array.from(block));
  const syndromes = new Array<number>(eccCount);
  let clean = true;
  for (let index = 0; index < eccCount; index += 1) {
    const value = received.evaluate(EXP[index]);
    syndromes[eccCount - 1 - index] = value;
    if (value !== 0) clean = false;
  }
  if (clean) return 0;

  // The extended Euclidean algorithm on x^eccCount and the syndrome polynomial.
  let rLast = Poly.monomial(eccCount, 1);
  let r = new Poly(syndromes);
  if (rLast.degree < r.degree) [rLast, r] = [r, rLast];
  let tLast = ZERO;
  let t = ONE;
  while (2 * r.degree >= eccCount) {
    const rLastLast = rLast;
    const tLastLast = tLast;
    rLast = r;
    tLast = t;
    if (rLast.isZero) throw new ReedSolomonError("Too many errors to correct.");
    r = rLastLast;
    let quotient = ZERO;
    const leadInverse = inverse(rLast.coefficient(rLast.degree));
    while (r.degree >= rLast.degree && !r.isZero) {
      const shift = r.degree - rLast.degree;
      const factor = multiply(r.coefficient(r.degree), leadInverse);
      quotient = quotient.add(Poly.monomial(shift, factor));
      r = r.add(rLast.shiftScale(shift, factor));
    }
    t = quotient.times(tLast).add(tLastLast);
    if (r.degree >= rLast.degree) throw new ReedSolomonError("The division went wrong; the block is beyond repair.");
  }
  const atZero = t.coefficient(0);
  if (atZero === 0) throw new ReedSolomonError("Too many errors to correct.");
  const norm = inverse(atZero);
  const sigma = t.scale(norm);
  const omega = r.scale(norm);

  // Chien search: the error locations are the inverses of the locator's roots.
  const count = sigma.degree;
  const locations: number[] = [];
  if (count === 1) locations.push(sigma.coefficient(1));
  else for (let candidate = 1; candidate < 256 && locations.length < count; candidate += 1) if (sigma.evaluate(candidate) === 0) locations.push(inverse(candidate));
  if (locations.length !== count) throw new ReedSolomonError("Too many errors to correct.");

  // Forney: each error's value from the evaluator and the locator's derivative.
  for (let index = 0; index < count; index += 1) {
    const xInverse = inverse(locations[index]);
    let denominator = 1;
    for (let other = 0; other < count; other += 1) {
      if (other === index) continue;
      const term = multiply(locations[other], xInverse);
      denominator = multiply(denominator, term & 1 ? term & ~1 : term | 1);
    }
    const magnitude = multiply(omega.evaluate(xInverse), inverse(denominator));
    const position = block.length - 1 - LOG[locations[index]];
    if (position < 0) throw new ReedSolomonError("An error lies outside the block.");
    block[position] ^= magnitude;
  }
  return count;
}
