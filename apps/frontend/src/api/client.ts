export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

export function authHeaders() {
  const token = localStorage.getItem('rolematch_token');

  if (!token) {
    throw new Error('You need to log in first.');
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export function buildQuery(params: Record<string, string | number | boolean | null | undefined> = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'Any' || value === 'All sources') {
      return;
    }

    searchParams.set(key, String(value));
  });

  return searchParams.toString();
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    const message = data?.error ?? 'Request failed.';

    if (response.status === 401 || /jwt|token|authorization/i.test(message)) {
      localStorage.removeItem('rolematch_token');
      window.location.assign('/auth');
      throw new Error('Session expired. Please log in again.');
    }

    throw new Error(message);
  }

  return data as T;
}
