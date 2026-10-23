# SMART-CAFE
A CAFE SELF ORDERING APPLICATON POWERED BY CONVERSATIONAL AI 
# Smart Cafe - AI-Powered Self Ordering Application

A curated, AI-powered digital concierge experience for a high-end bistro. A CAFE SELF ORDERING APPLICATION POWERED BY CONVERSATIONAL AI.

## Features

- **AI-Powered Recommendations**: Get personalized food and drink recommendations powered by Groq's Llama 3.1 model
- **Real-time Orders**: Place and track orders in real-time
- **Admin Dashboard**: Manage menu items, orders, and staff
- **Wine Concierge**: Sophisticated wine recommendations with responsible serving limits

## Run with Docker (dev sandbox)

```bash
docker compose -f docker-compose.base44.yml up -d
```

Then open `http://localhost:3000`. Firebase config and the Groq key come from environment
variables (see `AGENTS.md`); `.env.base44-defaults` holds placeholders so the app boots
without credentials, and values loaded from `/run/base44/app.env` override them.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Add your Groq API key:
     ```
     GROQ_API_KEY=your_api_key_here
     ```
   - Get your API key from [Groq Console](https://console.groq.com/keys)

3. Run the development server:

   ```bash
   npm run dev
   ```

4. Open your browser to `http://localhost:3000`

## Firebase Setup

This project uses Firebase for authentication and Firestore database.

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable Authentication (Google Sign-in)
4. Create a Firestore database
5. Update `firebase-applet-config.json` with your Firebase configuration

### Firestore Rules

Deploy the Firestore rules from `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

## Build for Production

```bash
npm run build
npm run preview
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js, Groq SDK
- **Database**: Firebase Firestore
- **AI**: Groq Llama 3.1 8B Instant
# SMART-CAFE
A CAFE SELF ORDERING APPLICATON POWERED BY CONVERSATIONAL AI 
