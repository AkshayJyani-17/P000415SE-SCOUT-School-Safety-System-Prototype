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
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `CLICKSEND_USERNAME`
- `CLICKSEND_API_KEY`

Recommended local values:

```env
PORT=5000
BACKEND_URL=http://localhost:5000
JWT_SECRET=replace_with_local_secret
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_PROJECT_ID=scout-safety-prod
GMAIL_USER=your_gmail_address@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
CLICKSEND_USERNAME=your_clicksend_username
CLICKSEND_API_KEY=your_clicksend_api_key
```

Use `FIREBASE_SERVICE_ACCOUNT_PATH` for local development with a JSON file in `server/`. Use `FIREBASE_SERVICE_ACCOUNT_JSON` for hosted environments such as Render where the service account JSON is stored as an environment variable.

Notification delivery uses Gmail SMTP for email and ClickSend for SMS. The old SendGrid and Twilio variables are no longer used by the notification route.

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
