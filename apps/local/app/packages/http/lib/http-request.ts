export const httpRequest = (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => fetch(input, init);
