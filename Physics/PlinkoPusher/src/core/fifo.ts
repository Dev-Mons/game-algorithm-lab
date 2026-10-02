/** 머리 인덱스 기반 FIFO. shift()의 O(n) 비용을 피하고 주기적으로 압축한다. */
export class Fifo<T> {
  private items: T[] = [];
  private head = 0;
  get length() { return this.items.length - this.head; }
  push(value: T) { this.items.push(value); }
  peek(): T | undefined { return this.items[this.head]; }
  at(i: number): T | undefined { return this.items[this.head + i]; }
  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const value = this.items[this.head++];
    if (this.head > 64 && this.head * 2 > this.items.length) { this.items = this.items.slice(this.head); this.head = 0; }
    return value;
  }
  /** 앞쪽에 순서를 유지한 채 삽입한다. */
  unshiftAll(values: T[]) { this.items = values.concat(this.items.slice(this.head)); this.head = 0; }
  drainAll(): T[] { const out = this.items.slice(this.head); this.items = []; this.head = 0; return out; }
  forEach(visit: (value: T) => void) { for (let i = this.head; i < this.items.length; i++) visit(this.items[i]); }
  clear() { this.items = []; this.head = 0; }
}
