/** 동일 수명의 GPU 자원. 공유 자원은 한 번만 등록·해제한다. */
export class ResourceScope {
  private readonly resources = new Set<{ dispose(): void }>();

  own<T extends { dispose(): void }>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  dispose() {
    for (const resource of [...this.resources].reverse()) resource.dispose();
    this.resources.clear();
  }
}
