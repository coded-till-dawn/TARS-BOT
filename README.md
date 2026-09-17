# TARS Bot

A feature-rich, high-performance WhatsApp Multi-Device Bot with a built-in Web Admin Dashboard and advanced AI conversational capabilities.

🔗 **GitHub Repository:** [https://github.com/coded-till-dawn/TARS-BOT](https://github.com/coded-till-dawn/TARS-BOT)

TARS Bot is powered by cutting-edge web technologies, designed to provide seamless WhatsApp automation, dynamic command loading, and a suite of powerful utilities.

---

## 🚀 Key Features

### 🤖 Artificial Intelligence
- **TARS Conversational AI:** The primary persona-driven AI for natural interactions.
- **Gemini Conversational AI:** Separate, specialized Google Gemini integration for complex prompts and generation.
- **Google Search:** Live, real-time web search powered by the **Serper API**.

### 🎨 Media & Stickers
- **Sticker Maker:** Convert images and videos into animated or static WebP stickers.
- **Auto-Sticker for Images:** Automatically converts any normal, caption-less image sent in a group into a sticker (when enabled via the dashboard).
- **Auto-Sticker for GIFs:** Automatically converts any caption-less GIF into an animated sticker. *(Note: Normal videos and captioned media are explicitly ignored to prevent spam).*
- **Media Conversion & Search:** Image search, meme generation, and extensive music/audio commands including lyrics integration.
- **Utilities:** News fetching, horoscope, programming quotes, urban dictionary, and more.

### ⚙️ Command System & Administration
- **Dynamic Command Loading:** Commands are hot-loaded and categorized into Public, Member, Admin, and Owner scopes.
- **Command Prefix:** `-` (e.g., `-sticker`, `-gs OpenAI`).
- **Web Admin Dashboard:** A React/Vite-powered interface to control group settings, toggle features (like Auto-Sticker), manage command scopes, and monitor bot health.

---

## 🛠️ Technology Stack

- **Runtime:** Node.js 22+ / Bun 1.3.11+
- **WhatsApp Library:** Baileys (7.0.0-rc14)
- **Database:** MongoDB 8
- **Server:** Express.js
- **Frontend Dashboard:** React & Vite
- **APIs:** Google Gemini API, Google Serper API
- **Caching:** Redis (Optional)

---

## 📂 Project Structure

- `commands/` - Dynamically loaded bot commands (admin, owner, public, members).
- `core/` - Core Baileys connection logic, message dispatcher, and event handlers.
- `dashboard/` - React/Vite source code for the Web Admin Dashboard.
- `db/` - MongoDB schemas, connection logic, and caching layers.
- `functions/` - Helper functions for specific API integrations.
- `media/` - Static assets, default tag stickers, and fonts.
- `notify/` - Event listeners for admin and group updates.
- `public/` - Publicly served files, EJS templates, and the TARS profile image (`tars.jpg`).
- `queue/` - Rate limiting and message queue processing.
- `routes/` - Express API routes serving the dashboard.
- `scripts/` - Utility scripts.
- `utils/` - Shared utilities, memory management, and formatting tools.

---

## ⚙️ Installation & Setup

### 1. Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v22+)
- [Bun](https://bun.sh/) (v1.1+)
- A running instance of **MongoDB** (Local or Atlas)
- **FFmpeg** (Ensure it is added to your system PATH for sticker/media conversions)

### 2. Clone the Repository
```bash
git clone https://github.com/coded-till-dawn/TARS-BOT.git
cd TARS-BOT
```

### 3. Environment Variables
Create a `.env` file in the root directory based on `.env.example`. You will need to provide your API keys:

```env
# Database
MONGODB_URI=mongodb+srv://your_username:your_password@cluster...

# APIs
GEMINI_API_KEY=your_gemini_key_here
SERPER_API_KEY=your_serper_key_here

# Bot Owner
OWNER_NUMBER=1234567890

# Express Server
PORT=8000
```
*(⚠️ Never commit your `.env` file to version control.)*

### 4. Install Dependencies
Use Bun to install dependencies for both the bot and the dashboard workspace:
```bash
bun install
```

### 5. Build the Dashboard
Compile the React/Vite admin dashboard for production:
```bash
bun run build
```

### 6. Start the Bot
Run the bot using the default start script:
```bash
bun run start
```
Scan the QR code printed in the terminal (or authenticate via the pairing code) with your WhatsApp mobile app to link the bot.

---

## 🙏 Credits & Acknowledgements

The **TARS Bot** project was adapted from and built upon the excellent foundation of the [WhatsAppBotMultiDevice](https://github.com/jacktheboss220/WhatsAppBotMultiDevice) codebase created by jacktheboss220. We extend our thanks to the original author for the underlying multi-device architecture.

*This project is actively maintained as TARS Bot at [coded-till-dawn/TARS-BOT](https://github.com/coded-till-dawn/TARS-BOT).*
