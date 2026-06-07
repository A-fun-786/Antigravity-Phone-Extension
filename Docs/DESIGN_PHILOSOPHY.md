# DESIGN PHILOSOPHY - Antigravity Phone Connect

## Problem Statement
Developing with powerful AI models like Claude or Gemini in Antigravity often involves long "thinking" times or prolonged generation of large codebases. Developers are often "tethered" to their desks, waiting for a prompt to finish before they can review or provide the next instruction.

## The Solution: A Seamless Extension
Antigravity Phone Connect isn't a replacement for the desktop IDE; it's a **wireless viewport**. It solves the "tethering" problem by mirroring the state of the desktop session to any device on the local network.

## Design Principles

### 1. Robustness Over Precision (With The Zero-Proxy Filter)
Selecting elements in a dynamically changing IDE like Antigravity is brittle. This project prioritizes **Text-Based Selection** and **Fuzzy Matching**. Instead of looking for `.button-32x`, we look for an element that *looks like a button* and *contains the word "Gemini"*. To ensure 100% accuracy with multiple identical elements (e.g., three separate "Thought for 2s" blocks), we implement **Occurrence Index Tracking**. 

Furthermore, to solve the "Nested DOM Trap" (where clicking a parent div fails but clicking the inner span works), we apply **Leaf-Node Isolation**. The system automatically discards container results and targets the inner-most matching node, ensuring that your tap on a mobile device lands exactly where it needs to on the Desktop.

### 2. Zero-Impact Mirroring
The snapshot system clones the DOM before capturing. This ensures that the mirroring process doesn't interfere with the developer's cursor, scroll position, or focus on the Desktop machine.

> 🎨 **Note**: For all UI design decisions, CSS architecture (Visual Parity, Dark Mode, Mobile-First Navigation), and snapshot rendering details, see [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md).

> 📚 For browser warning bypass instructions and security recommendations, see [SECURITY.md](SECURITY.md).

### 4. Resilient Error Handling
- **Optimistic Updates**: Message sending clears the input immediately and refreshes to verify.
- **Layered Interaction**: Using full-screen overlays for history management ensures that complex navigation doesn't interfere with the real-time session mirroring.
- **Silent Failure resilience**: Memory leak prevention and centralized CDP handling ensure the server stays up even if the desktop session is volatile.
- **Graceful Shutdown**: Clean exit on Ctrl+C, closing all connections properly.

## Human-Centric Features

- **The "Bathroom" Use Case**: Optimized for quick checking of status while away from the desk.
- **Thought & Status Expansion**: The generation process often "hides" the reasoning or file lists. We added remote-click relay specifically so you can "peek" into the AI's internal thoughts, check "Worked for" durations, or expand "Edited files" lists from your phone.
- **Remote Command Actions**: When Antigravity proposes a terminal command or asks for permission, the "Run", "Reject", "Allow", "Deny", and "Review Changes" buttons are now tappable from mobile. This eliminates the need to walk back to your desk just to approve or reject a single action — the **"bathroom use case"** taken to its logical conclusion.
- **Quick Actions (Prompt Pills)**: Reduces the friction of common repetitive interactions on mobile. One-tap actions like "Continue", "Fix Bugs", or "Explain this code" are instantly relayed up to the Desktop IDE with no manual typing required.
- **Bi-directional Sync**: If you change the model on your Desktop, your phone updates automatically. The goal is for both devices to feel like parts of the same "brain".
- **💖 Project Sustainability**: By integrating a non-intrusive support heart and modal, we acknowledge the value provided by the tool while offering a seamless way to support its ongoing development.
- **🔒 Secure Connection**: HTTPS support removes the browser warning icon, making the experience feel more professional and trustworthy.
- **📦 Self-Contained Runtime (venv)**: By bundling dependencies into a local virtual environment, we shield the user from OS-level Python re-configurations (like Arch's externally managed environments) and provide a "delete-folder-to-uninstall" experience.
- **Zero-Config**: Users shouldn't need to be DevOps engineers to run a mobile monitor. We automate the boring parts (SSL generation, venv setup, process cleanup).

## Technical Trade-offs

| Decision | Rationale |
| :--- | :--- |
| Self-signed certs (not CA) | Simpler setup, works offline, no domain needed |
| Pure Node.js SSL generation | No OpenSSL dependency, works on all platforms |
| Passcode-Protected Web Mode | Secure remote access without the friction of full OAuth |
| LAN Auto-Authorization | High convenience for the developer's primary workspace |
| Optimistic message sending | Better UX; message usually succeeds even if CDP reports issues |
| Multiple snapshot reloads | Catches UI animations that complete after initial delay |
