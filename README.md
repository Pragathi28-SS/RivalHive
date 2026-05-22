# RivalHive Website

## Run locally

```powershell
npm start
```

Then open `http://localhost:3000`.

## Enable review admin

Set an admin password before starting the server:

```powershell
$env:RIVALHIVE_ADMIN_PASSWORD="choose-a-private-password"
npm start
```

Reviews are stored in `data/reviews.json`. If you open `index.html` directly without the server, the review UI uses browser-only preview mode.
