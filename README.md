# SnapReady

SnapReady is a one-click crop and retouch application designed for headshot photographers. It takes an uploaded portrait photo, automatically detects and crops an ideal square headshot using Google MediaPipe, and then applies professional AI retouching (light, medium, or strong) using the Gemini 3 Pro Image API.

## Architecture

The project is split into a hybrid architecture for optimized, free-tier deployment:

- **Frontend (`/frontend/public`)**: A vanilla HTML, CSS, and JavaScript interface designed to be hosted statically on **Vercel**.
- **Backend (Root Directory)**: A lightweight **FastAPI** Python service designed to run on **Render**. It handles image processing (Python Pillow + OpenCV), facial detection (MediaPipe), and API communication (Google GenAI SDK).

## Local Development Setup

### 1. Backend API

Requirements: Python 3.12+

1. Install the dependencies via [Poetry](https://python-poetry.org/) or pip using the provided files:
   ```bash
   poetry install
   # OR
   pip install -r requirements.txt
   ```
2. Create a `.env` file in the root directory and add your Google Gemini API key:
   ```env
   GEMINI_API_KEY="your_api_key_here"
   ```
3. Start the FastAPI development server:
   ```bash
   uvicorn app:app --port 8000 --reload
   ```

### 2. Frontend Server

The frontend consists of static files. To test it locally while communicating with your local backend API, you can start a simple HTTP server.

1. In a new terminal tab, navigate to the frontend directory:
   ```bash
   cd frontend/public
   ```
2. Start a Python static HTTP server:
   ```bash
   python3 -m http.server 3000
   ```
3. Open your browser and navigate to `http://localhost:3000`.

*Note: The frontend code in `main.js` is automatically configured to point to `http://localhost:8000` when running locally.*

## Deployment Guide

- **Vercel (Frontend)**: The project includes a `vercel.json` configuration file. Connecting this GitHub repository to Vercel will automatically detect the static build output and cleanly deploy the `frontend/public/` directory.
- **Render (Backend)**: The project includes a `render.yaml` configuration file. Connecting this repository to Render as a Web Service will automatically spin up the FastAPI service. **Requirement**: Ensure you manually add `GEMINI_API_KEY` to your Render environment variables. We have included a `.python-version` file to enforce Python 3.12 support.
