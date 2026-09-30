const configuredApiBase = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const API_PASSWORD_KEY = "easybrainrot-api-password";
export const apiUrl = (path) => `${configuredApiBase}${path}`;
export const assetUrl = (path) => /^https?:\/\//i.test(path) ? path : `${configuredApiBase}${path}`;

const storedPassword = () => {
  try { return localStorage.getItem(API_PASSWORD_KEY) || ""; } catch { return ""; }
};

const withPassword = (headers, password) => {
  if (password) headers.set("Authorization", `Basic ${btoa(`mobile:${password}`)}`);
  return headers;
};

export const apiFetch = async (path, options = {}) => {
  const headers = withPassword(new Headers(options.headers || {}), storedPassword());
  const requestUrl = /^https?:\/\//i.test(path) ? path : apiUrl(path);
  let response = await fetch(requestUrl, { ...options, headers });
  if (response.status !== 401 || typeof window.prompt !== "function") return response;

  const password = window.prompt("Enter the EasyBrainrot backend password to continue:");
  if (!password) return response;
  try { localStorage.setItem(API_PASSWORD_KEY, password); } catch { /* Continue for private browsing. */ }
  return fetch(requestUrl, { ...options, headers: withPassword(new Headers(options.headers || {}), password) });
};
