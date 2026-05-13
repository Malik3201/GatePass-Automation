# GatePass-Automation

LAN visitor / gate entry pass automation. The **backend API** lives in [`backend/`](backend/README.md).

## USB camera mode (visitor / CNIC)

USB camera mode uses the operator PC’s webcam or document camera through the browser (`getUserMedia`). It works best when you open the app on the same machine as the cameras, for example:

`http://localhost:5000`

Browsers treat `localhost` as a secure context for camera access. If operators open the UI from another device using `http://SERVER-IP:5000`, the browser may block USB camera access unless you serve the site over **HTTPS**. For LAN deployments where multiple PCs view the gate UI, **IP camera mode** (stream and snapshot URLs) remains the recommended approach. For **mobile-as-IP-camera** testing, keep using **IP mode** with your phone’s IP Webcam URLs.