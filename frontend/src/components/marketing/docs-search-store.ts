let currentQuery = "";
const listeners = new Set<(q: string) => void>();

export function getDocsQuery(): string {
  return currentQuery;
}

export function setDocsQuery(query: string): void {
  currentQuery = query;
  listeners.forEach((listener) => listener(query));
}

export function subscribeDocsQuery(listener: (q: string) => void): () => void {
  listeners.add(listener);
  listener(currentQuery);
  return () => {
    listeners.delete(listener);
  };
}