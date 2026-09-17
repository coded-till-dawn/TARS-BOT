import NodeCache from "node-cache";

// Optimized cache with TTL and memory management
const cache = new NodeCache({
	stdTTL: 300, // 5 minutes default TTL (reduced from 10)
	checkperiod: 60, // Check every 1 minute
	useClones: false, // Avoid cloning for better memory usage
	maxKeys: 300, // Reduced cache size for memory efficiency
	deleteOnExpire: true,
});

import socket from "./core/socket.js";
import events from "./core/events.js";
import { setSock } from "./core/socketRef.js";

let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
let lastConnectionTime = 0;
const MIN_CONNECTION_INTERVAL = 5000; // 5 seconds minimum between attempts

let isConnecting = false;
let pendingReconnectTimer = null;
let currentSock = null;

// ── Hook called every time a new socket is created (initial + every reconnect) ─
// index.js registers this so it can always track the live sock reference.
let _onNewSock = null;
export const onNewSock = (fn) => { _onNewSock = fn; };

const startSock = async (reason = "initial") => {
	if (isConnecting || pendingReconnectTimer) {
		console.log(`⏳ Connection request ignored (already in progress/queued): ${reason}`);
		return null;
	}

	try {
		const now = Date.now();

		if (now - lastConnectionTime < MIN_CONNECTION_INTERVAL) {
			const wait = MIN_CONNECTION_INTERVAL - (now - lastConnectionTime);
			console.log(`⏳ Connection attempt too soon, scheduling retry in ${wait}ms...`);
			pendingReconnectTimer = setTimeout(() => {
				pendingReconnectTimer = null;
				startSock(reason);
			}, wait);
			return null;
		}

		isConnecting = true;

		if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
			console.log("❌ Max connection attempts reached. Performing emergency cleanup and resetting...");
			connectionAttempts = 0; // Reset after cleanup
			// Wait longer before allowing reconnection
			setTimeout(() => {
				connectionAttempts = 0;
			}, 60000); // 1 minute reset
			isConnecting = false;
			return null;
		}

		// Perform comprehensive cleanup to prevent stale references and zombie events
		if (currentSock) {
			try {
				currentSock.ev.removeAllListeners();
			} catch (err) {}
			try {
				currentSock.end(undefined);
			} catch (err) {}
			currentSock = null;
		}

		connectionAttempts++;
		lastConnectionTime = Date.now();
		console.log(`🔄 Starting socket connection (attempt ${connectionAttempts}): ${reason}`);

		const sock = await socket();
		if (sock) {
			currentSock = sock;
			setSock(sock); // Update live reference for BullMQ worker
			// Notify index.js FIRST so it can attach its listener before events() runs
			if (_onNewSock) _onNewSock(sock);

			events(sock, startSock, cache);
			connectionAttempts = 0; // Reset on successful connection
			console.log("✅ Socket connection established successfully");
		}
		return sock;
	} catch (error) {
		console.error("❌ Error starting socket:", error.message);
		return null;
	} finally {
		isConnecting = false;
	}
};

export default startSock;
