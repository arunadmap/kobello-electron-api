import './index.css';

declare global {
  interface Window {
    api: {
      getServerAddress(): Promise<string>;
    };
  }
}

// 1. Global State
let mainServerAddress: string | null = null;

/**
 * Utility to display a fatal error to the user
 */
const showFatalError = (message: string) => {
  document.body.innerHTML = `
    <div style="height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background: #1a1a1a; color: #ff4d4d; font-family: sans-serif; text-align: center; padding: 20px;">
      <h1 style="margin-bottom: 10px;">⚠️ Connection Error</h1>
      <p style="color: #ccc;">${message}</p>
      <button onclick="window.location.reload()" style="margin-top: 20px; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; background: #444; color: white;">Retry Connection</button>
    </div>
  `;
};

/**
 * Main Entry Point (The Bootstrapper)
 */
(async () => {
  console.log('🚀 Initializing App...');

  try {
    // 2. Fetch the address immediately
    const address = await window.api.getServerAddress();

    if (!address) {
      throw new Error("Server returned an empty address.");
    }

    mainServerAddress = address;
    console.log('✅ Main server address initialized:', mainServerAddress);

    // 3. ONLY run other processes after success
    startApplication();

  } catch (error) {
    console.error('❌ Bootstrapping failed:', error);
    
    // 4. Display the error UI
    const errorMessage = error instanceof Error ? error.message : "Could not connect to the backend server.";
    showFatalError(errorMessage);
  }
})();

/**
 * This function handles all the "Other Processes"
 */
function startApplication() {
  console.log("🛠 Starting UI Components...");
  initializeAppBar();
  
  // loadData();
  // setupEventListeners();
}

function initializeAppBar() {
  // TypeScript knows mainServerAddress is set here, but we check anyway
  if (mainServerAddress) {
    console.log(`Building App Bar using: ${mainServerAddress}`);
    // Your UI logic here...
  }
}
