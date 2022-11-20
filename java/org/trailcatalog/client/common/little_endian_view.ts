export class LittleEndianView {

  private readonly view: DataView;
  private position: number;

  constructor(private readonly buffer: ArrayBuffer) {
    this.view = new DataView(this.buffer);
    this.position = 0;
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

  getInt32(): number {
    const r = this.view.getInt32(this.position, /* littleEndian= */ true);
    this.position += 4;
    return r;
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
}
