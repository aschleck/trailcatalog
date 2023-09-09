export class LittleEndianView {

  private readonly view: DataView;
  private readonly limit: number;
  position: number;

  constructor(private readonly buffer: ArrayBuffer, position: number = 0, limit: number = -1) {
    this.view = new DataView(this.buffer);
    this.position = position;
    this.limit = limit >= 0 ? limit : this.buffer.byteLength;
  }

  align(alignment: number): void {
    this.position = Math.trunc((this.position + alignment - 1) / alignment) * alignment;
  }

  getBigInt64(): bigint {
    const r = this.view.getBigInt64(this.position, /* littleEndian= */ true);
    this.position += 8;
    return r;
  }

  getFloat32(): number {
    const r = this.view.getFloat32(this.position, /* littleEndian= */ true);
    this.position += 4;
    return r;
  }

  getFloat64(): number {
    const r = this.view.getFloat64(this.position, /* littleEndian= */ true);
    this.position += 8;
    return r;
  }

  getInt8(): number {
    const r = this.view.getInt8(this.position);
    this.position += 1;
    return r;
  }

  getInt32(): number {
    const r = this.view.getInt32(this.position, /* littleEndian= */ true);
    this.position += 4;
    return r;
  }

  getVarBigInt64(): bigint {
    let r = 0n;
    let v = BigInt(this.view.getInt8(this.position));
    this.position += 1;
    let shift = 0n;
    while ((v & 0x80n) != 0n) {
      r |= (v & 0x7fn) << shift;
      shift += 7n;
      v = BigInt(this.view.getInt8(this.position));
      this.position += 1;
    }
    r |= v << shift;
    return r;
  }

  getVarInt32(): number {
    let r = 0;
    let v = this.view.getInt8(this.position);
    this.position += 1;
    let shift = 0;
    while ((v & 0x80) != 0) {
      r |= (v & 0x7f) << shift;
      shift += 7;
      v = this.view.getInt8(this.position);
      this.position += 1;
    }
    r |= v << shift;
    return r;
  }

  hasRemaining(): boolean {
    return this.position < this.limit;
  }

  skip(byteCount: number): void {
    this.position += byteCount;
  }

  sliceBigInt64(count: number): BigInt64Array {
    const r = new BigInt64Array(this.buffer, this.position, count);
    this.position += count * 8;
    return r;
  }

  sliceFloat32(count: number): Float32Array {
    const r = new Float32Array(this.buffer, this.position, count);
    this.position += count * 4;
    return r;
  }

  sliceFloat64(count: number): Float64Array {
    const r = new Float64Array(this.buffer, this.position, count);
    this.position += count * 8;
    return r;
  }

  sliceInt8(count: number): Int8Array {
    const r = new Int8Array(this.buffer, this.position, count);
    this.position += count;
    return r;
  }

  sliceInt32(count: number): Int32Array {
    const r = new Int32Array(this.buffer, this.position, count);
    this.position += count * 4;
    return r;
  }

  sliceUint8(count: number): Uint8Array {
    const r = new Uint8Array(this.buffer, this.position, count);
    this.position += count;
    return r;
  }

  viewSlice(count: number): LittleEndianView {
    const r = new LittleEndianView(this.buffer, this.position, this.position + count);
    this.position += count;
    return r;
  }
}
