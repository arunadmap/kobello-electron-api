
import './index.css';

declare global {
  interface Window {
    api: {
      getServerAddress(): Promise<string>;
    };
  }
}

// Global state
let mainServerAddress: string | null = null;

/**
 * Show error screen
 */
const showFatalError = (message: string) => {
  document.body.innerHTML = `
    <div style="
      height:100vh;
      display:flex;
      flex-direction:column;
      justify-content:center;
      align-items:center;
      background:#1a1a1a;
      color:#ff4d4d;
      font-family:sans-serif;
      text-align:center;
      padding:20px;
    ">
      <h1>⚠️ Connection Error</h1>
      <p style="color:#ccc;">${message}</p>
      <button
        onclick="window.location.reload()"
        style="
          margin-top:20px;
          padding:10px 20px;
          border:none;
          border-radius:8px;
          cursor:pointer;
          background:#444;
          color:white;
        "
      >
        Retry Connection
      </button>
    </div>
  `;
};

/**
 * Load main server application
 */
function loadMainServerApplication(serverAddress: string) {
  const url = `${serverAddress.replace(/\/$/, '')}/index.html`;

  document.body.innerHTML = `
    ${url}</iframe>
  `;

  console.log(`🌐 Loading application from ${url}`);
}

/**
 * Bootstrap
 */
(async () => {
  console.log('🚀 Initializing App...');

  try {
    const address = await window.api.getServerAddress();

    if (!address) {
      throw new Error('Server returned an empty address.');
    }

    mainServerAddress = address;

    console.log(
      '✅ Main server address initialized:',
      mainServerAddress
    );

    loadMainServerApplication(mainServerAddress);
  } catch (error) {
    console.error('❌ Bootstrapping failed:', error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Could not connect to the backend server.';

    showFatalError(errorMessage);
  }
})();