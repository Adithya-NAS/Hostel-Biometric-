# Hostel Biometric App

A sample Python-based hostel biometric management system built with Kivy for mobile-friendly GUI and SQLite for secure local data storage.

## Features

- Student management: registration, edit, delete
- Biometric enrollment for fingerprint and face
- Biometric authentication for attendance tracking
- Daily and monthly attendance reports
- Admin login with secure password hashing
- Local storage for offline reliability

## Files

- `main.py` - application logic and database manager
- `hostel_biometric.kv` - user interface definitions
- `requirements.txt` - dependencies for Python environment

## Run locally

1. Create a Python virtual environment.

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

2. Use the default admin credentials:

- username: `admin`
- password: `password123`

## Mobile deployment

This app is written using Kivy and can be packaged for Android using Buildozer or Kivy Launcher.

Optional setup for Android packaging:

```bash
pip install buildozer
buildozer init
# edit buildozer.spec and include requirements from requirements.txt
buildozer android debug
```

## Notes

- Biometric hardware integration is represented with stub methods in `main.py`.
- For real device integration, connect to mobile biometric APIs using `plyer`, `pyjnius`, or platform-specific SDKs.
- Encryption is applied to stored biometric templates and password hashing is used for admin credentials.

## Next steps

- Replace `simulate_mobile_biometric_scan` with real fingerprint/face capture logic.
- Add SMS / email notification integration for late entry alerts.
- Extend the database schema for offline sync and cloud backup.
