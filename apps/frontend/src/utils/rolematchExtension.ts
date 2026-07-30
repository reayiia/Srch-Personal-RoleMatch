import { API_BASE_URL } from '../api/client';

export interface RoleMatchExtensionJob {
  id?: string;
  jobId?: string;
  title: string;
  company: string;
  source?: string;
  location?: string;
  jobUrl: string;
  matchScore?: number | null;
}

export interface RoleMatchExtensionResult {
  ok: boolean;
  error?: string;
  connection?: {
    apiBaseUrl?: string;
    frontendBaseUrl?: string;
    connectedAt?: string;
  } | null;
}

function requestId() {
  return `rm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let bridgeDetected = false;

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ROLEMATCH_EXTENSION_BRIDGE_READY') {
      bridgeDetected = true;
    }
  });
}

function extensionTimeoutMessage() {
  if (!bridgeDetected) {
    return 'RoleMatch extension bridge was not detected. After loading or reloading the unpacked extension, reload this RoleMatch tab once, then click Connect extension again.';
  }

  return 'RoleMatch extension did not respond. Reload the unpacked extension from chrome://extensions, reload this RoleMatch tab, then click Connect extension again.';
}

function extensionRequest<TResponse>(
  outboundType: string,
  inboundType: string,
  payload: Record<string, unknown>,
  timeoutMs = 1500,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const id = requestId();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error(extensionTimeoutMessage()));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== inboundType || event.data?.requestId !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve(event.data.response as TResponse);
    };

    window.addEventListener('message', handleMessage);
    window.postMessage({
      type: outboundType,
      requestId: id,
      payload: {
        apiBaseUrl: API_BASE_URL,
        token: localStorage.getItem('rolematch_token'),
        ...payload,
      },
    }, window.location.origin);
  });
}

export async function connectRoleMatchExtension(): Promise<RoleMatchExtensionResult> {
  return extensionRequest<RoleMatchExtensionResult>(
    'ROLEMATCH_CONNECT_EXTENSION',
    'ROLEMATCH_EXTENSION_CONNECT_RESULT',
    {},
  );
}

export async function checkRoleMatchExtension(): Promise<RoleMatchExtensionResult> {
  return extensionRequest<RoleMatchExtensionResult>(
    'ROLEMATCH_CHECK_EXTENSION',
    'ROLEMATCH_EXTENSION_CHECK_RESULT',
    {},
    900,
  );
}

export async function applyWithRoleMatch(job: RoleMatchExtensionJob): Promise<RoleMatchExtensionResult> {
  try {
    return await extensionRequest<RoleMatchExtensionResult>(
      'ROLEMATCH_APPLY_WITH_ROLEMATCH',
      'ROLEMATCH_EXTENSION_APPLY_RESULT',
      { job },
      2200,
    );
  } catch (error) {
    window.open(job.jobUrl, '_blank', 'noopener,noreferrer');
    return {
      ok: false,
      error: error instanceof Error ? `${error.message} Opened the job normally instead.` : 'Opened the job normally instead.',
    };
  }
}

export async function openJobWithRoleMatchPanel(job: RoleMatchExtensionJob): Promise<RoleMatchExtensionResult> {
  try {
    return await extensionRequest<RoleMatchExtensionResult>(
      'ROLEMATCH_OPEN_WITH_ROLEMATCH_PANEL',
      'ROLEMATCH_EXTENSION_OPEN_RESULT',
      { job },
      2200,
    );
  } catch (error) {
    window.open(job.jobUrl, '_blank', 'noopener,noreferrer');
    return {
      ok: false,
      error: error instanceof Error ? `${error.message} Opened the job normally instead.` : 'Opened the job normally instead.',
    };
  }
}

export async function notifyRoleMatchProfileUpdated(): Promise<RoleMatchExtensionResult> {
  try {
    return await extensionRequest<RoleMatchExtensionResult>(
      'ROLEMATCH_PROFILE_UPDATED',
      'ROLEMATCH_EXTENSION_PROFILE_UPDATED_RESULT',
      {},
      1200,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to notify the RoleMatch extension.',
    };
  }
}
