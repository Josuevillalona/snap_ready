import requests
import json
import time

API_URL = "http://localhost:8000"
TEST_IMG = "test-photos/IMG_0128.jpg"

try:
    print("1. Testing Upload (POST /process)...")
    with open(TEST_IMG, "rb") as f:
        files = {"file": f}
        data = {"intensity": "medium"}
        resp = requests.post(f"{API_URL}/process", files=files, data=data)
        
    if resp.status_code != 200:
        print(f"Failed! {resp.text}")
        exit(1)
        
    job_id = resp.json()["job_id"]
    print(f"Success! Job ID: {job_id}")
    
    # Wait for file system
    time.sleep(1)
    
    print("\n2. Testing Static Serving (GET /uploads/{job_id}/retouched.jpg)...")
    resp = requests.get(f"{API_URL}/uploads/{job_id}/retouched.jpg")
    print(f"Status: {resp.status_code}, Length: {len(resp.content)} bytes")
    
    print("\n3. Testing ZIP Download (GET /download/{job_id})...")
    resp = requests.get(f"{API_URL}/download/{job_id}")
    print(f"Status: {resp.status_code}, Length: {len(resp.content)} bytes")
    if resp.status_code == 200:
        print("All API tests passed! ✅")
        
except Exception as e:
    print(f"Error: {e}")
