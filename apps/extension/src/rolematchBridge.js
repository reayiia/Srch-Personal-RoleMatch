function sendExtensionMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve(response ?? { ok: false, error: 'No extension response.' });
    });
  });
}

function connectionPayload(payload = {}) {
  return {
    apiBaseUrl: payload.apiBaseUrl || 'http://localhost:5000',
    frontendBaseUrl: window.location.origin,
    token: payload.token || window.localStorage.getItem('rolematch_token'),
  };
}

function announceBridgeReady() {
  window.postMessage({
    type: 'ROLEMATCH_EXTENSION_BRIDGE_READY',
    extensionName: 'RoleMatch Autofill',
  }, window.location.origin);
}

announceBridgeReady();
window.addEventListener('focus', announceBridgeReady);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) announceBridgeReady();
});

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ROLEMATCH_CONNECT_EXTENSION') {
    const response = await sendExtensionMessage({
      type: 'ROLEMATCH_CONNECT',
      payload: connectionPayload(message.payload),
    });
    window.postMessage({
      type: 'ROLEMATCH_EXTENSION_CONNECT_RESULT',
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }

  if (message.type === 'ROLEMATCH_CHECK_EXTENSION') {
    const response = await sendExtensionMessage({
      type: 'ROLEMATCH_GET_CONNECTION',
    });
    window.postMessage({
      type: 'ROLEMATCH_EXTENSION_CHECK_RESULT',
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }

  if (message.type === 'ROLEMATCH_APPLY_WITH_ROLEMATCH') {
    const response = await sendExtensionMessage({
      type: 'ROLEMATCH_START_APPLICATION',
      payload: {
        connection: connectionPayload(message.payload),
        job: message.payload?.job,
      },
    });
    window.postMessage({
      type: 'ROLEMATCH_EXTENSION_APPLY_RESULT',
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }

  if (message.type === 'ROLEMATCH_OPEN_WITH_ROLEMATCH_PANEL') {
    const response = await sendExtensionMessage({
      type: 'ROLEMATCH_OPEN_APPLICATION',
      payload: {
        connection: connectionPayload(message.payload),
        job: message.payload?.job,
      },
    });
    window.postMessage({
      type: 'ROLEMATCH_EXTENSION_OPEN_RESULT',
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }

  if (message.type === 'ROLEMATCH_PROFILE_UPDATED') {
    const response = await sendExtensionMessage({
      type: 'ROLEMATCH_PROFILE_UPDATED',
    });
    window.postMessage({
      type: 'ROLEMATCH_EXTENSION_PROFILE_UPDATED_RESULT',
      requestId: message.requestId,
      response,
    }, window.location.origin);
  }
});
