export interface Layer {
  hasDataNewerThan(time: number): boolean;
}
