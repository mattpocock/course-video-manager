export const body = (stream: unknown): Response => new Response(stream as any);
