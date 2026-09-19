interface Fetcher { fetch(request: Request): Promise<Response>; }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; }
interface D1Result { meta: { changes?: number } }
interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; run(): Promise<D1Result>; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }>; }
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface R2Object { body: ReadableStream; httpMetadata?: { contentType?: string }; httpEtag: string; }
interface R2Bucket { put(key: string, value: ReadableStream, options?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> }): Promise<unknown>; get(key: string): Promise<R2Object | null>; delete(key: string): Promise<void>; }
