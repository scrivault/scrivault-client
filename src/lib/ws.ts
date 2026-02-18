/**
 * WebSocket client utility for real-time thread notifications.
 *
 * Connects to the server's notification-only WebSocket endpoints,
 * auto-reconnects with exponential backoff on disconnect,
 * and invokes a callback when a new_message event arrives.
 */

export interface WsNotification {
	type: string;
	thread_id: string;
}

export interface WsOptions {
	/** Full WebSocket URL (ws:// or wss://) */
	url: string;
	/** Called when a notification message arrives */
	onMessage: (notification: WsNotification) => void;
	/** Initial reconnect delay in ms (default 1000) */
	initialDelay?: number;
	/** Maximum reconnect delay in ms (default 30000) */
	maxDelay?: number;
}

/**
 * Create a WebSocket connection with auto-reconnect.
 * Returns a cleanup function to close the connection and stop reconnecting.
 */
export function createWsConnection(options: WsOptions): () => void {
	const { url, onMessage, initialDelay = 1000, maxDelay = 30_000 } = options;

	let ws: WebSocket | null = null;
	let reconnectDelay = initialDelay;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	function connect() {
		if (destroyed) return;

		try {
			ws = new WebSocket(url);
		} catch {
			scheduleReconnect();
			return;
		}

		ws.onopen = () => {
			// Reset backoff on successful connection
			reconnectDelay = initialDelay;
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as WsNotification;
				onMessage(data);
			} catch {
				// Ignore malformed messages
			}
		};

		ws.onclose = () => {
			ws = null;
			scheduleReconnect();
		};

		ws.onerror = () => {
			// onclose will fire after onerror, which triggers reconnect
		};
	}

	function scheduleReconnect() {
		if (destroyed) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
			connect();
		}, reconnectDelay);
	}

	function destroy() {
		destroyed = true;
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (ws) {
			ws.onclose = null; // Prevent reconnect on intentional close
			ws.close();
			ws = null;
		}
	}

	connect();
	return destroy;
}

/**
 * Build the WebSocket URL for the source endpoint.
 * Uses the current page origin and upgrades to ws:// or wss://.
 */
export function sourceWsUrl(blindedId: string): string {
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${proto}//${location.host}/api/ws/source/${encodeURIComponent(blindedId)}`;
}

/**
 * Build the WebSocket URL for the newsroom endpoint.
 * Uses the current page origin and upgrades to ws:// or wss://.
 */
export function newsroomWsUrl(threadId: string, token: string): string {
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${proto}//${location.host}/api/ws/newsroom/${encodeURIComponent(threadId)}?token=${encodeURIComponent(token)}`;
}
