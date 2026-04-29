const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = await response.json();
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore malformed error bodies.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

export const fetchPublicConfig = () => requestJson("/api/config");

export const createConvexRequester = (loadConfig) => async (kind, path, args = {}) => {
  const convexUrl = await loadConfig();
  const response = await fetch(`${convexUrl}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      args,
      format: "json",
      path
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.errorMessage || `${response.status} ${response.statusText}`);
  }

  return payload.value;
};
