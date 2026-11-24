import { httpRequest } from "@/packages/http";

const actionMessage = (body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
};

const toFormData = (body: FormData | Record<string, string>): FormData => {
  if (body instanceof FormData) return body;
  const formData = new FormData();
  for (const [name, value] of Object.entries(body))
    formData.append(name, value);
  return formData;
};

export async function postAction(
  action: string,
  body: FormData | Record<string, string>
): Promise<unknown> {
  const response = await httpRequest(action, {
    method: "POST",
    body: toFormData(body),
  });
  if (!response.ok) {
    throw new Error(actionMessage(await response.text()));
  }
  return response.json().catch(() => null);
}
