/**
 * Số phức (phần thực + phần ảo). Mọi phép toán trả về instance mới — không đổi `this`.
 */
export default class Complex {
  /**
   * @param {number} re — phần thực
   * @param {number} [im=0] — phần ảo
   */
  constructor(re, im = 0) {
    this.re = Number(re);
    this.im = Number(im);
  }

  /**
   * @param {Complex} other
   * @private
   */
  static _parts(other) {
    if (!(other instanceof Complex)) {
      throw new TypeError('Expected Complex');
    }
    return { re: other.re, im: other.im };
  }

  /**
   * @param {Complex} other
   * @returns {Complex}
   */
  add(other) {
    const o = Complex._parts(other);
    return new Complex(this.re + o.re, this.im + o.im);
  }

  /**
   * @param {Complex} other
   * @returns {Complex}
   */
  sub(other) {
    const o = Complex._parts(other);
    return new Complex(this.re - o.re, this.im - o.im);
  }

  /**
   * @param {Complex} other
   * @returns {Complex}
   */
  mul(other) {
    const o = Complex._parts(other);
    const re = this.re * o.re - this.im * o.im;
    const im = this.re * o.im + this.im * o.re;
    return new Complex(re, im);
  }

  /**
   * @param {Complex} other
   * @returns {Complex}
   * @throws {RangeError} nếu mẫu số bằng 0
   */
  div(other) {
    const o = Complex._parts(other);
    const den = o.re * o.re + o.im * o.im;
    if (den === 0) {
      throw new RangeError('Division by zero complex');
    }
    const re = (this.re * o.re + this.im * o.im) / den;
    const im = (this.im * o.re - this.re * o.im) / den;
    return new Complex(re, im);
  }

  /** @returns {number} độ lớn |z| */
  magnitude() {
    return Math.hypot(this.re, this.im);
  }

  /** @returns {number} góc pha (radian), dùng atan2 */
  phase() {
    return Math.atan2(this.im, this.re);
  }

  /** @returns {Complex} liên hợp */
  conjugate() {
    return new Complex(this.re, -this.im);
  }

  /**
   * Tạo số phức từ dạng cực (độ lớn, pha radian).
   * @param {number} mag
   * @param {number} phase
   * @returns {Complex}
   */
  static fromPolar(mag, phase) {
    return new Complex(mag * Math.cos(phase), mag * Math.sin(phase));
  }

  /**
   * Chuỗi dạng "re + im i" (dấu của ảo được điều chỉnh hiển thị).
   * @returns {string}
   */
  toString() {
    const r = this.re;
    const i = this.im;
    if (i === 0) {
      return `${r} + 0 i`;
    }
    if (i > 0) {
      return `${r} + ${i} i`;
    }
    return `${r} - ${-i} i`;
  }
}
