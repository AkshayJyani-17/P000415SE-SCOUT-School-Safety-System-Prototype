# SCOUT School Safety Dashboard Prototype

## Environment Setup

This project has two parts:

- Frontend: `client/`
- Backend: `server/`

### Default Local URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5000`
- Backend health check: `http://localhost:5000/api/health`

### Setup Steps

1. Install dependencies in both apps.

```bash
cd client
npm install

cd ../server
npm install
```

2. Copy the example env files and fill in your own values.

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

3. Add the Firebase service account file to the `server/` folder, or update the path in `server/.env`.

4. For a fresh Firebase project or emulator database, seed the required demo/setup data from the `server/` folder.

```bash
cd server
npm run seed:demo
npm run seed:alert-config
```

5. Start the backend first, then the frontend.

```bash
cd server
npm run dev

cd ../client
npm run dev
```

### Environment Variables

#### Frontend

The frontend uses:

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Recommended local value:

```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

#### Backend

The backend uses:

- `PORT`
- `JWT_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_PATH`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID`
- `BACKEND_URL`
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `CLICKSEND_USERNAME`
- `CLICKSEND_API_KEY`
- `SMS_DEFAULT_COUNTRY`
- `NOTIFICATION_WEBHOOK_SECRET`

Recommended local values:

```env
PORT=5000
BACKEND_URL=http://localhost:5000
JWT_SECRET=replace_with_local_secret
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_PROJECT_ID=scout-safety-prod
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender@example.com
BREVO_SENDER_NAME=SCOUT Safety System
CLICKSEND_USERNAME=your_clicksend_username
CLICKSEND_API_KEY=your_clicksend_api_key
SMS_DEFAULT_COUNTRY=AU
NOTIFICATION_WEBHOOK_SECRET=replace_with_a_long_random_string
```

Use `FIREBASE_SERVICE_ACCOUNT_PATH` for local development with a JSON file in `server/`. Use `FIREBASE_SERVICE_ACCOUNT_JSON` for hosted environments such as Render where the service account JSON is stored as an environment variable.

### Alert Notifications

Triggered alerts are sent by email through the Brevo API and by SMS through ClickSend. Both are called over HTTPS, so they work on Render's free tier, which blocks outbound SMTP. The old Gmail, SendGrid and Twilio variables are no longer used.

Every message is recorded in the `notifications` collection before it is sent, and each channel moves through `pending` → `sent` → `delivered`, or to `failed` with the reason in `emailError` / `smsError`. `skipped` means the recipient is not set up for that channel. The Notifications page shows these statuses, refreshes itself while recent messages are waiting for a receipt, and lets admins retry a failed channel.

One-time setup for a deployment:

1. **Brevo:** create an API key under SMTP & API, and verify the sender address under Senders & IP. Set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL`.
2. **ClickSend:** set `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY`. Messages are sent from ClickSend's shared numbers. Trial accounts can only text numbers verified in the ClickSend dashboard.
3. **Delivery receipts:** set `BACKEND_URL` to the public backend URL and choose a long random `NOTIFICATION_WEBHOOK_SECRET`. Then register these webhook URLs:
   - Brevo → Transactional → Settings → Webhooks, events *Delivered*, *Hard bounce*, *Blocked*, *Invalid email* and *Error*:
     `https://<backend>/api/notifications/webhooks/brevo?secret=<NOTIFICATION_WEBHOOK_SECRET>`
   - ClickSend → Messaging Settings → Delivery Reports Rules → add an SMS rule with the *URL* action:
     `https://<backend>/api/notifications/webhooks/clicksend?secret=<NOTIFICATION_WEBHOOK_SECRET>`

Without step 3, messages still send and show as `sent`, but they never move to `delivered`.

Run the notification tests with `npm run test:notifications` from `server/`.

### Important Notes

- If you change the backend port, update the frontend API base URL too.
- Do not commit real secrets or real `.env` files to the repo.
- Use the `.env.example` files as the shared template for the team.
- Make sure your backend routes are enabled before testing frontend integration.
- If you see `Failed to fetch`, first check that the backend is running and that the API port matches the frontend config.

## Git Workflow

Use this workflow so we can develop in separate branches and merge more safely.

1. Always start from the latest `main`.

```bash
git checkout main
git pull
```

2. Create a new feature branch from `main`.

```bash
git checkout -b your-branch-name
```

3. Work only on files related to your user story unless the team agrees on a shared change.

4. Before opening a pull request or merging, update your branch with the latest `main`.

```bash
git checkout main
git pull
git checkout your-branch-name
git merge main
```

5. Fix merge conflicts in your own branch before asking others to review or before merging.

6. Do not delete, revert, or overwrite teammates' work unless you have checked with them first.

7. If a change touches another teammate's scope, discuss it in the group before merging.

## Notes

- The safest habit is: `pull main` first, then create or update your feature branch.
- Merge `main` into your branch before merging to `main`, not after.
- Keep commits focused so conflicts are easier to resolve.




