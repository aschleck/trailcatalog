export class LittleEndianView {

  private readonly view: DataView;
  private position: number;

  constructor(private readonly buffer: ArrayBuffer) {
    this.view = new DataView(this.buffer);
    this.position = 0;
  }

  getBigInt64(): bigint {
    const r = this.view.getBigInt64(this.position, /* littleEndian= */ true);
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

  slice(byteLength: number): ArrayBuffer {
    const r = this.buffer.slice(this.position, this.position + byteLength);
    this.position += byteLength;
    return r;
  }
}