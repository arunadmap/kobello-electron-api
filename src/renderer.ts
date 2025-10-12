

import './index.css';

console.log(
  '👋 This message is being logged by "renderer.js", included via webpack',
);



const appSidebar = document.getElementById('sidebar');
if (appSidebar) {
  // Center content in the sidebar using flexbox
  appSidebar.style.display = 'flex';
  appSidebar.style.justifyContent = 'center';
  appSidebar.style.alignItems = 'center';
  appSidebar.style.height = '100vh'; // Ensure full height for vertical centering

  // Fetch the SVG icon from the server
  (async () => {
    try {
      // @ts-ignore
      const mainServerAddress = await window.api.getServerAddress();
      console.log('Main server address:', mainServerAddress);
      
      const serverAddress = mainServerAddress + "main";
      const iconUrl = `${serverAddress.replace(/\/$/, '')}/icon.svg`;
      const response = await fetch(iconUrl);
      if (!response.ok) throw new Error('Failed to load icon');
      const svgText = await response.text();

      // Create a container for the SVG icon
      const iconContainer = document.createElement('div');
      iconContainer.innerHTML = svgText;
      iconContainer.style.cursor = 'pointer';
      iconContainer.title = 'Open App';
      iconContainer.style.width = '32px';
      iconContainer.style.height = '32px';
      iconContainer.style.display = 'flex';
      iconContainer.style.justifyContent = 'center';
      iconContainer.style.alignItems = 'center';

      // Ensure the SVG itself is 32x32
      const svg = iconContainer.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '32');
        svg.setAttribute('height', '32');
        svg.style.width = '32px';
        svg.style.height = '32px';
        svg.style.display = 'block';
      }

      iconContainer.onclick = () => {
        const appDiv = document.getElementById('panel1');
        if (appDiv) {
          appDiv.innerHTML = '';
          const iframe = document.createElement('iframe');
          iframe.src = serverAddress;
          console.log('Loading app from:', serverAddress);
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          appDiv.appendChild(iframe);
        }

        const appDiv2 = document.getElementById('panel2');
        if (appDiv2) {
          appDiv2.innerHTML = '';
          const iframe = document.createElement('iframe');
          iframe.src = mainServerAddress+"explorer";
          console.log('Loading app from:', mainServerAddress+"explorer");
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          appDiv2.appendChild(iframe);
        }
      };

      appSidebar.appendChild(iconContainer);
    } catch (error) {
      console.error('Error loading SVG icon:', error);
    }
  })();
}
