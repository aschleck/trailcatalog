import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

// A binary min heap over (priority, value) pairs. Lowering a node's cost pushes a second entry
// rather than moving the first, so a node can hold several entries and the search skips the stale
// ones as they come off.
export class Heap {

  private readonly priorities: number[];
  private readonly values: number[];

  constructor() {
    this.priorities = [];
    this.values = [];
  }

  get isEmpty(): boolean {
    return this.values.length === 0;
  }

  push(priority: number, value: number): void {
    let at = this.values.length;
    this.priorities.push(priority);
    this.values.push(value);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.priorities[parent] <= priority) {
        break;
      }

      this.priorities[at] = this.priorities[parent];
      this.values[at] = this.values[parent];
      at = parent;
    }
    this.priorities[at] = priority;
    this.values[at] = value;
  }

  pop(): number {
    const top = this.values[0];
    const priority = checkExists(this.priorities.pop());
    const value = checkExists(this.values.pop());
    const count = this.values.length;
    if (count === 0) {
      return top;
    }

    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      if (left >= count) {
        break;
      }

      const right = left + 1;
      const child =
          right < count && this.priorities[right] < this.priorities[left] ? right : left;
      if (priority <= this.priorities[child]) {
        break;
      }

      this.priorities[at] = this.priorities[child];
      this.values[at] = this.values[child];
      at = child;
    }
    this.priorities[at] = priority;
    this.values[at] = value;
    return top;
  }
}
